/* Планер — ИИ-ассистент: панель, контекст, инструменты.
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

/* ---------- AI assistant ---------- */
let sample = null, assistant = null, aiMode = null, aiBusy = false, aiCtrl = null;
const aiHistory = [];
const aiPanel = $('#aiPanel'), aiBtn = $('#aiBtn');
let aiMsgs, aiIn, aiSendBtn, aiChips, aiModeBtn;
function showAiMode(s){
  aiMode = s && s.mode;
  if (aiModeBtn) aiModeBtn.textContent = aiMode === 'claude-code' ? 'через подписку Claude' + (s.model && s.model !== 'sonnet' ? ' · ' + s.model[0].toUpperCase() + s.model.slice(1) : '') : 'через ключ API';
}

const inlineMd = t => t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
function mdLite(s){
  const esc = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = '', inList = false, code = null;
  for (const ln of esc.split('\n')) {
    if (/^\s*```/.test(ln)) {                       // блок кода (экспрешены и т. п.) — с кнопкой «Копировать»
      if (code === null) { if (inList) { out += '</ul>'; inList = false; } code = []; }
      else { out += '<pre class="ai-code"><code>' + code.join('\n') + '</code></pre>'; code = null; }
      continue;
    }
    if (code !== null) { code.push(ln); continue; }
    const m = ln.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (m) { if (!inList) { out += '<ul>'; inList = true; } out += '<li>' + inlineMd(m[1]) + '</li>'; }
    else { if (inList) { out += '</ul>'; inList = false; } if (ln.trim()) out += '<p>' + inlineMd(ln) + '</p>'; }
  }
  if (code !== null) out += '<pre class="ai-code"><code>' + code.join('\n') + '</code></pre>';   // ещё печатается
  return out + (inList ? '</ul>' : '');
}
function decorateCode(md){
  md.querySelectorAll('pre.ai-code').forEach(pre => {
    if (pre.querySelector('.ai-copy')) return;
    pre.append(h('button', { type:'button', class:'ai-copy', title:'Копировать код', onclick:async () => {
      const ea = window.electronAPI, ok = ea && ea.clipWriteText ? await ea.clipWriteText(pre.querySelector('code').textContent) : false;
      toast(ok ? 'Код скопирован' : 'Не удалось скопировать.');
    } }, icon('copy', 14), 'Копировать'));
  });
}
function buildAiPanel(){
  aiMsgs = h('div', { class:'ai-msgs', 'aria-live':'polite' });
  aiIn = h('textarea', { class:'ai-in', rows:'1', placeholder:'Спросите или поручите что-нибудь…', 'aria-label':'Сообщение ассистенту' });
  aiSendBtn = h('button', { class:'send', type:'submit', 'aria-label':'Отправить' }, icon('up', 18));
  const chips = ['Составь план на сегодня из задач недели', 'Что самое важное сделать сейчас?', 'Разбери мои идеи: что стоит превратить в план?', 'Подведи итог дня'];
  aiChips = h('div', { class:'chips' }, chips.map(c => h('button', { class:'chip', type:'button', onclick:() => aiSend(c) }, c)));
  aiModeBtn = h('button', { class:'ai-mode', type:'button', title:'Как подключён ассистент', onclick:() => assistant && assistant.openSettings() });
  aiModeBtn.hidden = !assistant;
  aiPanel.append(
    h('div', { class:'ai-head' }, h('div', {}, h('h3', {}, icon('spark', 18), 'Ассистент'), aiModeBtn), tool('x', 'Закрыть', closeAi)),
    aiMsgs, aiChips,
    h('form', { class:'ai-form', onsubmit:e => { e.preventDefault(); if (aiBusy) { aiCtrl && aiCtrl.abort(); return; } const v = aiIn.value.trim(); if (v) { aiIn.value = ''; autosize(aiIn); aiSend(v); } } }, aiIn, aiSendBtn));
  aiIn.addEventListener('input', () => autosize(aiIn));
  aiIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); aiSendBtn.click(); } });
  addMsg('bot', 'Я вижу ваши списки и могу их менять: добавлять задачи, расставлять приоритеты, переносить между «Сегодня» и «Неделя», создавать страницы в «Основных планах» и «Идеях». Могу читать доски задач и добавлять на них заметки и чек-листы, а картинки посмотрю, если попросите. Просто напишите, что нужно.');
}
function openAi(){ aiPanel.classList.add('open'); aiPanel.removeAttribute('inert'); setTimeout(() => aiIn.focus(), 220); }
function closeAi(){ aiPanel.classList.remove('open'); }
function addMsg(role, text){
  const m = h('div', { class:'msg ' + role });
  if (role === 'user') m.textContent = text;
  else { m.append(h('div', { class:'acts-log' }), h('div', { class:'md' })); m.querySelector('.md').innerHTML = mdLite(text); decorateCode(m.querySelector('.md')); }
  aiMsgs.append(m); aiMsgs.scrollTop = aiMsgs.scrollHeight; return m;
}
const ctxTask = (t, k) => {
  const b = t.block && dayBlocks(k).find(x => x.id === t.block);
  return '[' + t.id + '] ' + (t.done ? '[x]' : '[ ]') + ' ' + (b ? '{' + b.from + '–' + b.to + '} ' : '') + (t.pri ? '(приоритет ' + t.pri + (t.pri >= URGENT ? ', срочно' : '') + ') ' : '') + t.text + (t.note.trim() ? ' — заметка: ' + t.note.replace(/\s+/g, ' ').slice(0, 200) : '');
};
const ctxBlocks = (k, pad) => { const bl = sortedBlocks(k); return bl.length ? pad + 'блоки времени: ' + bl.map(b => '[' + b.id + '] ' + blockLabel(b)).join('; ') + '\n' : ''; };
const ctxDay = (k, pad) => ctxBlocks(k, pad) + dayItems(k).map(t => pad + ctxTask(t, k)).join('\n');
function ctxCalendar(){
  const today = todayKey(), from = addDays(today, -7), to = addDays(today, 28), out = [];
  Object.keys(S.cal.days).filter(k => k !== today && k >= from && k <= to).sort().forEach(k => {
    out.push(k + ' (' + fmtDate(k, { weekday:'long', day:'numeric', month:'long' }) + (relDay(k) ? ', ' + relDay(k).toLowerCase() : '') + '):');
    out.push(ctxDay(k, '  ').replace(/\n$/, ''));
  });
  const later = Object.keys(S.cal.days).filter(k => k > to).length, earlier = overdueTasks().filter(x => x.date < from).length;
  if (later) out.push('(ещё дней с задачами позже: ' + later + ')');
  if (earlier) out.push('(невыполненных задач раньше ' + from + ': ' + earlier + ')');
  return out.join('\n') || '(пусто)';
}
function ctxTree(k){
  const out = [];
  const walk = (arr, d) => arr.forEach(n => {
    if (out.length > 200) return;
    const pad = '  '.repeat(d);
    if (n.type === 'folder') { out.push(pad + '[' + n.id + '] папка «' + n.title + '»'); walk(n.children, d + 1); }
    else if (n.kind === 'board') out.push(pad + '[' + n.id + '] доска «' + (n.title || 'Без названия') + '»' + (n.boardCount ? ' {доска: карточек ' + n.boardCount + '}' : ' (пустая)'));
    else { const td = n.blocks.filter(b => b.t === 'todo'); out.push(pad + '[' + n.id + '] текстовая страница «' + (n.title || 'Без названия') + '» (блоков: ' + n.blocks.length + (td.length ? ', чекбоксов выполнено ' + td.filter(b => b.done).length + '/' + td.length : '') + ')' + (n.boardCount ? ' {доска: карточек ' + n.boardCount + '}' : '')); }
  });
  walk(S[k].nodes, 0); return out.join('\n') || '(пусто)';
}
function buildPrompt(userText){
  const now = new Intl.DateTimeFormat('ru-RU', { dateStyle:'full', timeStyle:'short' }).format(new Date());
  const today = todayKey(), openBoard = boardApi && boardApi.openTaskId(), ob = openBoard && findOwner(openBoard);
  return 'Ты — встроенный ИИ-ассистент личного планировщика. Отвечай по-русски, коротко и по делу, без лишних вступлений.\n' +
    'Ты можешь менять данные планировщика через инструменты: добавлять, менять, переносить задачи между днями; читать и создавать страницы. ' +
    'Если пользователь просит что-то сделать, добавить, запланировать или разложить — делай это инструментами, а не только советуй. ' +
    'Если просит совет или анализ — просто ответь. Ничего не удаляй без прямой просьбы. После действий в одну-две фразы скажи, что сделано. ' +
    'Задачи живут в календаре: у каждой задачи есть день (дата ГГГГ-ММ-ДД) или она «без даты». Колонка «Сегодня» показывает задачи сегодняшней даты, ' +
    'колонка «Неделя» — календарь, где на обзоре видны только срочные задачи. Приоритет задачи: 0 — нет, 1 — низкий, 2 — средний, 3 — срочно. ' +
    'Идентификаторы в квадратных скобках — это id для инструментов. Заметки к задаче короткие. Содержимое страниц смотри через read_page.\n' +
    'День можно разбить на блоки времени (например, 10:00–12:00 «Работа»): задача в блоке помечена {10:00–12:00}. Блок создаёт add_time_block, ' +
    'задачу в блок кладут add_task или move_task с параметром block (id блока этого дня). Блоки — необязательная функция: не создавай их без просьбы.\n' +
    'Файлы в «Основных планах» и «Идеях» бывают двух типов: текстовые страницы (блоки как в Notion: заголовки, списки, задачи, цитаты, выноски, код; read_page, append_to_page, replace_page) и доски — холст с карточками (заметки, чек-листы, фото, видео, зарисовки, ссылки с описанием, рисунки от руки); непустые доски помечены {доска: …}. ' +
    'Содержимое доски читай через read_board(pageId) — там координаты x, y и размеры w, h карточек. Доску можно дополнять (add_board_card: заметка, чек-лист, ссылка) и организовывать: ' +
    'arrange_board_cards переставляет и меняет размер, tidy_board раскладывает сеткой или колонками по типу, update_board_card меняет текст и цвет, remove_board_cards удаляет (только по прямой просьбе). ' +
    'Когда просят навести порядок на доске: прочитай её, сгруппируй связанные карточки рядом (например, по темам — колонками с заголовком-заметкой сверху), выровняй и оставь ровные промежутки 24 px без наложений; ничего не удаляй без просьбы. ' +
    'Изображения и зарисовки смотри через look_at_image(cardId) только когда пользователь прямо просит посмотреть, описать или разобрать картинку.\n' +
    (ob ? 'Сейчас у пользователя открыта доска страницы [' + ob.node.id + '] «' + (ob.node.title || 'Без названия') + '».\n' : '') +
    'Сейчас: ' + now + ' (сегодня ' + today + ').\n\n<состояние>\n' +
    '== СЕГОДНЯ (' + today + ') ==\n' + (ctxDay(today, '').replace(/\n$/, '') || '(пусто)') +
    '\n\n== КАЛЕНДАРЬ: другие дни с задачами (от недели назад до 4 недель вперёд) ==\n' + ctxCalendar() +
    '\n\n== БЕЗ ДАТЫ ==\n' + (S.cal.undated.map(t => ctxTask(t, null)).join('\n') || '(пусто)') +
    '\n\n== ОСНОВНЫЕ ПЛАНЫ (папки и страницы) ==\n' + ctxTree('plans') +
    '\n\n== ИДЕИ (папки и страницы) ==\n' + ctxTree('ideas') + '\n</состояние>\n\nЗапрос пользователя: ' + userText;
}
// блоки от ассистента: { type, text (Markdown внутри строки), done?, indent?, emoji? } → блоки страницы
function toBlocks(arr){
  return (Array.isArray(arr) ? arr : []).slice(0, 300).map(b => normBlock({ id:newId(), t:b && b.type, text:String((b && b.text) || '').slice(0, 4000), done:!!(b && b.done), ind:b && b.indent, emoji:b && b.emoji }));
}
const PAGE_BLOCK_SCHEMA = { type:'array', items:{ type:'object', properties:{ type:{ type:'string', enum:BLOCK_TYPES }, text:{ type:'string' }, done:{ type:'boolean' }, indent:{ type:'integer', minimum:0, maximum:6 }, emoji:{ type:'string' } }, required:['type'] } };
const PAGE_BLOCKS_HELP = 'Block types: p (text), h1, h2, h3 (headings), todo (checkbox, done), ul (bullet), ol (numbered), quote, callout (with emoji), code (plain text, keeps line breaks), hr (divider). indent 0-6 nests p/ul/ol/todo. Inside text use inline Markdown: **bold**, *italic*, ~~strike~~, `code`, [link](https://...).';
function aiTools(logEl){
  // строка действия в чате; undo — кнопка «Вернуть как было» (для перестановок и переписывания)
  const log = (ic, text, img, undo) => {
    const btn = undo ? h('button', { type:'button', class:'act-undo', onclick:() => { undo(); btn.disabled = true; btn.textContent = 'Возвращено'; } }, 'Вернуть как было') : null;
    logEl.append(h('div', { class:'act' }, icon(ic, 14), h('span', {}, text, img ? h('img', { class:'act-thumb', src:img, alt:'' }) : null), btn));
    aiMsgs.scrollTop = aiMsgs.scrollHeight;
  };
  const boardPage = id => {
    if (!boardApi) throw new Error('Boards are not available');
    const l = findAnyNode(String(id || ''));
    if (!l || l.node.type !== 'page') throw new Error('Page not found: ' + id + ' (boards belong to pages in "plans" and "ideas")');
    return l.node;
  };
  const taskOrThrow = id => { const loc = findTask(String(id || '')); if (!loc) throw new Error('Task not found: ' + id); return loc; };
  const blockOrThrow = (date, id) => { const b = dayBlocks(date).find(x => x.id === String(id)); if (!b) throw new Error('Time block ' + id + ' not found on ' + date); return b; };
  const dateArg = v => {
    const s = String(v == null ? 'today' : v).trim().toLowerCase();
    if (!s || s === 'today' || s === 'сегодня') return todayKey();
    if (s === 'tomorrow' || s === 'завтра') return addDays(todayKey(), 1);
    if (s === 'none' || s === 'undated' || s === 'null') return null;
    if (DATE_RE.test(s) && !isNaN(parseKey(s)) && dkey(parseKey(s)) === s) return s;
    throw new Error('date must be YYYY-MM-DD, "today", "tomorrow" or "none"');
  };
  const T = (name, description, properties, required, fn) => ({ name, description, inputSchema:{ type:'object', properties, required }, execute: async i => fn(i || {}) });
  const DATE = { type:'string', description:'YYYY-MM-DD, "today", "tomorrow" or "none" (no date)' };
  return [
    T('add_task', 'Add a task to a calendar day. Priority 3 means urgent: urgent tasks are shown in the week overview. Optional block = id of a time block of that day.', { date:DATE, text:{ type:'string' }, priority:{ type:'integer', minimum:0, maximum:3 }, note:{ type:'string' }, block:{ type:'string' } }, ['text'], i => {
      const date = dateArg(i.date), text = String(i.text || '').trim(); if (!text) throw new Error('text is empty');
      const t = { id:newId(), text:text.slice(0, 500), done:false, pri:Math.min(3, Math.max(0, i.priority | 0)), note:String(i.note || '').slice(0, 1000) };
      const b = i.block ? blockOrThrow(date, i.block) : null; if (b) t.block = b.id;
      dayItems(date, true).push(t); touch('cal'); refreshCal(); log('plus', 'Добавлено на ' + dayLabel(date) + (b ? ' в блок ' + blockLabel(b) : '') + ': ' + t.text); return { ok:true, id:t.id, date };
    }),
    T('add_time_block', 'Create a time block for a day (e.g. 10:00-12:00 "Работа"). Times are 24h HH:MM, to must be later than from. Colors: blue, green, yellow, orange, pink, purple. Only when the user asks for blocks.', { date:DATE, from:{ type:'string' }, to:{ type:'string' }, title:{ type:'string' }, color:{ type:'string', enum:BLOCK_COLOR_IDS } }, ['date', 'from', 'to'], i => {
      const date = dateArg(i.date); if (!date) throw new Error('time blocks need a date');
      const b = normTimeBlock({ id:newId(), from:String(i.from || '').padStart(5, '0'), to:String(i.to || '').padStart(5, '0'), title:i.title, color:i.color || suggestBlock(date).color });
      if (!b) throw new Error('from/to must be HH:MM and to must be later than from');
      const day = S.cal.days[date] || (S.cal.days[date] = { items:[] }); day.blocks = (day.blocks || []).concat([b]);
      touch('cal'); refreshCal(); log('clock', 'Блок ' + blockLabel(b) + ' на ' + dayLabel(date)); return { ok:true, id:b.id, date };
    }),
    T('update_task', 'Change a task: text, priority 0-3 (3 = urgent), note, done flag.', { id:{ type:'string' }, text:{ type:'string' }, priority:{ type:'integer', minimum:0, maximum:3 }, note:{ type:'string' }, done:{ type:'boolean' } }, ['id'], i => {
      const t = taskOrThrow(i.id).t;
      if (typeof i.text === 'string' && i.text.trim()) t.text = i.text.trim().slice(0, 500);
      if (i.priority != null) t.pri = Math.min(3, Math.max(0, i.priority | 0));
      if (typeof i.note === 'string') t.note = i.note.slice(0, 1000);
      if (typeof i.done === 'boolean') t.done = i.done;
      touch('cal'); refreshCal(); log('check', 'Обновлено: ' + t.text); return { ok:true };
    }),
    T('move_task', 'Move a task to another day (or "none" to remove the date). Optional block: id of a time block of the target day, or "none" to take the task out of its block.', { id:{ type:'string' }, date:DATE, block:{ type:'string' } }, ['id', 'date'], i => {
      const loc = taskOrThrow(i.id), date = dateArg(i.date), t = loc.t;
      const b = i.block && i.block !== 'none' ? blockOrThrow(date, i.block) : null;
      if (loc.date !== date) { loc.arr.splice(loc.i, 1); delete t.block; dayItems(date, true).push(t); pruneDays(); }
      if (b) t.block = b.id; else if (i.block === 'none') delete t.block;
      touch('cal'); refreshCal(); log('arrow', 'Перенесено на ' + dayLabel(date) + (b ? ' в блок ' + blockLabel(b) : '') + ': ' + t.text);
      return { ok:true, date };
    }),
    T('delete_task', 'Delete a task. Only when the user explicitly asks.', { id:{ type:'string' } }, ['id'], i => {
      const loc = taskOrThrow(i.id); loc.arr.splice(loc.i, 1); pruneDays(); touch('cal'); refreshCal(); log('trash', 'Удалено: ' + loc.t.text); return { ok:true };
    }),
    T('read_page', 'Read the full content of a page from "plans" or "ideas" by id.', { id:{ type:'string' } }, ['id'], i => {
      const l = findAnyNode(i.id); if (!l || l.node.type !== 'page') throw new Error('Page not found: ' + i.id);
      const n = l.node;
      return { title:n.title, markdown:window.PlanerCore.blocksToMarkdown(n.blocks),
        blocks:n.blocks.map(b => Object.assign({ type:b.t, text:b.text }, b.t === 'todo' ? { done:b.done } : {}, b.ind ? { indent:b.ind } : {}, b.emoji ? { emoji:b.emoji } : {})) };
    }),
    T('create_page', 'Create a text page in "plans" or "ideas". folder is a top-level folder title (created if missing). ' + PAGE_BLOCKS_HELP, { section:{ type:'string', enum:['plans', 'ideas'] }, folder:{ type:'string' }, title:{ type:'string' }, blocks:PAGE_BLOCK_SCHEMA }, ['section', 'title'], i => {
      const k = i.section; if (k !== 'plans' && k !== 'ideas') throw new Error('section must be plans or ideas');
      let arr = S[k].nodes;
      if (i.folder && String(i.folder).trim()) {
        const nm = String(i.folder).trim().toLowerCase();
        let f = S[k].nodes.find(n => n.type === 'folder' && n.title.trim().toLowerCase() === nm);
        if (!f) { f = { id:newId(), type:'folder', title:String(i.folder).trim().slice(0, 120), open:true, children:[] }; S[k].nodes.push(f); }
        f.open = true; arr = f.children;
      }
      const page = { id:newId(), type:'page', title:String(i.title || '').trim().slice(0, 160), blocks:toBlocks(i.blocks) };
      if (!page.blocks.length) page.blocks.push(newBlock('p'));
      arr.push(page); touch(k); refreshTree(k); log('file', 'Создана страница в «' + SECTIONS[k].title + '»: ' + (page.title || 'Без названия')); return { ok:true, id:page.id };
    }),
    T('append_to_page', 'Append blocks to the end of an existing page. ' + PAGE_BLOCKS_HELP, { id:{ type:'string' }, blocks:PAGE_BLOCK_SCHEMA }, ['id', 'blocks'], i => {
      const l = findAnyNode(i.id); if (!l || l.node.type !== 'page') throw new Error('Page not found: ' + i.id);
      const nb = toBlocks(i.blocks); const bl = l.node.blocks;
      if (bl.length === 1 && !bl[0].text) bl.length = 0;
      l.node.blocks.push(...nb); touch(l.k); refreshTree(l.k); if (editing && editing.id === i.id) editorSync();
      log('file', 'Дополнена страница: ' + (l.node.title || 'Без названия')); return { ok:true, added:nb.length };
    }),
    T('replace_page', 'Replace the whole content of an existing text page (to rewrite, restructure or tidy it up). Only when the user asks to change the page; keep everything important. ' + PAGE_BLOCKS_HELP, { id:{ type:'string' }, blocks:PAGE_BLOCK_SCHEMA }, ['id', 'blocks'], i => {
      const l = findAnyNode(i.id); if (!l || l.node.type !== 'page') throw new Error('Page not found: ' + i.id);
      const nb = toBlocks(i.blocks); if (!nb.length) throw new Error('blocks are empty');
      const old = JSON.stringify(l.node.blocks);                  // вернуть можно только эту страницу, остальное не трогается
      l.node.blocks = nb; touch(l.k); refreshTree(l.k); if (editing && editing.id === i.id) editorSync();
      log('file', 'Страница переписана: ' + (l.node.title || 'Без названия'), null, () => {
        const cur = findAnyNode(i.id); if (!cur) return;
        cur.node.blocks = JSON.parse(old); touch(cur.k); refreshTree(cur.k); if (editing && editing.id === i.id) editorSync();
      });
      return { ok:true, blocks:nb.length };
    }),
    T('read_board', 'Read all cards on the board of a page from "plans" or "ideas": notes (text), checklists (title, items), images/videos (file name, caption), sketches, links, freehand drawings (ink). Card ids are needed for look_at_image.', { pageId:{ type:'string' } }, ['pageId'], async i => {
      const p = boardPage(i.pageId);
      const cards = await boardApi.readBoard(ownerKey(p));
      log('board', 'Прочитана доска: ' + (p.title || 'Без названия') + ' (карточек: ' + cards.length + ')');
      return { page:p.title, cards };
    }),
    T('add_board_card', 'Add a card to the board of a page from "plans" or "ideas": a note (text with **bold**, "- " lists, "[ ] " checkboxes; use a short bold first line as a heading), a checklist (first line = title, every other line = item, "[x] " = done) or a link (text = URL, title optional). x/y are optional board coordinates (pixels, x to the right, y down); without them the card goes to free space without overlapping. color (note/checklist): yellow, green, blue, pink, purple or empty.', { pageId:{ type:'string' }, type:{ type:'string', enum:['note', 'checklist', 'link'] }, text:{ type:'string' }, title:{ type:'string' }, x:{ type:'number' }, y:{ type:'number' }, color:{ type:'string' } }, ['pageId', 'type', 'text'], async i => {
      const p = boardPage(i.pageId), text = String(i.text || '').trim(); if (!text) throw new Error('text is empty');
      if (i.type === 'link') {
        const it = await boardApi.addLink(ownerKey(p), text, i.title, i.x, i.y);
        log('link', 'Ссылка добавлена на доску «' + (p.title || 'Без названия') + '»: ' + it.url);
        return { ok:true, id:it.id };
      }
      const it = await boardApi.addCard(ownerKey(p), i.type === 'checklist' ? 'checklist' : 'note', text.slice(0, 8000), i.x, i.y);
      if (i.color) { try { await boardApi.updateCard(ownerKey(p), it.id, { color:String(i.color) }); } catch (e) {} }
      log('board', (it.type === 'checklist' ? 'Чек-лист' : 'Заметка') + ' добавлен' + (it.type === 'checklist' ? '' : 'а') + ' на доску «' + (p.title || 'Без названия') + '»');
      return { ok:true, id:it.id };
    }),
    T('arrange_board_cards', 'Move and/or resize cards on a page board to organize the space: group related cards, align them, leave even gaps (24 px is the usual gap), avoid overlaps. Coordinates are board pixels (x right, y down) as returned by read_board; give only the cards that change. Images and drawings keep their proportions (give w only).', { pageId:{ type:'string' }, moves:{ type:'array', maxItems:500, items:{ type:'object', properties:{ id:{ type:'string' }, x:{ type:'number' }, y:{ type:'number' }, w:{ type:'number' }, h:{ type:'number' } }, required:['id'] } } }, ['pageId', 'moves'], async i => {
      const p = boardPage(i.pageId);
      const r = await boardApi.moveCards(ownerKey(p), i.moves);
      log('board', 'Переставлено карточек на доске «' + (p.title || 'Без названия') + '»: ' + r.result.moved, null, r.changed ? r.undo : null);
      return { ok:true, moved:r.result.moved, missing:r.result.missing };
    }),
    T('tidy_board', 'Automatically lay out cards of a page board: "grid" — neat grid with even gaps, "columns" — one column per card type (notes, checklists, links, images, videos, sketches, drawings), "row" — single row. cardIds limits it to some cards (default: all).', { pageId:{ type:'string' }, layout:{ type:'string', enum:['grid', 'columns', 'row'] }, cardIds:{ type:'array', items:{ type:'string' } } }, ['pageId', 'layout'], async i => {
      const p = boardPage(i.pageId);
      const r = await boardApi.arrangeCards(ownerKey(p), i.layout, i.cardIds);
      log('board', 'Доска «' + (p.title || 'Без названия') + '» разложена ' + ({ grid:'сеткой', columns:'колонками по типу', row:'в ряд' }[i.layout] || 'сеткой'), null, r.changed ? r.undo : null);
      return { ok:true, arranged:r.result.arranged };
    }),
    T('update_board_card', 'Change a card on a page board: note text, checklist title/items, color (note/checklist: yellow, green, blue, pink, purple, "" for none), link title/url, caption of an image/video/sketch.', { pageId:{ type:'string' }, cardId:{ type:'string' }, text:{ type:'string' }, title:{ type:'string' }, items:{ type:'array', items:{ type:'object', properties:{ text:{ type:'string' }, done:{ type:'boolean' } }, required:['text'] } }, color:{ type:'string' }, url:{ type:'string' }, caption:{ type:'string' } }, ['pageId', 'cardId'], async i => {
      const p = boardPage(i.pageId);
      const r = await boardApi.updateCard(ownerKey(p), i.cardId, i);
      log('pencil', 'Изменена карточка на доске «' + (p.title || 'Без названия') + '»', null, r.changed ? r.undo : null);
      return { ok:true };
    }),
    T('remove_board_cards', 'Remove cards from a page board. ONLY when the user explicitly asks to delete or clean up specific cards.', { pageId:{ type:'string' }, ids:{ type:'array', items:{ type:'string' } } }, ['pageId', 'ids'], async i => {
      const p = boardPage(i.pageId);
      const r = await boardApi.removeCards(ownerKey(p), i.ids);
      log('trash', 'Удалено с доски «' + (p.title || 'Без названия') + '»: ' + r.result.removed, null, r.changed ? r.undo : null);
      return { ok:true, removed:r.result.removed };
    }),
    T('look_at_image', 'Look at an image, sketch or freehand drawing (ink) card from a page board (the picture is sent to you). Use ONLY when the user explicitly asks to look at, describe or analyze a picture. Get card ids from read_board.', { cardId:{ type:'string' } }, ['cardId'], async i => {
      if (!boardApi) throw new Error('Boards are not available');
      const f = await boardApi.findCard(String(i.cardId || ''));
      if (!f) throw new Error('Card not found: ' + i.cardId);
      const it = f.item;
      if (it.type !== 'image' && it.type !== 'ink' && !(it.type === 'sketch' && it.mediaId)) throw new Error('This card is not an image (type: ' + it.type + ')');
      const img = await boardApi.imageForAI(it);
      const label = it.type === 'sketch' ? 'зарисовка' : it.type === 'ink' ? 'рисунок от руки' : (it.caption || it.name || 'изображение');
      log('eye', 'Отправляю ассистенту картинку: ' + label + ' (' + img.width + '×' + img.height + ', JPEG)', it.type === 'ink' ? 'data:image/jpeg;base64,' + img.data : it.type === 'image' && it.thumb ? boardApi.thumbUrl(it.mediaId) : boardApi.mediaUrl(it.mediaId));
      return { __content:[
        { type:'image', source:{ type:'base64', media_type:img.mediaType, data:img.data } },
        { type:'text', text:'Карточка ' + it.id + ' (' + (it.type === 'sketch' ? 'зарисовка' : it.type === 'ink' ? 'рисунок от руки на доске' : 'изображение') + (it.name ? ', файл «' + it.name + '»' : '') + (it.caption ? ', подпись «' + it.caption + '»' : '') + (it.overlay ? ', поверх нарисованы пометки' : '') + ')' }
      ] };
    })
  ];
}
async function aiSend(text){
  if (aiBusy || !sample) return;
  aiBusy = true; aiChips.hidden = true;
  aiSendBtn.replaceChildren(icon('stop', 16)); aiSendBtn.setAttribute('aria-label', 'Остановить');
  addMsg('user', text);
  const bot = addMsg('bot', ''); const md = bot.querySelector('.md'); md.className = 'md thinking';
  const logEl = bot.querySelector('.acts-log');
  const msgs = aiHistory.slice(-10).concat([{ role:'user', content:buildPrompt(text) }]);
  aiCtrl = new AbortController();
  try {
    const res = await sample(msgs, {
      tools:aiTools(logEl), cache:false, modelTier:'default', signal:aiCtrl.signal,
      onText:({ text:t }) => { md.className = 'md'; md.innerHTML = mdLite(t); decorateCode(md); aiMsgs.scrollTop = aiMsgs.scrollHeight; }
    });
    md.className = 'md';
    const final = (res && res.text) || '';
    md.innerHTML = mdLite(final || (logEl.children.length ? 'Готово.' : '…'));
    decorateCode(md);
    aiHistory.push({ role:'user', content:text }, { role:'assistant', content:final || 'Готово.' });
  } catch (e) {
    md.className = 'md';
    const code = e && e.code, stopped = (aiCtrl && aiCtrl.signal.aborted) || code === 'aborted';
    const partial = e && e.text ? mdLite(e.text) : '';
    const why = stopped ? 'Остановлено.'
      : code === 'cc_login' ? 'Claude Code не выполнил вход в ваш аккаунт Claude. Войдите один раз — дальше ассистент будет работать по вашей подписке.'
      : code === 'cc_missing' ? 'Не найден Claude Code — через него ассистент работает по подписке Claude.'
      : code === 'not_granted' ? 'Нет доступа к ИИ: проверьте ключ API и повторите.'
      : code === 'rate_limited' ? (aiMode === 'claude-code' ? 'Лимит подписки Claude временно исчерпан — попробуйте позже.' : 'Слишком много запросов — подождите немного.')
      : 'Не удалось получить ответ. Попробуйте ещё раз.';
    md.innerHTML = partial + '<p><i>' + why + '</i></p>';
    if (!stopped && aiMode === 'claude-code' && code === 'unavailable' && e.message) md.append(h('p', { class:'ai-err' }, String(e.message).slice(0, 300)));
    if (!stopped && assistant && (code === 'cc_login' || code === 'cc_missing' || code === 'not_granted'))
      md.append(h('button', { class:'ai-fix', type:'button', onclick:() => assistant.openSettings() }, code === 'cc_login' ? 'Войти в Claude…' : 'Настроить подключение…'));
  } finally {
    aiBusy = false; aiCtrl = null;
    aiSendBtn.replaceChildren(icon('up', 18)); aiSendBtn.setAttribute('aria-label', 'Отправить');
    aiMsgs.scrollTop = aiMsgs.scrollHeight;
  }
}
async function initAI(){
  try { if (window.claude && window.claude.use) sample = await window.claude.use('sample'); } catch (e) { sample = null; }
  if (!sample) return;
  try { assistant = await window.claude.use('assistant'); } catch (e) { assistant = null; }
  buildAiPanel();
  if (assistant) { assistant.onState(showAiMode); assistant.get().then(showAiMode, () => {}); }
  aiBtn.append(icon('spark', 15), 'Ассистент'); aiBtn.hidden = false;
  aiBtn.addEventListener('click', () => aiPanel.classList.contains('open') ? closeAi() : openAi());
}
