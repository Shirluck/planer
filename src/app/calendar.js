/* Планер — колонки «Сегодня» и «Неделя» (календарь), окно дня.
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

/* ---------- колонка «Сегодня»: план на сегодняшнюю дату ---------- */
function buildTodayCol(){
  const cfg = SECTIONS.day;
  const list = h('div', { class:'list', 'data-key':'day' });
  const input = h('input', { class:'add-input', type:'text', placeholder:'Новая задача (!!! — срочно)', title:'Добавьте ! или !! или !!! в конце, чтобы сразу задать приоритет. !!! — срочно', 'aria-label':'Новая задача на сегодня', autocomplete:'off', enterkeyhint:'done' });
  const form = h('form', { class:'composer', onsubmit:e => { e.preventDefault(); addTask(todayKey(), input, list); } }, icon('plus', 16), input);
  const eye = tool('eye', 'Скрыть выполненные', () => { S.cal.hideDone = !S.cal.hideDone; touch('cal'); refreshToday(); });
  const clock = tool('clock', 'Добавить блок времени (например, 10:00–12:00)', () => blockEditor(clock, todayKey(), null));
  const more = tool('more', 'Ещё', () => openMenu(more, [
    { icon:'clock', label:'Добавить блок времени', run:() => blockEditor(more, todayKey(), null) },
    { icon:'cal', label:'Открыть день целиком', run:() => openDay(todayKey()) },
    { icon:'eye', label:S.cal.hideDone ? 'Показать выполненные' : 'Скрыть выполненные', run:() => eye.click() },
    { icon:'sort', label:'Отсортировать по приоритету', run:() => sortByPriority(todayKey()) },
    { sep:true },
    { icon:'trash', danger:true, label:'Удалить выполненные', run:() => clearDone(todayKey()) }
  ]));
  const sub = h('div', { class:'col-sub' });
  const bar = h('i'), n = h('span', { class:'n' });
  const root = h('section', { class:'col', 'data-key':'day', 'aria-label':cfg.title },
    h('div', { class:'col-head' },
      h('div', { class:'col-title' }, h('span', { class:'ico' }, icon(cfg.icon, 19)), h('h2', {}, cfg.title)),
      h('div', { class:'col-tools' }, clock, eye, more)),
    sub, h('div', { class:'prog' }, h('div', { class:'bar' }, bar), n), list, form);
  bindTaskList(list);
  return { root, list, sub, bar, n, eye, input };
}
function updateProgress(){
  const c = cols.day; if (!c) return;
  const all = dayItems(todayKey()), done = all.filter(t => t.done).length;
  c.n.textContent = all.length ? done + ' / ' + all.length : '';
  c.bar.style.width = all.length ? (done / all.length * 100) + '%' : '0%';
}
let overdueOpen = false;
function overdueTasks(){
  const today = todayKey(), from = addDays(today, -60), out = [];
  for (const [k, d] of Object.entries(S.cal.days)) if (k < today && k >= from) d.items.forEach(t => { if (!t.done) out.push({ date:k, t }); });
  return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
}
function refreshToday(){
  const c = cols.day; if (!c) return;
  const today = todayKey(), items = dayItems(today), hide = S.cal.hideDone;
  updateProgress();
  c.eye.replaceChildren(icon(hide ? 'eyeoff' : 'eye', 17));
  c.eye.setAttribute('aria-pressed', String(hide));
  const lab = hide ? 'Показать выполненные' : 'Скрыть выполненные';
  c.eye.title = lab; c.eye.setAttribute('aria-label', lab);
  const vis = hide ? items.filter(t => !t.done) : items;
  c.list.replaceChildren();
  if (!vis.length && !dayBlocks(today).length) c.list.append(h('div', { class:'empty' }, items.length ? 'Все дела на сегодня выполнены' : SECTIONS.day.empty));
  renderTaskGroups(c.list, today, vis);
  const od = overdueTasks();
  if (od.length) c.list.append(overdueEl(od));
  c.list.querySelectorAll('textarea').forEach(autosize);
}
function overdueEl(list){
  const box = h('div', { class:'overdue' + (overdueOpen ? ' open' : '') },
    h('button', { class:'od-head', type:'button', 'aria-expanded':String(overdueOpen), onclick:() => { overdueOpen = !overdueOpen; refreshToday(); } },
      icon('chev', 14), h('span', {}, 'Не сделано в прошлые дни'), h('b', {}, String(list.length))));
  if (overdueOpen) {
    list.forEach(({ date, t }) => box.append(h('div', { class:'od-row', 'data-id':t.id, 'data-pri':t.pri },
      h('span', { class:'od-t', title:t.text }, t.text || 'Без названия'),
      h('button', { class:'od-date', type:'button', title:'Открыть этот день', onclick:() => openDay(date) }, fmtDate(date, { day:'numeric', month:'short' })),
      h('button', { class:'od-move', type:'button', 'aria-label':'Перенести на сегодня: ' + t.text, title:'Перенести на сегодня', onclick:() => moveTask(t.id, todayKey()) }, icon('arrow', 14)))));
    if (list.length > 1) box.append(h('button', { class:'od-all', type:'button', onclick:() => moveAllOverdue() }, 'Перенести все на сегодня'));
  }
  return box;
}
function moveAllOverdue(){
  const od = overdueTasks(); if (!od.length) return;
  const undo = undoer(['cal']), dest = dayItems(todayKey(), true);
  od.forEach(({ t }) => { const loc = findTask(t.id); if (loc) { loc.arr.splice(loc.i, 1); delete t.block; dest.push(t); } });
  pruneDays(); touch('cal'); refreshCal(); toast('Перенесено на сегодня: ' + tasksWord(od.length), undo);
}

