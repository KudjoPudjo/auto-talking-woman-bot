import { id, now, contactById } from './store.js';

export const DISCLOSURE_VERSION = 1;
export const disclosure = (name) =>
  `Привет! Это ИИ-помощник${name ? ` ${name}` : ' владельца аккаунта'}. С его разрешения я могу поддерживать переписку в его стиле. Это автоматические ответы, а не личные слова или обещания владельца. Выбранная переписка сохраняется в его приложении и передаётся OpenAI для ответов и конспектов. Если тебе есть 18 и ты согласна, напиши /agree. Остановить помощника можно в любой момент: /stop или «стоп». Без согласия автоматических ответов не будет.`;

export class Engine {
  constructor({ store, ai, transport, demo = false }) {
    Object.assign(this, { store, ai, transport, demo });
    this.running = new Map();
    store.update((s) => {
      for (const m of s.messages) if (m.status === 'sending') m.status = 'uncertain';
      for (const j of s.jobs) if (['pending', 'generating'].includes(j.status)) j.status = 'interrupted';
    });
  }
  conversation(contactId) {
    return this.store.state.messages.filter(
      (m) =>
        m.contactId === contactId &&
        ['received', 'sent', 'imported'].includes(m.status) &&
        m.role !== 'system',
    );
  }
  canSend(contactId) {
    const c = this.store.state.contacts.find((x) => x.id === contactId);
    return Boolean(
      c && c.active && c.consent === 'accepted' && c.disclosureAt && !this.store.state.settings.paused,
    );
  }
  async disclose(contactId) {
    const c = contactById(this.store, contactId);
    if (this.store.state.settings.paused) throw new Error('Снимите общую паузу перед отправкой приглашения.');
    if (c.consent === 'stopped')
      throw new Error('Собеседница остановила агента. Повторное приглашение недоступно.');
    if (c.disclosureAt) throw new Error('Уведомление уже доставлено. Ожидаем /agree.');
    if (
      this.store.state.messages.some(
        (m) =>
          m.contactId === contactId && m.role === 'system' && ['sending', 'uncertain'].includes(m.status),
      )
    )
      throw new Error('Предыдущая отправка ещё выполняется или её результат неизвестен. Проверьте Telegram.');
    const m = this.addMessage(contactId, 'system', disclosure(this.store.state.settings.ownerName), 'draft');
    await this.deliver(m, true);
    if (this.store.state.contacts.some((x) => x.id === contactId))
      this.store.update((s) => {
        const current = s.contacts.find((x) => x.id === contactId);
        current.disclosureAt = now();
        current.disclosureVersion = DISCLOSURE_VERSION;
      });
  }
  addMessage(contactId, role, text, status, extra = {}) {
    const m = { id: id(), contactId, role, text, status, at: now(), ...extra };
    this.store.update((s) => s.messages.push(m));
    return m;
  }
  async ingest(message) {
    const c = this.store.state.contacts.find((x) => x.peerId === message.peerId);
    if (!c) return; // Never read/store/send other dialogs.
    if (
      this.store.state.messages.some(
        (m) => m.contactId === c.id && m.sourceId === `telegram:${message.sourceId}`,
      )
    )
      return;
    if (message.outgoing) {
      const sending = this.store.state.messages.find(
        (m) => m.contactId === c.id && m.status === 'sending' && m.text === message.text,
      );
      if (sending) {
        this.store.update(() => {
          sending.sourceId = `telegram:${message.sourceId}`;
          sending.status = 'sent';
        });
        return;
      }
      this.addMessage(c.id, 'owner', message.text, 'sent', {
        sourceId: `telegram:${message.sourceId}`,
        at: message.at,
      });
      this.store.update(() => {
        c.active = false;
      });
      this.store.event('pause', 'Вы ответили лично — агент поставлен на паузу.', c.id);
      return;
    }
    const m = this.addMessage(c.id, 'contact', message.text.slice(0, 8000), 'received', {
      sourceId: `telegram:${message.sourceId}`,
      at: message.at,
    });
    const command = message.text.trim().toLowerCase();
    if (/^(\/stop\b|стоп[.!\s]*$)|не (пиши|пишите|хочу общаться)|отстань/i.test(command)) {
      this.store.update(() => {
        c.consent = 'stopped';
        c.active = false;
        c.consentAt = null;
      });
      this.store.event('pause', 'Собеседница остановила агента.', c.id);
      return;
    }
    if (/^(\/agree|согласна)[.!\s]*$/.test(command) && c.disclosureAt) {
      this.store.update(() => {
        c.consent = 'accepted';
        c.consentAt = now();
      });
      this.store.event('consent', 'Получено согласие на общение с ИИ (18+).', c.id);
      return;
    }
    if (!this.canSend(c.id) || c.mode !== 'auto') return;
    if (
      this.store.state.jobs.filter((j) => j.contactId === c.id && Date.now() - Date.parse(j.at) < 3600000)
        .length >= 30
    ) {
      this.store.update(() => {
        c.active = false;
      });
      this.store.event('pause', 'Достигнут лимит 30 запросов ИИ в час. Контакт поставлен на паузу.', c.id);
      return;
    }
    const job = { id: id(), contactId: c.id, messageId: m.id, status: 'pending', at: now() };
    this.store.update((s) => s.jobs.push(job));
    this.schedule(c.id);
  }
  schedule(contactId) {
    if (this.running.has(contactId)) return;
    const task = this.drain(contactId)
      .catch(() => this.store.event('error', 'Задача ответа остановлена.', contactId))
      .finally(() => this.running.delete(contactId));
    this.running.set(contactId, task);
  }
  async drain(contactId) {
    let job;
    while ((job = this.store.state.jobs.find((j) => j.contactId === contactId && j.status === 'pending'))) {
      if (!this.canSend(contactId) || contactById(this.store, contactId).mode !== 'auto') {
        this.store.update(() => {
          job.status = 'cancelled';
        });
        continue;
      }
      const pending = this.store.state.jobs.filter(
        (j) => j.contactId === contactId && j.status === 'pending',
      );
      this.store.update(() => {
        for (const j of pending) j.status = 'generating';
      });
      try {
        await this.generate(contactId, true);
        this.store.update(() => {
          for (const j of pending) j.status = 'done';
        });
      } catch (error) {
        this.store.update(() => {
          for (const j of pending) j.status = 'error';
        });
        this.store.event('error', error.message, contactId);
      }
    }
  }
  async generate(contactId, automatic = false) {
    const c = contactById(this.store, contactId);
    if (!this.canSend(contactId)) throw new Error('Нужны согласие собеседницы и снятая пауза.');
    if (!this.store.state.style) throw new Error('Сначала импортируйте примеры и создайте профиль стиля.');
    const messages = this.conversation(contactId);
    if (!messages.length) throw new Error('Пока нет сообщений для ответа.');
    const lastId = messages.at(-1).id;
    const result = await this.ai.reply({
      contact: structuredClone(c),
      messages: structuredClone(messages),
      style: this.store.state.style.profile,
      settings: this.store.state.settings,
    });
    // Deleted contacts and revoked consent must remain deleted/revoked during network calls.
    if (!this.store.state.contacts.some((x) => x.id === contactId)) return;
    const m = this.addMessage(
      contactId,
      'assistant',
      result.text,
      result.needsReview || !result.text ? 'review' : 'draft',
      { reason: result.reason, basedOn: lastId },
    );
    if (
      automatic &&
      !result.needsReview &&
      result.text &&
      this.canSend(contactId) &&
      contactById(this.store, contactId).mode === 'auto' &&
      this.conversation(contactId).at(-1)?.id === lastId
    )
      await this.deliver(m);
    return m;
  }
  async deliver(m, system = false) {
    const c = contactById(this.store, m.contactId);
    if (!['draft', 'review'].includes(m.status) || !m.text.trim())
      throw new Error('Это сообщение уже отправлено, отправляется или не содержит текста.');
    if (!system && !this.canSend(c.id)) throw new Error('Отправка остановлена: проверьте согласие и паузу.');
    if (!system && m.basedOn && this.conversation(c.id).at(-1)?.id !== m.basedOn)
      throw new Error('После создания ответа переписка изменилась. Создайте новый ответ.');
    const recent = this.store.state.messages.filter(
      (x) => x.role !== 'contact' && x.status === 'sent' && Date.now() - Date.parse(x.at) < 3600000,
    );
    if (
      recent.filter((x) => x.contactId === c.id).length >= 30 ||
      recent.filter((x) => Date.now() - Date.parse(x.at) < 60000).length >= 10
    )
      throw new Error('Достигнут лимит отправок: 30 в час на контакт, 10 в минуту всего. Ответ сохранён.');
    this.store.update(() => {
      m.status = 'sending';
    });
    try {
      const sourceId = this.demo ? `demo:${id()}` : `telegram:${await this.transport.send(c, m.text)}`;
      // Removing a contact while a send is in flight must not recreate its history.
      if (this.store.state.messages.some((x) => x.id === m.id))
        this.store.update(() => {
          m.status = 'sent';
          m.sourceId = sourceId;
          m.at = now();
        });
    } catch (error) {
      if (this.store.state.messages.some((x) => x.id === m.id))
        this.store.update(() => {
          m.status = 'uncertain';
          m.reason = 'Доставка не подтверждена. Проверьте Telegram перед повторной отправкой.';
        });
      throw error;
    }
  }
}
