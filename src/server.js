import path from 'node:path';
import { Store } from './store.js';
import { AI } from './ai.js';
import { Engine } from './engine.js';
import { TelegramAccount } from './telegram.js';
import { createApp } from './app.js';
import { demoState } from './demo.js';

const demo = process.argv.includes('--demo');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3210);
const key = process.env.ENCRYPTION_KEY;
if (demo && !['127.0.0.1', 'localhost', '::1'].includes(host))
  throw new Error('Demo must listen on loopback only.');
if (!demo && ((process.env.ADMIN_PASSWORD?.length ?? 0) < 16 || !/^[a-f0-9]{64}$/i.test(key ?? '')))
  throw new Error(
    'Run npm run setup, then configure .env: ADMIN_PASSWORD (16+ characters), ENCRYPTION_KEY (64 hex).',
  );
const file = path.resolve(
  demo ? process.env.DEMO_DATA_FILE || './data/demo.json' : process.env.DATA_FILE || './data/store.enc',
);
const store = new Store(file, demo ? demoState() : undefined, demo ? undefined : key);
if (!demo && !store.state.settings.ownerName && process.env.OWNER_NAME)
  store.update((s) => {
    s.settings.ownerName = process.env.OWNER_NAME;
  });
const config = {
  demo,
  password: process.env.ADMIN_PASSWORD,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  aiKey: demo ? undefined : process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  allowedHosts: [
    '127.0.0.1',
    'localhost',
    '[::1]',
    ...(process.env.ALLOWED_HOSTS || '').split(',').filter(Boolean),
  ],
};
const ai = new AI({ key: config.aiKey, model: config.model, demo });
let engine;
const telegram = new TelegramAccount({
  apiId: process.env.TELEGRAM_API_ID,
  apiHash: process.env.TELEGRAM_API_HASH,
  key,
  sessionFile: path.join(path.dirname(file), 'telegram-session.enc'),
  onMessage: (m) => engine.ingest(m),
  onError: (message) => store.event('error', message),
  onIdentity: (accountId) => {
    if (store.state.accountId && store.state.accountId !== accountId)
      throw new Error(
        'Это пространство связано с другим аккаунтом Telegram. Войдите в прежний аккаунт или создайте отдельную папку данных.',
      );
    store.update((s) => {
      s.accountId = accountId;
    });
  },
});
engine = new Engine({ store, ai, transport: telegram, demo });
const app = createApp({ store, engine, ai, telegram, config });
const server = app.listen(port, host, () =>
  console.log(`Blizhe ${demo ? '(DEMO)' : ''}: http://${host}:${port}`),
);
if (!demo)
  telegram
    .restore()
    .catch(() =>
      store.event('error', 'Сессия Telegram не подключена. Проверьте настройки и выполните вход.'),
    );
async function close() {
  store.update((s) => {
    s.settings.paused = true;
  });
  await telegram.close();
  server.close(() => process.exit(0));
}
process.once('SIGINT', close);
process.once('SIGTERM', close);