/* ---------- колонка «Неделя»: календарь месяца + дни выбранной недели ---------- */
let calMonth = monthOf(todayKey()), weekStart = mondayOf(todayKey());
const monthTitle = m => cap(fmtDate(m + '-01', { month:'long' })) + ' ' + m.slice(0, 4);
function dayStats(k){ const it = dayItems(k); return { n:it.length, urgent:it.filter(t => t.pri >= URGENT && !t.done).length }; }
function monthHead(m, onNav){
  return h('div', { class:'mc-head' },
    h('button', { class:'mc-nav flip', type:'button', 'aria-label':'Предыдущий месяц', title:'Предыдущий месяц', onclick:() => onNav(-1) }, icon('chev', 15)),
    h('b', { class:'mc-title' }, monthTitle(m)),
    h('button', { class:'mc-nav', type:'button', 'aria-label':'Следующий месяц', title:'Следующий месяц', onclick:() => onNav(1) }, icon('chev', 15)));
}
function monthGrid(m, o){
  const today = todayKey(), first = m + '-01';
  const [y, mm] = m.split('-').map(Number);
  const last = dkey(new Date(y, mm, 0)), end = addDays(mondayOf(last), 6);
  const grid = h('div', { class:'mc-grid', role:'group', 'aria-label':monthTitle(m) });
  DOW.forEach((d, i) => grid.append(h('span', { class:'mc-dow' + (i >= 5 ? ' we' : ''), 'aria-hidden':'true' }, d)));
  for (let k = mondayOf(first); k <= end; k = addDays(k, 1)) {
    const st = dayStats(k), wd = (parseKey(k).getDay() + 6) % 7;
    const cls = ['mc-day', monthOf(k) !== m && 'out', k === today && 'today', o.week && mondayOf(k) === o.week && 'inweek',
      k === o.picked && 'picked', st.n && 'has', st.urgent && 'urgent', wd >= 5 && 'we'].filter(Boolean).join(' ');
    const label = cap(fmtDate(k, { weekday:'long', day:'numeric', month:'long' })) + (st.n ? ': ' + tasksWord(st.n) + (st.urgent ? ', срочных ' + st.urgent : '') : '');
    const day = k;
    grid.append(h('button', { class:cls, type:'button', 'data-date':k, 'aria-label':label, title:label, onclick:() => o.onPick(day) },
      h('span', { class:'mc-n' }, String(parseKey(k).getDate())), h('i', { class:'mc-dot' })));
  }
  return grid;
}
// Всплывающий выбор дня (для «Перенести на другой день…»)
function pickDate(anchor, k, cb){
  closeMenu();
  let m = monthOf(k);
  const box = h('div', { class:'menu date-pop', role:'dialog', 'aria-label':'Выберите день' });
  const draw = () => box.replaceChildren(h('div', { class:'mc' }, monthHead(m, d => { m = addMonths(m, d); draw(); }), monthGrid(m, { picked:k, onPick:d => { closeMenu(); cb(d); } })));
  draw();
  menuEl = box; placePopup(anchor, box);
}
function buildWeekCol(){
  const cfg = SECTIONS.week;
  const calBox = h('div', { class:'mc-wrap' });
  const list = h('div', { class:'list wk', 'data-key':'week' });
  const urgT = tool('flag', '', () => { S.cal.urgentOnly = !S.cal.urgentOnly; touch('cal'); refreshWeek(); });
  const calT = tool('cal', '', () => { S.cal.showCal = !S.cal.showCal; touch('cal'); refreshWeek(); });
  const nowT = tool('sun', 'К текущей неделе', () => { weekStart = mondayOf(todayKey()); calMonth = monthOf(todayKey()); refreshWeek(); });
  const bar = h('i'), n = h('span', { class:'n' });
  const root = h('section', { class:'col', 'data-key':'week', 'aria-label':cfg.title },
    h('div', { class:'col-head' },
      h('div', { class:'col-title' }, h('span', { class:'ico' }, icon(cfg.icon, 19)), h('h2', {}, cfg.title)),
      h('div', { class:'col-tools' }, urgT, calT, nowT)),
    calBox, h('div', { class:'prog' }, h('div', { class:'bar' }, bar), n), list);
  return { root, list, calBox, bar, n, urgT, calT, nowT };
}
const fmtRange = (a, b) => parseKey(a).getMonth() === parseKey(b).getMonth()
  ? parseKey(a).getDate() + ' – ' + fmtDate(b, { day:'numeric', month:'long' })
  : fmtDate(a, { day:'numeric', month:'short' }) + ' – ' + fmtDate(b, { day:'numeric', month:'short' });
