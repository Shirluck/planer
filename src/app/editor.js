/* Планер — редактор текстовой страницы в стиле Notion.
   Весь документ — одно редактируемое поле (contenteditable): текст выделяется и копируется через любые блоки, Ctrl+A — весь текст.
   Блоки: текст, заголовки 1–3, задачи, маркированный и нумерованный списки, цитата, выноска, код, разделитель; отступы Tab/Shift+Tab.
   «/» — меню блоков, Markdown при вводе («# », «- », «1. », «[] », «> », «```», «---»), панель форматирования над выделенным текстом,
   ручка «⋮⋮» слева — перетащить блок или открыть меню, «+» — новый блок. Своя история отмены (Ctrl+Z / Ctrl+Shift+Z).
   Модель — блоки { id, t, text, done, ind?, emoji? }; text хранит разметку внутри строки (**жирный** и т. п., src/core.js).
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

const { parseInline, inlineToMd, mdPlain, mdEscape, blocksToMarkdown, markdownToBlocks, INDENTABLE } = window.PlanerCore;

let editing = null, overlayEl = null, boxEl = null, titleEl = null, crumbsEl = null, footProg = null;
const editNode = () => { if (!editing) return null; const l = findNode(editing.k, editing.id); return l && l.node.type === 'page' ? l.node : null; };
const NE = { undo:[], redo:[], last:null, typing:false, typingTimer:0, slash:null, pop:null, bar:null, gut:null, gutId:null, drag:null, onSel:null, body:null };

const BT = {
  p:       { label:'Текст',                icon:'text',    ph:'Введите текст или «/» для команд', keys:'текст абзац обычный text paragraph' },
  h1:      { label:'Заголовок 1',          icon:'h1',      ph:'Заголовок 1',      keys:'заголовок большой heading h1 #' },
  h2:      { label:'Заголовок 2',          icon:'h2',      ph:'Заголовок 2',      keys:'заголовок средний heading h2 ##' },
  h3:      { label:'Заголовок 3',          icon:'h3',      ph:'Заголовок 3',      keys:'заголовок малый heading h3 ###' },
  todo:    { label:'Задача',               icon:'todo',    ph:'Задача',           keys:'задача чекбокс галочка дело todo check' },
  ul:      { label:'Маркированный список', icon:'list',    ph:'Пункт списка',     keys:'список маркированный точки bullet ul' },
  ol:      { label:'Нумерованный список',  icon:'olist',   ph:'Пункт списка',     keys:'список нумерованный номер numbered ol' },
  quote:   { label:'Цитата',               icon:'quote',   ph:'Цитата',           keys:'цитата quote' },
  callout: { label:'Выноска',              icon:'callout', ph:'Важная мысль',     keys:'выноска важно внимание callout' },
  code:    { label:'Код',                  icon:'code',    ph:'Код',              keys:'код программа экспрешн expression code' },
  table: {label:'Таблица', icon:'cal', keys:'таблица table'},
  subpage: {label:'Подстраница',icon:'fileplus',keys:'страница подстраница page'},
  hr:      { label:'Разделитель',          icon:'hr',      ph:'',                 keys:'разделитель линия черта divider hr' }
};
const SLASH_TYPES = ['p', 'h1', 'h2', 'h3', 'todo', 'ul', 'ol', 'quote', 'callout', 'code', 'hr'];
const CALLOUT_EMOJI = ['💡', '📌', '⚠️', '✅', '❗', '🔥', '⭐', '🎬', '🎨', '🧠', '📅', '📎'];
const LIST_TYPES = ['ul', 'ol', 'todo'];

/* ---------- блок ↔ DOM ---------- */
function appendPlain(parent, text){ String(text).split('\n').forEach((ln, i) => { if (i) parent.append(document.createElement('br')); if (ln) parent.append(document.createTextNode(ln)); }); }
function segDom(g){
  let node = document.createDocumentFragment();
  appendPlain(node, g.text);
  const wrap = tag => { const e = document.createElement(tag); e.append(node); node = e; };
  if (g.code) wrap('code'); else { if (g.s) wrap('s'); if (g.u) wrap('u'); if (g.i) wrap('i'); if (g.b) wrap('b'); }
  if (g.href) { const a = document.createElement('a'); a.href = g.href; a.title = g.href + ' — Ctrl+щелчок, чтобы открыть'; a.append(node); node = a; }
  return node;
}
function nbDom(b){
  const el = document.createElement('div');
  el.className = 'nb'; el.dataset.id = b.id; el.dataset.t = b.t;
  el.dataset.ph = BT[b.t] ? BT[b.t].ph : '';
  if (b.ind) el.dataset.ind = String(b.ind);
  if (b.t === 'todo') el.dataset.done = String(!!b.done);
  if (b.t === 'callout') el.dataset.emoji = b.emoji || '💡';
  if (b.t === 'hr') { el.contentEditable = 'false'; el.append(document.createElement('hr')); return el; }
  if (b.t === 'code') { el.spellcheck = false; appendPlain(el, b.text); }
  else for (const g of parseInline(b.text)) el.append(segDom(g));
  if (!b.text || /\n$/.test(b.text)) el.append(document.createElement('br'));   // пустой блок и перенос в конце видны браузеру
  paintNb(el);
  return el;
}
function paintNb(el){
  el.classList.toggle('empty', el.dataset.t !== 'hr' && !plainOf(el).length);
  const ind = el.dataset.ind | 0;
  el.style.marginLeft = ind ? ind * 26 + 'px' : '';
}
// последний <br> блока ничего не показывает (нужен браузеру для пустой строки) — в текст он не входит
function lastBr(root){ let n = root.lastChild; while (n && n.nodeType === 1 && n.nodeName !== 'BR' && n.lastChild) n = n.lastChild; return n && n.nodeName === 'BR' ? n : null; }
function plainOf(root, keepLast){
  let s = '';
  const ph = keepLast ? null : lastBr(root);
  const walk = n => { for (const c of n.childNodes) { if (c.nodeType === 3) s += c.nodeValue; else if (c.nodeName === 'BR') { if (c !== ph) s += '\n'; } else if (c.nodeName !== 'HR') walk(c); } };
  walk(root);
  return s.replace(/​/g, '').replace(/ /g, ' ');
}
function segsOf(root, skipLast){
  const out = [], ph = skipLast ? lastBr(root) : null;
  const walk = (node, m) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { const t = c.nodeValue.replace(/​/g, '').replace(/ /g, ' '); if (t) out.push(Object.assign({ text:t }, m)); }
      else if (c.nodeName === 'BR') { if (c !== ph) out.push(Object.assign({ text:'\n' }, m)); }
      else if (c.nodeType === 1 && c.nodeName !== 'HR') {
        const tag = c.nodeName, m2 = Object.assign({}, m);
        if (tag === 'B' || tag === 'STRONG') m2.b = true;
        if (tag === 'I' || tag === 'EM') m2.i = true;
        if (tag === 'U') m2.u = true;
        if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') m2.s = true;
        if (tag === 'CODE') m2.code = true;
        if (tag === 'A') { const href = safeLink(c.getAttribute('href')); if (href) m2.href = href; }
        walk(c, m2);
      }
    }
  };
  walk(root, {});
  return mergeSegs(out);
}
function mergeSegs(segs){
  const out = [];
  for (const g of segs) {
    const last = out[out.length - 1];
    if (last && ['b', 'i', 'u', 's', 'code', 'href'].every(k => (last[k] || false) === (g[k] || false))) last.text += g.text;
    else out.push(Object.assign({}, g));
  }
  return out;
}
const safeLink = u => { const s = String(u || '').trim(); return /^(https?:\/\/|mailto:)[^\s<>"]+$/i.test(s) ? s : null; };
const nbText = el => el.dataset.t === 'code' ? plainOf(el) : inlineToMd(segsOf(el, true));
const joinMd = (a, b) => inlineToMd(mergeSegs(parseInline(a).concat(parseInline(b))));
const textLen = b => b.t === 'code' ? b.text.length : mdPlain(b.text).length;

/* ---------- каретка и выделение (в символах текста блока; <br> — один символ) ---------- */
const nbOf = n => { const e = n && (n.nodeType === 1 ? n : n.parentNode); const b = e && e.closest ? e.closest('.nb') : null; return b && b.parentNode === boxEl ? b : null; };
function caretIn(block, node, off){ const r = document.createRange(); r.setStart(block, 0); r.setEnd(node, off); return plainOf(r.cloneContents(), true).length; }
function pointIn(block, off){
  let left = Math.max(0, off), res = null;
  const walk = n => {
    for (const c of n.childNodes) {
      if (res) return;
      if (c.nodeType === 3) { const L = c.nodeValue.length; if (left <= L) { res = { node:c, off:left }; return; } left -= L; }
      else if (c.nodeName === 'BR') { if (left === 0) { res = { node:c.parentNode, off:[...c.parentNode.childNodes].indexOf(c) }; return; } left -= 1; }
      else if (c.nodeName !== 'HR') walk(c);
    }
  };
  walk(block);
  if (!res) { const ph = lastBr(block); res = ph ? { node:ph.parentNode, off:[...ph.parentNode.childNodes].indexOf(ph) } : { node:block, off:block.childNodes.length }; }
  return res;
}
// точка выделения → блок и смещение; у корня (после Ctrl+A) — первый или последний блок
function edgeOf(node, off, isEnd){
  if (node === boxEl) {
    const kids = boxEl.children;
    if (!kids.length) return null;
    const el = isEnd ? kids[Math.max(0, Math.min(kids.length, off) - 1)] : kids[Math.min(off, kids.length - 1)];
    return { el, off:isEnd ? plainOf(el).length : 0 };
  }
  const el = nbOf(node); if (!el) return null;
  return { el, off:caretIn(el, node, off) };
}
function selInfo(){
  const s = window.getSelection();
  if (!boxEl || !s || !s.rangeCount) return null;
  const r = s.getRangeAt(0);
  if (!boxEl.contains(r.startContainer) || !boxEl.contains(r.endContainer)) return null;
  const a = edgeOf(r.startContainer, r.startOffset, false), z = edgeOf(r.endContainer, r.endOffset, true);
  if (!a || !z) return null;
  return { r, a:a.el, ao:a.off, z:z.el, zo:z.off, collapsed:r.collapsed };
}
function setSel(aid, ao, zid, zo){
  const a = boxEl && boxEl.querySelector('.nb[data-id="' + aid + '"]'); if (!a) return;
  const z = (zid && boxEl.querySelector('.nb[data-id="' + zid + '"]')) || a;
  if (a.dataset.t === 'hr') { const s = window.getSelection(); s.removeAllRanges(); boxEl.focus({ preventScroll:true }); return; }
  const p = pointIn(a, ao), q = zid ? pointIn(z, zo) : p;
  const r = document.createRange(); r.setStart(p.node, p.off); r.setEnd(q.node, q.off);
  if (document.activeElement !== boxEl) boxEl.focus({ preventScroll:true });
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  const rect = a.getBoundingClientRect(), body = NE.body && NE.body.getBoundingClientRect();
  if (body && (rect.bottom > body.bottom || rect.top < body.top)) a.scrollIntoView({ block:'nearest' });
}
const setCaret = (id, off) => setSel(id, off);
const caretState = () => { const si = selInfo(); return si ? { id:si.a.dataset.id, off:si.ao } : null; };
// половины блока до и после точки — с разметкой
function splitMd(el, off){
  const p = pointIn(el, off);
  const r1 = document.createRange(); r1.setStart(el, 0); r1.setEnd(p.node, p.off);
  const r2 = document.createRange(); r2.setStart(p.node, p.off); r2.setEnd(el, el.childNodes.length);
  if (el.dataset.t === 'code') return [plainOf(r1.cloneContents(), true), plainOf(r2.cloneContents())];
  return [inlineToMd(segsOf(r1.cloneContents(), false)), inlineToMd(segsOf(r2.cloneContents(), true))];
}

/* ---------- модель ↔ DOM, история ---------- */
const blocksOf = () => editNode().blocks;
const blockById = id => blocksOf().find(b => b.id === id);
const idxOf = id => blocksOf().findIndex(b => b.id === id);
const stateNow = () => ({ blocks:JSON.stringify(editNode().blocks), caret:caretState() });
function render(){
  const n = editNode(); if (!n || !boxEl) return;
  if (!n.blocks.length) n.blocks.push(newBlock('p'));
  boxEl.replaceChildren(...n.blocks.map(nbDom));
  numberLists(); paintFoot(); markCurrent();
}
function numberLists(){
  let num = [];
  for (const el of boxEl.children) {
    const ind = el.dataset.ind | 0;
    if (el.dataset.t === 'ol') { num = num.slice(0, ind + 1); num[ind] = (num[ind] || 0) + 1; el.dataset.num = num[ind] + '.'; }
    else num = num.slice(0, ind);
  }
}
// содержимое поля → блоки модели (после обычного ввода браузером)
function syncDom(){
  const n = editNode(); if (!n || !boxEl) return;
  for (const c of [...boxEl.childNodes]) {                 // всё, что не блок, становится текстовым блоком
    if (c.nodeType === 1 && c.classList.contains('nb')) { c.querySelectorAll('div, p').forEach(x => x.replaceWith(...x.childNodes)); continue; }
    if (c.nodeType === 3 && !c.nodeValue.replace(/[\s​]/g, '')) { c.remove(); continue; }
    const el = nbDom({ id:newId(), t:'p', text:'' }); el.replaceChildren(); c.replaceWith(el); el.append(c);
  }
  const seen = new Set();
  const out = [...boxEl.children].map(el => {
    let id = el.dataset.id;
    if (!id || seen.has(id)) { id = newId(); el.dataset.id = id; }
    seen.add(id);
    const t = BT[el.dataset.t] ? el.dataset.t : 'p'; el.dataset.t = t;
    const b = { id, t, text:t === 'hr' ? '' : nbText(el), done:t === 'todo' && el.dataset.done === 'true' };
    const ind = el.dataset.ind | 0; if (ind && INDENTABLE.includes(t)) b.ind = ind;
    if (t === 'callout') b.emoji = el.dataset.emoji || '💡';
    paintNb(el);
    return b;
  });
  if (!out.length) { n.blocks = [newBlock('p')]; render(); setCaret(n.blocks[0].id, 0); }
  else n.blocks = out;
  touch(editing.k); numberLists(); paintFoot();
}
function pushUndo(st){ if (!st) return; NE.undo.push(st); if (NE.undo.length > 300) NE.undo.shift(); NE.redo.length = 0; }
function endTyping(){ clearTimeout(NE.typingTimer); NE.typing = false; }
// структурное изменение: модель уже изменена → перерисовать, каретка, запись в историю
function commit(before, caret){
  endTyping();
  touch(editing.k); render();
  if (caret) setSel(caret.id, caret.off, caret.zid, caret.zoff);
  pushUndo(before);
  NE.last = stateNow();
}
function restoreState(st){
  const n = editNode(); if (!n) return;
  n.blocks = JSON.parse(st.blocks); touch(editing.k); render();
  if (st.caret && blockById(st.caret.id)) setCaret(st.caret.id, st.caret.off);
  NE.last = stateNow();
}
function undo(){ endTyping(); if (!NE.undo.length) return; NE.redo.push(stateNow()); restoreState(NE.undo.pop()); closePops(); }
function redo(){ endTyping(); if (!NE.redo.length) return; NE.undo.push(stateNow()); restoreState(NE.redo.pop()); closePops(); }

/* ---------- структурные действия ---------- */
function insertAfter(id, b){ const bl = blocksOf(), i = bl.findIndex(x => x.id === id); bl.splice(i + 1, 0, b); return b; }
function nb(t, text, extra){ return Object.assign(newBlock(t, text || ''), extra || {}); }
function doEnter(si){
  const before = NE.last;
  if (si.a !== si.z) { replaceSelection(si, ''); si = selInfo(); if (!si) return; }
  else if (!si.collapsed) { document.execCommand('delete'); syncDom(); si = selInfo(); if (!si) return; }
  const el = si.a, b = blockById(el.dataset.id); if (!b) return;
  if (b.t === 'hr') { const p = insertAfter(b.id, nb('p')); commit(before, { id:p.id, off:0 }); return; }
  const plain = plainOf(el);
  if (LIST_TYPES.includes(b.t) && !plain.trim()) {               // пустой пункт списка: выйти из списка
    if (b.ind) b.ind--; else { b.t = 'p'; b.done = false; }
    commit(before, { id:b.id, off:0 }); return;
  }
  const keepType = LIST_TYPES.includes(b.t) ? b.t : 'p';
  const extra = (LIST_TYPES.includes(b.t) || b.t === 'p') && b.ind ? { ind:b.ind } : {};
  if (si.ao === 0 && plain.length) {                              // в начале непустого блока — пустой блок выше
    const bl = blocksOf(); bl.splice(bl.indexOf(b), 0, nb(b.t === 'todo' || b.t === 'ul' || b.t === 'ol' ? b.t : 'p', '', extra));
    commit(before, { id:b.id, off:0 }); return;
  }
  const [left, right] = splitMd(el, si.ao);
  b.text = left;
  const nxt = insertAfter(b.id, nb(keepType, b.t === 'code' ? mdEscape(right) : right, extra));
  commit(before, { id:nxt.id, off:0 });
}
function backspaceAtStart(b){
  const before = NE.last, bl = blocksOf(), i = bl.indexOf(b);
  if (b.t !== 'p') {                                              // сначала блок становится обычным текстом
    if (b.ind) b.ind--; else { const keep = b.t === 'code' ? mdEscape(b.text) : b.text; b.t = 'p'; b.text = keep; b.done = false; delete b.emoji; }
    commit(before, { id:b.id, off:0 }); return;
  }
  if (b.ind) { b.ind--; commit(before, { id:b.id, off:0 }); return; }
  if (i <= 0) return;
  const prev = bl[i - 1];
  if (prev.t === 'hr') { bl.splice(i - 1, 1); commit(before, { id:b.id, off:0 }); return; }
  const off = textLen(prev);
  prev.text = prev.t === 'code' ? prev.text + mdPlain(b.text) : joinMd(prev.text, b.text);
  bl.splice(i, 1);
  commit(before, { id:prev.id, off });
}
function deleteAtEnd(b){
  const before = NE.last, bl = blocksOf(), i = bl.indexOf(b), next = bl[i + 1];
  if (!next) return;
  const off = textLen(b);
  if (next.t === 'hr') bl.splice(i + 1, 1);
  else { b.text = b.t === 'code' ? b.text + mdPlain(next.text) : joinMd(b.text, next.t === 'code' ? mdEscape(next.text) : next.text); bl.splice(i + 1, 1); }
  commit(before, { id:b.id, off });
}
// выделение через несколько блоков заменяется текстом (или удаляется): блоки между ними исчезают
function replaceSelection(si, text){
  const before = NE.last, bl = blocksOf();
  const A = blockById(si.a.dataset.id), Z = blockById(si.z.dataset.id); if (!A || !Z) return;
  const left = A.t === 'hr' ? '' : splitMd(si.a, si.ao)[0], right = Z.t === 'hr' ? '' : splitMd(si.z, si.zo)[1];
  const ins = A.t === 'code' ? text : mdEscape(text);
  const ia = bl.indexOf(A), iz = bl.indexOf(Z);
  if (A.t === 'hr') { A.t = 'p'; A.done = false; }
  A.text = A.t === 'code' ? left + ins + (Z.t === 'code' ? right : mdPlain(right)) : joinMd(joinMd(left, ins), Z.t === 'code' ? mdEscape(right) : right);
  bl.splice(ia + 1, iz - ia);
  const off = (A.t === 'code' ? left.length : mdPlain(left).length) + text.length;
  commit(before, { id:A.id, off });
}
function setType(b, t, keepCaret){
  const before = NE.last, c = caretState();
  if (t === 'code' && b.t !== 'code') b.text = mdPlain(b.text);
  else if (b.t === 'code' && t !== 'code') b.text = mdEscape(b.text);
  b.t = t;
  if (t !== 'todo') b.done = false;
  if (!INDENTABLE.includes(t)) delete b.ind;
  if (t === 'callout') b.emoji = b.emoji || '💡'; else delete b.emoji;
  if (t === 'hr') { b.text = ''; const p = insertAfter(b.id, nb('p')); commit(before, { id:p.id, off:0 }); return; }
  commit(before, keepCaret && c && c.id === b.id ? c : { id:b.id, off:textLen(b) });
}
function indentSel(si, d){
  const before = NE.last, bl = blocksOf(), ia = idxOf(si.a.dataset.id), iz = idxOf(si.z.dataset.id);
  let changed = false;
  for (let i = ia; i <= iz; i++) {
    const b = bl[i]; if (!INDENTABLE.includes(b.t)) continue;
    const max = i ? Math.min(6, (bl[i - 1].ind || 0) + 1) : 0;
    const v = Math.max(0, Math.min(d > 0 ? max : 6, (b.ind || 0) + d));
    if (v !== (b.ind || 0)) { if (v) b.ind = v; else delete b.ind; changed = true; }
  }
  if (changed) commit(before, { id:si.a.dataset.id, off:si.ao, zid:si.z.dataset.id, zoff:si.zo });
}
function moveBlocks(si, d){
  const before = NE.last, bl = blocksOf(), ia = idxOf(si.a.dataset.id), iz = idxOf(si.z.dataset.id);
  if ((d < 0 && ia === 0) || (d > 0 && iz === bl.length - 1)) return;
  const part = bl.splice(ia, iz - ia + 1);
  bl.splice(ia + d, 0, ...part);
  commit(before, { id:si.a.dataset.id, off:si.ao, zid:si.z.dataset.id, zoff:si.zo });
}
function duplicateBlock(b){
  const before = NE.last, copy = JSON.parse(JSON.stringify(b)); copy.id = newId();
  insertAfter(b.id, copy);
  commit(before, { id:copy.id, off:textLen(copy) });
}
function neDeleteBlock(b){
  const before = NE.last, bl = blocksOf(), i = bl.indexOf(b);
  bl.splice(i, 1);
  if (!bl.length) bl.push(nb('p'));
  const t = bl[Math.max(0, i - 1)];
  commit(before, { id:t.id, off:textLen(t) });
}
function toggleTodo(b){ const before = NE.last; b.done = !b.done; commit(before, caretState()); }

/* ---------- Markdown при вводе: «# », «- », «1. », «[] », «> », «```», «---» ---------- */
function markdownShortcut(si){
  const el = si.a, b = blockById(el.dataset.id);
  if (!b || b.t !== 'p') return false;
  const head = plainOf(el).slice(0, si.ao);
  const rules = [[/^#\s$/, 'h1'], [/^##\s$/, 'h2'], [/^###\s$/, 'h3'], [/^[-*•]\s$/, 'ul'], [/^\d+[.)]\s$/, 'ol'], [/^\[ ?\]\s$/, 'todo'], [/^\[[xхXХ]\]\s$/, 'done'], [/^>\s$/, 'quote'], [/^```\s?$/, 'code']];
  const hit = rules.find(([re]) => re.test(head)); if (!hit) return false;
  const before = NE.last;
  const rest = splitMd(el, si.ao)[1];
  const t = hit[1] === 'done' ? 'todo' : hit[1];
  b.t = t; b.text = t === 'code' ? mdPlain(rest) : rest; b.done = hit[1] === 'done';
  if (!INDENTABLE.includes(t)) delete b.ind;
  commit(before, { id:b.id, off:0 });
  return true;
}
function dividerShortcut(si){
  const el = si.a, b = blockById(el.dataset.id);
  if (!b || b.t !== 'p' || plainOf(el) !== '---') return false;
  const before = NE.last;
  b.t = 'hr'; b.text = ''; delete b.ind;
  const p = insertAfter(b.id, nb('p'));
  commit(before, { id:p.id, off:0 });
  return true;
}

/* ---------- всплывающие окна: «/»-меню, панель форматирования, ссылка, эмодзи ---------- */
function closePops(){ closeSlash(); hideBar(); if (NE.pop) { NE.pop.remove(); NE.pop = null; } }
function placeNear(el, rect, above){
  document.body.append(el);
  const w = el.offsetWidth, hh = el.offsetHeight;
  let x = Math.min(Math.max(8, rect.left), innerWidth - w - 8);
  let y = above ? rect.top - hh - 8 : rect.bottom + 6;
  if (!above && y + hh > innerHeight - 8) y = Math.max(8, rect.top - hh - 6);
  if (above && y < 8) y = rect.bottom + 8;
  el.style.left = x + 'px'; el.style.top = y + 'px';
}
function caretRect(si){
  const r = si.r.cloneRange(); r.collapse(true);
  const rects = r.getClientRects();
  return rects.length ? rects[0] : si.a.getBoundingClientRect();
}
function openSlash(blockId, at){
  closeSlash(); hideBar();
  NE.slash = { id:blockId, at, q:'', i:0, items:SLASH_TYPES.slice(), el:h('div', { class:'menu ne-slash', role:'listbox', 'aria-label':'Блоки' }) };
  paintSlash();
}
function paintSlash(){
  const S = NE.slash; if (!S) return;
  const si = selInfo();
  const q = window.PlanerCore.normSearch(S.q.trim());
  S.items = [...SLASH_TYPES,'table','subpage'].filter(t => !q || q.split(/\s+/).every(w => window.PlanerCore.normSearch(BT[t].label + ' ' + BT[t].keys).includes(w)));

  S.i = Math.min(S.i, Math.max(0, S.items.length - 1));
  S.el.replaceChildren(h('div', { class:'ne-slash-cap' }, S.q ? 'Поиск · ' + S.q + (S.items.length ? '' : ' · Нет блоков') : 'Основные блоки · введите название'),
    ...S.items.map((t, i) => h('button', { type:'button', class:'menu-it' + (i === S.i ? ' on' : ''), role:'option', 'aria-selected':String(i === S.i), 'data-t':t,
      onmousedown:e => e.preventDefault(), onclick:() => chooseSlash(t) }, icon(BT[t].icon, 16), BT[t].label, h('kbd', { class:'ne-keyhint' }, ({h1:'#',h2:'##',h3:'###',ul:'-',ol:'1.',todo:'[]',quote:'>',hr:'---'})[t] || ''))));
  if (!S.el.isConnected) placeNear(S.el, si ? caretRect(si) : boxEl.getBoundingClientRect(), false);
  const on = S.el.querySelector('.on'); if (on) on.scrollIntoView({ block:'nearest' });
}
function closeSlash(){ if (NE.slash) { NE.slash.el.remove(); NE.slash = null; } }
function slashFollow(){
  const S = NE.slash; if (!S) return;
  const si = selInfo();
  if (!si || !si.collapsed || si.a.dataset.id !== S.id) { closeSlash(); return; }
  if (S.at >= 0) {
    const plain = plainOf(si.a);
    if (si.ao <= S.at || plain[S.at] !== '/') { closeSlash(); return; }
    S.q = plain.slice(S.at + 1, si.ao);
    if (S.q.length > 30 || /\s{2}|\n/.test(S.q)) { closeSlash(); return; }
  }
  paintSlash();
}
function chooseSlash(t){
  const S = NE.slash; if (!S) return;
  closeSlash();
  const el = boxEl.querySelector('.nb[data-id="' + S.id + '"]'); if (!el) return;
  if (S.at >= 0) {                                                 // убрать «/запрос» из текста
    const si = selInfo(), end = si && si.a === el ? si.ao : S.at + 1 + S.q.length;
    const p = pointIn(el, S.at), q = pointIn(el, end);
    const r = document.createRange(); r.setStart(p.node, p.off); r.setEnd(q.node, q.off); r.deleteContents();
    syncDom(); NE.last = stateNow();
  }
  if(t==='table'){neInsertTable();return;}
  if(t==='subpage'){neInsertPage();return;}
  const b = blockById(S.id); if (!b) return;
  if (!plainOf(el).trim() || b.t === 'hr') setType(b, t);
  else {
    const before = NE.last;
    if (t === 'hr') { const hr = insertAfter(b.id, nb('hr')); const p = insertAfter(hr.id, nb('p')); commit(before, { id:p.id, off:0 }); }
    else { const n2 = insertAfter(b.id, nb(t)); commit(before, { id:n2.id, off:0 }); }
  }
}
function slashKeys(e){
  const S = NE.slash; if (!S) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.i = (S.i + (e.key === 'ArrowDown' ? 1 : -1) + S.items.length) % Math.max(1, S.items.length); paintSlash(); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { if (S.items.length) { e.preventDefault(); chooseSlash(S.items[S.i]); return true; } }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSlash(); return true; }
  return false;
}
// панель над выделенным текстом
function showBar(si){
  if (!NE.bar) {
    const b = (ic, label, run) => h('button', { type:'button', class:'tool', 'aria-label':label, title:label, onmousedown:e => e.preventDefault(), onclick:run }, icon(ic, 16));
    NE.bar = h('div', { class:'menu ne-bar', role:'toolbar', 'aria-label':'Форматирование' },
      b('olist','Пронумеровать выделенные абзацы', () => {
        const range=selInfo(); if(!range) return;
        const before=stateNow(), blocks=blocksOf();
        const first=blocks.findIndex(b=>b.id===range.a.dataset.id), last=blocks.findIndex(b=>b.id===range.z.dataset.id);
        for(const b of blocks.slice(first,last+1)){
          if(b.t==='hr')continue;
          if(b.t==='code') b.text=mdEscape(b.text);
          b.t='ol';b.done=false;delete b.emoji;
        }
        commit(before,{id:range.a.dataset.id,off:range.ao,zid:range.z.dataset.id,zoff:range.zo});
      }), b('bold', 'Жирный (Ctrl+B)', () => fmt('bold')), b('italic', 'Курсив (Ctrl+I)', () => fmt('italic')),
      b('underline', 'Подчёркнутый (Ctrl+U)', () => fmt('underline')), b('strike', 'Зачёркнутый (Ctrl+Shift+S)', () => fmt('strikeThrough')),
      b('code', 'Код (Ctrl+E)', () => toggleCode()), b('link', 'Ссылка (Ctrl+K)', () => linkPrompt()),
      h('span', { class:'bd-tsep' }), b('clear', 'Убрать оформление', () => fmt('clear')));
  }
  const rect = si.r.getBoundingClientRect();
  if (!rect.width && !rect.height) { hideBar(); return; }
  placeNear(NE.bar, rect, true);
}
function hideBar(){ if (NE.bar && NE.bar.isConnected) NE.bar.remove(); }
function fmt(cmd){
  const si = selInfo(); if (!si || si.collapsed) return;
  if ([si.a, si.z].some(el => el.dataset.t === 'code')) { toast('В блоке кода форматирование не используется.'); return; }
  const before = NE.last;
  if (cmd === 'clear') { document.execCommand('removeFormat'); document.execCommand('unlink'); }
  else document.execCommand(cmd);
  syncDom(); pushUndo(before); NE.last = stateNow();
  const s2 = selInfo(); if (s2 && !s2.collapsed) showBar(s2);
}
function toggleCode(){
  const si = selInfo(); if (!si || si.collapsed || si.a !== si.z || si.a.dataset.t === 'code') return;
  const before = NE.last, r = si.r;
  const inCode = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer.closest('code') : r.commonAncestorContainer.parentNode.closest('code');
  if (inCode) inCode.replaceWith(...inCode.childNodes);
  else { const text = plainOf(r.cloneContents(), true); r.deleteContents(); const c = document.createElement('code'); c.textContent = text; r.insertNode(c); }
  const id = si.a.dataset.id, ao = si.ao, zo = si.zo;
  syncDom(); render(); setSel(id, ao, id, zo); pushUndo(before); NE.last = stateNow();
}
function linkPrompt(){
  const si = selInfo(); if (!si || si.collapsed) { toast('Выделите текст, который станет ссылкой.'); return; }
  const saved = { id:si.a.dataset.id, ao:si.ao, zid:si.z.dataset.id, zo:si.zo }, rect = si.r.getBoundingClientRect();
  hideBar();
  const inp = h('input', { type:'text', class:'tm-in ne-link-in', placeholder:'https://…', 'aria-label':'Адрес ссылки' });
  const err = h('div', { class:'tm-err' });
  const done = () => { if (NE.pop) { NE.pop.remove(); NE.pop = null; } };
  const apply = () => {
    let u = inp.value.trim();
    if (u && !/^[a-z]+:/i.test(u) && /\.[a-zа-я]{2,}/i.test(u)) u = 'https://' + u;
    const href = safeLink(u);
    if (!href) { err.textContent = 'Нужен адрес вида https://…'; return; }
    done(); setSel(saved.id, saved.ao, saved.zid, saved.zo);
    const before = NE.last; document.execCommand('createLink', false, href); syncDom(); pushUndo(before); NE.last = stateNow();
  };
  NE.pop = h('form', { class:'menu ne-link', onsubmit:e => { e.preventDefault(); apply(); } }, inp, h('button', { type:'submit', class:'tb-btn primary' }, 'ОК'), err);
  inp.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); setSel(saved.id, saved.ao, saved.zid, saved.zo); } });
  placeNear(NE.pop, rect, false);
  inp.focus();
}
function emojiMenu(b, el){
  const before = NE.last;
  if (NE.pop) NE.pop.remove();
  NE.pop = h('div', { class:'menu ne-emoji', role:'listbox', 'aria-label':'Значок выноски' }, CALLOUT_EMOJI.map(em => h('button', { type:'button', class:'ne-em', onclick:() => {
    if (NE.pop) { NE.pop.remove(); NE.pop = null; }
    b.emoji = em; commit(before, { id:b.id, off:textLen(b) });
  } }, em)));
  placeNear(NE.pop, el.getBoundingClientRect(), false);
}

