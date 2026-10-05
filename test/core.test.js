import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store, initialState, removeContact } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { AI, replySchema } from '../src/ai.js';
import { encrypt, decrypt } from '../src/crypto.js';
import { previewImport, extractMessages, styleSamples } from '../src/import.js';
import { TelegramAccount } from '../src/telegram.js';
import { Api } from 'teleproto';

function fixture(reply) {
  const state = initialState();
  state.style = { profile: {} };
  state.contacts = [
    {
      id: 'c1',
      peerId: '123',
      name: 'Test',
      active: true,
      mode: 'auto',
      consent: 'accepted',
      disclosureAt: new Date().toISOString(),
    },
  ];
  const store = new Store(null, state);
  const sent = [];
  const ai = { reply: reply ?? (async () => ({ text: 'Ответ', needsReview: false, reason: '' })) };
  const engine = new Engine({
    store,
    ai,
    transport: {
      send: async (c, text) => {
        sent.push({ contact: c.id, text });
        return '77';
      },
    },
  });
  return { store, engine, sent };
}
const message = (text = 'Привет', sourceId = '1', peerId = '123', outgoing = false) => ({
  text,
  sourceId,
  peerId,
  outgoing,
  at: new Date().toISOString(),
});
const settle = async (engine) => {
  await Promise.all([...engine.running.values()]);
};

test('unknown dialogs are ignored without saving or sending', async () => {
  const { store, engine, sent } = fixture();
  await engine.ingest(message('private', '1', '999'));
  await settle(engine);
  assert.equal(store.state.messages.length, 0);
  assert.equal(sent.length, 0);
});
test('consent requires delivered disclosure and can only come from selected contact', async () => {
  const { store, engine, sent } = fixture();
  const c = store.state.contacts[0];
  c.consent = 'pending';
  c.disclosureAt = null;
  await engine.ingest(message('/agree'));
  assert.equal(c.consent, 'pending');
  await engine.disclose('c1');
  assert.equal(sent.length, 1);
  await engine.ingest(message('/agree', '2'));
  assert.equal(c.consent, 'accepted');
  await engine.ingest(message('Как день?', '3'));
  await settle(engine);
  assert.equal(sent.length, 2);
});
test('duplicate Telegram events do not duplicate replies', async () => {
  const { store, engine, sent } = fixture();
  await engine.ingest(message());
  await settle(engine);
  await engine.ingest(message());
  assert.equal(sent.length, 1);
  assert.equal(store.state.messages.filter((m) => m.role === 'contact').length, 1);
});
test('stop during generation prevents delivery', async () => {
  let finish;
  const { store, engine, sent } = fixture(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  await engine.ingest(message());
  await engine.ingest(message('/stop', '2'));
  finish({ text: 'Delayed', needsReview: false, reason: '' });
  await settle(engine);
  assert.equal(sent.length, 0);
  assert.equal(store.state.contacts[0].consent, 'stopped');
});
test('global pause and manual takeover prevent in-flight generated delivery', async () => {
  for (const mode of ['global', 'manual']) {
    let finish;
    const { store, engine, sent } = fixture(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    await engine.ingest(message());
    if (mode === 'global') store.state.settings.paused = true;
    else await engine.ingest(message('Сам отвечу', '2', '123', true));
    finish({ text: 'Delayed', needsReview: false, reason: '' });
    await settle(engine);
    assert.equal(sent.length, 0);
  }
});
test('delete during generation removes all contact data and cannot resurrect it', async () => {
  let finish;
  const { store, engine, sent } = fixture(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  await engine.ingest(message());
  removeContact(store, 'c1');
  finish({ text: 'Delayed', needsReview: false, reason: '' });
  await settle(engine);
  assert.equal(sent.length, 0);
  assert.equal(store.state.messages.length, 0);
  assert.equal(store.state.jobs.length, 0);
});
test('responses requiring review are never automatically sent', async () => {
  const { store, engine, sent } = fixture(async () => ({
    text: '',
    needsReview: true,
    reason: 'Подтвердите время встречи.',
  }));
  await engine.ingest(message('Завтра в 5?'));
  await settle(engine);
  assert.equal(sent.length, 0);
  assert.equal(store.state.messages.at(-1).status, 'review');
});
test('failed send becomes uncertain and cannot be blindly sent again', async () => {
  const { store, engine } = fixture();
  engine.transport.send = async () => {
    throw new Error('timeout');
  };
  await engine.ingest(message());
  await settle(engine);
  const draft = store.state.messages.find((m) => m.role === 'assistant');
  assert.equal(draft.status, 'uncertain');
  await assert.rejects(engine.deliver(draft), /уже отправлено/);
});
test('send double click and restart do not cause repeated sends', async () => {
  const { store, engine, sent } = fixture();
  const m = engine.addMessage('c1', 'assistant', 'Hi', 'draft');
  const first = engine.deliver(m);
  await assert.rejects(engine.deliver(m));
  await first;
  assert.equal(sent.length, 1);
  m.status = 'sending';
  new Engine({ store, ai: {}, transport: {} });
  assert.equal(m.status, 'uncertain');
});
test('outgoing echo from agent does not activate manual takeover', async () => {
  const { store, engine } = fixture();
  engine.transport.send = async (c, text) => {
    await engine.ingest(message(text, '77', c.peerId, true));
    return '77';
  };
  await engine.ingest(message());
  await settle(engine);
  assert.equal(store.state.contacts[0].active, true);
  assert.equal(store.state.messages.length, 2);
});
test('stale drafts cannot be sent after conversation changes', async () => {
  const { store, engine } = fixture();
  store.state.contacts[0].mode = 'review';
  await engine.ingest(message());
  const m = await engine.generate('c1');
  await engine.ingest(message('Новое', '2'));
  await assert.rejects(engine.deliver(m), /переписка изменилась/);
});
test('import flattens entities, isolates chat and selects only own style samples', () => {
  const chat = {
    id: 123,
    name: 'Example',
    type: 'personal_chat',
    messages: Array.from({ length: 12 }, (_, i) => ({
      id: i,
      type: 'message',
      from: i % 2 ? 'Friend' : 'Me',
      from_id: i % 2 ? 'user2' : 'user1',
      date_unixtime: '1700000000',
      text:
        i % 2
          ? 'OTHER PRIVATE'
          : [{ type: 'bold', text: 'Мой текст' }, ' @myname https://example.com +79991234567'],
    })),
  };
  const data = {
    chats: {
      list: [chat, { ...chat, id: 456, messages: [{ type: 'message', from_id: 'user3', text: 'SECRET' }] }],
    },
  };
  assert.equal(previewImport(data).length, 2);
  const selected = extractMessages(data, '123', 'user1');
  const samples = styleSamples(selected);
  assert.equal(samples.length, 6);
  assert.ok(
    samples.every(
      (x) => !x.includes('PRIVATE') && !x.includes('SECRET') && !x.includes('7999') && !x.includes('@myname'),
    ),
  );
  assert.throws(() => extractMessages(data, '123', 'user9'));
  assert.throws(() => previewImport({ type: 'private_group', messages: [] }));
});
test('encrypted store persists and wrong key/tampering fails closed', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'blizhe-test-'));
  const file = path.join(folder, 'store.enc');
  const key = 'ab'.repeat(32);
  try {
    const store = new Store(file, undefined, key);
    store.update((s) => {
      s.settings.notes = 'Sensitive';
    });
    assert.ok(!readFileSync(file, 'utf8').includes('Sensitive'));
    assert.equal(new Store(file, undefined, key).state.settings.notes, 'Sensitive');
    assert.throws(() => new Store(file, undefined, 'cd'.repeat(32)));
    const payload = JSON.parse(encrypt('secret', key));
    payload.data = 'dGFtcGVyZWQ=';
    assert.throws(() => decrypt(JSON.stringify(payload), key));
  } finally {
    rmSync(folder, { recursive: true });
  }
});
test('AI request excludes other contacts, disables API storage and validates output', async () => {
  let body;
  const ai = new AI({
    key: 'test',
    fetcher: async (url, options) => {
      body = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          status: 'completed',
          output: [
            {
              content: [
                { type: 'output_text', text: JSON.stringify({ text: 'Hi', needsReview: false, reason: '' }) },
              ],
            },
          ],
        }),
      };
    },
  });
  const result = await ai.reply({
    contact: { notes: 'selected' },
    settings: {},
    style: {},
    messages: [message('hello')],
  });
  assert.equal(result.text, 'Hi');
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  ai.fetcher = async () => ({
    ok: true,
    json: async () => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{}' }] }] }),
  });
  await assert.rejects(ai.structured(replySchema, '', {}), /ожидаемый формат/);
});
test('Telegram peer serialization, raw text and per-request retry control', async () => {
  const transport = new TelegramAccount({});
  transport.ready = true;
  let args, options;
  transport.client = {
    invoke: async (request, dcId, opts) => {
      request.getBytes();
      args = request;
      options = opts;
      return { id: 42 };
    },
  };
  assert.equal(await transport.send({ peerId: '1234', accessHash: '987654321' }, '**literal**'), '42');
  assert.equal(args.message, '**literal**');
  assert.equal(args.entities, undefined);
  assert.equal(options.maxRetryCount, 0);
  assert.ok(
    new Api.auth.SignIn({ phoneNumber: '+19999999999', phoneCodeHash: 'x', phoneCode: '12345' }).getBytes()
      .length > 0,
  );
});

