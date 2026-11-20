/* Планер — общие помощники (h, icon), модель данных, даты, поиск задач и страниц.
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

/* ---------- helpers ---------- */
const $ = (s, r=document) => r.querySelector(s);
const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
};
const { newId, DATE_RE, TIME_RE, BLOCK_TYPES, BLOCK_COLOR_IDS, pad2, dkey, todayKey, parseKey, isDateKey, addDays, mondayOf, monthOf, addMonths, cap, plural,
  normTask, normTimeBlock, normBlock, normNode, normCal, parseNewTask } = window.PlanerCore;   // src/core.js
const clone = o => JSON.parse(JSON.stringify(o));
const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
  : (v && typeof v === 'object') ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
  : JSON.stringify(v);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const IC = {
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  grip:'<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/></g>',
  flag:'<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  note:'<path d="M4 6h16M4 12h10M4 18h14"/>',
  more:'<g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></g>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  folder:'<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  folderplus:'<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M12 10.5v5M9.5 13h5"/>',
  file:'<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  fileplus:'<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M12 12v5M9.5 14.5h5"/>',
  chev:'<path d="M9 6l6 6-6 6"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  sort:'<path d="M7 5v14M7 19l-3-3M7 19l3-3M17 19V5M17 5l-3 3M17 5l3 3"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
  spark:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  up:'<path d="M12 19V5M5 12l7-7 7 7"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
  cal:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  bulb:'<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z"/>',
  pencil:'<path d="M4 20l4-1 11-11-3-3L5 16z"/>',
  text:'<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  head:'<path d="M5 5v14M19 5v14M5 12h14"/>',
  list:'<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
  todo:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  dot:'<circle cx="12" cy="12" r="2"/>',
  timer:'<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.6 1.6M9.5 2.5h5M12 2.5V6M18.4 6.6l1.6-1.6"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  play:'<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  pause:'<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  history:'<path d="M3.5 12a8.5 8.5 0 102.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 7.5V12l3 2"/>',
  moon:'<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>',
  monitor:'<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  volume:'<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>',
  rows:'<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  power:'<path d="M12 3v8.5"/><path d="M6.4 6.6a8 8 0 1011.2 0"/>',
  bell:'<path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 004 0"/>',
  h1:'<path d="M4 6v12M12 6v12M4 12h8"/><path d="M17 9l2.5-2v11"/>',
  h2:'<path d="M3.5 6v12M11 6v12M3.5 12H11"/><path d="M15 9.5a2.5 2.5 0 015 0c0 2-5 4.5-5 8.5h5"/>',
  h3:'<path d="M3.5 6v12M11 6v12M3.5 12H11"/><path d="M15 7.5h5l-3 4a3 3 0 11-2.5 4.5"/>',
  olist:'<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5l1.5-1v5M3.5 14.5a1.3 1.3 0 012.5.5c0 1-2.5 2-2.5 3.5H6"/>',
  quote:'<path d="M5 5v14"/><path d="M9 8h10M9 12h10M9 16h6"/>',
  callout:'<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="8" cy="12" r="1.6" fill="currentColor"/><path d="M12 10h5M12 14h4"/>',
  code:'<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5"/>',
  hr:'<path d="M3 12h18"/><path d="M6 7h12M6 17h12" opacity=".35"/>',
  bold:'<path d="M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z"/>',
  italic:'<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
  underline:'<path d="M7 4v7a5 5 0 0010 0V4M5 20h14"/>',
  strike:'<path d="M4 12h16"/><path d="M16.5 7.5C16 5.5 14.3 4.5 12 4.5c-2.8 0-4.5 1.5-4.5 3.5 0 1.3.7 2.4 2.5 3M8 16.5c.6 2 2.3 3 4.5 3 2.8 0 4.5-1.4 4.5-3.5 0-.8-.2-1.5-.7-2"/>',
  link:'<path d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1"/>',
  dup:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  down:'<path d="M12 5v14M5 12l7 7 7-7"/>',
  clear:'<path d="M6 5h12M12 5l-3 14"/><path d="M14 14l6 6M20 14l-6 6"/>',
  tools:'<path d="M14.7 6.3a4 4 0 00-5.4 5.4L3.5 17.5a1.8 1.8 0 002.5 2.5l5.8-5.8a4 4 0 005.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  film:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>',
  palette:'<path d="M12 3a9 9 0 100 18c1.2 0 1.8-.9 1.4-2-.5-1.2.3-2.5 1.6-2.5H17a4 4 0 004-4c0-5-4-9.5-9-9.5z"/><circle cx="7.5" cy="11" r="1.2" fill="currentColor"/><circle cx="10" cy="7" r="1.2" fill="currentColor"/><circle cx="15" cy="7.5" r="1.2" fill="currentColor"/>',
  frame:'<rect x="4" y="6" width="16" height="12" rx="1.5"/><path d="M2 9V4h5M22 9V4h-5M2 15v5h5M22 15v5h-5"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  ext:'<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  board:'<rect x="3" y="4" width="18" height="16" rx="3"/><rect x="6.5" y="7.5" width="5" height="4" rx="1"/><rect x="13" y="7.5" width="4.5" height="7" rx="1"/><rect x="6.5" y="13.5" width="5" height="3" rx="1"/>'
};
function icon(n, s=16){
  const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  sv.setAttribute('viewBox', '0 0 24 24'); sv.setAttribute('width', s); sv.setAttribute('height', s);
  sv.setAttribute('fill', 'none'); sv.setAttribute('stroke', 'currentColor'); sv.setAttribute('stroke-width', '2');
  sv.setAttribute('stroke-linecap', 'round'); sv.setAttribute('stroke-linejoin', 'round'); sv.setAttribute('aria-hidden', 'true');
  sv.innerHTML = IC[n] || IC.dot;
  return sv;
}
function autosize(ta){
  if (!ta || ta.offsetParent === null) return;
  ta.style.height = 'auto';
  ta.style.height = (ta.scrollHeight + (ta.offsetHeight - ta.clientHeight)) + 'px';
}
const autosizeAll = () => document.querySelectorAll('.txt,.note,.b-in,.ai-in').forEach(autosize);

