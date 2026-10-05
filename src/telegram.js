import fs from 'node:fs';
import { TelegramClient, Api } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { NewMessage } from 'teleproto/events/index.js';
import { computeCheck } from 'teleproto/Password.js';
import { generateRandomLong } from 'teleproto/Helpers.js';
import { encrypt, decrypt } from './crypto.js';

// Authentication needs DC-migration retries; message sends override retry count to zero.
export const CLIENT_OPTIONS = {
  connectionRetries: 3,
  requestRetries: 3,
  floodSleepThreshold: 0,
  deviceModel: 'Blizhe Assistant',
  systemVersion: '1.0',
  appVersion: '1.0.0',
};

export function telegramError(error) {
  if (error.localMessage) return error.localMessage;
  const code = error.errorMessage ?? '';
  if (error.seconds) return `Telegram просит подождать ${error.seconds} сек. Автоповтор отключён.`;
  const messages = {
    PHONE_CODE_INVALID: 'Неверный код Telegram.',
    PHONE_CODE_EXPIRED: 'Код истёк. Запросите новый.',
    PASSWORD_HASH_INVALID: 'Неверный пароль 2FA.',
    PHONE_NUMBER_INVALID: 'Проверьте номер телефона.',
    AUTH_KEY_UNREGISTERED: 'Войдите в Telegram заново.',
    SESSION_REVOKED: 'Сессия отозвана. Войдите заново.',
  };
  return (
    messages[code] ??
    'Не удалось выполнить запрос Telegram. Проверьте подключение, данные и ограничения аккаунта.'
  );
}

