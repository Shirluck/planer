/* Планер — поиск по всему (Ctrl+K): задачи за все дни и их заметки, блоки времени, папки, страницы и их текст,
   карточки досок (заметки, чек-листы, ссылки, подписи). Плюс быстрые команды: новая задача, таймеры, тема и др.
   Логика совпадений и оценки — src/core.js (search, matchRanges, snippet). Классический скрипт (см. index.html). */
'use strict';

const { search:coreSearch, searchTokens, matchRanges, snippet:coreSnippet } = window.PlanerCore;
const SP = { ov:null, input:null, list:null, results:[], active:0, cards:[], cardsReady:false, loadSeq:0 };
const SP_KIND = {
  cmd:   { ico:'arrow',  name:'Действие' },
  task:  { ico:'check',  name:'Задача' },
  block: { ico:'clock',  name:'Блок времени' },
  page:  { ico:'file',   name:'Текст' },
  board: { ico:'board',  name:'Доска' },
  folder:{ ico:'folder', name:'Папка' },
  card:  { ico:'note',   name:'Карточка' }
};
const SP_GROUPS = [['cmd', 'Действия', 5], ['task', 'Задачи', 8], ['block', 'Блоки времени', 3], ['page', 'Страницы и доски', 8], ['card', 'На досках', 8], ['folder', 'Папки', 4]];
const CARD_NAMES = { note:'заметка', checklist:'чек-лист', link:'ссылка', image:'изображение', video:'видео', sketch:'зарисовка', ink:'рисунок' };

function initSearch(){
  const b = $('#searchBtn');
  b.hidden = false;
  b.append(icon('search', 16), h('span', {}, 'Поиск'), h('kbd', {}, 'Ctrl+K'));
  b.title = 'Поиск по задачам, страницам и доскам (Ctrl+K)';
  b.setAttribute('aria-label', 'Поиск по задачам, страницам и доскам');
  b.addEventListener('click', () => openSearch());
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyK') {
      const sel = window.getSelection();
      if (boxEl && boxEl.contains(document.activeElement) && sel && !sel.isCollapsed) return;   // в заметке Ctrl+K с выделением — ссылка
      if (document.querySelector('.pk-ov, .sk-ov')) return;          // диалог ключа API, редактор зарисовки
      e.preventDefault(); e.stopPropagation();
      if (SP.ov) closeSearch(); else openSearch();
    }
  }, true);
}

