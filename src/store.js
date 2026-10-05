import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { encrypt, decrypt } from './crypto.js';

export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export const initialState = () => ({
  version: 1,
  contacts: [],
  messages: [],
  dates: [],
  jobs: [],
  events: [],
  offset: 0,
  settings: { paused: false, ownerName: '', notes: '' },
  style: null,
});

// Single-process store: synchronous transactions + atomic replacement prevent partial writes.
export class Store {
  constructor(file, seed, key) {
    this.file = file;
    this.key = key;
    const saved = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    this.state = saved ? JSON.parse(key ? decrypt(saved, key) : saved) : (seed ?? initialState());
    if (this.state.version !== 1) throw new Error('Unsupported data version');
    if (file) fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true, mode: 0o700 });
  }
  update(fn) {
    const previous = structuredClone(this.state);
    try {
      const result = fn(this.state);
      if (this.file) {
        const temp = this.file + '.tmp';
        const fd = fs.openSync(temp, 'w', 0o600);
        try {
          const data = JSON.stringify(this.state);
          fs.writeFileSync(fd, this.key ? encrypt(data, this.key) : data);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        fs.renameSync(temp, this.file);
      }
      return result;
    } catch (error) {
      this.state = previous;
      throw error;
    }
  }
  event(kind, text, contactId = null) {
    this.update((s) => {
      s.events.unshift({ id: id(), kind, text, contactId, at: now() });
      s.events = s.events.slice(0, 200);
    });
  }
}

export function contactById(store, contactId) {
  const contact = store.state.contacts.find((c) => c.id === contactId);
  if (!contact) throw Object.assign(new Error('Контакт не найден'), { status: 404 });
  return contact;
}

export function removeContact(store, contactId) {
  contactById(store, contactId);
  store.update((s) => {
    s.contacts = s.contacts.filter((c) => c.id !== contactId);
    for (const key of ['messages', 'dates', 'jobs', 'events'])
      s[key] = s[key].filter((x) => x.contactId !== contactId);
  });
}