export class TelegramAccount {
  constructor({ apiId, apiHash, key, sessionFile, onMessage, onError, onIdentity }) {
    Object.assign(this, { apiId: Number(apiId), apiHash, key, sessionFile, onMessage, onError, onIdentity });
    this.ready = false;
    this.stage = 'phone';
    this.user = null;
    this.client = null;
    this.busy = false;
  }
  get configured() {
    return Boolean(this.apiId && this.apiHash && this.key);
  }
  status() {
    return {
      configured: this.configured,
      connected: this.ready && Boolean(this.client?.connected),
      stage: this.stage,
      user: this.user,
    };
  }
  async createClient(saved = '') {
    if (!this.configured)
      throw new Error('Заполните TELEGRAM_API_ID, TELEGRAM_API_HASH и ENCRYPTION_KEY в .env.');
    if (this.client) await this.client.destroy();
    this.client = new TelegramClient(new StringSession(saved), this.apiId, this.apiHash, CLIENT_OPTIONS);
    this.client.setLogLevel('none');
    await this.client.connect();
  }
  async restore() {
    if (!this.configured || !fs.existsSync(this.sessionFile)) return;
    await this.createClient(decrypt(fs.readFileSync(this.sessionFile, 'utf8'), this.key));
    if (await this.client.checkAuthorization()) await this.activate();
  }
  async exclusive(fn) {
    if (this.busy) throw new Error('Дождитесь завершения предыдущего запроса входа.');
    this.busy = true;
    try {
      return await fn();
    } catch (error) {
      throw new Error(telegramError(error));
    } finally {
      this.busy = false;
    }
  }
  async sendCode(phone) {
    if (this.ready) throw new Error('Аккаунт уже подключён.');
    return this.exclusive(async () => {
      await this.createClient();
      const result = await this.client.sendCode({ apiId: this.apiId, apiHash: this.apiHash }, phone);
      if (result.emailRequired)
        throw Object.assign(new Error(), {
          localMessage:
            'Telegram требует настроить email для входа. Сделайте это в официальном приложении и попробуйте снова.',
        });
      this.phone = phone;
      this.phoneCodeHash = result.phoneCodeHash;
      this.stage = result.emailCodeSent ? 'email-code' : 'code';
      this.expires = Date.now() + 600000;
      return this.status();
    });
  }
  async signIn(code) {
    if (!['code', 'email-code'].includes(this.stage) || Date.now() > this.expires)
      throw new Error('Запросите новый код входа.');
    return this.exclusive(async () => {
      try {
        const result = await this.client.invoke(
          new Api.auth.SignIn({
            phoneNumber: this.phone,
            phoneCodeHash: this.phoneCodeHash,
            ...(this.stage === 'email-code'
              ? { emailVerification: new Api.EmailVerificationCode({ code }) }
              : { phoneCode: code }),
          }),
        );
        if (result instanceof Api.auth.AuthorizationSignUpRequired)
          throw new Error('Регистрация не поддерживается');
        await this.activate();
      } catch (error) {
        if (error.errorMessage === 'SESSION_PASSWORD_NEEDED') this.stage = 'password';
        else throw error;
      }
      return this.status();
    });
  }
  async password(password) {
    if (this.stage !== 'password' || Date.now() > this.expires) throw new Error('Сначала введите код входа.');
    return this.exclusive(async () => {
      const params = await this.client.invoke(new Api.account.GetPassword());
      await this.client.invoke(
        new Api.auth.CheckPassword({ password: await computeCheck(params, password) }),
      );
      await this.activate();
      return this.status();
    });
  }
  async activate() {
    const me = await this.client.getMe();
    try {
      this.onIdentity?.(me.id.toString());
    } catch (error) {
      await this.client.invoke(new Api.auth.LogOut());
      await this.client.destroy();
      this.stage = 'phone';
      throw Object.assign(error, { localMessage: error.message });
    }
    this.user = { id: me.id.toString(), name: me.firstName ?? '', username: me.username ?? '' };
    const temp = this.sessionFile + '.tmp';
    fs.writeFileSync(temp, encrypt(this.client.session.save(), this.key), { mode: 0o600 });
    fs.renameSync(temp, this.sessionFile);
    this.ready = true;
    this.stage = 'connected';
    this.phone = null;
    this.phoneCodeHash = null;
    this.client.addEventHandler(async (event) => {
      try {
        const m = event.message;
        if (!event.isPrivate || !m.peerId?.userId || !m.message) return;
        await this.onMessage({
          peerId: m.peerId.userId.toString(),
          sourceId: String(m.id),
          text: m.message,
          outgoing: Boolean(m.out),
          at: new Date(m.date * 1000).toISOString(),
        });
      } catch {
        this.onError?.('Не удалось обработать сообщение Telegram.');
      }
    }, new NewMessage({}));
  }
  async dialogs() {
    if (!this.ready) throw new Error('Сначала подключите Telegram.');
    const dialogs = await this.client.getDialogs({ limit: 100 });
    return dialogs
      .filter((d) => d.isUser && !d.entity.bot && !d.entity.self && !d.entity.deleted)
      .map((d) => ({
        id: d.entity.id.toString(),
        name: [d.entity.firstName, d.entity.lastName].filter(Boolean).join(' '),
        username: d.entity.username ?? '',
      }));
  }
  async resolve(reference) {
    if (!this.ready) throw new Error('Сначала подключите Telegram в настройках.');
    let entity;
    try {
      if (/^\d+$/.test(reference)) {
        const dialogs = await this.client.getDialogs({ limit: 100 });
        entity = dialogs.find((d) => d.isUser && d.entity.id.toString() === reference)?.entity;
        if (!entity) throw new Error();
      } else entity = await this.client.getEntity(reference.replace(/^@/, ''));
    } catch {
      throw new Error(
        'ID не найден среди последних 100 диалогов. Укажите @username или сначала откройте личный диалог в Telegram.',
      );
    }
    if (!(entity instanceof Api.User) || entity.bot || entity.self || entity.deleted || !entity.accessHash)
      throw new Error('Нужен личный диалог с другим пользователем.');
    return {
      peerId: entity.id.toString(),
      accessHash: entity.accessHash.toString(),
      username: entity.username ?? '',
      name: entity.firstName ?? reference,
    };
  }
  async send(contact, text) {
    if (!this.ready) throw new Error('Telegram не подключён.');
    const peer = new Api.InputPeerUser({
      userId: BigInt(contact.peerId),
      accessHash: BigInt(contact.accessHash),
    });
    try {
      const randomId = generateRandomLong();
      const result = await this.client.invoke(
        new Api.messages.SendMessage({ peer, message: text, randomId, noWebpage: true }),
        undefined,
        { maxRetryCount: 0 },
      );
      const messageId =
        result.id ??
        result.updates?.find(
          (update) =>
            update instanceof Api.UpdateMessageID && update.randomId.toString() === randomId.toString(),
        )?.id;
      if (!messageId) throw new Error('Missing delivery acknowledgement');
      return String(messageId);
    } catch (error) {
      throw new Error(telegramError(error));
    }
  }
  async logout() {
    if (this.client && this.ready) await this.client.invoke(new Api.auth.LogOut());
    await this.close();
    if (fs.existsSync(this.sessionFile)) fs.unlinkSync(this.sessionFile);
    this.ready = false;
    this.user = null;
    this.stage = 'phone';
  }
  async cancelLogin() {
    if (this.ready) throw new Error('Аккаунт уже подключён.');
    if (this.busy) throw new Error('Дождитесь завершения запроса входа.');
    await this.close();
    this.stage = 'phone';
    this.phone = null;
    this.phoneCodeHash = null;
    this.expires = 0;
  }
  async close() {
    if (this.client) await this.client.destroy();
  }
}