/* ---------- записи для поиска ---------- */
function spRecords(){
  const out = [];
  for (const [date, d] of Object.entries(S.cal.days)) {
    d.items.forEach(t => out.push({ kind:'task', id:t.id, date, title:t.text, text:t.note || '', t }));
    (d.blocks || []).forEach(b => out.push({ kind:'block', id:b.id, date, title:b.title || (b.from + '–' + b.to), text:b.from + '–' + b.to, b }));
  }
  S.cal.undated.forEach(t => out.push({ kind:'task', id:t.id, date:null, title:t.text, text:t.note || '', t }));
  for (const k of ['plans', 'ideas']) {
    const walk = (arr, path) => arr.forEach(n => {
      if (n.type === 'folder') { out.push({ kind:'folder', k, id:n.id, title:n.title || 'Без названия', text:'', path }); walk(n.children, [...path, n.title || 'Без названия']); }
      else out.push({ kind:n.kind === 'board' ? 'board' : 'page', k, id:n.id, title:n.title || 'Без названия', text:n.blocks.map(b => b.t === 'code' ? b.text : window.PlanerCore.mdPlain(b.text)).join('\n'), path, n });
    });
    walk(S[k].nodes, []);
  }
  return out.concat(SP.cards);
}
// Карточки досок читаются асинхронно (доски хранятся отдельными документами); поиск обновляется, когда они готовы.
async function spLoadCards(){
  const seq = ++SP.loadSeq;
  if (!boardApi) { SP.cardsReady = true; return; }
  const cards = [];
  const pages = [];
  for (const k of ['plans', 'ideas']) { const walk = arr => arr.forEach(n => { if (n.type === 'folder') walk(n.children); else if (n.boardCount > 0) pages.push({ k, n }); }); walk(S[k].nodes); }
  for (const { k, n } of pages) {
    let list = [];
    try { list = await boardApi.readBoard(ownerKey(n)); } catch (e) { continue; }
    for (const c of list) {
      const parts = [c.text, c.title, c.description, c.url, c.site, c.caption, c.file].concat((c.items || []).map(x => x.text)).filter(Boolean);
      if (!parts.length) continue;                                       // фото без подписи, рисунок — искать нечего
      const first = c.type === 'note' ? firstLine(c.text) : c.title || c.caption || c.file || (c.url ? c.url.replace(/^https?:\/\//, '') : '');
      cards.push({ kind:'card', id:c.id, k, pageId:n.id, page:n.title || 'Без названия', cardType:c.type, title:first.slice(0, 120) || CARD_NAMES[c.type] || 'карточка', text:parts.join('\n') });
    }
  }
  if (seq !== SP.loadSeq) return;
  SP.cards = cards; SP.cardsReady = true;
  if (SP.ov) spRun();
}

/* ---------- быстрые команды ---------- */
function spDateCmd(q){
  const s = q.trim().toLowerCase().replace(/ё/g, 'е');
  let k = null;
  if (s === 'сегодня') k = todayKey(); else if (s === 'завтра') k = addDays(todayKey(), 1); else if (s === 'вчера') k = addDays(todayKey(), -1);
  else if (isDateKey(s)) k = s;
  else {
    const m = s.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/);
    if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : new Date().getFullYear(); const c = y + '-' + pad2(Number(m[2])) + '-' + pad2(Number(m[1])); if (isDateKey(c)) k = c; }
  }
  return k ? { kind:'cmd', id:'date-' + k, title:'Открыть день: ' + fmtDate(k, { weekday:'long', day:'numeric', month:'long', year:'numeric' }), text:'', ico:'cal', run:() => { weekStart = mondayOf(k); calMonth = monthOf(k); refreshWeek(); openDay(k); } } : null;
}
function spCommands(){
  const ea = window.electronAPI, ui = SET.ui || {};
  const cmds = [
    { title:'Новая задача на сегодня', text:'добавить дело задачу', ico:'plus', run:() => { const i = cols.day && cols.day.input; if (i) i.focus(); } },
    { title:'Открыть сегодняшний день целиком', text:'день план', ico:'sun', run:() => openDay(todayKey()) },
    { title:'Новый текстовый документ в «Основных планах»', text:'страница файл создать', ico:'file', run:() => addNode('plans', null, 'page', 'text') },
    { title:'Новая доска в «Основных планах»', text:'холст создать', ico:'board', run:() => addNode('plans', null, 'page', 'board') },
    { title:'Новый текстовый документ в «Идеях»', text:'страница файл создать', ico:'file', run:() => addNode('ideas', null, 'page', 'text') },
    { title:'Новая доска в «Идеях»', text:'холст создать', ico:'board', run:() => addNode('ideas', null, 'page', 'board') },
    TM.api ? { title:'Таймеры', text:'фокус помодоро перерыв', ico:'timer', run:() => openTimers() } : null,
    MT.btn ? { title:'Моушн: мои ссылки на сайты', text:'ссылки сайты закладки моушн инструменты', ico:'globe', run:() => openTools('links') } : null,
    MT.btn ? { title:'Экспрешены After Effects', text:'экспрешн expression ae aftereffects wiggle loop моушн', ico:'code', run:() => openTools('expr') } : null,
    MT.btn ? { title:'Кадры, секунды, таймкод', text:'тайминг таймкод fps кадры bpm музыка моушн', ico:'film', run:() => openTools('time') } : null,
    MT.btn ? { title:'Цвет для After Effects', text:'цвет hex rgb ae палитра моушн', ico:'palette', run:() => openTools('color') } : null,
    MT.btn ? { title:'Форматы кадра', text:'размер кадра формат reels shorts 1920 1080 моушн', ico:'frame', run:() => openTools('formats') } : null,
    ...((TM.st && TM.st.presets) || []).map(p => ({ title:'Запустить таймер «' + p.title + '» — ' + fmtDuration(p.ms), text:'таймер старт', ico:'play', run:() => TM.api.start({ presetId:p.id }) })),
    sample ? { title:'Открыть ассистента', text:'ии claude помощник', ico:'spark', run:() => openAi() } : null,
    ea && ea.ui ? { title:'Настройки и оформление', text:'тема размер компактный автозапуск', ico:'gear', run:() => openSettings() } : null,
    ea && ea.ui ? { title:'Тема: светлая', text:'оформление светлый', ico:'sun', run:() => setUi({ theme:'light' }) } : null,
    ea && ea.ui ? { title:'Тема: тёмная', text:'оформление темный ночь', ico:'moon', run:() => setUi({ theme:'dark' }) } : null,
    ea && ea.ui ? { title:'Тема: как в системе', text:'оформление авто', ico:'monitor', run:() => setUi({ theme:'system' }) } : null,
    ea && ea.ui ? { title:ui.compact ? 'Компактный режим: выключить' : 'Компактный режим: включить', text:'плотнее мельче оформление', ico:'rows', run:() => setUi({ compact:!ui.compact }) } : null,
    ea && ea.backups ? { title:'Восстановить из резервной копии', text:'копия бэкап вернуть откат', ico:'history', run:() => openRestore() } : null
  ];
  return cmds.filter(Boolean).map((c, i) => Object.assign({ kind:'cmd', id:'cmd' + i }, c));
}