function refreshWeek(){
  const c = cols.week; if (!c) return;
  if (tdrag) { refreshWeekSoon(); return; }                 // не перестраиваем под перетаскиваемой задачей
  const st = S.cal, today = todayKey(), thisWeek = weekStart === mondayOf(today);
  const setTool = (b, on, label) => { b.setAttribute('aria-pressed', String(on)); b.title = label; b.setAttribute('aria-label', label); };
  setTool(c.urgT, st.urgentOnly, st.urgentOnly ? 'Сейчас видны только срочные — показать все задачи' : 'Сейчас видны все задачи — показать только срочные');
  setTool(c.calT, st.showCal, st.showCal ? 'Скрыть календарь' : 'Показать календарь');
  c.nowT.disabled = thisWeek && calMonth === monthOf(today);
  c.calBox.hidden = !st.showCal;
  if (st.showCal) c.calBox.replaceChildren(h('div', { class:'mc' },
    monthHead(calMonth, d => { calMonth = addMonths(calMonth, d); weekStart = monthOf(today) === calMonth ? mondayOf(today) : mondayOf(calMonth + '-01'); refreshWeek(); }),
    monthGrid(calMonth, { week:weekStart, onPick:k => { weekStart = mondayOf(k); calMonth = monthOf(k); refreshWeek(); openDay(k); } })));
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDays(weekStart, i));
  const all = days.flatMap(k => dayItems(k)), done = all.filter(t => t.done).length;
  c.n.textContent = all.length ? done + ' / ' + all.length : '';
  c.bar.style.width = all.length ? (done / all.length * 100) + '%' : '0%';
  const nav = d => () => { weekStart = addDays(weekStart, d * 7); calMonth = monthOf(addDays(weekStart, 3)); refreshWeek(); };
  const scroll = c.list.scrollTop;
  c.list.classList.toggle('all', !st.urgentOnly);
  c.list.replaceChildren(h('div', { class:'wk-nav' },
    h('button', { class:'mc-nav flip', type:'button', 'aria-label':'Предыдущая неделя', title:'Предыдущая неделя', onclick:nav(-1) }, icon('chev', 15)),
    h('span', { class:'wk-range' }, fmtRange(days[0], days[6]), thisWeek ? h('span', { class:'wk-this' }, ' · эта неделя') : null),
    h('button', { class:'mc-nav', type:'button', 'aria-label':'Следующая неделя', title:'Следующая неделя', onclick:nav(1) }, icon('chev', 15))));
  let shown = 0;
  days.forEach(k => { const r = weekDayEl(k); shown += r.shown; c.list.append(r.el); });
  if (st.undated.length) c.list.append(weekDayEl(null).el);
  if (!shown) c.list.append(h('div', { class:'wk-hint' }, st.urgentOnly
    ? 'Срочных задач на этой неделе нет. Нажмите на день, чтобы расписать его; задача с !!! в конце — срочная и появится здесь.'
    : 'На этой неделе задач нет. Нажмите на день, чтобы расписать его.'));
  c.list.scrollTop = scroll;
}
function weekDayEl(k){
  const items = dayItems(k), today = todayKey();
  const urgent = items.filter(t => t.pri >= URGENT);
  const show = k == null || !S.cal.urgentOnly ? items : urgent;
  const rest = items.length - show.length;
  const cnt = !items.length ? '' : show.length ? (rest ? '+ ещё ' + rest : '') : tasksWord(items.length) + (S.cal.urgentOnly ? ', без срочных' : '');
  const head = k == null
    ? h('button', { class:'wk-head', type:'button', 'aria-label':'Открыть задачи без даты', onclick:() => openDay(null) },
        h('span', { class:'wk-num' }, 'Без даты'), h('span', { class:'wk-cnt' }, tasksWord(items.length)), icon('chev', 14))
    : h('button', { class:'wk-head', type:'button', 'aria-label':'Открыть день: ' + fmtDate(k, { weekday:'long', day:'numeric', month:'long' }), onclick:() => openDay(k) },
        h('span', { class:'wk-dow' }, DOW[(parseKey(k).getDay() + 6) % 7]),
        h('span', { class:'wk-num' }, fmtDate(k, { day:'numeric', month:'short' })),
        relDay(k) ? h('span', { class:'wk-rel' }, relDay(k)) : null,
        h('span', { class:'wk-cnt' }, cnt), icon('chev', 14));
  const blocks = k ? dayBlocks(k) : [];
  const el = h('div', { class:'wk-day' + (k === today ? ' today' : '') + (k != null && k < today ? ' past' : '') + (k == null ? ' undated' : ''), 'data-date':k || '' },
    head, show.length ? h('div', { class:'wk-tasks tz', 'data-date':k || '', 'data-block':'*' }, show.map(t => weekTaskEl(t, k, blocks))) : null);
  return { el, shown:show.length };
}
function weekTaskEl(t, k, blocks){
  const b = t.block && blocks.find(x => x.id === t.block);
  const row = h('div', { class:'wk-task' + (t.done ? ' done' : ''), 'data-id':t.id, 'data-pri':t.pri, title:'Открыть день' },
    h('button', { class:'cb', type:'button', role:'checkbox', 'aria-checked':String(t.done), 'aria-label':'Выполнено: ' + t.text }, icon('check', 12)),
    b ? h('span', { class:'wk-time', 'data-color':b.color, title:blockLabel(b) }, b.from) : null,
    h('span', { class:'wk-t' }, t.text || 'Без названия'));
  row.addEventListener('click', e => {
    if (e.target.closest('.cb')) { t.done = !t.done; touch('cal'); forRows(t.id, r => paintItem(r, t)); updateProgress(); paintDayProgress(); paintBlockCounts(); refreshWeek(); return; }
    openDay(k, t.id);
  });
  return row;
}

