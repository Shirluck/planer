/* Планер — редактор текстовой страницы.
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

/* ---------- page editor ---------- */
let editing = null, overlayEl = null, boxEl = null, titleEl = null, crumbsEl = null, footProg = null;
const editNode = () => { if (!editing) return null; const l = findNode(editing.k, editing.id); return l && l.node.type === 'page' ? l.node : null; };

function openPage(k, id, opts = {}){
  const loc = findNode(k, id); if (!loc || loc.node.type !== 'page') return;
  closeEditor(true); closeMenu();
  editing = { k, id };
  const n = loc.node; if (!n.blocks.length) n.blocks.push(newBlock('p'));
  titleEl = h('input', { class:'title-in', type:'text', placeholder:'Без названия', 'aria-label':'Название страницы', maxlength:'160' });
  titleEl.value = n.title;
  titleEl.addEventListener('input', () => { const nn = editNode(); if (nn) { nn.title = titleEl.value; touch(editing.k); } });
  titleEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const f = boxEl.querySelector('.b-in'); f && f.focus(); } });
  boxEl = h('div', { class:'blocks' });
  crumbsEl = h('div', { class:'crumbs' });
  footProg = h('span');
  const more = tool('more', 'Действия со страницей', () => { const nn = editNode(); if (!nn) return; const other = editing.k === 'plans' ? 'ideas' : 'plans';
    openMenu(more, [
      { icon:'board', label:'Сделать доской', run:() => setFileKind(editing.k, editing.id, 'board') },
      nn.boardCount ? { icon:'board', label:'Открыть прежнюю доску (' + nn.boardCount + ')', run:() => openNodeBoard(editing.k, editing.id) } : null,
      { icon:'arrow', label:'Перенести в «' + SECTIONS[other].title + '»', run:() => moveNode(editing.k, editing.id, other) },
      { sep:true },
      { icon:'trash', danger:true, label:'Удалить документ', run:() => deleteNode(editing.k, editing.id) }
    ]); });
  overlayEl = h('div', { class:'overlay', onmousedown:e => { if (e.target === overlayEl) closeEditor(); } },
    h('div', { class:'sheet', 'data-key':k, role:'dialog', 'aria-modal':'true', 'aria-label':'Редактор страницы' },
      h('div', { class:'sheet-top' }, crumbsEl, h('div', { class:'col-tools' }, more, tool('x', 'Закрыть', () => closeEditor()))),
      h('div', { class:'sheet-body' }, titleEl, boxEl, h('div', { class:'pad', onclick:padClick })),
      h('div', { class:'sheet-foot' },
        h('span', {}, h('kbd', {}, 'Enter'), ' — новая строка · ', h('kbd', {}, '[] '), ' чекбокс · ', h('kbd', {}, '# '), ' заголовок · ', h('kbd', {}, '- '), ' список'),
        footProg)));
  document.body.append(overlayEl);
  setupBlockEvents();
  renderBlocks(); paintCrumbs();
  if (opts.focusTitle) titleEl.focus();
}
function paintCrumbs(){
  const loc = editNode() && findNode(editing.k, editing.id); if (!loc) return;
  crumbsEl.replaceChildren(h('b', {}, SECTIONS[editing.k].title), ...loc.path.flatMap(p => [h('span', {}, '›'), h('span', {}, p.title || 'Без названия')]));
}
function closeEditor(silent){
  if (!overlayEl) return;
  const k = editing && editing.k;
  overlayEl.remove(); overlayEl = boxEl = titleEl = crumbsEl = footProg = null; editing = null;
  if (!silent && k) refreshTree(k);
}
function editorSync(){ if (!overlayEl) return; const n = editNode(); if (!n) { closeEditor(); return; } if (document.activeElement !== titleEl) titleEl.value = n.title; renderBlocks(); paintCrumbs(); }
function padClick(){
  const n = editNode(); if (!n) return;
  const last = n.blocks[n.blocks.length - 1];
  if (last && (last.text.trim() || last.t === 'h')) { const b = newBlock('p'); n.blocks.push(b); touch(editing.k); renderBlocks({ id:b.id, pos:0 }); }
  else renderBlocks({ id:last.id, pos:'end' });
}
const PH = { p:'Начните писать…', h:'Заголовок', todo:'Задача', ul:'Пункт списка' };
function blockEl(b, only){
  const row = h('div', { class:'blk t-' + b.t + (b.done ? ' done' : '') + (only ? ' only' : ''), 'data-id':b.id });
  row.append(h('button', { class:'b-menu', type:'button', tabindex:'-1', 'aria-label':'Тип блока', title:'Тип блока' }, icon('grip', 14)));
  row.append(b.t === 'todo' ? h('button', { class:'cb b-cb', type:'button', role:'checkbox', 'aria-checked':String(!!b.done), 'aria-label':'Выполнено' }, icon('check', 14))
    : b.t === 'ul' ? h('span', { class:'b-bul', 'aria-hidden':'true' }, '•') : h('span', { class:'b-gap' }));
  const ta = h('textarea', { class:'b-in', rows:'1', spellcheck:'false', placeholder:PH[b.t], 'aria-label':PH[b.t] }); ta.value = b.text;
  row.append(ta);
  return row;
}
function renderBlocks(focus){
  const n = editNode(); if (!n || !boxEl) return;
  boxEl.replaceChildren(...n.blocks.map(b => blockEl(b, n.blocks.length === 1 && !b.text)));
  boxEl.querySelectorAll('.b-in').forEach(autosize);
  paintFoot();
  if (focus) {
    const ta = boxEl.querySelector('.blk[data-id="' + focus.id + '"] .b-in');
    if (ta) { ta.focus(); const p = focus.pos === 'end' ? ta.value.length : focus.pos; ta.setSelectionRange(p, p); }
  }
}
function paintFoot(){
  const n = editNode(); if (!n || !footProg) return;
  const t = n.blocks.filter(b => b.t === 'todo'), d = t.filter(b => b.done).length;
  footProg.textContent = t.length ? 'Выполнено: ' + d + ' из ' + t.length : '';
}
function setupBlockEvents(){
  const blocks = () => editNode().blocks;
  const rowOf = el => el.closest('.blk');
  const getB = row => blocks().find(b => b.id === row.dataset.id);
  boxEl.addEventListener('click', e => {
    const row = rowOf(e.target); if (!row) return; const b = getB(row); if (!b) return;
    if (e.target.closest('.b-cb')) { b.done = !b.done; row.classList.toggle('done', b.done); row.querySelector('.b-cb').setAttribute('aria-checked', String(b.done)); touch(editing.k); paintFoot(); }
    else if (e.target.closest('.b-menu')) {
      const set = t => () => { b.t = t; if (t !== 'todo') b.done = false; touch(editing.k); renderBlocks({ id:b.id, pos:'end' }); };
      openMenu(e.target.closest('.b-menu'), [
        { icon:'text', label:'Текст', run:set('p') }, { icon:'head', label:'Заголовок', run:set('h') },
        { icon:'list', label:'Маркированный список', run:set('ul') }, { icon:'todo', label:'Чекбокс', run:set('todo') },
        { sep:true },
        { icon:'trash', danger:true, label:'Удалить блок', run:() => { const bl = blocks(); bl.splice(bl.indexOf(b), 1); if (!bl.length) bl.push(newBlock('p')); touch(editing.k); renderBlocks(); } }
      ]);
    }
  });
  boxEl.addEventListener('input', e => {
    const ta = e.target.closest('.b-in'); if (!ta) return; const row = rowOf(ta), b = getB(row); if (!b) return;
    b.text = ta.value; autosize(ta);
    if (b.t === 'p') {
      const m = b.text.match(/^(?:-\s\[\s?\]|\[\s?\]|\[x\])\s/i) || b.text.match(/^#{1,3}\s/) || b.text.match(/^[-*•]\s/);
      if (m) {
        b.t = /^#/.test(m[0]) ? 'h' : /^[-*•]/.test(m[0]) && !/\[/.test(m[0]) ? 'ul' : 'todo';
        b.done = /\[x\]/i.test(m[0]); b.text = b.text.slice(m[0].length);
        touch(editing.k); renderBlocks({ id:b.id, pos:0 }); return;
      }
    }
    touch(editing.k);
  });
  boxEl.addEventListener('keydown', e => {
    const ta = e.target.closest('.b-in'); if (!ta || e.isComposing) return;
    const row = rowOf(ta), bl = blocks(), idx = bl.findIndex(b => b.id === row.dataset.id), b = bl[idx]; if (!b) return;
    const pos = ta.selectionStart, end = ta.selectionEnd, k = editing.k;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if ((b.t === 'todo' || b.t === 'ul') && !b.text.trim()) { b.t = 'p'; b.done = false; touch(k); renderBlocks({ id:b.id, pos:0 }); return; }
      const nb = newBlock(b.t === 'todo' || b.t === 'ul' ? b.t : 'p', ta.value.slice(end));
      b.text = ta.value.slice(0, pos); bl.splice(idx + 1, 0, nb); touch(k); renderBlocks({ id:nb.id, pos:0 });
    } else if (e.key === 'Backspace' && pos === 0 && end === 0) {
      if (b.t !== 'p') { e.preventDefault(); b.t = 'p'; b.done = false; touch(k); renderBlocks({ id:b.id, pos:0 }); }
      else if (idx > 0) { e.preventDefault(); const prev = bl[idx - 1], jp = prev.text.length; prev.text += b.text; bl.splice(idx, 1); touch(k); renderBlocks({ id:prev.id, pos:jp }); }
    } else if (e.key === 'ArrowUp' && e.altKey && idx > 0) {
      e.preventDefault(); [bl[idx - 1], bl[idx]] = [bl[idx], bl[idx - 1]]; touch(k); renderBlocks({ id:b.id, pos });
    } else if (e.key === 'ArrowDown' && e.altKey && idx < bl.length - 1) {
      e.preventDefault(); [bl[idx + 1], bl[idx]] = [bl[idx], bl[idx + 1]]; touch(k); renderBlocks({ id:b.id, pos });
    } else if (e.key === 'ArrowUp' && !e.shiftKey && pos === 0 && end === 0 && idx > 0) {
      e.preventDefault(); const p = boxEl.querySelector('.blk[data-id="' + bl[idx - 1].id + '"] .b-in'); p.focus(); p.setSelectionRange(p.value.length, p.value.length);
    } else if (e.key === 'ArrowDown' && !e.shiftKey && pos === ta.value.length && end === pos && idx < bl.length - 1) {
      e.preventDefault(); const p = boxEl.querySelector('.blk[data-id="' + bl[idx + 1].id + '"] .b-in'); p.focus(); p.setSelectionRange(0, 0);
    }
  });
}
