import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
if (fs.existsSync('.env')) {
  console.log('.env already exists; left unchanged.');
  process.exit(0);
}
const template = fs
  .readFileSync('.env.example', 'utf8')
  .replace('ADMIN_PASSWORD=\n', `ADMIN_PASSWORD=${randomBytes(24).toString('base64url')}\n`)
  .replace('ENCRYPTION_KEY=\n', `ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`);
fs.writeFileSync('.env', template, { mode: 0o600, flag: 'wx' });
console.log(
  'Created .env with generated admin password and encryption key. Fill TELEGRAM_API_ID, TELEGRAM_API_HASH, OPENAI_API_KEY and OWNER_NAME.',
);
