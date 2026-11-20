/* Планер — выделение нескольких задач: Ctrl+щелчок — добавить/убрать, Shift+щелчок — подряд в одном списке.
   Выделенные задачи перетаскиваются вместе (drag.js) и меняются разом через панель внизу: выполнено, приоритет,
   перенос на день, удаление. Esc или щелчок мимо — снять выделение.
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

const TSEL = { ids:new Set(), anchor:null, bar:null, swallow:false };
const taskRowOf = n => n && n.closest ? n.closest('.item[data-id], .wk-task[data-id]') : null;
// выделенные задачи в порядке календаря (дни по порядку, внутри дня — как в списке, затем «Без даты»)
function tselOrdered(){
  const out = [];
  for (const k of Object.keys(S.cal.days).sort()) for (const t of S.cal.days[k].items) if (TSEL.ids.has(t.id)) out.push(t.id);
  for (const t of S.cal.undated) if (TSEL.ids.has(t.id)) out.push(t.id);
  return out;
}
function tselClick(row, e){
  const id = row.dataset.id;
  if (e.shiftKey && TSEL.anchor) {
    const box = row.closest('.list') || row.parentNode;
    const rows = [...box.querySelectorAll('.item[data-id], .wk-task[data-id]')].filter(r => !r.closest('.task-ghost'));
    const a = rows.findIndex(r => r.dataset.id === TSEL.anchor), b = rows.indexOf(row);
    if (a >= 0 && b >= 0) { for (let i = Math.min(a, b); i <= Math.max(a, b); i++) TSEL.ids.add(rows[i].dataset.id); paintTsel(); return; }
  }
  if (TSEL.ids.has(id)) TSEL.ids.delete(id); else TSEL.ids.add(id);
  TSEL.anchor = id;
  paintTsel();
}
function tselClear(){ if (!TSEL.ids.size && !TSEL.bar) return; TSEL.ids.clear(); TSEL.anchor = null; paintTsel(); }
// подсветка строк и панель действий; вызывается и после каждой перерисовки списков
function paintTsel(){
  for (const id of [...TSEL.ids]) if (!findTask(id)) TSEL.ids.delete(id);
  document.querySelectorAll('.item[data-id], .wk-task[data-id]').forEach(r => r.classList.toggle('tsel', TSEL.ids.has(r.dataset.id)));
  if (TSEL.ids.size < 1) { if (TSEL.bar) { TSEL.bar.remove(); TSEL.bar = null; } return; }
  const n = TSEL.ids.size, ids = tselOrdered(), all = ids.map(id => findTask(id).t);
  const allDone = all.every(t => t.done), today = todayKey();
  const b = (ic, label, run, cls) => h('button', { type:'button', class:'tsel-b' + (cls ? ' ' + cls : ''), title:label, onclick:e => run(e.currentTarget) }, icon(ic, 15), h('span', {}, label));
  const bar = h('div', { class:'tsel-bar', role:'toolbar', 'aria-label':'Действия с выделенными задачами' },
    h('b', { class:'tsel-n' }, 'Выбрано: ' + n),
    b('check', allDone ? 'Не выполнено' : 'Выполнено', () => bulkTasks(t => { t.done = !allDone; }, allDone ? 'Отмечено невыполненными' : 'Отмечено выполненными')),
    b('flag', 'Приоритет', btn => openMenu(btn, [3, 2, 1, 0].map(p => ({ icon:'flag', label:(p ? '!'.repeat(p) + ' ' : '') + cap(PRI[p]), run:() => bulkTasks(t => { t.pri = p; }, 'Приоритет: ' + PRI[p]) })))),
    b('sun', 'На сегодня', () => { moveTasks(ids, today); tselClear(); }),
    b('arrow', 'На завтра', () => { moveTasks(ids, addDays(today, 1)); tselClear(); }),
    b('cal', 'На день…', btn => pickDate(btn, today, d => { moveTasks(ids, d); tselClear(); })),
    b('trash', 'Удалить', () => { deleteTasks(ids); tselClear(); }, 'danger'),
    h('button', { type:'button', class:'tool tsel-x', title:'Снять выделение (Esc)', 'aria-label':'Снять выделение', onclick:() => tselClear() }, icon('x', 15)));
  if (TSEL.bar) TSEL.bar.replaceWith(bar); else document.body.append(bar);
  TSEL.bar = bar;
}
function bulkTasks(fn, msg){
  const undo = undoer(['cal']);
  tselOrdered().forEach(id => { const loc = findTask(id); if (loc) fn(loc.t); });
  touch('cal'); refreshCal(); toast(msg, undo);
}
// перенос нескольких задач одним действием (одна отмена); порядок между ними сохраняется
function moveTasks(ids, date, beforeId, block){
  if (date !== null && date !== undefined && !DATE_RE.test(date)) return;
  date = date === undefined ? null : date;
  const undo = undoer(['cal']), moved = [];
  let changedDay = false;
  for (const id of ids) {
    const loc = findTask(id); if (!loc) continue;
    const [t] = loc.arr.splice(loc.i, 1);
    if (block !== undefined) { if (block && dayBlocks(date).some(b => b.id === block)) t.block = block; else delete t.block; }
    else if (date !== loc.date) delete t.block;
    if (date !== loc.date) changedDay = true;
    moved.push(t);
  }
  if (!moved.length) return;
  const dest = dayItems(date, true);
  const bi = beforeId && !ids.includes(beforeId) ? dest.findIndex(x => x.id === beforeId) : -1;
  if (bi >= 0) dest.splice(bi, 0, ...moved); else dest.push(...moved);
  pruneDays(); touch('cal'); refreshCal();
  toast((changedDay ? (date == null ? 'Без даты: ' : 'Перенесено на ' + dayLabel(date) + ': ') : 'Перемещено: ') + tasksWord(moved.length), undo);
}
function deleteTasks(ids){
  const undo = undoer(['cal']);
  let n = 0;
  for (const id of ids) { const loc = findTask(id); if (loc) { loc.arr.splice(loc.i, 1); openNotes.delete(id); n++; } }
  pruneDays(); touch('cal'); refreshCal(); toast('Удалено: ' + tasksWord(n), undo);
}
document.addEventListener('mousedown', e => {
  if (e.button !== 0 || !(e.ctrlKey || e.metaKey || e.shiftKey)) return;
  const row = taskRowOf(e.target);
  if (!row || row.closest('.task-ghost, .menu')) return;
  e.preventDefault();                                   // курсор в текст не ставится — это выделение
  TSEL.swallow = true;
  tselClick(row, e);
}, true);
document.addEventListener('click', e => {
  if (TSEL.swallow) { TSEL.swallow = false; e.preventDefault(); e.stopPropagation(); return; }
  if (!TSEL.ids.size || justDragged) return;
  if (e.target.closest && e.target.closest('.tsel-bar, .menu, .toast, .tsel')) return;
  tselClear();
}, true);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && TSEL.ids.size && !menuEl && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); tselClear(); }
}, true);
