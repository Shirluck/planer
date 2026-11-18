/* Планер — колонки на экране и общий код списков задач, блоки времени дня.
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

/* ---------- board ---------- */
const cols = {};
const board = $('#board');
const tool = (ic, label, on) => h('button', { class:'tool', type:'button', 'aria-label':label, title:label, onclick:on }, icon(ic, 17));

function buildBoard(){
  COLS.forEach(k => {
    const kind = SECTIONS[k].kind;
    const c = kind === 'today' ? buildTodayCol() : kind === 'week' ? buildWeekCol() : buildTreeCol(k);
    cols[k] = c; board.append(c.root);
  });
  refreshDates();
}
const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
let shownToday = null;
function refreshDates(){
  if (!cols.day) return;
  const t = todayKey();
  cols.day.sub.textContent = cap(fmtDate(t, { weekday:'long', day:'numeric', month:'long' }));
  if (shownToday && shownToday !== t) {             // наступил новый день — «Сегодня» показывает новую дату
    if (weekStart === mondayOf(shownToday)) weekStart = mondayOf(t);
    if (calMonth === monthOf(shownToday)) calMonth = monthOf(t);
    refreshCal();
  }
  shownToday = t;
  paintNowBlocks();
}
setInterval(refreshDates, 60000);
function refreshSection(k){
  if (k === 'cal') refreshCal();
  else if (k === 'day') refreshToday();
  else if (k === 'week') refreshWeek();
  else refreshTree(k);
}
function refreshCal(){ refreshToday(); refreshWeek(); if (dayView) renderDayView(); }

/* ---------- задачи: общий код списков («Сегодня» и окно дня) ---------- */
const openNotes = new Set();
const firstLine = s => (s || '').split('\n').find(l => l.trim()) || '';
const forRows = (id, fn) => document.querySelectorAll('.item[data-id="' + id + '"]').forEach(fn);
const refreshWeekSoon = debounce(() => refreshWeek(), 250);

function bindTaskList(list){
  list.addEventListener('click', e => {
    const sec = e.target.closest('.tblock');
    if (sec && e.target.closest('.tb-add')) { openBlockComposer(sec); return; }
    if (sec && e.target.closest('.tb-more')) { blockMenu(e.target.closest('.tb-more'), sec); return; }
    const el = e.target.closest('.item'); if (!el) return;
    const loc = findTask(el.dataset.id); if (!loc) return; const t = loc.t;
    if (e.target.closest('.cb')) {
      t.done = !t.done; forRows(t.id, r => paintItem(r, t)); touch('cal'); updateProgress(); paintDayProgress(); paintBlockCounts(); refreshWeek();
      if (t.done && S.cal.hideDone && list === cols.day.list) setTimeout(() => { if (el.isConnected && t.done) refreshToday(); }, 450);
    } else if (e.target.closest('.pri')) {
      t.pri = (t.pri + 1) % 4; forRows(t.id, r => paintItem(r, t)); touch('cal'); refreshWeek();
    } else if (e.target.closest('.note-btn') || e.target.closest('.note-prev')) {
      if (openNotes.has(t.id)) openNotes.delete(t.id); else openNotes.add(t.id);
      paintItem(el, t);
      if (openNotes.has(t.id)) { const ta = el.querySelector('.note'); autosize(ta); ta.focus(); }
    } else if (e.target.closest('.more')) taskMenu(e.target.closest('.more'), t);
  });
  list.addEventListener('input', e => {
    const el = e.target.closest('.item'); if (!el) return;
    const loc = findTask(el.dataset.id); if (!loc) return; const t = loc.t;
    if (e.target.matches('.txt')) {
      t.text = e.target.value; autosize(e.target);
      forRows(t.id, r => { const x = r.querySelector('.txt'); if (x !== e.target) { x.value = t.text; autosize(x); } });
      refreshWeekSoon();
    } else if (e.target.matches('.note')) { t.note = e.target.value; autosize(e.target); paintItem(el, t); }
    else return;
    touch('cal');
  });
  list.addEventListener('focusin', e => { if (e.target.matches('.txt')) e.target.dataset.prev = e.target.value; });
  list.addEventListener('focusout', e => {
    const el = e.target.closest('.item'); if (!el) return;
    if (e.target.matches('.txt') && !e.target.value.trim() && e.target.dataset.prev) {
      e.target.value = e.target.dataset.prev; const loc = findTask(el.dataset.id); if (loc) { loc.t.text = e.target.value; touch('cal'); } autosize(e.target);
    }
    if (e.target.matches('.note')) { const loc = findTask(el.dataset.id); if (loc && !loc.t.note.trim()) { openNotes.delete(loc.t.id); paintItem(el, loc.t); } }
  });
  list.addEventListener('keydown', e => {
    if (e.target.matches('.txt') && (e.key === 'Enter' || e.key === 'Escape') && !e.isComposing) { e.preventDefault(); e.stopPropagation(); e.target.blur(); }
    if (e.target.matches('.note') && e.key === 'Escape') { e.stopPropagation(); e.target.blur(); }
  });
}
function taskMenu(anchor, t){
  const loc = findTask(t.id); if (!loc) return;
  const today = todayKey(), tom = addDays(today, 1);
  const blocks = loc.date ? sortedBlocks(loc.date) : [];
  openMenu(anchor, [
    loc.date !== today ? { icon:'sun', label:'Перенести на сегодня', run:() => moveTask(t.id, today) } : null,
    loc.date !== tom ? { icon:'arrow', label:'Перенести на завтра', run:() => moveTask(t.id, tom) } : null,
    { icon:'cal', label:'Перенести на другой день…', run:() => pickDate(anchor, loc.date || today, d => moveTask(t.id, d)) },
    loc.date != null ? { icon:'x', label:'Убрать дату', run:() => moveTask(t.id, null) } : null,
    blocks.length ? { sep:true } : null,
    ...blocks.filter(b => b.id !== t.block).map(b => ({ icon:'clock', label:'В блок ' + blockLabel(b), run:() => setTaskBlock(t.id, b.id) })),
    t.block ? { icon:'x', label:'Убрать из блока', run:() => setTaskBlock(t.id, null) } : null,
    { sep:true },
    { icon:'trash', danger:true, label:'Удалить', run:() => deleteTask(t.id) }
  ]);
}