/* ---------- model ---------- */
const SECTIONS = {
  day:   { title:'Сегодня',        kind:'today', icon:'sun',    empty:'На сегодня планов нет. Добавьте дело ниже или распишите день во вкладке «Неделя».' },
  week:  { title:'Неделя',         kind:'week',  icon:'cal',    empty:'' },
  plans: { title:'Основные планы', kind:'tree',  icon:'target', empty:'Создайте папку или страницу, чтобы начать.' },
  ideas: { title:'Идеи',           kind:'tree',  icon:'bulb',   empty:'Создайте папку или страницу для идей.' }
};
const COLS = Object.keys(SECTIONS);          // колонки на экране
const KEYS = ['cal', 'plans', 'ideas'];      // документы с данными; cal — задачи по датам (из него «Сегодня» и «Неделя»)
const PRI = ['без приоритета', 'низкий', 'средний', 'срочно'];
const URGENT = 3;                            // срочные задачи видны в обзоре недели

function defaults(k){
  if (k === 'cal') return { v:1, days:{}, undated:[], hideDone:false, urgentOnly:true, showCal:true };
  const f = t => ({ id:newId(), type:'folder', title:t, open:true, children:[] });
  return { nodes: k === 'plans' ? [f('Работа'), f('Личное')] : [f('Проекты'), f('Заметки')] };
}
function normalize(k, d){
  if (k === 'cal') return normCal(d);
  d = d || {};
  return { nodes:(d.nodes || []).map(normNode) };
}
const S = {};
KEYS.forEach(k => S[k] = defaults(k));
const newBlock = (t='p', text='') => ({ id:newId(), t, text, done:false });

/* даты: ключ дня — 'ГГГГ-ММ-ДД' по местному времени */
const fmtDate = (k, o) => new Intl.DateTimeFormat('ru-RU', o).format(parseKey(k));
const relDay = k => { const t = todayKey(); return k === t ? 'Сегодня' : k === addDays(t, 1) ? 'Завтра' : k === addDays(t, -1) ? 'Вчера' : ''; };
const dayLabel = k => k == null ? 'без даты' : (relDay(k).toLowerCase() || fmtDate(k, { day:'numeric', month:'long' }));
const tasksWord = n => n + ' ' + plural(n, 'задача', 'задачи', 'задач');

// Задачи дня (null — «Без даты»). create — создать пустой день, если его нет.
function dayItems(k, create){
  if (k == null) return S.cal.undated;
  let d = S.cal.days[k];
  if (!d) { if (!create) return []; d = S.cal.days[k] = { items:[] }; }
  return d.items;
}
function pruneDays(){
  for (const k of Object.keys(S.cal.days)) {
    const d = S.cal.days[k];
    if (d.blocks && !d.blocks.length) delete d.blocks;
    if (!d.items.length && !d.blocks) delete S.cal.days[k];
  }
}
const dayBlocks = k => (k && S.cal.days[k] && S.cal.days[k].blocks) || [];
function findTask(id){
  for (const [k, d] of Object.entries(S.cal.days)) { const i = d.items.findIndex(t => t.id === id); if (i >= 0) return { date:k, arr:d.items, i, t:d.items[i] }; }
  const i = S.cal.undated.findIndex(t => t.id === id);
  return i >= 0 ? { date:null, arr:S.cal.undated, i, t:S.cal.undated[i] } : null;
}
function findNode(k, id, arr = S[k].nodes, path = []){
  for (let i = 0; i < arr.length; i++) {
    const n = arr[i];
    if (n.id === id) return { k, node:n, arr, index:i, path };
    if (n.type === 'folder') { const r = findNode(k, id, n.children, [...path, n]); if (r) return r; }
  }
  return null;
}
const findAnyNode = id => findNode('plans', id) || findNode('ideas', id);
function countNodes(nodes){ let n = 0; nodes.forEach(x => { if (x.type === 'page') n++; else n += countNodes(x.children); }); return n; }
