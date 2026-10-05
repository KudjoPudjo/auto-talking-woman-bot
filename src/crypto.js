import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export function encrypt(text, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  });
}
export function decrypt(text, key) {
  const payload = JSON.parse(text);
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(payload.iv, 'base64'));
  cipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([cipher.update(Buffer.from(payload.data, 'base64')), cipher.final()]).toString('utf8');
}
