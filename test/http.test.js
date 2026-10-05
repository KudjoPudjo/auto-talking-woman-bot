import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { AI } from '../src/ai.js';
import { createApp } from '../src/app.js';

test('HTTP authentication, CSRF, contact lifecycle and protected state', async () => {
  const store = new Store(null);
  const ai = new AI({ demo: true });
  const telegram = { status: () => ({ connected: false }) };
  const engine = new Engine({ store, ai, transport: telegram, demo: true });
  const app = createApp({
    store,
    ai,
    engine,
    telegram,
    config: { demo: false, password: 'a-very-long-test-password', allowedHosts: ['127.0.0.1'] },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/state')).status, 401);
    const invalid = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'incorrect' }),
    });
    assert.equal(invalid.status, 401);
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'a-very-long-test-password' }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const { csrf } = await login.json();
    assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    const headers = { cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
    assert.equal((await fetch(base + '/api/state', { headers })).status, 200);
    assert.equal(
      (
        await fetch(base + '/api/settings', {
          method: 'PATCH',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + '/api/settings', {
          method: 'PATCH',
          headers: { ...headers, origin: 'https://evil.example' },
          body: '{}',
        })
      ).status,
      403,
    );
    store.state.contacts.push({
      id: 'c1',
      peerId: '123',
      accessHash: 'SECRET',
      name: 'A',
      active: false,
      consent: 'stopped',
    });
    const response = await fetch(base + '/api/state', { headers });
    assert.ok(!(await response.text()).includes('SECRET'));
    assert.equal(
      (
        await fetch(base + '/api/contacts/c1', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ consent: 'accepted' }),
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + '/api/contacts/c1', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ active: true }),
        })
      ).status,
      400,
    );
    store.state.messages.push({ contactId: 'c1', text: 'private' });
    store.state.dates.push({ contactId: 'c1', place: 'private' });
    assert.equal((await fetch(base + '/api/contacts/c1', { method: 'DELETE', headers })).status, 200);
    assert.equal(store.state.messages.length, 0);
    assert.equal(store.state.dates.length, 0);
    assert.equal(
      (await fetch(base + '/api/demo/message', { method: 'POST', headers, body: '{}' })).status,
      404,
    );
    await fetch(base + '/api/logout', { method: 'POST', headers, body: '{}' });
    assert.equal((await fetch(base + '/api/state', { headers })).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
