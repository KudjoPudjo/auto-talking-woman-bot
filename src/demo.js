import { initialState, id, now } from './store.js';
export function demoState() {
  const s = initialState();
  s.settings.ownerName = 'Александр';
  s.style = {
    sampleCount: 42,
    updatedAt: now(),
    profile: {
      tone: 'Тёплый, лёгкий, немного ироничный',
      length: 'Короткие сообщения, 1–2 предложения',
      punctuation: 'Разговорный ритм, без канцелярита',
      emoji: 'Редко, по настроению 🙂',
      phrases: ['звучит как план', 'расскажешь?'],
      rules: ['Один вопрос за раз', 'Внимание к деталям', 'Без выдуманных обещаний'],
    },
  };
  s.contacts = [
    {
      name: 'Аня',
      username: 'anya_example',
      notes: 'Любит книги, кофе и прогулки. Все данные в демо вымышлены.',
      mode: 'auto',
      consent: 'accepted',
    },
    {
      name: 'Маша',
      username: 'masha_example',
      notes: 'Занимается керамикой. Вымышленный контакт.',
      mode: 'review',
      consent: 'accepted',
    },
    {
      name: 'Соня',
      username: 'sonya_example',
      notes: 'Вымышленный контакт.',
      mode: 'auto',
      consent: 'pending',
    },
  ].map((c, i) => ({
    ...c,
    id: id(),
    peerId: String(10001 + i),
    active: true,
    createdAt: now(),
    disclosureAt: i < 2 ? now() : null,
    consentAt: i < 2 ? now() : null,
  }));
  const dialogue = [
    ['contact', 'Привет! Я всё-таки дошла до той маленькой кофейни ☕'],
    ['owner', 'ну и как? кофе или атмосфера победили?'],
    ['contact', 'Атмосфера! Там целая полка книг, я пропала на два часа'],
    ['assistant', 'кофе с побочным эффектом в виде новой книги 🙂 что читала?'],
    ['contact', '«Нормальные люди». Люблю такие тихие истории.'],
    ['owner', 'тогда в субботу можно продолжить разговор за кофе'],
    ['contact', 'Давай! В 16:00 в «Историях»?'],
  ];
  s.messages = dialogue.map(([role, text], i) => ({
    id: id(),
    contactId: s.contacts[0].id,
    role,
    text,
    status: role === 'contact' ? 'received' : 'sent',
    at: new Date(Date.now() - (8 - i) * 3600000).toISOString(),
  }));
  s.messages.push({
    id: id(),
    contactId: s.contacts[1].id,
    role: 'contact',
    text: 'Сегодня впервые сделала чашку, которая не похожа на вазу 😄',
    status: 'received',
    at: now(),
  });
  s.messages.push({
    id: id(),
    contactId: s.contacts[1].id,
    role: 'assistant',
    text: 'это уже повод для выставки 🙂 покажешь?',
    status: 'draft',
    at: now(),
    basedOn: s.messages.at(-1).id,
  });
  s.dates = [
    {
      id: id(),
      contactId: s.contacts[0].id,
      at: new Date(Date.now() + 2 * 86400000).toISOString(),
      place: 'Кофейня «Истории»',
      notes: 'Столик у окна, потом прогулка',
      status: 'planned',
      brief: null,
    },
  ];
  s.events = [
    { id: id(), kind: 'info', text: 'Демо готово. Все контакты и переписки вымышлены.', at: now() },
  ];
  return s;
}
