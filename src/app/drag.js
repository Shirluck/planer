/* Планер — перетаскивание задач мышью: порядок, блоки, дни недели, числа календаря.
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

/* ---------- перетаскивание задач мышью: порядок, блоки, дни недели, числа календаря ---------- */
let tdrag = null, justDragged = false;
const zoneTarget = z => ({ date:z.dataset.date || null, block:z.dataset.block === '*' ? undefined : (z.dataset.block || null) });
function clearDropMarks(){ document.querySelectorAll('.drop-before,.drop-after,.drop-end,.drop-on').forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop-end', 'drop-on')); }
document.addEventListener('click', e => { if (justDragged) { e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener('pointerdown', e => {
  if (e.button !== 0 || tdrag) return;
  const row = e.target.closest && e.target.closest('.item[data-id], .wk-task[data-id]');
  if (!row || !row.isConnected) return;
  const onGrip = !!e.target.closest('.grip');
  if (e.pointerType === 'touch' && !onGrip) return;                       // на сенсорном экране — только за ручку
  if (!onGrip && e.target.closest('button, input, a, .note-wrap')) return; // кнопки работают как обычно
  const ta = e.target.closest('textarea');
  if (ta && document.activeElement === ta) return;                         // в режиме ввода текста — выделение, а не перенос
  if (onGrip) e.preventDefault();
  const sx = e.clientX, sy = e.clientY, pid = e.pointerId;
  const move = ev => {
    if (ev.pointerId !== pid) return;
    if (!tdrag) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return; startTaskDrag(row, sx, sy); }
    ev.preventDefault();
    dragOverTask(ev.clientX, ev.clientY);
  };
  const stop = cancel => {
    window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', cancelUp, true); document.removeEventListener('keydown', key, true);
    if (tdrag) finishTaskDrag(cancel);
  };
  const up = ev => { if (ev.pointerId === pid) stop(false); };
  const cancelUp = ev => { if (ev.pointerId === pid) stop(true); };
  const key = ev => { if (ev.key === 'Escape' && tdrag) { ev.preventDefault(); ev.stopPropagation(); stop(true); } };
  window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', cancelUp, true); document.addEventListener('keydown', key, true);
}, true);
function startTaskDrag(row, sx, sy){
  closeMenu();
  const a = document.activeElement; if (a && row.contains(a) && a.blur) a.blur();
  try { window.getSelection().removeAllRanges(); } catch (e) {}
  const r = row.getBoundingClientRect();
  const id = row.dataset.id;
  // перетаскивание выделенной задачи уносит все выделенные (select.js)
  const group = TSEL.ids.has(id) && TSEL.ids.size > 1 ? tselOrdered() : null;
  if (!group) tselClear();
  const ghost = row.cloneNode(true);
  const srcTa = row.querySelectorAll('textarea');
  ghost.querySelectorAll('textarea').forEach((x, i) => { x.value = srcTa[i] ? srcTa[i].value : ''; });
  ghost.classList.add('task-ghost'); ghost.classList.remove('drop-before', 'drop-after', 'tsel');
  ghost.style.width = r.width + 'px';
  ghost.style.setProperty('--accent', getComputedStyle(row).getPropertyValue('--accent'));
  ghost.setAttribute('aria-hidden', 'true');
  if (group) ghost.append(h('b', { class:'tg-count' }, String(group.length)));
  document.body.append(ghost);
  tdrag = { id, group, row, ghost, dx:sx - r.left, dy:sy - r.top, target:null, x:sx, y:sy, scroll:null, raf:0 };
  row.classList.add('drag-src'); document.body.classList.add('task-dragging');
  if (group) document.querySelectorAll('.tsel:not(.task-ghost)').forEach(x => x.classList.add('drag-src'));
  autoScrollLoop();
}
function dragOverTask(x, y){
  const d = tdrag; if (!d) return;
  d.x = x; d.y = y;
  d.ghost.style.transform = 'translate(' + (x - d.dx) + 'px,' + (y - d.dy) + 'px) rotate(1deg)';
  clearDropMarks(); d.target = null;
  const el = document.elementFromPoint(x, y); if (!el) return;
  const list = el.closest('.list');
  d.scroll = null;
  if (list) { const lr = list.getBoundingClientRect(); if (y < lr.top + 36) d.scroll = { list, dir:-1 }; else if (y > lr.bottom - 36) d.scroll = { list, dir:1 }; }
  const it = el.closest('.item[data-id], .wk-task[data-id]');
  const own = x => x === d.row || (d.group && d.group.includes(x.dataset.id));   // сама перетаскиваемая (или из группы)
  if (it && !own(it) && it.closest('.tz') && !it.closest('.task-ghost')) {
    const zone = it.closest('.tz'), r = it.getBoundingClientRect(), after = y > r.top + r.height / 2;
    let before = it.dataset.id;
    if (after) { let n = it.nextElementSibling; while (n && (!n.dataset.id || own(n))) n = n.nextElementSibling; before = n ? n.dataset.id : null; }
    it.classList.add(after ? 'drop-after' : 'drop-before');
    d.target = Object.assign(zoneTarget(zone), { beforeId:before });
    return;
  }
  if (it && own(it)) return;                                               // над собой — без изменений
  let zone = el.closest('.tz') || (el.closest('.tblock') && el.closest('.tblock').querySelector('.tz'));
  if (!zone && list && list.querySelector('.tz') && !el.closest('.wk-day')) { const zs = list.querySelectorAll('.tz'); zone = zs[zs.length - 1]; }
  if (zone) { zone.classList.add('drop-end'); d.target = Object.assign(zoneTarget(zone), { beforeId:null }); return; }
  const wd = el.closest('.wk-day');
  if (wd) { wd.classList.add('drop-on'); d.target = { date:wd.dataset.date || null, block:undefined, beforeId:null }; return; }
  const mc = el.closest('.col[data-key=week] .mc-day');
  if (mc) { mc.classList.add('drop-on'); d.target = { date:mc.dataset.date, block:undefined, beforeId:null }; }
}
function autoScrollLoop(){
  const d = tdrag; if (!d) return;
  if (d.scroll) { d.scroll.list.scrollTop += d.scroll.dir * 9; dragOverTask(d.x, d.y); }
  d.raf = requestAnimationFrame(autoScrollLoop);
}
function finishTaskDrag(cancel){
  const d = tdrag; tdrag = null; if (!d) return;
  cancelAnimationFrame(d.raf);
  d.ghost.remove(); d.row.classList.remove('drag-src'); document.querySelectorAll('.drag-src').forEach(x => x.classList.remove('drag-src')); document.body.classList.remove('task-dragging'); clearDropMarks();
  justDragged = true; setTimeout(() => { justDragged = false; }, 0);
  if (cancel || !d.target) return;
  if (d.group) moveTasks(d.group, d.target.date, d.target.beforeId, d.target.block);
  else moveTask(d.id, d.target.date, d.target.beforeId, d.target.block);
}
