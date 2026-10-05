const fail = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};
export function telegramChats(data) {
  const chats = data?.chats?.list ?? (Array.isArray(data?.messages) ? [data] : []);
  const privateChats = chats.filter((c) => ['personal_chat', 'private'].includes(c.type));
  if (!privateChats.length) fail('Нужен JSON-экспорт личного чата Telegram (не группа или канал).');
  return privateChats.map((c, index) => ({ ...c, key: String(c.id ?? index) }));
}
export function textOf(message) {
  const value = message.text;
  return (
    typeof value === 'string'
      ? value
      : Array.isArray(value)
        ? value.map((part) => (typeof part === 'string' ? part : (part?.text ?? ''))).join('')
        : ''
  ).trim();
}
export function previewImport(data) {
  return telegramChats(data).map((c) => ({
    key: c.key,
    name: c.name || 'Личный чат',
    messages: c.messages.filter((m) => m.type === 'message' && textOf(m)).length,
    authors: [
      ...new Map(
        c.messages
          .filter((m) => m.from_id)
          .map((m) => [String(m.from_id), { id: String(m.from_id), name: m.from ?? m.from_id }]),
      ).values(),
    ],
  }));
}
export function extractMessages(data, chatKey, selfId) {
  const chat = telegramChats(data).find((c) => c.key === chatKey);
  if (!chat) fail('Выберите чат из экспорта.');
  if (!selfId || !chat.messages.some((m) => String(m.from_id) === selfId))
    fail('Выберите себя среди авторов сообщений.');
  const messages = chat.messages
    .filter((m) => m.type === 'message' && m.from_id && textOf(m))
    .map((m) => ({
      sourceId: `import:${chatKey}:${m.id}`,
      role: String(m.from_id) === selfId ? 'owner' : 'contact',
      text: textOf(m).slice(0, 8000),
      at: Number.isFinite(Number(m.date_unixtime))
        ? new Date(Number(m.date_unixtime) * 1000).toISOString()
        : nowFallback(m.date),
    }));
  if (!messages.length) fail('В выбранном чате нет текстовых сообщений.');
  return messages.slice(-3000);
}
function nowFallback(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
export function styleSamples(messages) {
  const samples = messages
    .filter((m) => m.role === 'owner')
    .slice(-100)
    .map((m) =>
      m.text
        .replace(/https?:\/\/\S+/gi, '[ссылка]')
        .replace(/@[\w]+/g, '[ник]')
        .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email]')
        .replace(/\+?\d[\d ()-]{8,}\d/g, '[номер]')
        .slice(0, 700),
    );
  if (samples.length < 5) fail('Для анализа нужны хотя бы 5 ваших текстовых сообщений.');
  return samples;
}