function itemEl(t){
  const el = h('div', { class:'item', 'data-id':t.id },
    h('button', { class:'grip', type:'button', tabindex:'-1', 'aria-hidden':'true', title:'Перетащить' }, icon('grip', 14)),
    h('button', { class:'cb', type:'button', role:'checkbox', 'aria-label':'Выполнено' }, icon('check', 14)),
    h('textarea', { class:'txt', rows:'1', spellcheck:'false', 'aria-label':'Текст задачи' }),
    h('div', { class:'acts' },
      h('button', { class:'pri', type:'button' }),
      h('button', { class:'note-btn', type:'button', 'aria-label':'Заметка', title:'Заметка' }, icon('note', 15)),
      h('button', { class:'more', type:'button', 'aria-label':'Ещё', title:'Перенести, в блок, удалить' }, icon('more', 16))),
    h('div', { class:'note-wrap' },
      h('textarea', { class:'note', rows:'1', placeholder:'Заметка к задаче…', 'aria-label':'Заметка к задаче' }),
      h('div', { class:'note-prev', title:'Нажмите, чтобы изменить заметку' })));
  el.querySelector('.txt').value = t.text;
  el.querySelector('.note').value = t.note || '';
  paintItem(el, t);
  return el;
}
function paintItem(el, t){
  el.classList.toggle('done', t.done);
  el.dataset.pri = t.pri;
  el.querySelector('.cb').setAttribute('aria-checked', String(t.done));
  const pri = el.querySelector('.pri');
  pri.replaceChildren(t.pri ? document.createTextNode('!'.repeat(t.pri)) : icon('flag', 14));
  const lab = 'Приоритет: ' + PRI[t.pri] + ' — нажмите, чтобы сменить';
  pri.title = lab; pri.setAttribute('aria-label', lab);
  el.classList.toggle('note-open', openNotes.has(t.id));
  el.classList.toggle('has-note', !!(t.note && t.note.trim()));
  el.querySelector('.note-prev').textContent = firstLine(t.note);
}
function addTask(date, input, list, block){
  const { text, pri } = parseNewTask(input.value); if (!text) return;
  const t = { id:newId(), text, done:false, pri, note:'' };
  if (block && dayBlocks(date).some(b => b.id === block)) t.block = block;
  dayItems(date, true).push(t);
  input.value = ''; touch('cal'); refreshCal();
  if (block && list) { const sec = list.querySelector('.tblock[data-block="' + block + '"]'); if (sec) openBlockComposer(sec); }
  else if (list) list.scrollTop = list.scrollHeight;
}
function sortByPriority(date){
  const arr = dayItems(date); if (!arr.length) return;
  const undo = undoer(['cal']);
  const sorted = arr.map((t, i) => ({ t, i })).sort((a, b) => (a.t.done - b.t.done) || (b.t.pri - a.t.pri) || (a.i - b.i)).map(x => x.t);
  arr.splice(0, arr.length, ...sorted);
  touch('cal'); refreshCal(); toast('Отсортировано: сначала срочные', undo);
}
function clearDone(date){
  const arr = dayItems(date), n = arr.filter(t => t.done).length;
  if (!n) { toast('Выполненных задач нет'); return; }
  const undo = undoer(['cal']);
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].done) arr.splice(i, 1);
  pruneDays(); touch('cal'); refreshCal(); toast('Удалено выполненных: ' + n, undo);
}
function deleteTask(id){
  const loc = findTask(id); if (!loc) return;
  const undo = undoer(['cal']);
  loc.arr.splice(loc.i, 1); openNotes.delete(id); pruneDays(); touch('cal'); refreshCal(); toast('Задача удалена', undo);
}
// Перенос задачи: другой день (null — «Без даты»), место в списке (перед beforeId) и блок времени.
// block: id блока, null — без блока, undefined — оставить как есть в пределах того же дня.
function moveTask(id, date, beforeId, block){
  const loc = findTask(id); if (!loc) return;
  if (date !== null && date !== undefined && !DATE_RE.test(date)) return;
  date = date === undefined ? null : date;
  if (beforeId === id) beforeId = null;
  const undo = undoer(['cal']);
  const [t] = loc.arr.splice(loc.i, 1);
  if (block !== undefined) { if (block && dayBlocks(date).some(b => b.id === block)) t.block = block; else delete t.block; }
  else if (date !== loc.date) delete t.block;                  // блоки у каждого дня свои
  const dest = dayItems(date, true);
  const bi = beforeId ? dest.findIndex(x => x.id === beforeId) : -1;
  if (bi >= 0) dest.splice(bi, 0, t); else dest.push(t);
  pruneDays(); touch('cal'); refreshCal();
  if (date !== loc.date) toast(date == null ? 'Дата убрана: задача в «Без даты»' : 'Перенесено на ' + dayLabel(date), undo);
}
// В блок (или из блока) — задача встаёт в конец этой группы.
function setTaskBlock(id, block){
  const loc = findTask(id); if (!loc) return;
  const t = loc.t, arr = loc.arr;
  arr.splice(loc.i, 1);
  if (block && dayBlocks(loc.date).some(b => b.id === block)) t.block = block; else { delete t.block; block = null; }
  let at = -1;
  arr.forEach((x, i) => { if ((x.block || null) === block) at = i; });
  arr.splice(at >= 0 ? at + 1 : arr.length, 0, t);
  touch('cal'); refreshCal();
}