/* ---------- окно поиска ---------- */
function openSearch(initial){
  if (SP.ov) { SP.input.focus(); SP.input.select(); return; }
  closeMenu();
  SP.input = h('input', { class:'sp-in', type:'text', placeholder:'Найти задачу, страницу, карточку… или действие', 'aria-label':'Поиск', autocomplete:'off', spellcheck:'false',
    role:'combobox', 'aria-expanded':'true', 'aria-controls':'spList', 'aria-autocomplete':'list' });
  SP.list = h('div', { class:'sp-list', id:'spList', role:'listbox', 'aria-label':'Результаты поиска' });
  const box = h('div', { class:'sp-box', role:'dialog', 'aria-modal':'true', 'aria-label':'Поиск' },
    h('div', { class:'sp-top' }, icon('search', 18), SP.input, h('kbd', {}, 'Esc')),
    SP.list,
    h('div', { class:'sp-foot' }, h('span', {}, h('kbd', {}, '↑'), h('kbd', {}, '↓'), ' выбрать'), h('span', {}, h('kbd', {}, 'Enter'), ' открыть'), h('span', {}, 'Можно ввести дату: ', h('kbd', {}, '25.12'), ' или ', h('kbd', {}, 'завтра'))));
  SP.ov = h('div', { class:'sp-ov', onmousedown:e => { if (e.target === SP.ov) closeSearch(); } }, box);
  SP.input.addEventListener('input', () => spRun());
  SP.input.addEventListener('keydown', spKeys);
  document.body.append(SP.ov);
  if (initial) SP.input.value = initial;
  SP.cardsReady = false;
  spRun();
  SP.input.focus();
  spLoadCards();
}
function closeSearch(){ if (!SP.ov) return; SP.ov.remove(); SP.ov = null; SP.loadSeq++; }
function spKeys(e){
  if (e.isComposing) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSearch(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); spSetActive(SP.active + (e.key === 'ArrowDown' ? 1 : -1)); return; }
  if (e.key === 'Enter') { e.preventDefault(); const r = SP.results[SP.active]; if (r) spOpen(r); }
}
function spRun(){
  const q = SP.input.value, tokens = searchTokens(q);
  SP.lastQuery = q;
  let res = [];
  if (!tokens.length) res = spCommands().slice(0, 6);
  else {
    const dc = spDateCmd(q);
    const found = coreSearch(spRecords().concat(spCommands()), q, 400);
    const groups = SP_GROUPS.map(([kind, , max]) => found.filter(r => r.kind === kind || (kind === 'page' && r.kind === 'board')).slice(0, max));
    res = (dc ? [dc] : []).concat(...groups);
  }
  SP.results = res;
  SP.active = 0;
  SP.list.replaceChildren();
  if (!tokens.length) SP.list.append(h('div', { class:'sp-group' }, 'Быстрые действия'));
  let lastGroup = null;
  res.forEach((r, i) => {
    const g = SP_GROUPS.find(([kind]) => kind === r.kind || (kind === 'page' && r.kind === 'board'));
    if (tokens.length && g && g[1] !== lastGroup) { lastGroup = g[1]; SP.list.append(h('div', { class:'sp-group' }, g[1])); }
    SP.list.append(spRow(r, i, tokens));
  });
  if (tokens.length && !res.length) SP.list.append(h('div', { class:'sp-none' }, SP.cardsReady ? 'Ничего не найдено. Попробуйте другое слово.' : 'Ищу…'));
  if (tokens.length && !SP.cardsReady && res.length) SP.list.append(h('div', { class:'sp-more' }, 'Ещё ищу на досках…'));
  spSetActive(0);
}
function spMark(text, tokens){
  const s = String(text || ''), frag = document.createDocumentFragment();
  let at = 0;
  for (const [a, b] of matchRanges(s, tokens)) { if (a > at) frag.append(s.slice(at, a)); frag.append(h('mark', {}, s.slice(a, b))); at = b; }
  if (at < s.length) frag.append(s.slice(at));
  return frag;
}
function spRow(r, i, tokens){
  let sub = '', ico = r.ico || SP_KIND[r.kind].ico;
  const textHit = r.text && tokens.some(t => normSearchText(r.text).includes(t)) && !tokens.every(t => normSearchText(r.title).includes(t));
  if (r.kind === 'task') sub = (r.date ? cap(dayLabel(r.date)) : 'Без даты') + (r.t.done ? ' · выполнено' : '') + (r.t.pri >= URGENT ? ' · срочно' : '');
  else if (r.kind === 'block') sub = 'Блок ' + r.b.from + '–' + r.b.to + ' · ' + cap(dayLabel(r.date));
  else if (r.kind === 'page' || r.kind === 'board' || r.kind === 'folder') sub = [SECTIONS[r.k].title, ...r.path].join(' › ');
  else if (r.kind === 'card') { sub = 'Доска «' + r.page + '» · ' + (CARD_NAMES[r.cardType] || 'карточка'); ico = r.cardType === 'checklist' ? 'todo' : r.cardType === 'link' ? 'arrow' : 'note'; }
  const row = h('div', { class:'sp-row' + (r.kind === 'task' && r.t.done ? ' done' : ''), role:'option', id:'sp-' + i, 'data-i':String(i), 'aria-selected':'false',
      onmousemove:() => { if (SP.active !== i) spSetActive(i); }, onclick:() => spOpen(r) },
    h('span', { class:'sp-ico k-' + r.kind }, icon(ico, 16)),
    h('div', { class:'sp-txt' },
      h('div', { class:'sp-title' }, spMark(r.title || 'Без названия', tokens)),
      sub || textHit ? h('div', { class:'sp-sub' }, sub, textHit ? h('span', { class:'sp-snip' }, (sub ? ' — ' : ''), spMark(coreSnippet(r.text, tokens, 80), tokens)) : null) : null),
    r.kind === 'cmd' ? null : h('span', { class:'sp-kind' }, r.kind === 'card' ? 'доска' : SP_KIND[r.kind].name.toLowerCase()));
  return row;
}
const normSearchText = s => window.PlanerCore.normSearch(s);
function spSetActive(i){
  const rows = SP.list.querySelectorAll('.sp-row'); if (!rows.length) { SP.input.removeAttribute('aria-activedescendant'); return; }
  SP.active = (i + rows.length) % rows.length;
  rows.forEach((r, j) => r.setAttribute('aria-selected', String(j === SP.active)));
  const cur = rows[SP.active]; SP.input.setAttribute('aria-activedescendant', cur.id);
  cur.scrollIntoView({ block:'nearest' });
}

