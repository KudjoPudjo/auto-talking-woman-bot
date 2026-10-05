import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { id, now, contactById, removeContact } from './store.js';
import { previewImport, extractMessages, styleSamples } from './import.js';
import { styleSchema } from './ai.js';

const contactPatch = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    notes: z.string().max(3000).optional(),
    active: z.boolean().optional(),
    mode: z.enum(['auto', 'review']).optional(),
  })
  .strict();
const importInput = z.object({
  data: z.unknown(),
  chatKey: z.string(),
  selfId: z.string(),
  contactId: z.string().optional(),
  permission: z.literal(true),
});
const dateInput = z.object({
  contactId: z.string(),
  at: z.iso.datetime({ offset: true }),
  place: z.string().trim().min(1).max(200),
  notes: z.string().max(2000).default(''),
});
const error = (message, status = 400) => Object.assign(new Error(message), { status });

export function createApp({ store, engine, ai, telegram, config }) {
  const app = express();
  const sessions = new Map();
  const salt = randomBytes(16);
  const passwordHash = scryptSync(config.password || 'demo-password', salt, 64);
  const publicDir = fileURLToPath(new URL('../public', import.meta.url));
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const host = req.hostname;
    if (!config.allowedHosts.includes(host))
      return res.status(403).json({ error: 'Недопустимый адрес сервера.' });
    if (req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host)
          return res.status(403).json({ error: 'Запрос с другого сайта отклонён.' });
      } catch {
        return res.status(403).json({ error: 'Некорректный Origin.' });
      }
    }
    next();
  });
  app.use(express.json({ limit: '15mb' }));
  const loginLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 15,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Слишком много попыток входа. Подождите 15 минут.' },
  });
  function session(req) {
    const match = /(?:^|;\s*)blizhe=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '');
    const item = match && sessions.get(match[1]);
    return item && item.expires > Date.now() ? item : null;
  }
  app.post('/api/login', loginLimit, (req, res) => {
    const value = z.object({ password: z.string().max(500) }).parse(req.body);
    if (!config.demo && !timingSafeEqual(passwordHash, scryptSync(value.password, salt, 64)))
      return res.status(401).json({ error: 'Неверный пароль.' });
    for (const [key, value] of sessions) if (value.expires < Date.now()) sessions.delete(key);
    if (sessions.size > 20) sessions.delete(sessions.keys().next().value);
    const token = randomBytes(32).toString('hex');
    const csrf = randomBytes(24).toString('hex');
    sessions.set(token, { csrf, expires: Date.now() + 12 * 3600000 });
    res.cookie('blizhe', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      maxAge: 12 * 3600000,
      path: '/',
    });
    res.json({ csrf });
  });
  app.get('/api/session', (req, res) =>
    res.json({ authenticated: Boolean(session(req)), demo: config.demo, csrf: session(req)?.csrf }),
  );
  app.use('/api', (req, res, next) => {
    const current = session(req);
    if (!current) return res.status(401).json({ error: 'Войдите в панель управления.' });
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-csrf-token'] !== current.csrf)
      return res.status(403).json({ error: 'Обновите страницу и повторите действие.' });
    next();
  });
  app.post('/api/logout', (req, res) => {
    const current = session(req);
    for (const [key, value] of sessions) if (value === current) sessions.delete(key);
    res.clearCookie('blizhe', { path: '/' });
    res.json({ ok: true });
  });
  app.get('/api/state', (req, res) => {
    const { contacts, settings, style, dates, events, jobs } = store.state;
    res.json({
      contacts: contacts.map(({ accessHash, ...c }) => ({
        ...c,
        messageCount: engine.conversation(c.id).length,
        lastMessage: store.state.messages.filter((m) => m.contactId === c.id).at(-1),
        pending: store.state.messages.filter(
          (m) => m.contactId === c.id && ['draft', 'review', 'uncertain'].includes(m.status),
        ).length,
      })),
      settings,
      style,
      dates,
      events,
      jobs: jobs.slice(-100),
      demo: config.demo,
      telegram: config.demo
        ? { connected: false, configured: false, stage: 'demo', user: null }
        : telegram.status(),
      aiConfigured: Boolean(config.aiKey),
      model: config.model,
    });
  });
  app.patch('/api/settings', (req, res) => {
    const patch = z
      .object({
        paused: z.boolean().optional(),
        ownerName: z.string().trim().max(80).optional(),
        notes: z.string().max(3000).optional(),
      })
      .strict()
      .parse(req.body);
    store.update((s) => Object.assign(s.settings, patch));
    res.json(store.state.settings);
  });
  app.post('/api/contacts', async (req, res) => {
    const value = z
      .object({
        name: z.string().trim().max(80).default(''),
        reference: z
          .string()
          .trim()
          .regex(/^(?:[1-9]\d{0,15}|@[a-zA-Z][a-zA-Z0-9_]{3,31})$/),
        notes: z.string().max(3000).default(''),
      })
      .parse(req.body);
    const resolved = config.demo
      ? {
          peerId: /^\d+$/.test(value.reference) ? value.reference : String(Date.now()),
          username: value.reference.replace('@', ''),
          name: value.name || 'Новый контакт',
        }
      : await telegram.resolve(value.reference);
    if (store.state.contacts.some((c) => c.peerId === resolved.peerId)) throw error('Контакт уже добавлен.');
    const c = {
      ...resolved,
      id: id(),
      name: value.name || resolved.name,
      notes: value.notes,
      active: true,
      mode: 'auto',
      consent: 'pending',
      disclosureAt: null,
      consentAt: null,
      createdAt: now(),
    };
    store.update((s) => s.contacts.push(c));
    const { accessHash, ...safe } = c;
    res.status(201).json(safe);
  });
  app.patch('/api/contacts/:id', (req, res) => {
    const c = contactById(store, req.params.id);
    const patch = contactPatch.parse(req.body);
    if (patch.active && c.consent === 'stopped')
      throw error('Собеседница остановила агента. Возобновление возможно только после её /agree.');
    store.update(() => Object.assign(c, patch));
    res.json({ ok: true });
  });
  app.delete('/api/contacts/:id', (req, res) => {
    removeContact(store, req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/contacts/:id/disclose', async (req, res) => {
    await engine.disclose(req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/contacts/:id/messages', (req, res) => {
    contactById(store, req.params.id);
    res.json(store.state.messages.filter((m) => m.contactId === req.params.id).slice(-500));
  });
  const aiLimit = rateLimit({
    windowMs: 60000,
    limit: 12,
    message: { error: 'Подождите минуту перед следующим запросом ИИ.' },
  });
  app.post('/api/contacts/:id/generate', aiLimit, async (req, res) => {
    await engine.generate(req.params.id);
    res.json({ ok: true });
  });
  app.post('/api/messages/:id/send', async (req, res) => {
    const m = store.state.messages.find((m) => m.id === req.params.id);
    if (!m || m.role !== 'assistant' || !['draft', 'review'].includes(m.status))
      throw error('Черновик не найден.', 404);
    const { text } = z.object({ text: z.string().trim().min(1).max(3000) }).parse(req.body);
    store.update(() => {
      m.text = text;
    });
    await engine.deliver(m);
    res.json({ ok: true });
  });
  app.delete('/api/messages/:id', (req, res) => {
    const m = store.state.messages.find((m) => m.id === req.params.id);
    if (!m || !['draft', 'review'].includes(m.status)) throw error('Можно удалить только черновик.');
    store.update((s) => {
      s.messages = s.messages.filter((x) => x.id !== m.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/import/preview', (req, res) => res.json(previewImport(req.body.data)));
  app.post('/api/import/style', aiLimit, async (req, res) => {
    const value = importInput.parse(req.body);
    const samples = styleSamples(extractMessages(value.data, value.chatKey, value.selfId));
    const profile = await ai.analyze(samples);
    store.update((s) => {
      s.style = { profile, sampleCount: samples.length, updatedAt: now() };
    });
    res.json(store.state.style);
  });
  app.put('/api/style', (req, res) => {
    const profile = styleSchema.parse(req.body);
    store.update((s) => {
      s.style = { profile, sampleCount: s.style?.sampleCount ?? 0, updatedAt: now() };
    });
    res.json(store.state.style);
  });
  app.delete('/api/style', (req, res) => {
    store.update((s) => {
      s.style = null;
      s.settings.paused = true;
    });
    res.json({ ok: true });
  });
  app.post('/api/import/history', (req, res) => {
    const value = importInput.parse(req.body);
    contactById(store, value.contactId);
    const messages = extractMessages(value.data, value.chatKey, value.selfId);
    let count = 0;
    store.update((s) => {
      const existing = new Set(
        s.messages.filter((m) => m.contactId === value.contactId).map((m) => m.sourceId),
      );
      for (const m of messages)
        if (!existing.has(m.sourceId)) {
          s.messages.push({ ...m, id: id(), contactId: value.contactId, status: 'imported' });
          existing.add(m.sourceId);
          count++;
        }
      s.messages.sort((a, b) => a.at.localeCompare(b.at));
    });
    res.json({ count });
  });
  async function makeBrief(dateId) {
    const date = store.state.dates.find((d) => d.id === dateId);
    if (!date) throw error('Встреча не найдена.', 404);
    const messages = engine.conversation(date.contactId);
    if (!messages.length) throw error('Для конспекта нужна переписка.');
    const brief = await ai.brief({ messages, date });
    if (store.state.dates.includes(date))
      store.update(() => {
        date.brief = brief;
        date.briefAt = now();
        date.briefMessageId = messages.at(-1).id;
      });
    return brief;
  }
  app.post('/api/dates', aiLimit, async (req, res) => {
    const value = dateInput.parse(req.body);
    contactById(store, value.contactId);
    const date = { ...value, id: id(), status: 'planned', brief: null };
    store.update((s) => s.dates.push(date));
    try {
      await makeBrief(date.id);
    } catch (e) {
      store.update(() => {
        date.briefError = e.message;
      });
    }
    res.status(201).json(date);
  });
  app.post('/api/dates/:id/brief', aiLimit, async (req, res) => res.json(await makeBrief(req.params.id)));
  app.patch('/api/dates/:id', (req, res) => {
    const date = store.state.dates.find((d) => d.id === req.params.id);
    if (!date) throw error('Встреча не найдена.', 404);
    const patch = z
      .object({
        at: z.iso.datetime({ offset: true }).optional(),
        place: z.string().trim().min(1).max(200).optional(),
        notes: z.string().max(2000).optional(),
        status: z.enum(['planned', 'done', 'cancelled']).optional(),
      })
      .strict()
      .parse(req.body);
    store.update(() => {
      Object.assign(date, patch);
    });
    res.json(date);
  });
  app.delete('/api/dates/:id', (req, res) => {
    store.update((s) => {
      s.dates = s.dates.filter((d) => d.id !== req.params.id);
    });
    res.json({ ok: true });
  });
  app.use('/api/telegram', (req, res, next) => {
    if (config.demo)
      return res.status(400).json({ error: 'В демо Telegram отключён. Запустите рабочий режим.' });
    next();
  });
  app.get('/api/telegram/dialogs', async (req, res) => res.json(await telegram.dialogs()));
  app.post('/api/telegram/code', loginLimit, async (req, res) =>
    res.json(
      await telegram.sendCode(
        z.object({ phone: z.string().regex(/^\+[1-9]\d{7,14}$/) }).parse(req.body).phone,
      ),
    ),
  );
  app.post('/api/telegram/signin', loginLimit, async (req, res) =>
    res.json(await telegram.signIn(z.object({ code: z.string().regex(/^\d{4,8}$/) }).parse(req.body).code)),
  );
  app.post('/api/telegram/password', loginLimit, async (req, res) =>
    res.json(
      await telegram.password(z.object({ password: z.string().min(1).max(500) }).parse(req.body).password),
    ),
  );
  app.post('/api/telegram/logout', async (req, res) => {
    store.update((s) => {
      s.settings.paused = true;
    });
    await telegram.logout();
    res.json({ ok: true });
  });
  app.post('/api/telegram/cancel', async (req, res) => {
    await telegram.cancelLogin();
    res.json({ ok: true });
  });
  if (config.demo)
    app.post('/api/demo/message', async (req, res) => {
      const value = z
        .object({ contactId: z.string(), text: z.string().trim().min(1).max(3000) })
        .parse(req.body);
      const c = contactById(store, value.contactId);
      await engine.ingest({ peerId: c.peerId, sourceId: id(), text: value.text, outgoing: false, at: now() });
      res.json({ ok: true });
    });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Маршрут не найден.' }));
  app.use(express.static(publicDir, { index: 'index.html' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err instanceof z.ZodError || err instanceof SyntaxError ? 400 : (err.status ?? 400);
    res.status(status).json({
      error:
        err instanceof z.ZodError
          ? 'Проверьте заполнение полей и формат данных.'
          : status === 413
            ? 'Файл слишком большой. Максимум 15 МБ.'
            : err.message || 'Не удалось выполнить действие.',
    });
  });
  return app;
}
