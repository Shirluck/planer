/* Планер — главное окно отвечает мини-окну «Сегодня» (mini.html): задачи на сегодня, отметка «выполнено», новая задача.
   Состояние живёт здесь, мини-окно только показывает его и просит изменить (через основной процесс).
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

function miniToday(){
  const k = todayKey(), items = dayItems(k), blocks = sortedBlocks(k);
  const label = b => b.from + '–' + b.to + (b.title ? ' ' + b.title : '');
  return {
    date:k, title:cap(fmtDate(k, { weekday:'long', day:'numeric', month:'long' })),
    items:items.map(t => { const b = t.block && blocks.find(x => x.id === t.block); return { id:t.id, text:t.text, done:t.done, pri:t.pri, block:b ? label(b) : '', color:b ? b.color : '', from:b ? b.from : '' }; }),
    blocks:blocks.map(b => ({ id:b.id, label:label(b), color:b.color, now:isNowIn(k, b) })),
    overdue:overdueTasks().length
  };
}
const miniNotify = debounce(() => { const ea = window.electronAPI; if (ea && ea.miniHost) ea.miniHost.changed(); }, 120);
function initMiniHost(){
  const ea = window.electronAPI; if (!ea || !ea.miniHost) return;
  ea.miniHost.onOp(async (op, args) => {
    if (op === 'today') return miniToday();
    if (op === 'toggle') {
      const loc = findTask(String(args.id || ''));
      if (!loc || loc.date !== todayKey()) return miniToday();
      loc.t.done = !loc.t.done;
      forRows(loc.t.id, r => paintItem(r, loc.t)); touch('cal'); updateProgress(); paintDayProgress(); paintBlockCounts(); refreshWeek();
      return miniToday();
    }
    if (op === 'add') {
      const { text, pri } = parseNewTask(args.text);
      if (text) { dayItems(todayKey(), true).push({ id:newId(), text:text.slice(0, 500), done:false, pri, note:'' }); touch('cal'); refreshCal(); }
      return miniToday();
    }
    return null;
  });
}