/* ---------- ручка блока: перетаскивание и меню, «+» ---------- */
function gutterAt(el){
  if (!NE.gut) return;
  if (!el || NE.drag) { if (!NE.drag) NE.gut.hidden = true; return; }
  NE.gutId = el.dataset.id;
  NE.gut.hidden = false;
  const lh = el.dataset.t === 'h1' ? 14 : el.dataset.t === 'h2' ? 9 : el.dataset.t === 'h3' ? 5 : el.dataset.t === 'hr' ? -2 : 1;
  NE.gut.style.top = (el.offsetTop + lh) + 'px';
  NE.gut.style.left = (boxEl.offsetLeft - 54 + (el.dataset.ind | 0) * 26) + 'px';
}
function neBlockMenu(anchor, b){
  const run = f => () => { closeMenu(); f(); };
  openMenu(anchor, [
    ...SLASH_TYPES.filter(t => t !== b.t).map(t => ({ icon:BT[t].icon, label:'Превратить: ' + BT[t].label.toLowerCase(), run:run(() => setType(blockById(b.id), t)) })),
    { sep:true },
    { icon:'dup', label:'Дублировать (Ctrl+D)', run:run(() => duplicateBlock(blockById(b.id))) },
    { icon:'up', label:'Выше (Alt+↑)', run:run(() => { const el = boxEl.querySelector('.nb[data-id="' + b.id + '"]'); moveBlocks({ a:el, z:el, ao:0, zo:0 }, -1); }) },
    { icon:'down', label:'Ниже (Alt+↓)', run:run(() => { const el = boxEl.querySelector('.nb[data-id="' + b.id + '"]'); moveBlocks({ a:el, z:el, ao:0, zo:0 }, 1); }) },
    { sep:true },
    { icon:'trash', danger:true, label:'Удалить блок', run:run(() => neDeleteBlock(blockById(b.id))) }
  ]);
}
function startBlockDrag(e){
  const id = NE.gutId, b = id && blockById(id); if (!b) return;
  e.preventDefault();
  const sy = e.clientY, handle = e.currentTarget;
  let moved = false, target = null;
  const line = h('div', { class:'ne-drop' });
  const move = ev => {
    if (!moved && Math.abs(ev.clientY - sy) < 4) return;
    if (!moved) { moved = true; NE.drag = { id }; boxEl.querySelector('.nb[data-id="' + id + '"]').classList.add('ne-dragging'); NE.body.append(line); }
    const kids = [...boxEl.children];
    let at = kids.length;
    for (let i = 0; i < kids.length; i++) { const r = kids[i].getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { at = i; break; } }
    target = at;
    const ref = kids[at] || kids[kids.length - 1];
    line.style.top = (at < kids.length ? ref.offsetTop - 2 : ref.offsetTop + ref.offsetHeight + 1) + 'px';
    line.style.left = boxEl.offsetLeft + 'px'; line.style.width = boxEl.offsetWidth + 'px';
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    line.remove(); NE.drag = null;
    const el = boxEl.querySelector('.nb[data-id="' + id + '"]'); if (el) el.classList.remove('ne-dragging');
    if (!moved) { neBlockMenu(handle, b); return; }
    const bl = blocksOf(), from = bl.indexOf(b);
    if (target == null || target === from || target === from + 1) return;
    const before = NE.last;
    bl.splice(from, 1); bl.splice(target > from ? target - 1 : target, 0, b);
    commit(before, { id:b.id, off:textLen(b) });
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
function plusBlock(){
  const id = NE.gutId, b = id && blockById(id); if (!b) return;
  const before = NE.last;
  const el = boxEl.querySelector('.nb[data-id="' + id + '"]');
  const target = b.t === 'p' && el && !plainOf(el) ? b : insertAfter(b.id, nb('p'));
  if (target !== b) commit(before, { id:target.id, off:0 }); else setCaret(b.id, 0);
  openSlash(target.id, -1);
}

/* ---------- открытие и закрытие ---------- */
function openPage(k, id, opts = {}){
  const loc = findNode(k, id); if (!loc || loc.node.type !== 'page') return;
  closeEditor(true); closeMenu();
  editing = { k, id };
  const n = loc.node; if (!n.blocks.length) n.blocks.push(newBlock('p'));
  NE.undo = []; NE.redo = []; endTyping();
  titleEl = h('input', { class:'title-in', type:'text', placeholder:'Без названия', 'aria-label':'Название страницы', maxlength:'160' });
  titleEl.value = n.title;
  titleEl.addEventListener('input', () => { const nn = editNode(); if (nn) { nn.title = titleEl.value; touch(editing.k); } });
  titleEl.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === 'ArrowDown') && !e.isComposing) { e.preventDefault(); const f = blocksOf()[0]; setCaret(f.id, 0); }
  });
  boxEl = h('div', { class:'ne', contenteditable:'true', spellcheck:'true', role:'textbox', 'aria-multiline':'true', 'aria-label':'Текст страницы' });
  crumbsEl = h('div', { class:'crumbs' });
  footProg = h('span');
  NE.gut = h('div', { class:'ne-gut', hidden:true },
    h('button', { type:'button', class:'ne-gb', title:'Новый блок ниже', 'aria-label':'Новый блок ниже', onmousedown:e => e.preventDefault(), onclick:() => plusBlock() }, icon('plus', 16)),
    h('button', { type:'button', class:'ne-gb ne-grip', title:'Перетащите, чтобы переместить; щелчок — меню блока', 'aria-label':'Блок: переместить или изменить', onpointerdown:startBlockDrag }, icon('grip', 15)));
  const outline = tool('olist', 'Оглавление страницы', () => {
    const headings = [...boxEl.querySelectorAll('.nb')].filter(el => /^h[123]$/.test(el.dataset.t));
    if (!headings.length) { toast('Добавьте заголовок через /, чтобы он появился в оглавлении'); return; }
    openMenu(outline, headings.map(el => ({ icon:el.dataset.t, label:plainOf(el) || 'Без названия', run:() => {
      boxEl.focus(); setCaret(el.dataset.id, 0); el.scrollIntoView({ block:'center' });
    }})));
  });
  const more = tool('more', 'Действия со страницей', () => { const nn = editNode(); if (!nn) return; const other = editing.k === 'plans' ? 'ideas' : 'plans';
    openMenu(more, [
      { icon:'copy', label:'Копировать как Markdown', run:() => copyMarkdown() },
      { icon:'board', label:'Сделать доской', run:() => setFileKind(editing.k, editing.id, 'board') },
      nn.boardCount ? { icon:'board', label:'Открыть прежнюю доску (' + nn.boardCount + ')', run:() => openNodeBoard(editing.k, editing.id) } : null,
      { icon:'arrow', label:'Перенести в «' + SECTIONS[other].title + '»', run:() => moveNode(editing.k, editing.id, other) },
      { sep:true },
      { icon:'trash', danger:true, label:'Удалить документ', run:() => deleteNode(editing.k, editing.id) }
    ]); });
  const inserts = tool('plus','Добавить таблицу или подстраницу',()=>openMenu(inserts,[
    {icon:'cal',label:'Таблица',run:()=>neInsertTable()},
    {icon:'fileplus',label:'Подстраница',run:()=>neInsertPage()}
  ]));
  NE.extras=h('div',{class:'ne-extras'});
  NE.body = h('div', { class:'sheet-body ne-body' }, titleEl, boxEl, NE.extras, h('div', { class:'pad', onclick:padClick }), NE.gut);
  overlayEl = h('div', { class:'overlay', onmousedown:e => { if (e.target === overlayEl) closeEditor(); } },
    h('div', { class:'sheet ne-sheet', 'data-key':k, role:'dialog', 'aria-modal':'true', 'aria-label':'Редактор страницы' },
      h('div', { class:'sheet-top' }, crumbsEl, h('div', { class:'col-tools' }, inserts, outline, more, tool('x', 'Закрыть', () => closeEditor()))),
      NE.body,
      h('div', { class:'sheet-foot' },
        h('span', {}, h('kbd', {}, '/'), ' — блоки · ', h('kbd', {}, '# '), h('kbd', {}, '- '), h('kbd', {}, '1. '), h('kbd', {}, '[] '), h('kbd', {}, '> '), ' — как в Markdown · ',
          h('kbd', {}, 'Tab'), ' — отступ · выделите текст — форматирование'),
        footProg)));
  document.body.append(overlayEl);
  setupEditorEvents();
  render(); paintCrumbs();
  NE.last = stateNow();
  if (opts.focusTitle) titleEl.focus();
}
function paintCrumbs(){
  nePaintExtras();
  const loc = editNode() && findNode(editing.k, editing.id); if (!loc) return;
  const column=loc.path.find(n=>n.column);
  overlayEl.querySelector('.sheet').style.setProperty('--accent',column && layoutPrefs[column.id]?.color || 'var(--c-'+editing.k+')');
  crumbsEl.replaceChildren(h('b', {}, SECTIONS[editing.k].title), ...loc.path.flatMap(p => [h('span', {}, '›'), p.type==='page'?h('button',{class:'tb-btn',onclick:()=>openPage(editing.k,p.id)},p.title || 'Без названия'):h('span', {}, p.title || 'Без названия')]));
}
function closeEditor(silent){
  if (!overlayEl) return;
  const k = editing && editing.k;
  if (boxEl && editNode()) syncDom();
  closePops();
  if (NE.onSel) { document.removeEventListener('selectionchange', NE.onSel); NE.onSel = null; }
  overlayEl.remove(); overlayEl = boxEl = titleEl = crumbsEl = footProg = null; editing = null; NE.gut = null; NE.body = null;
  if (!silent && k) refreshTree(k);
}
// изменения со стороны (ассистент, восстановление): перерисовать, сохранив каретку
function editorSync(){
  if (!overlayEl) return;
  const n = editNode(); if (!n) { closeEditor(); return; }
  if (document.activeElement !== titleEl) titleEl.value = n.title;
  const c = caretState();
  render(); paintCrumbs();
  if (c && blockById(c.id)) setCaret(c.id, c.off);
  NE.last = stateNow();
}
function padClick(){
  const n = editNode(); if (!n) return;
  const last = n.blocks[n.blocks.length - 1];
  if (last && last.t === 'p' && !last.text) { setCaret(last.id, 0); return; }
  const before = NE.last, p = nb('p'); n.blocks.push(p); commit(before, { id:p.id, off:0 });
}
function paintFoot(){
  const n = editNode(); if (!n || !footProg) return;
  const t = n.blocks.filter(b => b.t === 'todo'), d = t.filter(b => b.done).length;
  footProg.textContent = t.length ? 'Выполнено: ' + d + ' из ' + t.length : '';
}
// блок с кареткой — для подсказки «/» в пустой строке
function markCurrent(){
  if (!boxEl) return;
  const si = selInfo();
  boxEl.querySelectorAll('.nb.cur').forEach(x => { if (!si || x !== si.a) x.classList.remove('cur'); });
  if (si && si.collapsed) si.a.classList.add('cur');
}
async function copyMarkdown(){
  const n = editNode(); if (!n) return;
  const md = (n.title ? '# ' + n.title + '\n\n' : '') + blocksToMarkdown(n.blocks);
  const ok = window.electronAPI && window.electronAPI.clipWriteText ? await window.electronAPI.clipWriteText(md) : false;
  toast(ok ? 'Страница скопирована как Markdown' : 'Не удалось скопировать.');
}
// найти и выделить слово (поиск по всему)
function editorReveal(tokens){
  const n = editNode(); if (!n || !tokens.length) return;
  const norm = window.PlanerCore.normSearch;
  for (const b of n.blocks) {
    const plain = b.t === 'code' ? b.text : mdPlain(b.text), t = tokens.find(x => norm(plain).includes(x));
    if (t) { const p = norm(plain).indexOf(t); setSel(b.id, p, b.id, p + t.length); return; }
  }
}