/* ---------- окно дня: все задачи выбранной даты ---------- */
let dayView = null;
function openDay(date, focusId){
  if (dayView) closeDay();
  closeMenu();
  const list = h('div', { class:'list day-list', 'data-key':'week' });
  const input = h('input', { class:'add-input', type:'text', placeholder:'Новая задача (!!! — срочно)', title:'!!! в конце — срочная задача', 'aria-label':'Новая задача на этот день', autocomplete:'off', enterkeyhint:'done' });
  const form = h('form', { class:'composer day-composer', onsubmit:e => { e.preventDefault(); if (dayView) addTask(dayView.date, input, list); } }, icon('plus', 16), input);
  const title = h('h2', { class:'day-title' }), rel = h('span', { class:'day-rel' }), crumbs = h('div', { class:'crumbs' });
  const bar = h('i'), n = h('span', { class:'n' });
  const prev = h('button', { class:'tool flip', type:'button', 'aria-label':'Предыдущий день', title:'Предыдущий день (Alt+←)', onclick:() => shiftDay(-1) }, icon('chev', 17));
  const next = h('button', { class:'tool', type:'button', 'aria-label':'Следующий день', title:'Следующий день (Alt+→)', onclick:() => shiftDay(1) }, icon('chev', 17));
  const blockBtn = h('button', { class:'sheet-board day-block-btn', type:'button', title:'Добавить блок времени (например, 10:00–12:00)', onclick:() => { if (dayView && dayView.date) blockEditor(blockBtn, dayView.date, null); } }, icon('clock', 16), 'Блок времени');
  const sheet = h('div', { class:'sheet day-sheet', 'data-key':'week', role:'dialog', 'aria-modal':'true', 'aria-label':'План на день' },
    h('div', { class:'sheet-top' }, crumbs, h('div', { class:'col-tools' }, blockBtn, prev, next, tool('x', 'Закрыть (Esc)', () => closeDay()))),
    h('div', { class:'day-head' }, h('div', { class:'day-titles' }, title, rel), h('div', { class:'prog' }, h('div', { class:'bar' }, bar), n)),
    list, form,
    h('div', { class:'sheet-foot' },
      h('span', {}, h('kbd', {}, '!!!'), ' в конце — срочно: такие задачи видны в колонке «Неделя»'),
      h('span', {}, 'Задачи перетаскиваются мышью · ', h('kbd', {}, 'Alt+←/→'), ' — соседние дни')));
  const ov = h('div', { class:'overlay day-ov', onmousedown:e => { if (e.target === ov) closeDay(); } }, sheet);
  ov.addEventListener('keydown', e => { if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); shiftDay(e.key === 'ArrowLeft' ? -1 : 1); } });
  bindTaskList(list);
  dayView = { date:date == null ? null : date, ov, list, input, title, rel, crumbs, bar, n, prev, next, blockBtn };
  document.body.append(ov);
  renderDayView();
  const f = focusId && list.querySelector('.item[data-id="' + focusId + '"] .txt');
  if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } else input.focus();
}
function shiftDay(d){
  if (!dayView || dayView.date == null) return;
  dayView.date = addDays(dayView.date, d);
  weekStart = mondayOf(dayView.date); calMonth = monthOf(dayView.date);
  renderDayView(); refreshWeek();
}
function renderDayView(){
  const v = dayView; if (!v) return;
  const k = v.date;
  v.title.textContent = k == null ? 'Без даты' : cap(fmtDate(k, { weekday:'long', day:'numeric', month:'long' }));
  v.rel.textContent = k == null ? 'Задачи, которые ещё не распределены по дням' : [relDay(k), cap(fmtDate(k, { year:'numeric' }))].filter(Boolean).join(' · ');
  v.crumbs.replaceChildren(h('b', {}, 'Неделя'), h('span', {}, '›'), h('span', {}, k == null ? 'Без даты' : fmtDate(k, { day:'numeric', month:'long', year:'numeric' })));
  v.prev.disabled = v.next.disabled = k == null;
  v.blockBtn.hidden = k == null;
  const items = dayItems(k);
  v.list.replaceChildren();
  if (!items.length && !dayBlocks(k).length) v.list.append(h('div', { class:'empty' }, k == null ? 'Задач без даты нет.' : 'На этот день пока ничего нет. Добавьте первое дело ниже или разбейте день на блоки времени.'));
  renderTaskGroups(v.list, k, items);
  v.list.querySelectorAll('textarea').forEach(autosize);
  paintDayProgress();
}
function paintDayProgress(){
  const v = dayView; if (!v) return;
  const it = dayItems(v.date), d = it.filter(t => t.done).length;
  v.n.textContent = it.length ? d + ' / ' + it.length : '';
  v.bar.style.width = it.length ? (d / it.length * 100) + '%' : '0%';
}
function closeDay(){ if (!dayView) return; dayView.ov.remove(); dayView = null; }