/* ---------- переход к найденному ---------- */
function spOpen(r){
  closeSearch();
  if (r.kind === 'cmd') { r.run(); return; }
  if (r.kind === 'task') { revealTask(r.id); return; }
  if (r.kind === 'block') { weekStart = mondayOf(r.date); calMonth = monthOf(r.date); refreshWeek(); openDay(r.date); return; }
  if (boardApi && boardApi.isOpen() && r.kind !== 'card') boardApi.close();
  if (r.kind === 'folder') { revealNode(r.k, r.id); return; }
  if (r.kind === 'board') { revealNode(r.k, r.id); openNodeBoard(r.k, r.id); return; }
  if (r.kind === 'page') {
    revealNode(r.k, r.id); openPage(r.k, r.id);
    editorReveal(searchTokens(SP.lastQuery || ''));             // найденное слово выделено в тексте страницы
    return;
  }
  if (r.kind === 'card') {
    const l = findNode(r.k, r.pageId); if (!l) return;
    revealNode(r.k, r.pageId);
    Promise.resolve(boardApi && boardApi.open(ownerKey(l.node))).then(() => boardApi && boardApi.reveal && boardApi.reveal(r.id));
  }
}
// Задача: сегодняшняя — в колонке «Сегодня», остальные — в окне своего дня. Найденная строка подсвечивается.
function revealTask(id){
  const loc = findTask(id); if (!loc) return;
  closeMenu(); if (overlayEl) closeEditor(true); if (boardApi && boardApi.isOpen()) boardApi.close();
  const flash = row => { if (!row) return; row.classList.remove('sp-flash'); void row.offsetWidth; row.classList.add('sp-flash'); };
  if (loc.date === todayKey() && !(loc.t.done && S.cal.hideDone)) {
    if (dayView) closeDay();
    const row = cols.day.list.querySelector('.item[data-id="' + id + '"]');
    if (row) { row.scrollIntoView({ block:'center' }); const ta = row.querySelector('.txt'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); flash(row); return; }
  }
  if (loc.date) { weekStart = mondayOf(loc.date); calMonth = monthOf(loc.date); refreshWeek(); }
  openDay(loc.date, id);
  flash(dayView && dayView.list.querySelector('.item[data-id="' + id + '"]'));
}
// Папка или файл в дереве: раскрыть родительские папки, прокрутить и выделить строку.
function revealNode(k, id){
  const loc = findNode(k, id); if (!loc) return;
  let opened = false;
  loc.path.forEach(f => { if (!f.open) { f.open = true; opened = true; } });
  if (opened) touch(k);
  refreshTree(k, id);
  const row = cols[k].list.querySelector('.node[data-id="' + id + '"]');
  if (row) { row.scrollIntoView({ block:'center' }); row.classList.remove('sp-flash'); void row.offsetWidth; row.classList.add('sp-flash'); }
}
