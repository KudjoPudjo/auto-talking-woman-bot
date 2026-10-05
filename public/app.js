const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
const paths = {
  heart:
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M20 21v-2a4 4 0 0 0-3-3.8M16 3a4 4 0 0 1 0 8M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  chat: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2V11.5A8.5 8.5 0 0 1 9.5 3h3a8.5 8.5 0 0 1 8.5 8.5ZM7 9h9M7 13h6',
  calendar:
    'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM8 14h2M14 14h2M8 18h2',
  spark: 'm12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8L12 2Z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',
  plus: 'M12 5v14M5 12h14',
  right: 'm9 5 7 7-7 7',
  close: 'm6 6 12 12M18 6 6 18',
  pause: 'M8 5v14M16 5v14',
  play: 'm7 4 14 8-14 8V4Z',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  check: 'm5 12 4 4L19 6',
  lock: 'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4M12 15v2',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  send: 'm22 2-7 20-4-9L2 9l20-7ZM22 2 11 13',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  leaf: 'M20 3c-11-2-18 8-13 13 5 5 15-2 13-13ZM4 21l11-11',
  edit: 'm16 3 5 5-12 12-6 1 1-6L16 3Z',
  file: 'M14 2H4v20h16V8l-6-6ZM14 2v6h6M8 13h8M8 17h5',
  exit: 'M9 3H3v18h6M9 12h13m-5-5 5 5-5 5',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.spark}"/></svg>`;
const btn = (text, action, iconName, cls = '', extra = '') =>
  `<button class="btn ${cls}" data-action="${action}" ${extra}>${iconName ? icon(iconName) : ''}${text}</button>`;
const avatar = (c, i = 0, small = false) =>
  `<span class="avatar a${i % 4} ${small ? 'small' : ''}">${esc(c.name?.slice(0, 1).toUpperCase() || '?')}</span>`;
const fmt = (value, options = {}) =>
  new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', ...options });
