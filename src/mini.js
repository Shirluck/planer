/* Мини-окно «Сегодня» (щелчок по значку в трее): дела на сегодня с отметкой «выполнено», новая задача, таймеры.
   Данные спрашивает у главного окна через основной процесс (window.electronAPI.mini), сама ничего не хранит. */
(function () {
'use strict';
const ea = window.electronAPI;
if (!ea || !ea.mini) return;
const { fmtClock, fmtDuration } = window.PlanerCore;
const $ = s => document.querySelector(s);
const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
};
const IC = {
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>', open:'<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>', play:'<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  pause:'<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>', plus:'<path d="M12 5v14M5 12h14"/>',
  timer:'<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.6 1.6M9.5 2.5h5M12 2.5V6M18.4 6.6l1.6-1.6"/>'
};
function icon(n, s){
  const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  sv.setAttribute('viewBox', '0 0 24 24'); sv.setAttribute('width', s || 16); sv.setAttribute('height', s || 16);
  sv.setAttribute('fill', 'none'); sv.setAttribute('stroke', 'currentColor'); sv.setAttribute('stroke-width', '2');
  sv.setAttribute('stroke-linecap', 'round'); sv.setAttribute('stroke-linejoin', 'round'); sv.setAttribute('aria-hidden', 'true');
  sv.innerHTML = IC[n] || ''; return sv;
}
const plural = (n, a, b, c) => { const x = Math.abs(n) % 100, y = x % 10; return x > 10 && x < 20 ? c : y === 1 ? a : y >= 2 && y <= 4 ? b : c; };

let data = null, tstate = null, tick = 0;
$('#mnOpen').append(icon('open', 16));
$('#mnClose').append(icon('x', 16));
$('#mnOpen').addEventListener('click', () => ea.mini.openMain({}));
$('#mnClose').addEventListener('click', () => ea.mini.hide());
document.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); ea.mini.hide(); } });

/* ---------- задачи ---------- */
async function load(){
  const r = await ea.mini.call('today');
  if (r && r.ok && r.data) { data = r.data; render(); }
  else if (!data) $('#mnList').replaceChildren(h('div', { class:'mn-empty' }, 'Планер ещё загружается…'));
}
function render(){
  if (!data) return;
  $('#mnDate').textContent = data.title;
  const all = data.items, done = all.filter(t => t.done).length;
  $('#mnCount').textContent = all.length ? done + ' / ' + all.length : '';
  $('#mnBar').style.width = all.length ? (done / all.length * 100) + '%' : '0%';
  const list = $('#mnList'), rows = [];
  const loose = all.filter(t => !t.block), byBlock = new Map();
  all.filter(t => t.block).forEach(t => { if (!byBlock.has(t.block)) byBlock.set(t.block, { color:t.color, from:t.from, items:[] }); byBlock.get(t.block).items.push(t); });
  loose.forEach(t => rows.push(row(t)));
  [...byBlock.entries()].sort((a, b) => a[1].from < b[1].from ? -1 : 1).forEach(([label, g]) => {
    const now = (data.blocks.find(b => b.label === label) || {}).now;
    rows.push(h('div', { class:'mn-block' + (now ? ' now' : ''), 'data-color':g.color }, icon('clock', 13), label, now ? h('span', { class:'mn-now' }, 'сейчас') : null));
    g.items.forEach(t => rows.push(row(t, g.color)));
  });
  if (!all.length) rows.push(h('div', { class:'mn-empty' }, 'На сегодня дел нет. Добавьте первое ниже.'));
  else if (done === all.length) rows.push(h('div', { class:'mn-empty ok' }, 'Все дела на сегодня выполнены'));
  if (data.overdue) rows.push(h('button', { class:'mn-overdue', type:'button', onclick:() => ea.mini.openMain({}) }, 'Не сделано в прошлые дни: ' + data.overdue));
  list.replaceChildren(...rows);
}
function row(t, color){
  return h('div', { class:'mn-item' + (t.done ? ' done' : ''), role:'listitem', 'data-id':t.id, 'data-pri':String(t.pri), 'data-color':color || '' },
    h('button', { class:'mn-cb', type:'button', role:'checkbox', 'aria-checked':String(t.done), 'aria-label':'Выполнено: ' + t.text, onclick:() => toggle(t.id) }, icon('check', 13)),
    h('button', { class:'mn-t', type:'button', title:'Открыть в Планере', onclick:() => ea.mini.openMain({ taskId:t.id }) }, t.text || 'Без названия'),
    t.pri >= 3 ? h('span', { class:'mn-pri', title:'Срочно' }, '!!!') : null);
}
async function toggle(id){
  const t = data && data.items.find(x => x.id === id); if (t) { t.done = !t.done; render(); }
  const r = await ea.mini.call('toggle', { id });
  if (r && r.ok && r.data) { data = r.data; render(); }
}
$('#mnForm').addEventListener('submit', async e => {
  e.preventDefault();
  const inp = $('#mnInput'), text = inp.value.trim(); if (!text) return;
  inp.value = '';
  const r = await ea.mini.call('add', { text });
  if (r && r.ok && r.data) { data = r.data; render(); const l = $('#mnList'); l.scrollTop = l.scrollHeight; }
});

/* ---------- таймеры ---------- */
const left = r => r.paused ? r.left : Math.max(0, r.endsAt - Date.now());
function renderTimers(){
  const box = $('#mnTimers'), st = tstate; if (!st) return;
  const run = st.running;
  const kids = run.map(r => h('div', { class:'mn-tm' + (r.paused ? ' paused' : ''), 'data-tid':r.id },
    icon('timer', 15), h('span', { class:'mn-tm-t' }, r.title), h('b', { class:'mn-tm-time' }, fmtClock(left(r))),
    h('button', { class:'mn-tool sm', type:'button', 'aria-label':r.paused ? 'Продолжить' : 'Пауза', title:r.paused ? 'Продолжить' : 'Пауза', onclick:() => r.paused ? ea.timers.resume(r.id) : ea.timers.pause(r.id) }, icon(r.paused ? 'play' : 'pause', 13)),
    h('button', { class:'mn-tool sm', type:'button', 'aria-label':'Остановить', title:'Остановить', onclick:() => ea.timers.stop(r.id) }, icon('stop', 12))));
  if (!run.length && st.presets.length) kids.push(h('div', { class:'mn-chips' }, st.presets.slice(0, 4).map(p =>
    h('button', { class:'mn-chip', type:'button', title:'Запустить таймер «' + p.title + '»', onclick:() => ea.timers.start({ presetId:p.id }) }, icon('play', 11), p.title + ' · ' + fmtDuration(p.ms)))));
  box.replaceChildren(...kids);
  const need = run.some(r => !r.paused);
  if (need && !tick) tick = setInterval(() => { (tstate.running || []).forEach(r => { const el = document.querySelector('.mn-tm[data-tid="' + r.id + '"] .mn-tm-time'); if (el) el.textContent = fmtClock(left(r)); }); }, 250);
  if (!need && tick) { clearInterval(tick); tick = 0; }
}
if (ea.timers) {
  ea.timers.onState(s => { tstate = s; renderTimers(); });
  ea.timers.state().then(s => { tstate = s; renderTimers(); });
}

/* ---------- тема и обновление ---------- */
if (ea.ui) { const apply = s => { document.documentElement.dataset.theme = s.theme; }; ea.ui.onState(apply); ea.ui.get().then(apply); }
ea.mini.onRefresh(() => { load(); setTimeout(() => $('#mnInput').focus(), 30); });
load();
})();