/* ---------- события поля ---------- */
function setupEditorEvents(){
  boxEl.addEventListener('beforeinput', e => {
    const t = e.inputType;
    if (t === 'historyUndo') { e.preventDefault(); undo(); return; }
    if (t === 'historyRedo') { e.preventDefault(); redo(); return; }
    if (t === 'insertFromDrop' || t === 'deleteByDrag' || t === 'insertFromYank') { e.preventDefault(); return; }
    const si = selInfo(); if (!si) return;
    if (t === 'insertParagraph') { e.preventDefault(); doEnter(si); return; }
    if (si.a !== si.z && /^(delete|insertText|insertReplacementText|insertLineBreak)/.test(t)) {
      e.preventDefault(); replaceSelection(si, t === 'insertLineBreak' ? '\n' : t.startsWith('insert') ? (e.data || '') : ''); return;
    }
    const b = blockById(si.a.dataset.id); if (!b) return;
    if (si.collapsed && /^delete(Content|Word|SoftLine|HardLine)Backward$/.test(t) && si.ao === 0) { e.preventDefault(); backspaceAtStart(b); return; }
    if (si.collapsed && /^delete(Content|Word|SoftLine|HardLine)Forward$/.test(t) && si.ao >= plainOf(si.a).length) { e.preventDefault(); deleteAtEnd(b); return; }
  });
  boxEl.addEventListener('input', e => {
    if (!NE.typing) pushUndo(NE.last);
    NE.typing = true; clearTimeout(NE.typingTimer); NE.typingTimer = setTimeout(() => { NE.typing = false; }, 800);
    syncDom();
    const si = selInfo();
    // браузер иногда оставляет лишние обёртки со стилями — перерисовать блок начисто
    if (si && si.collapsed && si.a.querySelector('span[style], font, div')) { const id = si.a.dataset.id, off = si.ao; render(); setCaret(id, off); }
    NE.last = stateNow();
    const s2 = selInfo();
    if (s2 && s2.collapsed && e.inputType === 'insertText') {
      if (e.data === ' ' && markdownShortcut(s2)) return;
      if (e.data === '-' && dividerShortcut(s2)) return;
      if (e.data === '/' && !NE.slash && s2.a.dataset.t !== 'code') {
        const plain = plainOf(s2.a), prev = plain[s2.ao - 2];
        if (prev === undefined || /\s/.test(prev)) openSlash(s2.a.dataset.id, s2.ao - 1);
      }
    }
    slashFollow();
    markCurrent();
  });
  boxEl.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (slashKeys(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const si = selInfo();
    if (mod && !e.altKey && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && !e.altKey && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
    if (e.key === 'Escape' && (NE.pop || (NE.bar && NE.bar.isConnected))) {      // первый Esc снимает выделение, второй закрывает страницу
      e.preventDefault(); e.stopPropagation(); closePops();
      const s = window.getSelection(); if (s && s.rangeCount && !s.isCollapsed) s.collapseToEnd();
      return;
    }
    if (!si) return;
    const b = blockById(si.a.dataset.id); if (!b) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      if (b.t === 'code' && si.a === si.z && !e.shiftKey) document.execCommand('insertText', false, '  ');
      else indentSel(si, e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'Enter' && b.t === 'code' && !mod && !e.shiftKey && si.a === si.z) { e.preventDefault(); document.execCommand('insertLineBreak'); return; }
    if (e.key === 'Enter' && mod && b.t === 'code') { e.preventDefault(); const before = NE.last, p = insertAfter(b.id, nb('p')); commit(before, { id:p.id, off:0 }); return; }
    if (e.key === 'Enter' && mod && b.t === 'todo') { e.preventDefault(); toggleTodo(b); return; }
    if ((e.altKey && !mod || mod && e.shiftKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); moveBlocks(si, e.key === 'ArrowUp' ? -1 : 1); return; }
    if (e.key === 'ArrowUp' && !e.shiftKey && si.collapsed && idxOf(b.id) === 0) {
      const r = caretRect(si), top = si.a.getBoundingClientRect().top;
      if (r.top - top < 8) { e.preventDefault(); titleEl.focus(); titleEl.setSelectionRange(titleEl.value.length, titleEl.value.length); return; }
    }
    if (mod && !e.altKey && e.code === 'KeyD') { e.preventDefault(); duplicateBlock(b); return; }
    if (mod && e.shiftKey && e.code === 'KeyS') { e.preventDefault(); fmt('strikeThrough'); return; }
    if (mod && !e.shiftKey && e.code === 'KeyE') { e.preventDefault(); toggleCode(); return; }
    if (mod && !e.shiftKey && e.code === 'KeyK' && !si.collapsed) { e.preventDefault(); e.stopPropagation(); linkPrompt(); return; }
    if (mod && e.altKey) {
      const map = { Digit0:'p', Digit1:'h1', Digit2:'h2', Digit3:'h3', Digit4:'todo', Digit5:'ul', Digit6:'ol', Digit7:'quote', Digit8:'code', Digit9:'callout' };
      if (map[e.code]) { e.preventDefault(); setType(b, map[e.code], true); return; }
    }
    if (e.key === 'Backspace' && si.collapsed && b.t === 'hr') { e.preventDefault(); neDeleteBlock(b); return; }
  });
  boxEl.addEventListener('mousedown', e => {
    const el = e.target.closest && e.target.closest('.nb'); if (!el) return;
    const a = e.target.closest('a');
    if (a && (e.ctrlKey || e.metaKey)) { e.preventDefault(); const u = safeLink(a.getAttribute('href')); if (u && window.electronAPI) window.electronAPI.openUrl(u); return; }
    const t = el.dataset.t;
    if (t !== 'todo' && t !== 'callout') return;
    const r = el.getBoundingClientRect(), pl = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    if (e.clientX >= r.left + pl) return;
    e.preventDefault();
    const b = blockById(el.dataset.id); if (!b) return;
    if (t === 'todo') toggleTodo(b); else emojiMenu(b, el);
  });
  boxEl.addEventListener('mousemove', e => { if (!NE.drag) gutterAt(e.target.closest && e.target.closest('.ne > .nb')); });
  NE.body.addEventListener('mouseleave', () => { if (NE.gut && !NE.drag) NE.gut.hidden = true; });
  NE.body.addEventListener('mousemove', e => {
    if (NE.drag || e.target.closest('.ne, .ne-gut')) return;
    const r = boxEl.getBoundingClientRect();
    if (e.clientX < r.left && e.clientX > r.left - 70) {           // слева от текста — ручка ближайшего блока
      const el = [...boxEl.children].find(x => { const q = x.getBoundingClientRect(); return e.clientY >= q.top && e.clientY <= q.bottom; });
      if (el) gutterAt(el);
    }
  });
  boxEl.addEventListener('copy', e => copyCut(e, false));
  boxEl.addEventListener('cut', e => copyCut(e, true));
  boxEl.addEventListener('paste', onPaste);
  boxEl.addEventListener('drop', e => e.preventDefault());
  boxEl.addEventListener('blur', () => { setTimeout(() => { if (boxEl && document.activeElement !== boxEl && !(NE.slash && NE.slash.el.contains(document.activeElement))) { closeSlash(); hideBar(); } }, 120); });
  NE.onSel = () => {
    if (!boxEl || !boxEl.isConnected) return;
    const si = selInfo();
    markCurrent();
    if (si && !si.collapsed && !NE.slash && !NE.pop && document.activeElement === boxEl) showBar(si); else if (!NE.pop) hideBar();
    if (NE.slash) slashFollow();
  };
  document.addEventListener('selectionchange', NE.onSel);
}
// копирование выделения через несколько блоков — текстом в Markdown (списки, заголовки, задачи сохраняются)
function copyCut(e, cut){
  const si = selInfo(); if (!si || si.collapsed || si.a === si.z) return;
  const frag = si.r.cloneContents();
  const parts = [...frag.childNodes].filter(x => x.nodeType === 1 && x.classList.contains('nb')).map(el => {
    const t = el.dataset.t || 'p';
    return { t, text:t === 'hr' ? '' : t === 'code' ? plainOf(el) : inlineToMd(segsOf(el, true)), done:el.dataset.done === 'true', ind:el.dataset.ind | 0, emoji:el.dataset.emoji };
  });
  e.preventDefault();
  const md = blocksToMarkdown(parts);
  e.clipboardData.setData('text/plain', md);
  if (cut) replaceSelection(si, '');
}
function onPaste(e){
  e.preventDefault();
  const dt = e.clipboardData, text = (dt && dt.getData('text/plain')) || '';
  if (!text) { if (dt && dt.files && dt.files.length) toast('Картинки и файлы добавляйте на доску — в текстовой странице только текст.'); return; }
  let si = selInfo(); if (!si) return;
  if (si.a !== si.z) { replaceSelection(si, ''); si = selInfo(); if (!si) return; }
  const el = si.a, b = blockById(el.dataset.id); if (!b) return;
  if (b.t === 'hr') return;
  const clean = text.replace(/\r\n?/g, '\n');
  if (!/\n/.test(clean.replace(/\n+$/, '')) || b.t === 'code') {             // одна строка или вставка в код — просто текст
    if (!si.collapsed) document.execCommand('delete');
    if (b.t === 'code') {
      const before = NE.last; syncDom(); const s2 = selInfo(); const [l, r] = splitMd(s2.a, s2.ao);
      b.text = l + clean + r; commit(before, { id:b.id, off:l.length + clean.length });
    } else document.execCommand('insertText', false, clean.replace(/\n+$/, ''));
    return;
  }
  if (!si.collapsed) { document.execCommand('delete'); syncDom(); NE.last = stateNow(); si = selInfo(); if (!si) return; }
  const before = NE.last;
  const [left, right] = splitMd(si.a, si.ao);
  const parsed = markdownToBlocks(clean).map(x => Object.assign(x, { id:newId() }));
  if (!parsed.length) return;
  const bl = blocksOf();
  let i = bl.indexOf(b);
  if (parsed[0].t === 'p' && !parsed[0].ind) { b.text = joinMd(left, parsed.shift().text); }
  else { b.text = left; }
  bl.splice(i + 1, 0, ...parsed);
  let tail = parsed.length ? parsed[parsed.length - 1] : b, off = textLen(tail);
  if (tail.t === 'hr' || (tail.t === 'code' && right)) {           // после разделителя (кода) — строка для дальнейшего ввода
    const p = nb('p', right); bl.splice(bl.indexOf(tail) + 1, 0, p); tail = p; off = 0;
  } else if (right) tail.text = joinMd(tail.text, right);
  if (!b.text && b.t === 'p' && parsed.length && !b.ind && b !== tail) bl.splice(bl.indexOf(b), 1);   // пустая строка, куда вставляли, не нужна
  commit(before, { id:tail.id, off });
}
function neInsertPage(){
  const n=editNode(); if(!n)return;
  const page={id:newId(),type:'page',kind:'text',title:'',blocks:[newBlock('p')]};
  (n.children ||= []).push(page);touch(editing.k);
  openPage(editing.k,page.id,{focusTitle:true});
}
function neInsertTable(){
  const n=editNode(); if(!n)return;
  (n.tables ||= []).push({id:newId(),columns:['Название','Описание'].map(title=>({id:newId(),title})),rows:[{id:newId(),cells:{}}]});
  touch(editing.k);nePaintExtras();
  NE.extras.querySelector('table:last-of-type input')?.focus();
}
function nePaintExtras(){
  const n=editNode();if(!n||!NE.extras)return;
  const persist=()=>touch(editing.k);
  const repaint=()=>{persist();nePaintExtras();};
  const button=(name,fn)=>h('button',{type:'button',class:'tb-btn',onclick:fn},name);
  const field=(value,label,save)=>{
    const input=h('input',{'aria-label':label,oninput:e=>{save(e.target.value);persist();}});
    input.value=value;return input;
  };
  NE.extras.replaceChildren();
  for(const table of n.tables||[]){
    const grid=h('table',{'aria-label':'Таблица документа'},
      h('thead',{},h('tr',{},table.columns.map(c=>h('th',{},field(c.title,'Название столбца',v=>c.title=v))))),
      h('tbody',{},table.rows.map((r,i)=>h('tr',{},table.columns.map(c=>h('td',{},field(r.cells[c.id]||'',(c.title||'Ячейка')+', строка '+(i+1),v=>r.cells[c.id]=v)))))));
    NE.extras.append(h('section',{class:'ne-table'},grid,
      button('+ Строка',()=>{table.rows.push({id:newId(),cells:{}});repaint();}),
      button('+ Столбец',()=>{table.columns.push({id:newId(),title:'Свойство'});repaint();}),
      button('Убрать таблицу',()=>{const i=n.tables.indexOf(table);n.tables.splice(i,1);const k=editing.k;repaint();
        toast('Таблица удалена',()=>{n.tables.splice(i,0,table);touch(k);nePaintExtras();});})));
  }
  for(const page of n.children||[])NE.extras.append(button('↳ '+(page.title||'Без названия'),()=>openPage(editing.k,page.id)));
}