const time = (value) => fmt(value, { hour: '2-digit', minute: '2-digit' });
const dateInput = (value) => {
  const d = new Date(value);
  return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
let state,
  csrf,
  page = 'overview',
  selected,
  messages = [],
  filter = 'all',
  search = '',
  importData,
  importChats = [],
  importMode,
  toastTimer;
let dirty = false;
const titles = {
  overview: 'Обзор',
  contacts: 'Контакты',
  chats: 'Диалоги',
  dates: 'Свидания',
  style: 'Мой стиль',
  settings: 'Настройки',
};
const navIcons = {
  overview: 'grid',
  contacts: 'users',
  chats: 'chat',
  dates: 'calendar',
  style: 'spark',
  settings: 'settings',
};

async function api(url, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && url !== '/login') await init();
    throw new Error(data.error || 'Не удалось выполнить действие.');
  }
  return data;
}
function toast(text, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = text;
  $('#toast').className = `visible ${error ? 'error' : ''}`;
  toastTimer = setTimeout(() => {
    $('#toast').className = '';
  }, 6500);
}
async function refresh() {
  state = await api('/state');
  if (selected && !state.contacts.some((c) => c.id === selected)) selected = null;
  if (!selected) selected = state.contacts[0]?.id;
  if (page === 'chats' && selected) messages = await api(`/contacts/${selected}/messages`);
  render();
}
function brand() {
  return `<div class="brand"><span class="brand-mark">${icon('heart')}</span><span>ближе</span></div>`;
}
function badge(c) {
  if (c.consent === 'stopped') return '<span class="badge red">Остановлено</span>';
  if (!c.active || state.settings.paused) return '<span class="badge gray">На паузе</span>';
  if (c.consent !== 'accepted') return '<span class="badge amber">Ждём согласия</span>';
  return c.mode === 'auto'
    ? '<span class="badge"><span class="dot"></span>Автоответы</span>'
    : '<span class="badge amber">С проверкой</span>';
}
function render() {
  dirty = false;
  const pending = state.contacts.reduce((sum, c) => sum + c.pending, 0);
  $('#app').innerHTML =
    `<div class="app-shell"><aside class="sidebar">${brand()}<div class="nav-label">Ваше пространство</div><nav class="nav" aria-label="Основная навигация">${Object.keys(
      titles,
    )
      .map(
        (key) =>
          `<button data-page="${key}" class="${page === key ? 'active' : ''}" title="${titles[key]}" aria-label="${titles[key]}" ${page === key ? 'aria-current="page"' : ''}>${icon(navIcons[key])}<span>${titles[key]}</span>${key === 'chats' && pending ? `<span class="count">${pending}</span>` : ''}</button>`,
      )
      .join(
        '',
      )}</nav><div class="sidebar-bottom"><div class="quiet-card">${icon('leaf')}<p>Больше внимания.<br>Меньше потерянных деталей.</p></div><div class="profile">${avatar({ name: state.settings.ownerName || 'Я' }, 2, true)}<div><b>${esc(state.settings.ownerName || 'Ваш аккаунт')}</b><small>Личное пространство</small></div></div></div></aside><main class="workspace"><header class="topbar"><div class="breadcrumbs">Моё пространство <span>/ &nbsp;${titles[page]}</span></div><div class="top-actions"><span class="status ${!state.telegram.connected ? 'off' : ''}"><span class="dot"></span>${state.demo ? 'Демо-режим' : state.telegram.connected ? 'Telegram подключён' : 'Telegram не подключён'}</span><button class="icon-btn" data-page="settings" aria-label="Открыть настройки">${icon('settings')}</button></div></header>${state.demo ? `<div class="banner">${icon('spark')}Демо с вымышленными данными. Telegram отключён, ответы ИИ показаны на примерах.</div>` : !state.aiConfigured ? `<div class="banner">${icon('spark')}Добавьте ключ ИИ в .env, чтобы включить анализ стиля и генерацию ответов.</div>` : ''}${state.settings.paused ? `<div class="banner">${icon('pause')}Все отправки приостановлены. ${btn('Возобновить', 'global-pause', '', 'ghost')}</div>` : ''}<div class="page-content">${{ overview, contacts, chats, dates, style, settings }[page]()}</div><footer class="bottom-note">${icon('lock')}${state.demo ? 'Демонстрационное пространство' : 'Локальное пространство · Зашифрованное хранение'} · Общение с раскрытием ИИ</footer></main></div>`;
  if (page === 'chats') {
    const list = $('.chat-messages');
    if (list) list.scrollTop = list.scrollHeight;
  }
}
function heading(title, subtitle, action = '', eyebrow = '') {
  return `<div class="page-head"><div>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`;
}
function empty(title, text, action = '') {
  return `<div class="empty">${icon('leaf')}<h3>${title}</h3><p>${text}</p>${action}</div>`;
}
function contactRow(c, i) {
  return `<button class="contact-row" data-action="open-chat" data-id="${c.id}">${avatar(c, i)}<div class="contact-info"><b>${esc(c.name)}</b><p>${esc(c.lastMessage?.text || c.notes || 'Здесь начнётся ваша история')}</p></div>${badge(c)}<span class="chevron">${icon('right')}</span></button>`;
}
function overview() {
  const active = state.contacts.filter((c) => c.active && c.consent === 'accepted').length;
  const nextDate = state.dates
    .filter((d) => d.status === 'planned' && new Date(d.at) > new Date())
    .sort((a, b) => a.at.localeCompare(b.at))[0];
  const nextContact = state.contacts.find((c) => c.id === nextDate?.contactId);
  const stats = [
    ['Контактов в пуле', state.contacts.length, 'users', 'Каждый разговор важен'],
    [
      'Активных диалогов',
      state.settings.paused ? 0 : active,
      'chat',
      state.settings.paused ? 'Общая пауза' : 'В вашем ритме',
    ],
    [
      'Ждут внимания',
      state.contacts.reduce((n, c) => n + c.pending, 0),
      'spark',
      'Ответы для вашей проверки',
    ],
    [
      'Впереди встреч',
      state.dates.filter((d) => d.status === 'planned' && new Date(d.at) > new Date()).length,
      'calendar',
      'Время быть рядом',
    ],
  ];
  return `${heading('Хороший день для общения', 'Разговоры, детали и встречи — всё, что хочется сохранить.', btn('Добавить контакт', 'add-contact', 'plus'), fmt(new Date(), { weekday: 'long' }))}<div class="stats">${stats.map(([label, value, ico, foot]) => `<div class="stat"><div class="stat-top">${label}${icon(ico)}</div><div class="stat-value">${value.toString().padStart(2, '0')}</div><div class="stat-foot">${foot}</div></div>`).join('')}</div><div class="overview-grid"><section class="panel"><div class="panel-head"><h2>В фокусе общения</h2>${btn('Все контакты', 'go-contacts', 'right', 'ghost')}</div>${state.contacts.length ? state.contacts.slice(0, 4).map(contactRow).join('') : empty('Первое знакомство', 'Добавьте контакт, чтобы подготовить помощника.', btn('Добавить', 'add-contact', 'plus'))}</section><section class="date-feature"><div class="eyebrow">Следующая встреча</div>${nextDate ? `<h2>Кофе, разговоры<br>и ${esc(nextContact?.name || 'встреча')}</h2><p>${fmt(nextDate.at, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}<br>${esc(nextDate.place)}</p>${btn('Подготовиться к встрече', 'go-dates', 'right')}` : `<h2>Оставьте место<br>для встречи</h2><p>Когда договоритесь о свидании,<br>сохраним важные детали.</p>${btn('Запланировать', 'add-date', 'plus')}`}</section></div><div class="lower-grid"><section class="panel"><div class="panel-head"><h2>Последние события</h2><span class="muted">${icon('clock')}</span></div><div class="panel-body">${
    state.events
      .slice(0, 4)
      .map(
        (e) =>
          `<div class="activity-row"><div class="activity-icon">${icon(e.kind === 'pause' ? 'pause' : e.kind === 'error' ? 'clock' : 'check')}</div><div><p>${esc(e.text)}</p><small>${time(e.at)}</small></div></div>`,
      )
      .join('') || '<p class="muted">Новые события появятся здесь.</p>'
  }</div></section><section class="panel style-mini"><div class="row spread"><h2>Звучит как вы</h2><span class="muted">${icon('spark')}</span></div><p>${esc(state.style?.profile.tone || 'Ваши сообщения помогут найти естественную манеру общения.')}</p><div class="tags">${state.style ? `<span class="tag">${state.style.sampleCount} примеров</span><span class="tag">Профиль настроен</span>` : '<span class="tag">Пока не настроен</span>'}</div>${btn('Настроить мой стиль', 'go-style', 'right', 'ghost')}</section></div>`;
}
function contacts() {
  const list = state.contacts.filter(
    (c) =>
      `${c.name} ${c.username} ${c.peerId}`.toLowerCase().includes(search.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'active' ? c.active && c.consent === 'accepted' : !c.active || c.consent !== 'accepted')),
  );
  return `${heading('Люди, с которыми ближе', 'Добавляйте контакты и выбирайте, где поможет агент.', btn('Добавить контакт', 'add-contact', 'plus'))}<div class="toolbar"><label class="search">${icon('search')}<input id="search" aria-label="Поиск контакта" placeholder="Имя, username или ID" value="${esc(search)}"></label><div class="filters">${[
    ['all', 'Все контакты'],
    ['active', 'Активные'],
    ['paused', 'Ожидание и пауза'],
  ]
    .map(
      ([key, label]) =>
        `<button data-filter="${key}" class="${filter === key ? 'active' : ''}">${label}</button>`,
    )
    .join(
      '',
    )}</div></div>${list.length ? `<div class="contact-grid">${list.map((c, i) => `<article class="contact-card"><div class="row spread">${avatar(c, i)}${badge(c)}</div><h3>${esc(c.name)}</h3><small>${c.username ? '@' + esc(c.username) : 'ID ' + esc(c.peerId)}</small><p>${esc(c.notes || 'Добавьте заметку о знакомстве и важных деталях.')}</p><div class="row spread"><small>${c.messageCount} сообщений</small>${btn('Настроить', 'edit-contact', 'settings', 'ghost', `data-id="${c.id}"`)}</div><div class="card-actions">${btn('Открыть диалог', 'open-chat', 'chat', 'secondary small', `data-id="${c.id}"`)}${btn(c.active ? 'Пауза' : 'Продолжить', 'contact-pause', c.active ? 'pause' : 'play', 'secondary small', `data-id="${c.id}"`)}</div></article>`).join('')}</div>` : empty('Пока никого нет', search ? 'Попробуйте изменить поиск или фильтр.' : 'Подключите Telegram и добавьте первый контакт.', btn('Добавить контакт', 'add-contact', 'plus'))}`;
}
function chats() {
  const c = state.contacts.find((c) => c.id === selected);
  const history = messages.filter((m) => !['draft', 'review'].includes(m.status));
  const drafts = messages.filter((m) => ['draft', 'review'].includes(m.status));
  return `${heading('Разговор продолжается', 'Контекст переписки и ответы, которым нужно ваше внимание.')}<section class="panel chat-layout"><div class="chat-list">${state.contacts.map((contact, i) => `<button class="contact-row ${selected === contact.id ? 'selected' : ''}" data-action="open-chat" data-id="${contact.id}">${avatar(contact, i, true)}<div class="contact-info"><b>${esc(contact.name)}</b><p>${contact.pending ? contact.pending + ' ждут внимания' : contact.active ? 'В пуле общения' : 'На паузе'}</p></div></button>`).join('')}</div><div class="chat-main">${c ? `<div class="chat-header"><div class="row"><h3>${esc(c.name)}</h3>${badge(c)}</div><div class="row">${btn('Настроить', 'edit-contact', 'settings', 'secondary small', `data-id="${c.id}"`)}</div></div>${c.consent !== 'accepted' ? `<div class="panel-body"><div class="notice">${c.consent === 'stopped' ? 'Собеседница остановила агента. Новые ответы отключены.' : c.disclosureAt ? 'Уведомление отправлено. Ждём согласия: /agree.' : 'Сначала отправьте уведомление об ИИ. Автоответы включатся только после /agree.'}</div>${!c.disclosureAt && c.consent !== 'stopped' ? btn('Отправить уведомление', 'disclose', 'send', 'secondary', `data-id="${c.id}"`) : ''}</div>` : ''}<div class="chat-messages">${history.length ? history.map((m) => `<div id="message-${m.id}" class="bubble ${['assistant', 'owner'].includes(m.role) ? 'out' : ''} ${m.role === 'system' ? 'system' : ''}">${esc(m.text)}<small>${m.role === 'assistant' ? 'ИИ · ' : m.role === 'owner' ? 'Вы · ' : ''}${time(m.at)}${m.status === 'uncertain' ? ' · Доставка не подтверждена' : m.status === 'sending' ? ' · Отправляется' : ''}</small></div>`).join('') : empty('Начало вашей истории', 'Можно импортировать прошлую переписку из Telegram JSON.')}</div>${drafts.map((m) => `<div class="draft"><span class="label">${icon('spark')} ${m.status === 'review' ? 'Нужно ваше решение' : 'Черновик ответа'}</span>${m.reason ? `<p class="subtitle">${esc(m.reason)}</p>` : ''}<textarea id="draft-${m.id}" aria-label="Черновик ответа">${esc(m.text)}</textarea><div class="row spread">${btn('Удалить', 'discard-draft', 'trash', 'ghost', `data-id="${m.id}"`)}${btn(state.demo ? 'Отправить в демо' : 'Отправить от моего имени', 'send-draft', 'send', 'small', `data-id="${m.id}"`)}</div></div>`).join('')}<div class="chat-tools">${btn('Подготовить ответ', 'generate', 'spark', 'secondary small', `data-id="${c.id}"`)}${btn('Импорт JSON', 'import-history', 'upload', 'secondary small', `data-id="${c.id}"`)}${btn('Назначить встречу', 'add-date', 'calendar', 'secondary small', `data-id="${c.id}"`)}${state.demo ? btn('Входящее в демо', 'demo-message', 'plus', 'secondary small', `data-id="${c.id}"`) : ''}</div>` : empty('Выберите собеседницу', 'Сначала добавьте контакт в пул общения.', btn('Добавить контакт', 'add-contact', 'plus'))}</div></section>`;
}
function briefHTML(brief) {
  return `<div class="brief"><p>${esc(brief.summary)}</p>${[
    ['facts', 'Что важно помнить'],
    ['topics', 'О чём поговорить'],
    ['promises', 'О чём договорились'],
    ['boundaries', 'Личные границы'],
    ['unknowns', 'Что стоит уточнить'],
  ]
    .map(([key, title]) =>
      brief[key]?.length
        ? `<h4>${title}</h4><ul>${brief[key].map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
        : '',
    )
    .join(
      '',
    )}${brief.sources?.length ? `<small>Сообщений-источников: ${brief.sources.length}</small>` : ''}</div>`;
}
function dates() {
  return `${heading('До встречи', 'Самое важное из разговоров — под рукой перед свиданием.', btn('Добавить встречу', 'add-date', 'plus'))}${
    state.dates.length
      ? `<div class="date-grid">${[...state.dates]
          .sort((a, b) => a.at.localeCompare(b.at))
          .map((d) => {
            const c = state.contacts.find((c) => c.id === d.contactId);
            return `<article class="panel date-card"><div class="row spread"><div class="row">${avatar(c || {}, 1, true)}<h3>${esc(c?.name)}</h3></div><span class="badge ${d.status !== 'planned' ? 'gray' : ''}">${{ planned: 'Запланировано', done: 'Состоялась', cancelled: 'Отменена' }[d.status]}</span></div><div class="date-block"><div class="calendar-tile"><strong>${new Date(d.at).getDate()}</strong><span>${new Date(d.at).toLocaleString('ru-RU', { month: 'short' })}</span></div><div><h3>${esc(d.place)}</h3><p>${fmt(d.at, { weekday: 'long', hour: '2-digit', minute: '2-digit' })}</p></div></div><p>${esc(d.notes)}</p>${d.brief ? briefHTML(d.brief) : `<div class="notice">${esc(d.briefError || 'Соберём факты, темы и договорённости из вашей переписки.')}</div>`}<div class="row wrap card-actions">${btn(d.brief ? 'Обновить конспект' : 'Создать конспект', 'make-brief', 'spark', 'secondary small', `data-id="${d.id}"`)}${d.brief ? btn('Скачать', 'download-brief', 'file', 'secondary small', `data-id="${d.id}"`) : ''}${btn('Изменить', 'edit-date', 'edit', 'ghost', `data-id="${d.id}"`)}</div>${d.briefAt ? `<p class="subtitle">Обновлён ${time(d.briefAt)} · Последние 300 сообщений</p>` : ''}</article>`;
          })
          .join('')}</div>`
      : empty(
          'Хорошее ещё впереди',
          'Добавьте договорённость о встрече — конспект сформируется автоматически.',
          btn('Добавить встречу', 'add-date', 'plus'),
        )
  }`;
}
function style() {
  const p = state.style?.profile;
  return `${heading('Ваш голос. Ваш ритм.', 'Помощник учится манере общения на ваших собственных сообщениях.', btn('Импорт Telegram JSON', 'import-style', 'upload'))}<div class="settings-grid"><section class="panel"><div class="panel-head"><h2>Профиль общения</h2><span class="badge ${p ? '' : 'amber'}">${p ? 'Настроен' : 'Нужны примеры'}</span></div><div class="panel-body">${
    p
      ? `<form id="style-form" class="form-stack">${[
          ['tone', 'Тон'],
          ['length', 'Длина сообщений'],
          ['punctuation', 'Пунктуация'],
          ['emoji', 'Эмодзи'],
        ]
          .map(
            ([key, label]) =>
              `<label class="field">${label}<input name="${key}" value="${esc(p[key])}" maxlength="1000" required></label>`,
          )
          .join(
            '',
          )}<label class="field">Характерные фразы, по одной на строку<textarea name="phrases">${esc(p.phrases.join('\n'))}</textarea></label><label class="field">Правила общения, по одному на строку<textarea name="rules">${esc(p.rules.join('\n'))}</textarea></label><div class="row spread"><button class="btn" type="submit">Сохранить стиль</button>${btn('Удалить профиль', 'delete-style', 'trash', 'ghost')}</div></form>`
      : empty(
          'Начнём с ваших слов',
          'Загрузите экспорт и выберите себя среди авторов. Для анализа нужно хотя бы 5 сообщений.',
          btn('Загрузить JSON', 'import-style', 'upload'),
        )
  }</div></section><section><div class="panel style-mini"><h2>Как получается ваш стиль</h2><p>1. Экспортируйте личный чат из Telegram Desktop в JSON.<br><br>2. Выберите диалог и своего автора. Для стиля используются только ваши сообщения.<br><br>3. Просмотрите результат и отредактируйте правила.</p><div class="tags"><span class="tag">До 100 ваших сообщений</span><span class="tag">Без обучения модели</span></div><p>Выбранные примеры отправляются OpenAI для анализа. Ссылки, ники и номера маскируются; имена и другие личные детали удалите из экспорта заранее.</p></div>${p ? `<div class="style-preview"><small>ВАШИ ХАРАКТЕРНЫЕ ФРАЗЫ</small><blockquote>«${esc(p.phrases[0] || p.tone)}»</blockquote><small>${state.style.sampleCount} примеров · ${fmt(state.style.updatedAt)}</small></div>` : ''}</section></div>`;
}
function settings() {
  const tg = state.telegram;
  const stage = tg.stage;
  return `${heading('Всё под вашим контролем', 'Аккаунт, контекст о вас и общий переключатель агента.')}<div class="settings-grid"><section class="panel"><div class="panel-head"><h2>Личный Telegram</h2>${icon('send')}</div><div class="panel-body"><p class="subtitle">Агент пишет через ваш аккаунт только в выбранные личные диалоги.</p>${state.demo ? `<div class="notice">В демо подключение аккаунта отключено. Выполните npm run setup, заполните .env и запустите npm start.</div>` : tg.connected ? `<div class="connection">${icon('check')}<div><p>${esc(tg.user?.name)} ${tg.user?.username ? '@' + esc(tg.user.username) : ''}</p><small>Подключён · Сессия зашифрована</small></div></div>${btn('Выйти из Telegram', 'telegram-logout', 'exit', 'secondary')}` : !tg.configured ? `<div class="notice">Добавьте TELEGRAM_API_ID и TELEGRAM_API_HASH с my.telegram.org в .env, затем перезапустите приложение.</div>` : `<form id="telegram-form" class="form-stack"><div class="connection">${icon('lock')}<div><p>${stage === 'password' ? 'Двухэтапная проверка' : ['code', 'email-code'].includes(stage) ? 'Введите код Telegram' : 'Подключить аккаунт'}</p><small>Код и пароль не сохраняются</small></div></div>${['code', 'email-code'].includes(stage) ? '<label class="field">Код из Telegram / email<input name="code" inputmode="numeric" pattern="[0-9]{4,8}" autocomplete="one-time-code" required></label>' : stage === 'password' ? '<label class="field">Пароль 2FA<input name="password" type="password" autocomplete="off" required></label>' : '<label class="field">Номер телефона<input name="phone" type="tel" placeholder="+79991234567" pattern="[+][1-9][0-9]{7,14}" required autocomplete="tel"></label>'}<button type="submit" class="btn">${stage === 'phone' ? 'Получить код' : 'Продолжить'}</button>${stage !== 'phone' ? btn('Начать вход заново', 'telegram-cancel', '', 'secondary') : ''}</form>`}<div class="style-preview"><h3>Когда агент останавливается</h3><p class="subtitle">Вы ответили лично · Собеседница написала «стоп» · Нужна конкретная договорённость · Вы включили паузу.</p></div></div></section><section class="panel"><div class="panel-head"><h2>Контекст о вас</h2>${icon('users')}</div><div class="panel-body"><form id="settings-form" class="form-stack"><label class="field">Ваше имя<input name="ownerName" maxlength="80" value="${esc(state.settings.ownerName)}" placeholder="Как вас зовут"></label><label class="field">Что помощнику можно знать о вас<textarea name="notes" maxlength="3000" placeholder="Увлечения, интересы, факты, которыми можно делиться">${esc(state.settings.notes)}</textarea><small>Этот контекст отправляется ИИ. Не добавляйте пароли и конфиденциальные данные.</small></label><button class="btn" type="submit">Сохранить</button></form><div class="connection">${icon(state.settings.paused ? 'pause' : 'play')}<div><p>${state.settings.paused ? 'Все отправки на паузе' : 'Агент включён'}</p><small>${state.demo ? 'Демонстрационные ответы' : state.aiConfigured ? 'ИИ настроен · ' + esc(state.model) : 'Ключ ИИ пока не задан'}</small></div></div>${btn(state.settings.paused ? 'Возобновить работу' : 'Поставить всё на паузу', 'global-pause', state.settings.paused ? 'play' : 'pause', 'secondary')}<div class="row card-actions">${btn('Выйти из панели', 'logout', 'exit', 'ghost')}</div></div></section></div>`;
}
function modal(title, body) {
  $('#modal').innerHTML =
    `<div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button></div><div class="modal-body">${body}<p id="modal-error" class="error-text" role="alert"></p></div>`;
  $('#modal').showModal();
}
function closeModal() {
  $('#modal').close();
  importData = null;
}
function footer(label = 'Сохранить') {
  return `<div class="modal-footer">${btn('Отмена', 'close-modal', '', 'secondary')}<button class="btn" type="submit">${label}</button></div>`;
}
function contactModal(c) {
  modal(
    c ? `Настройки: ${esc(c.name)}` : 'Новое знакомство',
    `<form id="contact-form" data-id="${c?.id || ''}" class="form-stack"><label class="field">Имя<input name="name" value="${esc(c?.name)}" maxlength="80" placeholder="Как зовут собеседницу" ${c ? 'required' : ''}></label>${!c ? `<label class="field">Telegram ID или @username<input name="reference" placeholder="@username или 123456789" required pattern="(?:[1-9][0-9]{0,15}|@[a-zA-Z][a-zA-Z0-9_]{3,31})"></label>${state.telegram.connected ? btn('Выбрать из моих диалогов', 'load-dialogs', 'chat', 'secondary') : ''}<div id="dialog-options"></div>` : `<label class="field">Режим ответов<select name="mode"><option value="auto" ${c.mode === 'auto' ? 'selected' : ''}>Автоответы после согласия</option><option value="review" ${c.mode === 'review' ? 'selected' : ''}>Только черновики по запросу</option></select></label>`}<label class="field">Заметки<textarea name="notes" maxlength="3000" placeholder="Интересы, контекст знакомства, важные детали">${esc(c?.notes)}</textarea></label>${!c ? '<p>После добавления отправьте уведомление об ИИ из диалога. До согласия автоответы отключены.</p>' : `<div class="row spread"><small>ID ${esc(c.peerId)}</small>${btn('Удалить контакт', 'delete-contact', 'trash', 'ghost', `data-id="${c.id}"`)}</div>`}${footer(c ? 'Сохранить' : 'Добавить контакт')}</form>`,
  );
}
function dateModal(date, contactId) {
  if (!state.contacts.length) {
    toast('Сначала добавьте контакт.');
    return;
  }
  modal(
    date ? 'Детали встречи' : 'Время встретиться',
    `<form id="date-form" data-id="${date?.id || ''}" class="form-stack"><label class="field">С кем<select name="contactId" ${date ? 'disabled' : ''}>${state.contacts.map((c) => `<option value="${c.id}" ${(date?.contactId || contactId) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label class="field">Дата и время<input name="at" type="datetime-local" required value="${dateInput(date?.at || Date.now() + 86400000)}"><small>Часовой пояс устройства: ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}</small></label><label class="field">Место<input name="place" maxlength="200" placeholder="Кофейня, адрес или место встречи" value="${esc(date?.place)}" required></label><label class="field">Детали<textarea name="notes" maxlength="2000">${esc(date?.notes)}</textarea></label>${
      date
        ? `<label class="field">Статус<select name="status">${[
            ['planned', 'Запланировано'],
            ['done', 'Состоялась'],
            ['cancelled', 'Отменена'],
          ]
            .map(([v, t]) => `<option value="${v}" ${date.status === v ? 'selected' : ''}>${t}</option>`)
            .join(
              '',
            )}</select></label>${btn('Удалить встречу', 'delete-date', 'trash', 'ghost', `data-id="${date.id}"`)}`
        : '<p>После сохранения подготовим конспект доступной переписки. Это не отправляет приглашение в Telegram.</p>'
    }${footer(date ? 'Сохранить' : 'Сохранить и подготовить')}</form>`,
  );
}
function importModal(mode, contactId) {
  importMode = mode;
  importData = null;
  modal(
    mode === 'style' ? 'Учимся вашему стилю' : 'Импорт переписки',
    `<form id="import-form" data-contact="${contactId || ''}" class="form-stack"><label class="file-label">${icon('upload')}Экспорт личного чата Telegram Desktop<br>JSON · до 15 МБ<input type="file" id="import-file" accept=".json,application/json" required></label><div id="import-options"></div><label class="check"><input type="checkbox" name="permission" required><span>${mode === 'style' ? 'Разрешаю отправить выбранные мои сообщения в OpenAI для анализа стиля.' : 'У меня есть разрешение на обработку этой переписки и её использование для ответов и конспектов с ИИ.'}</span></label>${footer(mode === 'style' ? 'Проанализировать стиль' : 'Импортировать')}</form>`,
  );
}
function importOptions() {
  $('#import-options').innerHTML =
    `<div class="form-stack"><label class="field">Диалог<select id="import-chat" name="chatKey">${importChats.map((c) => `<option value="${esc(c.key)}">${esc(c.name)} · ${c.messages} сообщений</option>`).join('')}</select></label><label class="field">Кто из авторов — вы?<select id="import-author" name="selfId" required></select></label></div>`;
  importAuthors();
}
function importAuthors() {
  const c = importChats.find((c) => c.key === $('#import-chat').value);
  $('#import-author').innerHTML =
    `<option value="">Выберите своего автора</option>${c.authors.map((a) => `<option value="${esc(a.id)}">${esc(a.name)} (${esc(a.id)})</option>`).join('')}`;
}
function confirmModal(title, text, action, id) {
  modal(
    title,
    `<p>${text}</p><div class="modal-footer">${btn('Отмена', 'close-modal', '', 'secondary')}${btn('Подтвердить', action, '', 'danger', `data-id="${id || ''}"`)}</div>`,
  );
}
async function runAction(action, target) {
  const id = target.dataset.id;
  const c = state?.contacts.find((c) => c.id === id);
  if (action.startsWith('go-')) {
    page = action.slice(3);
    await refresh();
    return;
  }
  switch (action) {
    case 'close-modal':
      closeModal();
      break;
    case 'add-contact':
      contactModal();
      break;
    case 'edit-contact':
      contactModal(c);
      break;
    case 'open-chat':
      selected = id;
      page = 'chats';
      await refresh();
      break;
    case 'contact-pause':
      await api(`/contacts/${id}`, { active: !c.active }, 'PATCH');
      await refresh();
      break;
    case 'global-pause':
      await api('/settings', { paused: !state.settings.paused }, 'PATCH');
      await refresh();
      break;
    case 'delete-contact':
      confirmModal(
        'Удалить контакт?',
        'Контакт, его переписка, встречи и конспекты будут удалены из приложения. История в Telegram сохранится.',
        'confirm-delete-contact',
        id,
      );
      break;
    case 'confirm-delete-contact':
      await api(`/contacts/${id}`, undefined, 'DELETE');
      closeModal();
      await refresh();
      toast('Контакт удалён.');
      break;
    case 'disclose':
      confirmModal(
        'Представить помощника?',
        `В личный диалог с ${esc(c.name)} уйдёт сообщение о том, что пишет ИИ-помощник, история обрабатывается OpenAI, общение предназначено для взрослых и включается по /agree. Остановить агента можно по /stop.`,
        'confirm-disclose',
        id,
      );
      break;
    case 'confirm-disclose':
      await api(`/contacts/${id}/disclose`, {});
      closeModal();
      await refresh();
      toast('Уведомление отправлено. Ждём согласия.');
      break;
    case 'generate':
      await api(`/contacts/${id}/generate`, {});
      await refresh();
      toast('Ответ подготовлен.');
      break;
    case 'send-draft':
      await api(`/messages/${id}/send`, { text: $(`#draft-${id}`).value });
      await refresh();
      toast(state.demo ? 'Демонстрационный ответ сохранён.' : 'Ответ отправлен.');
      break;
    case 'discard-draft':
      await api(`/messages/${id}`, undefined, 'DELETE');
      await refresh();
      break;
    case 'add-date':
      dateModal(null, id);
      break;
    case 'edit-date':
      dateModal(state.dates.find((d) => d.id === id));
      break;
    case 'delete-date':
      confirmModal('Удалить встречу?', 'Встреча и её конспект будут удалены.', 'confirm-delete-date', id);
      break;
    case 'confirm-delete-date':
      await api(`/dates/${id}`, undefined, 'DELETE');
      closeModal();
      await refresh();
      break;
    case 'make-brief':
      await api(`/dates/${id}/brief`, {});
      await refresh();
      toast('Конспект обновлён.');
      break;
    case 'download-brief': {
      const d = state.dates.find((d) => d.id === id);
      const b = d.brief;
      const text = [
        `Встреча: ${state.contacts.find((c) => c.id === d.contactId)?.name}`,
        time(d.at),
        d.place,
        '',
        b.summary,
        ...[
          ['facts', 'Факты'],
          ['topics', 'Темы'],
          ['promises', 'Договорённости'],
          ['boundaries', 'Границы'],
          ['unknowns', 'Уточнить'],
        ].flatMap(([key, label]) => ['', label, ...b[key].map((x) => '- ' + x)]),
        '',
        'Источники (ID сообщений):',
        ...b.sources,
      ].join('\n');
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'date-brief.txt';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      break;
    }
    case 'import-style':
      importModal('style');
      break;
    case 'import-history':
      importModal('history', id);
      break;
    case 'delete-style':
      confirmModal(
        'Удалить профиль стиля?',
        'Правила стиля будут удалены, а все отправки приостановлены.',
        'confirm-delete-style',
      );
      break;
    case 'confirm-delete-style':
      await api('/style', undefined, 'DELETE');
      closeModal();
      await refresh();
      break;
    case 'load-dialogs': {
      const dialogs = await api('/telegram/dialogs');
      $('#dialog-options').innerHTML =
        `<div class="dialog-list">${dialogs.map((d) => `<button type="button" data-action="pick-dialog" data-peer="${esc(d.id)}" data-name="${esc(d.name)}">${esc(d.name)} <small>${d.username ? '@' + esc(d.username) : d.id}</small></button>`).join('') || '<p>Личные диалоги не найдены.</p>'}</div>`;
      break;
    }
    case 'pick-dialog':
      $('#contact-form [name="reference"]').value = target.dataset.peer;
      $('#contact-form [name="name"]').value = target.dataset.name;
      $('#dialog-options').innerHTML = '';
      break;
    case 'telegram-logout':
      confirmModal(
        'Отключить Telegram?',
        'Сессия приложения будет отозвана, агент встанет на общую паузу.',
        'confirm-telegram-logout',
      );
      break;
    case 'telegram-cancel':
      await api('/telegram/cancel', {});
      await refresh();
      break;
    case 'confirm-telegram-logout':
      await api('/telegram/logout', {});
      closeModal();
      await refresh();
      break;
    case 'logout':
      await api('/logout', {});
      csrf = null;
      await init();
      break;
    case 'demo-message':
      modal(
        'Входящее сообщение · демо',
        `<form id="demo-form" data-id="${id}" class="form-stack"><label class="field">Текст собеседницы<textarea name="text" required placeholder="Введите сообщение, /agree или /stop"></textarea></label>${footer('Добавить сообщение')}</form>`,
      );
      break;
  }
}
document.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.page) {
    page = target.dataset.page;
    await refresh().catch((e) => toast(e.message, true));
    return;
  }
  if (target.dataset.filter) {
    filter = target.dataset.filter;
    render();
    return;
  }
  if (!target.dataset.action) return;
  event.preventDefault();
  target.disabled = true;
  try {
    await runAction(target.dataset.action, target);
  } catch (e) {
    showError(e);
  } finally {
    target.disabled = false;
  }
});
function showError(e) {
  if ($('#modal').open && $('#modal-error')) $('#modal-error').textContent = e.message;
  else toast(e.message, true);
}
document.addEventListener('input', (event) => {
  if (event.target.closest('form') || event.target.matches('.draft textarea')) dirty = true;
  if (event.target.id !== 'search') return;
  search = event.target.value;
  const position = event.target.selectionStart;
  render();
  $('#search').focus();
  $('#search').setSelectionRange(position, position);
});
document.addEventListener('change', async (event) => {
  if (event.target.closest('form')) dirty = true;
  if (event.target.id === 'import-chat') importAuthors();
  if (event.target.id === 'import-file') {
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 15 * 1024 * 1024) throw new Error('Максимальный размер файла — 15 МБ.');
      importData = JSON.parse(await file.text());
      importChats = await api('/import/preview', { data: importData });
      importOptions();
      $('#modal-error').textContent = '';
    } catch (e) {
      importData = null;
      $('#import-options').innerHTML = '';
      showError(e instanceof SyntaxError ? new Error('Файл не содержит корректный JSON.') : e);
    }
  }
});
document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  const submit = form.querySelector('button[type="submit"]');
  const original = submit?.textContent;
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Подождите…';
  }
  const value = Object.fromEntries(new FormData(form));
  try {
    switch (form.id) {
      case 'login-form': {
        const result = await api('/login', value);
        csrf = result.csrf;
        await refresh();
        return;
      }
      case 'contact-form':
        await api(
          `/contacts${form.dataset.id ? '/' + form.dataset.id : ''}`,
          value,
          form.dataset.id ? 'PATCH' : 'POST',
        );
        closeModal();
        break;
      case 'settings-form':
        await api('/settings', value, 'PATCH');
        toast('Контекст сохранён.');
        break;
      case 'style-form':
        value.phrases = value.phrases.split('\n').filter(Boolean);
        value.rules = value.rules.split('\n').filter(Boolean);
        await api('/style', value, 'PUT');
        toast('Стиль сохранён.');
        break;
      case 'date-form':
        value.at = new Date(value.at).toISOString();
        await api(
          `/dates${form.dataset.id ? '/' + form.dataset.id : ''}`,
          value,
          form.dataset.id ? 'PATCH' : 'POST',
        );
        closeModal();
        page = 'dates';
        break;
      case 'import-form': {
        if (!importData) throw new Error('Выберите корректный JSON-файл.');
        const result = await api(`/import/${importMode}`, {
          ...value,
          permission: value.permission === 'on',
          data: importData,
          ...(form.dataset.contact ? { contactId: form.dataset.contact } : {}),
        });
        closeModal();
        toast(importMode === 'style' ? 'Профиль стиля готов.' : `Добавлено сообщений: ${result.count}`);
        break;
      }
      case 'telegram-form':
        await api(
          `/telegram/${['code', 'email-code'].includes(state.telegram.stage) ? 'signin' : state.telegram.stage === 'password' ? 'password' : 'code'}`,
          value,
        );
        form.reset();
        break;
      case 'demo-form':
        await api('/demo/message', { ...value, contactId: form.dataset.id });
        closeModal();
        break;
    }
    await refresh();
  } catch (e) {
    showError(e);
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = original;
    }
  }
});
async function init() {
  const result = await api('/session');
  csrf = result.csrf;
  if (result.authenticated) {
    await refresh();
    return;
  }
  if (result.demo) {
    csrf = (await api('/login', { password: '' })).csrf;
    await refresh();
    return;
  }
  $('#app').innerHTML =
    `<main class="login">${brand()}<h1>Ваше личное пространство</h1><p>Войдите, чтобы управлять диалогами, стилем общения и встречами.</p><form id="login-form" class="form-stack"><label class="field">Пароль панели<input name="password" type="password" autocomplete="current-password" required autofocus></label><button type="submit" class="btn">Войти ${icon('right')}</button><small>Пароль ADMIN_PASSWORD из локального .env</small></form></main>`;
}
init().catch((e) => {
  $('#app').innerHTML =
    `<main class="login"><h1>Не удалось подключиться</h1><p>${esc(e.message)}</p><a class="btn" href="/">Обновить страницу</a></main>`;
});
setInterval(() => {
  if (
    state &&
    csrf &&
    !dirty &&
    !document.hidden &&
    !$('#modal').open &&
    !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
  )
    refresh().catch(() => {});
}, 10000);