/* ---------- блоки времени дня: цветные группы задач ---------- */
const BLOCK_COLORS = [['blue', 'Синий'], ['green', 'Зелёный'], ['yellow', 'Жёлтый'], ['orange', 'Оранжевый'], ['pink', 'Розовый'], ['purple', 'Сиреневый']];
const sortedBlocks = k => dayBlocks(k).slice().sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : 1);
const blockLabel = b => b.from + '–' + b.to + (b.title ? ' «' + b.title + '»' : '');
const nowHM = () => { const d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
const isNowIn = (k, b) => k === todayKey() && b.from <= nowHM() && nowHM() < b.to;
const zoneEl = (date, block, kids) => h('div', { class:'tz', 'data-date':date || '', 'data-block':block }, kids);
// Задачи дня: сначала без блока, затем блоки по времени начала.
function renderTaskGroups(list, date, items){
  const blocks = date ? sortedBlocks(date) : [];
  const groups = new Map(blocks.map(b => [b.id, []])), loose = [];
  items.forEach(t => (t.block && groups.has(t.block) ? groups.get(t.block) : loose).push(t));
  if (blocks.length && loose.length) list.append(h('div', { class:'tz-label' }, 'В любое время'));
  list.append(zoneEl(date, '', loose.map(itemEl)));
  blocks.forEach(b => list.append(timeBlockEl(date, b, groups.get(b.id))));
}
function timeBlockEl(date, b, items){
  const all = dayItems(date).filter(t => t.block === b.id), done = all.filter(t => t.done).length;
  return h('section', { class:'tblock' + (isNowIn(date, b) ? ' now' : ''), 'data-color':b.color, 'data-block':b.id, 'data-date':date, 'data-from':b.from, 'data-to':b.to, 'aria-label':'Блок ' + blockLabel(b) },
    h('div', { class:'tb-head' },
      icon('clock', 14),
      h('span', { class:'tb-time' }, b.from + ' – ' + b.to),
      b.title ? h('span', { class:'tb-title' }, b.title) : null,
      h('span', { class:'tb-now' }, 'сейчас'),
      h('span', { class:'tb-cnt' }, all.length ? done + '/' + all.length : ''),
      h('button', { class:'tb-add', type:'button', 'aria-label':'Добавить задачу в блок ' + blockLabel(b), title:'Добавить задачу в блок' }, icon('plus', 15)),
      h('button', { class:'tb-more', type:'button', 'aria-label':'Блок ' + blockLabel(b) + ': изменить или удалить', title:'Изменить или удалить блок' }, icon('more', 15))),
    zoneEl(date, b.id, items.map(itemEl)),
    items.length ? null : h('div', { class:'tb-empty' }, all.length ? 'Выполненные задачи скрыты' : 'Перетащите сюда задачи или нажмите +'));
}
function paintNowBlocks(){ document.querySelectorAll('.tblock').forEach(s => s.classList.toggle('now', isNowIn(s.dataset.date, { from:s.dataset.from, to:s.dataset.to }))); }
function paintBlockCounts(){
  document.querySelectorAll('.tblock').forEach(s => {
    const all = dayItems(s.dataset.date).filter(t => t.block === s.dataset.block), d = all.filter(t => t.done).length;
    const c = s.querySelector('.tb-cnt'); if (c) c.textContent = all.length ? d + '/' + all.length : '';
  });
}
function openBlockComposer(sec){
  let f = sec.querySelector('.tb-form'); if (f) { f.querySelector('input').focus(); return; }
  const inp = h('input', { class:'add-input', type:'text', placeholder:'Задача в этот блок (!!! — срочно)', 'aria-label':'Новая задача в блоке', autocomplete:'off', enterkeyhint:'done' });
  f = h('form', { class:'composer tb-form', onsubmit:e => { e.preventDefault(); addTask(sec.dataset.date || null, inp, sec.closest('.list'), sec.dataset.block); } }, icon('plus', 15), inp);
  inp.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); f.remove(); } });
  inp.addEventListener('blur', () => setTimeout(() => { if (f.isConnected && !inp.value.trim() && document.activeElement !== inp) f.remove(); }, 150));
  const em = sec.querySelector('.tb-empty'); if (em) em.remove();
  sec.append(f); inp.focus();
}
function blockMenu(anchor, sec){
  const date = sec.dataset.date, b = dayBlocks(date).find(x => x.id === sec.dataset.block); if (!b) return;
  openMenu(anchor, [
    { icon:'plus', label:'Добавить задачу в блок', run:() => openBlockComposer(sec) },
    { icon:'pencil', label:'Изменить время, название, цвет', run:() => blockEditor(anchor, date, b) },
    { sep:true },
    { icon:'trash', danger:true, label:'Удалить блок (задачи останутся)', run:() => deleteBlock(date, b.id) }
  ]);
}
function deleteBlock(date, id){
  const day = S.cal.days[date]; if (!day || !day.blocks) return;
  const undo = undoer(['cal']);
  day.blocks = day.blocks.filter(b => b.id !== id);
  day.items.forEach(t => { if (t.block === id) delete t.block; });
  pruneDays(); touch('cal'); refreshCal(); toast('Блок удалён, задачи остались в дне', undo);
}
const addHours = (hm, n) => { const [hh, mm] = hm.split(':').map(Number); const v = Math.min(23 * 60 + 59, hh * 60 + mm + n * 60); return pad2(Math.floor(v / 60)) + ':' + pad2(v % 60); };
function suggestBlock(date){
  const bl = sortedBlocks(date), used = new Set(bl.map(b => b.color));
  let from = bl.length ? bl[bl.length - 1].to : (date === todayKey() ? pad2(Math.min(22, new Date().getHours() + 1)) + ':00' : '09:00');
  if (from >= '23:00') from = '09:00';
  const color = (BLOCK_COLORS.find(([c]) => !used.has(c)) || BLOCK_COLORS[0])[0];
  return { from, to:addHours(from, 2), title:'', color };
}
function prevBlocksDay(date){
  for (let i = 1; i <= 60; i++) { const k = addDays(date, -i), d = S.cal.days[k]; if (d && d.blocks && d.blocks.length) return k; }
  return null;
}
// Всплывающий редактор блока: время «с … до …», название, цвет.
function blockEditor(anchor, date, block){
  if (!date) return;
  closeMenu();
  const def = block || suggestBlock(date);
  const from = h('input', { type:'time', class:'tb-time-in', 'aria-label':'Начало блока', required:true });
  const to = h('input', { type:'time', class:'tb-time-in', 'aria-label':'Конец блока', required:true });
  from.value = def.from; to.value = def.to;
  const name = h('input', { type:'text', class:'tb-name', placeholder:'Название (необязательно), например «Работа»', maxlength:'60', 'aria-label':'Название блока' });
  name.value = def.title || '';
  let color = def.color;
  const sw = h('div', { class:'tb-sw', role:'radiogroup', 'aria-label':'Цвет блока' }, BLOCK_COLORS.map(([c, n]) => h('button', {
    type:'button', class:'tb-sw-b', 'data-color':c, role:'radio', 'aria-checked':String(c === color), 'aria-label':n, title:n,
    onclick:() => { color = c; sw.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x.dataset.color === c))); } })));
  const err = h('div', { class:'tb-err', role:'alert' });
  const prev = !block && !dayBlocks(date).length ? prevBlocksDay(date) : null;
  const save = () => {
    const f = from.value, t = to.value;
    if (!TIME_RE.test(f) || !TIME_RE.test(t)) { err.textContent = 'Укажите время начала и конца.'; return; }
    if (t <= f) { err.textContent = 'Конец должен быть позже начала: например, 12:00 – 18:00.'; return; }
    const undo = undoer(['cal']);
    const day = S.cal.days[date] || (S.cal.days[date] = { items:[] });
    day.blocks = day.blocks || [];
    const data = { from:f, to:t, title:name.value.trim().slice(0, 60), color };
    if (block) { const b = day.blocks.find(x => x.id === block.id); if (b) Object.assign(b, data); }
    else day.blocks.push(Object.assign({ id:newId() }, data));
    closeMenu(); touch('cal'); refreshCal();
    toast(block ? 'Блок изменён' : 'Блок ' + f + ' – ' + t + ' добавлен', undo);
  };
  const pop = h('form', { class:'menu tb-pop', role:'dialog', 'aria-label':block ? 'Изменить блок времени' : 'Новый блок времени', onsubmit:e => { e.preventDefault(); save(); } },
    h('div', { class:'tb-pop-title' }, icon('clock', 16), block ? 'Блок времени' : 'Новый блок времени'),
    h('div', { class:'tb-row' }, h('span', {}, 'с'), from, h('span', {}, 'до'), to),
    h('div', { class:'tb-row' }, name),
    sw, err,
    prev ? h('button', { type:'button', class:'tb-copy', onclick:() => { closeMenu(); copyBlocks(prev, date); } },
      'Взять блоки из ' + fmtDate(prev, { weekday:'short', day:'numeric', month:'short' }) + ' (' + dayBlocks(prev).length + ')') : null,
    h('div', { class:'tb-actions' },
      h('button', { type:'button', class:'tb-btn', onclick:() => closeMenu() }, 'Отмена'),
      h('button', { type:'submit', class:'tb-btn primary' }, block ? 'Сохранить' : 'Создать')));
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); } });
  menuEl = pop; placePopup(anchor, pop); from.focus();
}
function copyBlocks(src, date){
  const undo = undoer(['cal']);
  const day = S.cal.days[date] || (S.cal.days[date] = { items:[] });
  day.blocks = (day.blocks || []).concat(dayBlocks(src).map(b => ({ id:newId(), from:b.from, to:b.to, title:b.title, color:b.color })));
  touch('cal'); refreshCal(); toast('Блоки скопированы: ' + dayBlocks(src).length, undo);
}
