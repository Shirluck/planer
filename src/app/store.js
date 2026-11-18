/* Планер — хранение (touch, flush, extraStore), уведомления (toast) и всплывающие меню.
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

/* ---------- persistence ---------- */
const backend = { kind:'memory', db:null, uid:null, refs:{} };
let boardApi = null;   // доска задачи (src/board.js), создаётся перед запуском
const timers = {}, writing = {}, again = {}, lastSaved = {}, pendingRemote = {};
const dirty = new Set();
let loaded = false;

const statusEl = $('#status');
function setStatus(kind){
  const map = {
    loading:['Загрузка…', 'busy'], saving:['Сохраняю…', 'busy'], saved:['Сохранено', 'ok'],
    local:['Сохранено в этом браузере', 'warn'], memory:['Не сохраняется', 'err'], error:['Ошибка сохранения', 'err']
  };
  const [txt, s] = map[kind]; statusEl.textContent = txt; statusEl.dataset.s = s;
}
const idleStatus = () => setStatus(backend.kind === 'db' ? 'saved' : backend.kind === 'local' ? 'local' : 'memory');
function showBanner(msg){ const b = $('#banner'); b.textContent = msg; b.hidden = !msg; }

async function initBackend(){
  let db = null, uid = null;
  try {
    if (window.claude && window.claude.use) {
      db = await window.claude.use('db');
      const user = await window.claude.use('user');
      uid = user ? await user.id() : null;
    }
  } catch (e) { db = null; }
  if (db && uid) { backend.kind = 'db'; backend.db = db; backend.uid = uid; return; }
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); backend.kind = 'local'; }
  catch (e) { backend.kind = 'memory'; }
}
function loadAll(){
  return new Promise(resolve => {
    if (backend.kind === 'db') {
      const col = backend.db.collection('data/users/' + backend.uid);
      let pending = KEYS.length, finished = false;
      const finish = () => { if (!finished) { finished = true; clearTimeout(tm); resolve(); } };
      const tm = setTimeout(() => { showBanner('Хранилище отвечает медленно — данные могут быть неактуальными. Не закрывайте страницу.'); finish(); }, 10000);
      KEYS.forEach(k => {
        let first = true;
        const ref = col.doc('planner-' + k);
        backend.refs[k] = ref;
        ref.onSnapshot(snap => {
          onRemote(k, snap);
          if (first && !snap.metadata.fromCache) { first = false; if (--pending === 0) finish(); }
        }, err => {
          showBanner('Не удалось загрузить данные (' + (err && err.code) + ').');
          if (first) { first = false; if (--pending === 0) finish(); }
        });
      });
    } else {
      KEYS.forEach(k => {
        try { const raw = localStorage.getItem('planner1-' + k); if (raw) { S[k] = normalize(k, JSON.parse(raw)); if (k === 'cal') calSeen = true; } } catch (e) {}
      });
      resolve();
    }
  });
}
function onRemote(k, snap){
  if (!snap.exists) return;
  const d = snap.data();
  if (snap.metadata.hasPendingWrites || dirty.has(k) || writing[k]) return;
  if (stable(d) === lastSaved[k]) return;
  if (loaded && isTyping()) { pendingRemote[k] = d; return; }
  applyRemote(k, d);
}
function applyRemote(k, d){
  S[k] = normalize(k, clone(d));
  lastSaved[k] = stable(d);
  if (k === 'cal') calSeen = true;
  if (loaded) { refreshSection(k); if (editing && editing.k === k) editorSync(); }
}

/* Переход со старого формата: «Сегодня» и «Неделя» были двумя списками без дат.
   Задачи «Сегодня» → на сегодняшнюю дату, задачи «Недели» → «Без даты». Доски, которые были у задач,
   становятся страницами в «Основных планах» (папка «Доски задач»). Старые документы не удаляются. */
let calSeen = false;
async function legacyGet(k){
  try {
    if (backend.kind === 'db') { const s = await backend.db.collection('data/users/' + backend.uid).doc('planner-' + k).get(); return s.exists ? s.data() : null; }
    if (backend.kind === 'local') { const r = localStorage.getItem('planner1-' + k); return r ? JSON.parse(r) : null; }
  } catch (e) {}
  return null;
}
async function migrateLegacy(){
  const day = await legacyGet('day'), week = await legacyGet('week');
  const dItems = day && Array.isArray(day.items) ? day.items : [], wItems = week && Array.isArray(week.items) ? week.items : [];
  calSeen = true;
  if (!dItems.length && !wItems.length) return;
  const today = todayKey(), boards = [];
  dItems.forEach(t => { dayItems(today, true).push(normTask(t)); if (t.boardCount > 0) boards.push(t); });
  wItems.forEach(t => { S.cal.undated.push(normTask(t)); if (t.boardCount > 0) boards.push(t); });
  if (day && day.hideDone) S.cal.hideDone = true;
  if (boards.length) {
    let f = S.plans.nodes.find(n => n.type === 'folder' && n.title === 'Доски задач');
    if (!f) { f = { id:newId(), type:'folder', title:'Доски задач', open:true, children:[] }; S.plans.nodes.push(f); }
    boards.forEach(t => f.children.push({ id:newId(), type:'page', kind:'board', title:String(t.text || 'Без названия'), blocks:[newBlock('p', String(t.note || ''))], boardId:String(t.id), boardCount:t.boardCount | 0 }));
    touch('plans');
  }
  touch('cal');
}
const isTyping = () => { const a = document.activeElement; return !!(a && a.matches && a.matches('textarea,input')); };
document.addEventListener('focusout', () => setTimeout(() => {
  if (isTyping()) return;
  for (const k of Object.keys(pendingRemote)) { const d = pendingRemote[k]; delete pendingRemote[k]; if (!dirty.has(k)) applyRemote(k, d); }
}, 60));

