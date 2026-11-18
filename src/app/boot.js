/* Планер — доски страниц, общие клавиши и запуск.
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

/* ---------- task boards ---------- */
function createBoards(){
  if (!window.PlanerBoard) return null;
  return window.PlanerBoard.create({
    h, icon, IC, toast, openMenu, closeMenu, isMenuOpen:() => !!menuEl,
    electron:window.electronAPI || null,
    store:extraStore, pending:pendingSave,
    saveError:e => { setStatus('error'); showBanner('Не удалось сохранить доску: ' + ((e && (e.code || e.message)) || 'ошибка') + '. Изменения остаются на экране.'); },
    // ключ доски = id страницы (или boardId страницы, перенесённой со старой задачи)
    getTask:key => { const l = findOwner(key); return l ? { id:key, text:l.node.title, boardCount:l.node.boardCount | 0 } : null; },
    taskSection:key => { const l = findOwner(key); return l ? l.k : null; },
    sectionTitle:k => SECTIONS[k] ? SECTIONS[k].title : '',
    setTaskText(key, text){
      const l = findOwner(key); if (!l || l.node.title === text) return;
      l.node.title = String(text).slice(0, 160); touch(l.k); refreshTree(l.k);
      if (editing && editNode() === l.node && document.activeElement !== titleEl) titleEl.value = l.node.title;
    },
    setBoardCount(key, n){ const l = findOwner(key); if (!l || (l.node.boardCount | 0) === n) return; l.node.boardCount = n; touch(l.k); refreshTree(l.k); },
    allBoardTaskIds:() => { const out = []; const walk = arr => arr.forEach(n => { if (n.type === 'folder') walk(n.children); else if (n.boardCount > 0) out.push(ownerKey(n)); }); walk(S.plans.nodes); walk(S.ideas.nodes); return out; },
    toggleAi:() => { if (!sample) { toast('Ассистент недоступен.'); return; } aiPanel.classList.contains('open') ? closeAi() : openAi(); },
    onClosed:key => { const l = findOwner(key); if (l) refreshTree(l.k); }
  });
}

/* ---------- команды из меню приложения и трея ---------- */
function runCommand(cmd, arg){
  if (cmd === 'search') openSearch();
  else if (cmd === 'timers') { if (SP.ov) closeSearch(); openTimers(); }
  else if (cmd === 'settings') openSettings();
  else if (cmd === 'restore') openRestore();
  else if (cmd === 'task' && typeof arg === 'string') revealTask(arg);
  else if (cmd === 'toast' && typeof arg === 'string') toast(arg);
}

/* ---------- global keys & boot ---------- */
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (menuEl) closeMenu();
  else if (overlayEl) closeEditor();
  else if (dayView) closeDay();
  else if (aiPanel.classList.contains('open')) closeAi();
});
if ('ResizeObserver' in window) new ResizeObserver(debounce(autosizeAll, 80)).observe(board);
// Файл, случайно брошенный мимо доски, не должен открываться вместо приложения.
['dragover', 'drop'].forEach(t => document.addEventListener(t, e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); }));

(async function main(){
  try { boardApi = createBoards(); } catch (e) { console.error('board:', e); boardApi = null; }
  const ea = window.electronAPI;
  if (ea && ea.onFlush) ea.onFlush(flushEverything);
  if (ea && ea.onStoreError) ea.onStoreError(m => { setStatus('error'); showBanner(m); });
  buildBoard();
  KEYS.forEach(refreshSection);
  setStatus('loading');
  await initBackend();
  await loadAll();
  if (!calSeen) { try { await migrateLegacy(); } catch (e) { console.error('migrate:', e); } }
  loaded = true;
  KEYS.forEach(refreshSection);
  board.classList.remove('loading');
  idleStatus();
  initAI();
  initTimers(); initSearch(); initSettings(); initMiniHost();
  if (ea && ea.onCommand) ea.onCommand(runCommand);
  if (ea && ea.notices) { try { const list = await ea.notices(); if (list && list.length) showBanner(list.join(' ')); } catch (e) {} }
})();