test('Telegram login flow handles code, two-factor challenge, email code and cancellation', async () => {
  const transport = new TelegramAccount({ apiId: '12345', apiHash: 'hash', key: 'aa'.repeat(32) });
  let mode = 'phone',
    called;
  transport.createClient = async () => {
    transport.client = {
      sendCode: async () => ({ phoneCodeHash: 'challenge', emailCodeSent: mode === 'email' }),
      invoke: async (request) => {
        called = request;
        if (mode === '2fa') throw { errorMessage: 'SESSION_PASSWORD_NEEDED' };
        return {};
      },
      destroy: async () => {},
    };
  };
  transport.activate = async () => {
    transport.ready = true;
    transport.stage = 'connected';
  };
  await transport.sendCode('+19999999999');
  assert.equal(transport.stage, 'code');
  mode = '2fa';
  await transport.signIn('12345');
  assert.equal(transport.stage, 'password');
  assert.equal(called.phoneCodeHash, 'challenge');
  await transport.cancelLogin();
  assert.equal(transport.stage, 'phone');
  assert.equal(transport.phoneCodeHash, null);
  mode = 'email';
  await transport.sendCode('+19999999999');
  assert.equal(transport.stage, 'email-code');
  await transport.signIn('123456');
  assert.ok(called.emailVerification instanceof Api.EmailVerificationCode);
  assert.equal(transport.stage, 'connected');
});