function touch(k){
  dirty.add(k); setStatus('saving');
  if (k === 'cal') miniNotify();                 // мини-окно «Сегодня» перечитает список
  clearTimeout(timers[k]); timers[k] = setTimeout(() => flush(k), 500);
}
async function flush(k){
  if (!dirty.has(k)) return;
  if (writing[k]) { again[k] = true; return; }
  writing[k] = true; dirty.delete(k);
  try {
    const body = clone(S[k]);
    const json = JSON.stringify(body);
    lastSaved[k] = stable(body);
    if (backend.kind === 'db') {
      if (!window.electronAPI && new Blob([json]).size > 235000) toast('Этот раздел почти достиг лимита размера (256 КБ). Удалите лишнее или разнесите по другим разделам.');
      await backend.refs[k].set(body);
    } else if (backend.kind === 'local') {
      localStorage.setItem('planner1-' + k, json);
    }
    showBanner('');
  } catch (e) {
    setStatus('error');
    showBanner('Не удалось сохранить: ' + ((e && (e.code || e.message)) || 'ошибка') + '. Изменения остаются на экране; попробуйте ещё раз после следующей правки.');
    writing[k] = false; return;
  }
  writing[k] = false;
  if (again[k] || dirty.has(k)) { again[k] = false; clearTimeout(timers[k]); timers[k] = setTimeout(() => flush(k), 300); }
  else if (!dirty.size && !Object.values(writing).some(Boolean) && !extraPending.size) idleStatus();
}
function flushAll(){ KEYS.forEach(k => { if (dirty.has(k)) { clearTimeout(timers[k]); flush(k); } }); }
// Дописать всё несохранённое (перед закрытием окна): разделы и доски.
async function flushEverything(){
  if (boardApi) { try { await boardApi.flush(); } catch (e) {} }
  flushAll();
  for (let i = 0; i < 100 && (dirty.size || Object.values(writing).some(Boolean)); i++) { await new Promise(r => setTimeout(r, 20)); flushAll(); }
}

/* Отдельные документы (доски задач): тот же бэкенд, что и у разделов */
const extraPending = new Set(), memDocs = {};
const extraStore = {
  async get(name){
    if (backend.kind === 'db') { const s = await backend.db.collection('data/users/' + backend.uid).doc(name).get(); return s.exists ? s.data() : null; }
    if (backend.kind === 'local') { try { const r = localStorage.getItem('planner1-' + name); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
    return memDocs[name] ? clone(memDocs[name]) : null;
  },
  async set(name, v){
    if (backend.kind === 'db') return backend.db.collection('data/users/' + backend.uid).doc(name).set(v);
    if (backend.kind === 'local') { localStorage.setItem('planner1-' + name, JSON.stringify(v)); return; }
    memDocs[name] = clone(v);
  }
};
function pendingSave(key, on){
  if (on) { extraPending.add(key); setStatus('saving'); return; }
  extraPending.delete(key);
  if (!extraPending.size && !dirty.size && !Object.values(writing).some(Boolean)) idleStatus();
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); else refreshDates(); });
window.addEventListener('pagehide', flushAll);

/* ---------- toast & menu ---------- */
let toastEl = null, toastTimer = null;
function toast(msg, undo){
  if (toastEl) toastEl.remove(); clearTimeout(toastTimer);
  toastEl = h('div', { class:'toast', role:'status' }, h('span', {}, msg),
    undo ? h('button', { type:'button', onclick:() => { undo(); toastEl && toastEl.remove(); toastEl = null; } }, 'Отменить') : null);
  document.body.append(toastEl);
  toastTimer = setTimeout(() => { toastEl && toastEl.remove(); toastEl = null; }, undo ? 7000 : 3500);
}
function undoer(keys){
  const snap = keys.map(k => [k, JSON.stringify(S[k])]);
  return () => { snap.forEach(([k, j]) => { S[k] = JSON.parse(j); touch(k); refreshSection(k); }); if (editing && !findNode(editing.k, editing.id)) closeEditor(); };
}

let menuEl = null;
function closeMenu(){ if (menuEl) { menuEl.remove(); menuEl = null; document.removeEventListener('pointerdown', menuOutside, true); } }
function menuOutside(e){ if (menuEl && !menuEl.contains(e.target) && !(e.target.closest && e.target.closest('.toast'))) closeMenu(); }   // «Отменить» в уведомлении не закрывает панель
function openMenu(anchor, items){
  closeMenu();
  menuEl = h('div', { class:'menu', role:'menu' }, items.filter(Boolean).map(it => it.sep
    ? h('div', { class:'menu-sep' })
    : it.swatches
    ? h('div', { class:'bd-sw menu-sw', role:'radiogroup', 'aria-label':'Цвет' }, it.swatches.map(c => h('button', { class:'bd-sw-b', type:'button', role:'radio', 'data-color':c, 'aria-checked':String(it.value === c), 'aria-label':it.names[c], title:it.names[c], onclick:() => { closeMenu(); it.pick(c); } })))
    : h('button', { class:'menu-it' + (it.danger ? ' danger' : ''), type:'button', role:'menuitem', onclick:() => { closeMenu(); it.run(); } }, icon(it.icon || 'dot', 15), it.label)));
  placePopup(anchor, menuEl);
}
function placePopup(anchor, el){
  document.body.append(el);
  const r = anchor.getBoundingClientRect(), mw = el.offsetWidth, mh = el.offsetHeight;
  const x = Math.min(Math.max(8, r.right - mw), innerWidth - mw - 8);
  let y = r.bottom + 4; if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 4);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  setTimeout(() => document.addEventListener('pointerdown', menuOutside, true), 0);
}
