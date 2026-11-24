/* Планер — колонки «Основные планы» и «Идеи»: папки, текстовые документы и доски.
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

/* ---------- tree columns ---------- */
function buildTreeCol(k, folder=null){
  const cfg = folder ? {...SECTIONS[k],title:folder.title} : SECTIONS[k];
  const list = h('div', { class:'list tree', 'data-key':k });
  const sub = h('div', { class:'col-sub' });
  const root = h('section', { class:'col', 'data-key':k, 'aria-label':cfg.title },
    h('div', { class:'col-head' },
      h('div', { class:'col-title' }, h('span', { class:'ico' }, icon(cfg.icon, 19)), h('h2', {}, cfg.title)),
      h('div', { class:'col-tools' }, tool('fileplus', 'Новый файл: текст или доска', e => newFileMenu(e.currentTarget, k, folder?.id || null)), tool('folderplus', 'Новая папка', () => addNode(k, folder?.id || null, 'folder')))),
    sub, h('div', { class:'prog', style:'padding-bottom:2px' }), list);

  list.addEventListener('click', e => {
    const row = e.target.closest('.node'); if (!row || e.target.closest('.rename')) return;
    const id = row.dataset.id, loc = findNode(k, id); if (!loc) return; const n = loc.node;
    const add = e.target.closest('.n-add'), more = e.target.closest('.n-more');
    if (add) { newFileMenu(add, k, id); return; }
    if (more) { nodeMenu(k, n, more); return; }
    if (n.type === 'folder') { if (e.detail <= 1) { n.open = !n.open; touch(k); refreshTree(k, id); } return; }
    row.focus({ preventScroll:true });                       // файл: щелчок выделяет, двойной щелчок открывает
  });
  list.addEventListener('dblclick', e => {
    const row = e.target.closest('.node.page'); if (!row || e.target.closest('.rename, button')) return;
    openFile(k, row.dataset.id);
  });
  list.addEventListener('keydown', e => {
    if (!e.target.classList.contains('node')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (e.target.classList.contains('page')) openFile(k, e.target.dataset.id); else e.target.click();
    } else if (e.key === 'F2') { e.preventDefault(); startRename(k, e.target.dataset.id); }
  });
  return { root, list, sub };
}
function countKinds(nodes, acc = { text:0, board:0 }){ nodes.forEach(x => { if (x.type === 'folder') countKinds(x.children, acc); else acc[x.kind === 'board' ? 'board' : 'text']++; }); return acc; }
function refreshTree(k, focusId){
  const c = cols[k], nodes = S[k].nodes;
  const fid = focusId || (document.activeElement && document.activeElement.closest && c.list.contains(document.activeElement) && document.activeElement.dataset.id);
  const cnt = countKinds(nodes);
  c.sub.textContent = [cnt.text ? cnt.text + ' ' + plural(cnt.text, 'текст', 'текста', 'текстов') : '', cnt.board ? cnt.board + ' ' + plural(cnt.board, 'доска', 'доски', 'досок') : ''].filter(Boolean).join(' · ');
  c.list.replaceChildren();
  if (!nodes.length) c.list.append(h('div', { class:'empty' }, SECTIONS[k].empty));
  nodes.filter(n=>!n.column).forEach(n => renderNode(k, n, 0, c.list));
  if(k==='plans') paintColumnLayout();
  if (fid) { const r = c.list.querySelector('.node[data-id="' + fid + '"]'); if (r) r.focus({ preventScroll:true }); }
  if (boardApi) { const id = boardApi.openTaskId(); if (id && !findOwner(id)) boardApi.close(); }
}
// Файл открывается по своему типу: текст — редактор страницы, доска — холст.
function openFile(k, id){
  const loc = findNode(k, id); if (!loc || loc.node.type !== 'page') return;
  if (loc.node.kind === 'board') openNodeBoard(k, id); else openPage(k, id);
}
function newFileMenu(anchor, k, parentId){
  openMenu(anchor, [
    { icon:'file', label:'Текстовый документ', run:() => addNode(k, parentId, 'page', 'text') },
    { icon:'board', label:'Доска (заметки, фото, видео, зарисовки)', run:() => addNode(k, parentId, 'page', 'board') },
    parentId ? null : { sep:true },
    parentId ? { icon:'folderplus', label:'Подпапка', run:() => addNode(k, parentId, 'folder') } : { icon:'folderplus', label:'Папка', run:() => addNode(k, null, 'folder') }
  ]);
}
function setFileKind(k, id, kind){
  const loc = findNode(k, id); if (!loc || loc.node.type !== 'page' || loc.node.kind === kind) return;
  const undo = undoer([k]);
  loc.node.kind = kind; touch(k); refreshTree(k, id);
  if (editing && editing.id === id && kind === 'board') { closeEditor(true); openNodeBoard(k, id); }
  toast(kind === 'board' ? 'Теперь это доска — текст страницы сохранён' : 'Теперь это текстовый документ — доска сохранена', undo);
}
const ownerKey = n => n.boardId || n.id;
function findOwner(key){
  const walk = (k, arr) => { for (const n of arr) { if (n.type === 'page' && ownerKey(n) === key) return { k, node:n }; if (n.type === 'folder') { const r = walk(k, n.children); if (r) return r; } } return null; };
  return walk('plans', S.plans.nodes) || walk('ideas', S.ideas.nodes);
}
function openNodeBoard(k, id, focusTitle){
  const loc = findNode(k, id); if (!loc || loc.node.type !== 'page') return;
  if (!boardApi) { toast('Доска недоступна.'); return; }
  closeMenu(); closeEditor(true);
  Promise.resolve(boardApi.open(ownerKey(loc.node))).then(() => { if (focusTitle) { const t = document.querySelector('.bd-title'); if (t) t.focus(); } });
}
function renderNode(k, n, depth, parent){
  const isF = n.type === 'folder', isBoard = !isF && n.kind === 'board';
  const todos = isF || isBoard ? [] : n.blocks.filter(b => b.t === 'todo');
  const meta = isF ? (countNodes(n.children) || '') : isBoard ? (n.boardCount ? String(n.boardCount) : '') : (todos.length ? todos.filter(b => b.done).length + '/' + todos.length : '');
  const kindName = isBoard ? 'Доска' : 'Текстовый документ';
  const row = h('div', { class:'node ' + n.type + (isBoard ? ' kind-board' : isF ? '' : ' kind-text') + (isF && n.open ? ' open' : ''), 'data-id':n.id, style:'--d:' + depth, tabindex:'0', role:'treeitem',
      title:isF ? null : kindName + ' — дважды щёлкните, чтобы открыть', 'aria-label':isF ? null : kindName + ': ' + (n.title || 'Без названия') },
    h('span', { class:'caret' }, icon('chev', 14)),
    h('span', { class:'n-ico' }, icon(isF ? 'folder' : isBoard ? 'board' : 'file', 17)),
    h('span', { class:'n-title' + (n.title ? '' : ' ph') }, n.title || 'Без названия'),
    meta !== '' ? h('span', { class:'n-meta', title:isBoard ? 'Карточек на доске' : null }, meta) : null,
    h('span', { class:'n-acts' },
      isF ? h('button', { class:'n-add', type:'button', 'aria-label':'Новый файл в папке', title:'Новый файл в папке' }, icon('plus', 15)) : null,
      h('button', { class:'n-more', type:'button', 'aria-label':'Ещё', title:'Ещё' }, icon('more', 16))));
  parent.append(row);
  if (isF && n.open) {
    if (n.children.length) n.children.forEach(ch => renderNode(k, ch, depth + 1, parent));
    else parent.append(h('div', { class:'node-empty', style:'--d:' + (depth + 1) }, 'Пока пусто'));
  }
}
function nodeMenu(k, n, anchor){
  const other = k === 'plans' ? 'ideas' : 'plans';
  const isF = n.type === 'folder', isBoard = !isF && n.kind === 'board';
  const textLeft = !isF && isBoard && (n.blocks.some(b => b.text.trim()));
  openMenu(anchor, [
    isF ? { icon:'file', label:'Новый текстовый документ', run:() => addNode(k, n.id, 'page', 'text') } : { icon:isBoard ? 'board' : 'file', label:'Открыть', run:() => openFile(k, n.id) },
    isF ? { icon:'board', label:'Новая доска', run:() => addNode(k, n.id, 'page', 'board') } : null,
    isF ? { icon:'folderplus', label:'Новая подпапка', run:() => addNode(k, n.id, 'folder') } : null,
    !isF && !isBoard ? { icon:'board', label:'Сделать доской', run:() => setFileKind(k, n.id, 'board') } : null,
    isBoard ? { icon:'file', label:'Сделать текстовым документом', run:() => setFileKind(k, n.id, 'text') } : null,
    !isF && !isBoard && n.boardCount ? { icon:'board', label:'Открыть прежнюю доску (' + n.boardCount + ')', run:() => openNodeBoard(k, n.id) } : null,
    textLeft ? { icon:'file', label:'Открыть прежний текст', run:() => openPage(k, n.id) } : null,
    { icon:'pencil', label:'Переименовать', run:() => startRename(k, n.id) },
    { icon:'arrow', label:'Перенести в «' + SECTIONS[other].title + '»', run:() => moveNode(k, n.id, other) },
    { sep:true },
    { icon:'trash', danger:true, label:'Удалить', run:() => deleteNode(k, n.id) }
  ]);
}
function addNode(k, parentId, type, kind){
  const n = type === 'folder' ? { id:newId(), type:'folder', title:'Новая папка', open:true, children:[] }
    : { id:newId(), type:'page', kind:kind === 'board' ? 'board' : 'text', title:'', blocks:[newBlock('p')] };
  let arr = S[k].nodes;
  if (parentId) { const p = findNode(k, parentId).node; p.open = true; arr = p.children; }
  arr.push(n); touch(k); refreshTree(k);
  if (type === 'folder') startRename(k, n.id);
  else if (n.kind === 'board') openNodeBoard(k, n.id, true);
  else openPage(k, n.id, { focusTitle:true });
}
function startRename(k, id){
  const row = board.querySelector('.node[data-id="' + id + '"]'); const loc = findNode(k, id);
  if (!row || !loc) return;
  const t = row.querySelector('.n-title');
  const inp = h('input', { class:'rename', type:'text', 'aria-label':'Название', maxlength:'120' }); inp.value = loc.node.title;
  let done = false;
  const commit = ok => { if (done) return; done = true; if (ok) { const v = inp.value.trim(); loc.node.title = v || (loc.node.type === 'folder' ? 'Без названия' : ''); touch(k); } refreshTree(k); };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(true); } else if (e.key === 'Escape') { e.stopPropagation(); commit(false); } });
  inp.addEventListener('blur', () => commit(true));
  inp.addEventListener('click', e => e.stopPropagation());
  t.replaceWith(inp); inp.focus(); inp.select();
}
function deleteNode(k, id){
  const loc = findNode(k, id); if (!loc) return;
  const undo = undoer([k]);
  loc.arr.splice(loc.index, 1);
  if (editing && editing.k === k && !findNode(k, editing.id)) closeEditor();
  touch(k); refreshTree(k); toast(loc.node.type === 'folder' ? 'Папка удалена' : loc.node.kind === 'board' ? 'Доска удалена' : 'Документ удалён', undo);
}
function moveNode(k, id, toKey){
  const loc = findNode(k, id); if (!loc) return;
  const undo = undoer([k, toKey]);
  loc.arr.splice(loc.index, 1); S[toKey].nodes.push(loc.node);
  if (editing && editing.id === id) closeEditor();
  touch(k); touch(toKey); refreshTree(k); refreshTree(toKey);
  toast('Перенесено в «' + SECTIONS[toKey].title + '»', undo);
}
