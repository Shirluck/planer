/* Планер — настройки: оформление (тема, размер интерфейса, компактный режим), автозапуск вместе с Windows,
   восстановление из резервных копий. Значения хранит основной процесс (settings.json), копии — lib/backups.js.
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

const SET = { ui:null, auto:null, dlg:null };
// Esc закрывает верхнее окно настроек или восстановления, где бы ни был фокус (обработчик на window — раньше остальных).
function escCloser(close){
  const fn = e => { if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  window.addEventListener('keydown', fn, true);
  return () => window.removeEventListener('keydown', fn, true);
}
const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.5];

function initSettings(){
  const ea = window.electronAPI; if (!ea || !ea.ui) return;
  const b = $('#settingsBtn');
  b.hidden = false; b.append(icon('gear', 18));
  b.title = 'Настройки: оформление, автозапуск, резервные копии'; b.setAttribute('aria-label', 'Настройки');
  b.addEventListener('click', () => openSettings());
  ea.ui.onState(applyUiState);
  ea.ui.get().then(applyUiState);
  if (ea.updates) {
    const state = s => { SET.updates = s; paintSettings(); };
    ea.updates.onState(state); ea.updates.get().then(state);
  }
  if (ea.autostart) { ea.autostart.onState(s => { SET.auto = s; paintSettings(); }); ea.autostart.get().then(s => { SET.auto = s; paintSettings(); }); }
}
function applyUiState(s){
  SET.ui = s;
  document.body.classList.toggle('compact', !!s.compact);
  document.documentElement.dataset.theme = s.theme;
  paintSettings();
}
function setUi(patch){ const ea = window.electronAPI; return ea && ea.ui ? ea.ui.set(patch).then(applyUiState) : Promise.resolve(); }

/* ---------- окно настроек ---------- */
function openSettings(){
  closeMenu(); if (SP.ov) closeSearch();
  if (SET.dlg) { SET.dlg.querySelector('button').focus(); return; }
  const body = h('div', { class:'st-body' });
  const box = h('div', { class:'st-box', role:'dialog', 'aria-modal':'true', 'aria-label':'Настройки' },
    h('div', { class:'st-head' }, icon('gear', 18), h('h2', {}, 'Настройки'), h('span', { class:'spacer' }), tool('x', 'Закрыть (Esc)', () => closeSettings())),
    body,
    h('div', { class:'st-foot' }, h('button', { type:'button', class:'tb-btn primary', onclick:() => closeSettings() }, 'Готово')));
  SET.dlg = h('div', { class:'overlay st-ov', onmousedown:e => { if (e.target === SET.dlg) closeSettings(); } }, box);
  SET.unEsc = escCloser(closeSettings);
  SET.body = body;
  document.body.append(SET.dlg);
  paintSettings();
  const f = body.querySelector('[aria-checked=true]') || body.querySelector('button'); if (f) f.focus();
}
function closeSettings(){ if (SET.dlg) { SET.dlg.remove(); SET.dlg = null; SET.body = null; if (SET.unEsc) SET.unEsc(); SET.unEsc = null; } }
function paintSettings(){
  if (!SET.dlg || !SET.body) return;
  const ui = SET.ui || { theme:'system', zoom:1, compact:false }, auto = SET.auto, ea = window.electronAPI;
  const had = document.activeElement && SET.body.contains(document.activeElement) ? document.activeElement.dataset.f : null;
  const seg = (name, items, cur, pick) => h('div', { class:'st-seg', role:'radiogroup', 'aria-label':name }, items.map(([v, label, ic]) =>
    h('button', { type:'button', role:'radio', 'aria-checked':String(cur === v), 'data-f':name + v, onclick:() => pick(v) }, icon(ic, 15), label)));
  const sw = (label, on, set, f) => h('button', { type:'button', class:'st-switch', role:'switch', 'aria-checked':String(!!on), 'aria-label':label, 'data-f':f, onclick:() => set(!on) }, h('i'));
  const zi = ZOOM_STEPS.indexOf(ui.zoom);
  SET.body.replaceChildren(
    h('section', { class:'st-sec' },
      h('h3', {}, 'Оформление'),
      h('div', { class:'st-row' }, h('span', { class:'st-lab' }, 'Тема'),
        seg('Тема', [['system', 'Как в системе', 'monitor'], ['light', 'Светлая', 'sun'], ['dark', 'Тёмная', 'moon']], ui.theme, v => setUi({ theme:v }))),
      h('div', { class:'st-row' }, h('span', { class:'st-lab' }, 'Размер интерфейса', h('small', {}, h('kbd', {}, 'Ctrl'), ' + ', h('kbd', {}, '='), ' / ', h('kbd', {}, '−'), ' / ', h('kbd', {}, '0'))),
        h('div', { class:'st-zoom' },
          h('button', { type:'button', class:'tool', 'aria-label':'Мельче', title:'Мельче', 'data-f':'zout', disabled:zi <= 0, onclick:() => setUi({ zoom:ZOOM_STEPS[Math.max(0, zi - 1)] }) }, icon('minus', 16)),
          h('button', { type:'button', class:'st-zv', title:'Обычный размер', 'data-f':'z100', onclick:() => setUi({ zoom:1 }) }, Math.round(ui.zoom * 100) + '%'),
          h('button', { type:'button', class:'tool', 'aria-label':'Крупнее', title:'Крупнее', 'data-f':'zin', disabled:zi >= ZOOM_STEPS.length - 1, onclick:() => setUi({ zoom:ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, zi + 1)] }) }, icon('plus', 16)))),
      h('div', { class:'st-row' }, h('span', { class:'st-lab' }, 'Компактный режим', h('small', {}, 'Плотнее строки и отступы — помещается больше задач')),
        sw('Компактный режим', ui.compact, v => setUi({ compact:v }), 'compact'))),
    auto && auto.available ? h('section', { class:'st-sec' },
      h('h3', {}, 'Запуск'),
      h('div', { class:'st-row' }, h('span', { class:'st-lab' }, 'Запускать вместе с Windows',
          h('small', {}, 'Планер стартует свёрнутым в трей: таймеры и мини-окно «Сегодня» сразу под рукой.' + (auto.portable ? ' Portable-версия: не перемещайте файл программы, иначе автозапуск его не найдёт.' : ''))),
        sw('Запускать вместе с Windows', auto.enabled, v => ea.autostart.set(v).then(s => { SET.auto = s; paintSettings(); }), 'auto'))) : null,
    SET.updates?.available ? h('section', { class:'st-sec' },
      h('h3', {}, 'Обновления'),
      h('div', { class:'st-row' }, h('span', { class:'st-lab' }, 'Проверять обновления автоматически',
        h('small', { role:'status' }, SET.updates.status.message)), sw('Проверять обновления автоматически', SET.updates.enabled, v => ea.updates.action(v), 'updates')),
      h('button', { class:'tb-btn', 'data-f':'update-action', disabled:SET.updates.status.busy,
        onclick:() => ea.updates.action(SET.updates.status.ready ? 'install' : 'check') },
        SET.updates.status.ready ? 'Перезапустить и обновить' : 'Проверить обновления')) :
      SET.updates?.portable ? h('button', { class:'tb-btn', onclick:() => ea.openUrl('https://github.com/Shirluck/planer/releases/latest') }, 'Скачать новую portable-версию') : '',
    ea && ea.backups ? h('section', { class:'st-sec' },
      h('h3', {}, 'Резервные копии'),
      h('p', { class:'st-note' }, 'Каждый день Планер сам копирует все данные и хранит копии за 14 дней. Из копии можно вернуть календарь, планы, идеи или отдельную доску.'),
      h('div', { class:'st-btns' },
        h('button', { type:'button', class:'tb-btn', 'data-f':'restore', onclick:() => { closeSettings(); openRestore(); } }, icon('history', 15), 'Восстановить из копии…'),
        h('button', { type:'button', class:'tb-btn', 'data-f':'snap', onclick:() => makeSnapshot() }, 'Сделать копию сейчас'),
        h('button', { type:'button', class:'tb-btn', 'data-f':'folder', onclick:() => ea.backups.openFolder() }, 'Открыть папку с копиями'))) : null);
  if (had) { const f = SET.body.querySelector('[data-f="' + had + '"]'); if (f) f.focus(); }
}
async function makeSnapshot(){
  await flushEverything();
  const r = await window.electronAPI.backups.snapshot();
  toast(r && r.ok ? 'Копия данных сделана (' + r.count + ' ' + plural(r.count, 'документ', 'документа', 'документов') + ')' : 'Не удалось сделать копию: ' + ((r && r.error) || 'ошибка'));
  if (RS.dlg) loadRestoreList(RS.sel);
}

/* ---------- восстановление из копий ---------- */
const RS = { dlg:null, list:null, docs:null, items:[], sel:null, cache:new Map() };
const LEGACY_DOC = /\/planner-(day|week)$/;
const docKey = p => p.split('/').pop();
function openRestore(){
  const ea = window.electronAPI; if (!ea || !ea.backups) return;
  closeMenu(); if (SP.ov) closeSearch(); closeSettings();
  if (RS.dlg) return;
  RS.list = h('div', { class:'rs-list', role:'listbox', 'aria-label':'Резервные копии' });
  RS.docs = h('div', { class:'rs-docs' });
  const box = h('div', { class:'st-box rs-box', role:'dialog', 'aria-modal':'true', 'aria-label':'Восстановление из копии' },
    h('div', { class:'st-head' }, icon('history', 18), h('h2', {}, 'Восстановление из копии'), h('span', { class:'spacer' }),
      h('button', { type:'button', class:'tb-btn', onclick:() => makeSnapshot() }, 'Сделать копию сейчас'),
      h('button', { type:'button', class:'tb-btn', onclick:() => ea.backups.openFolder() }, 'Папка с копиями'),
      tool('x', 'Закрыть (Esc)', () => closeRestore())),
    h('div', { class:'rs-main' }, RS.list, RS.docs),
    h('div', { class:'st-foot rs-foot' }, h('span', {}, 'Текущие данные перед восстановлением сохраняются в копию «перед восстановлением» — восстановление можно отменить.')));
  RS.dlg = h('div', { class:'overlay st-ov', onmousedown:e => { if (e.target === RS.dlg) closeRestore(); } }, box);
  RS.unEsc = escCloser(closeRestore);
  document.body.append(RS.dlg);
  loadRestoreList();
}
function closeRestore(){ if (RS.dlg) { RS.dlg.remove(); RS.dlg = null; RS.cache.clear(); if (RS.unEsc) RS.unEsc(); RS.unEsc = null; } }
const RS_KIND = { daily:'Ежедневная копия', manual:'Сделана вручную', 'before-restore':'Перед восстановлением' };
function rsWhen(b){
  const d = new Date(b.at), day = dkey(d);
  const rel = relDay(day);
  return (rel ? rel + ', ' : fmtDate(day, { day:'numeric', month:'long' }) + ', ') + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
async function loadRestoreList(keep){
  const items = (await window.electronAPI.backups.list()).filter(b => b.docs.length);    // пустые копии (до первых данных) не показываем
  if (!RS.dlg) return;
  RS.items = items;
  RS.list.replaceChildren(...(items.length ? items.map(b => h('button', { type:'button', class:'rs-item', role:'option', 'data-id':b.id, 'aria-selected':'false', onclick:() => selectBackup(b.id) },
      h('b', {}, rsWhen(b)), h('span', { class:'rs-kind k-' + b.kind }, RS_KIND[b.kind]), h('span', { class:'rs-n' }, b.docs.length + ' ' + plural(b.docs.length, 'документ', 'документа', 'документов'))))
    : [h('div', { class:'rs-empty' }, 'Копий пока нет. Первая появится сегодня или нажмите «Сделать копию сейчас».')]));
  const pick = items.find(b => b.id === keep) || items[0];
  if (pick) selectBackup(pick.id); else RS.docs.replaceChildren();
}
async function rsRead(id, p){
  const k = id + '|' + p;
  if (!RS.cache.has(k)) RS.cache.set(k, await window.electronAPI.backups.read(id, p));
  return RS.cache.get(k);
}
const countTasks = cal => { let n = 0, d = 0; if (cal && cal.days) for (const v of Object.values(cal.days)) { if (v && Array.isArray(v.items) && v.items.length) { n += v.items.length; d++; } } return { n:n + (cal && Array.isArray(cal.undated) ? cal.undated.length : 0), d }; };
const countFiles = doc => { let f = 0, p = 0; const walk = a => (Array.isArray(a) ? a : []).forEach(x => { if (x && x.type === 'folder') { f++; walk(x.children); } else if (x) p++; }); walk(doc && doc.nodes); return { f, p }; };
function boardTitleFrom(key, docs){
  const l = findOwner(key); if (l) return l.node.title || 'Без названия';
  for (const d of docs) { let t = null; const walk = a => (Array.isArray(a) ? a : []).forEach(x => { if (t) return; if (x && x.type === 'folder') walk(x.children); else if (x && (x.boardId || x.id) === key) t = x.title || 'Без названия'; }); walk(d && d.nodes); if (t) return t + ' (удалена)'; }
  return null;
}
async function selectBackup(id){
  RS.sel = id;
  RS.list.querySelectorAll('.rs-item').forEach(x => x.setAttribute('aria-selected', String(x.dataset.id === id)));
  const b = RS.items.find(x => x.id === id); if (!b) return;
  RS.docs.replaceChildren(h('div', { class:'rs-loading' }, 'Читаю копию…'));
  const ea = window.electronAPI;
  const paths = b.docs.map(d => d.path).filter(p => !LEGACY_DOC.test(p));
  const order = p => { const k = docKey(p); return k === 'planner-cal' ? 0 : k === 'planner-plans' ? 1 : k === 'planner-ideas' ? 2 : k === 'planner-timers' ? 3 : 4; };
  paths.sort((a, c) => order(a) - order(c));
  const treeDocs = await Promise.all(['planner-plans', 'planner-ideas'].map(k => { const p = paths.find(x => docKey(x) === k); return p ? rsRead(id, p) : null; }));
  const rows = [];
  for (const p of paths) {
    const k = docKey(p), then = await rsRead(id, p), now = await ea.dbGet(p);
    if (RS.sel !== id || !RS.dlg) return;
    let title, sum, ic;
    if (k === 'planner-cal') { const a = countTasks(then), c = countTasks(now); ic = 'cal'; title = 'Календарь: задачи и блоки времени'; sum = 'в копии ' + tasksWord(a.n) + ' · сейчас ' + tasksWord(c.n); }
    else if (k === 'planner-plans' || k === 'planner-ideas') { const a = countFiles(then), c = countFiles(now); ic = k === 'planner-plans' ? 'target' : 'bulb'; title = k === 'planner-plans' ? 'Основные планы' : 'Идеи'; sum = 'в копии файлов: ' + a.p + ', папок: ' + a.f + ' · сейчас: ' + c.p + ' и ' + c.f; }
    else if (k === 'planner-timers') { ic = 'timer'; title = 'Таймеры'; sum = 'шаблонов в копии: ' + ((then && then.presets) || []).length + ' · сейчас: ' + ((now && now.presets) || []).length; }
    else if (k === 'planner-tools') { ic = 'film'; title = 'Моушн: мои ссылки'; sum = 'ссылок в копии: ' + ((then && then.links) || []).length + ' · сейчас: ' + ((now && now.links) || []).length; }
    else if (k.startsWith('board-')) { const t = boardTitleFrom(k.slice(6), treeDocs); ic = 'board'; title = 'Доска «' + (t || k.slice(6)) + '»'; sum = 'карточек в копии: ' + ((then && then.items) || []).length + ' · сейчас: ' + ((now && now.items) || []).length; }
    else { ic = 'file'; title = k; sum = ''; }
    const same = then != null && stable(then) === stable(now);
    rows.push({ p, title, sum, ic, same, bad:then == null });
  }
  const diff = rows.filter(r => !r.same && !r.bad);
  RS.docs.replaceChildren(
    h('div', { class:'rs-docs-head' },
      h('div', {}, h('b', {}, rsWhen(b)), h('span', {}, ' · ' + RS_KIND[b.kind])),
      diff.length > 1 ? confirmBtn('Восстановить всё отличающееся (' + diff.length + ')', () => doRestore(id, diff.map(r => r.p)), 'rs-all') : null),
    ...rows.map(r => h('div', { class:'rs-doc' + (r.same ? ' same' : '') },
      h('span', { class:'rs-doc-ico' }, icon(r.ic, 17)),
      h('div', { class:'rs-doc-t' }, h('b', {}, r.title), h('span', {}, r.bad ? 'файл копии повреждён' : r.same ? 'совпадает с текущими данными' : r.sum)),
      r.same || r.bad ? null : confirmBtn('Восстановить', () => doRestore(id, [r.p])))));
}
// Кнопка с подтверждением вторым нажатием (без системных диалогов).
function confirmBtn(label, run, cls){
  let armed = false, t = 0;
  const b = h('button', { type:'button', class:'tb-btn rs-go' + (cls ? ' ' + cls : ''), onclick:() => {
    if (!armed) { armed = true; b.textContent = 'Точно восстановить?'; b.classList.add('armed'); t = setTimeout(() => { armed = false; b.textContent = label; b.classList.remove('armed'); }, 4000); return; }
    clearTimeout(t); b.disabled = true; run();
  } }, label);
  return b;
}
async function doRestore(id, paths){
  const ea = window.electronAPI;
  await flushEverything();
  const r = await ea.backups.restore(id, paths);
  if (!r || !r.ok) { toast('Не удалось восстановить: ' + ((r && r.error) || 'ошибка')); if (RS.dlg) selectBackup(id); return; }
  await applyRestored(paths);
  const what = paths.length === 1 ? 'документ' : paths.length + ' ' + plural(paths.length, 'документ', 'документа', 'документов');
  toast('Восстановлено: ' + what + '. Прежняя версия сохранена в копию.', async () => {
    await flushEverything();
    const u = await ea.backups.restore(r.undoId, paths);
    if (u && u.ok) { await applyRestored(paths); toast('Восстановление отменено'); } else toast('Не удалось отменить: ' + ((u && u.error) || 'ошибка'));
    if (RS.dlg) loadRestoreList(RS.sel);
  });
  if (RS.dlg) { loadRestoreList(id); const f = RS.list.querySelector('.rs-item[aria-selected=true]') || RS.list; f.focus(); }   // открытая заново доска не уводит фокус из окна
}
// Восстановленные документы перечитываются в открытое приложение — без перезапуска.
async function applyRestored(paths){
  const ea = window.electronAPI;
  for (const p of paths) {
    const k = docKey(p);
    const sec = k === 'planner-cal' ? 'cal' : k === 'planner-plans' ? 'plans' : k === 'planner-ideas' ? 'ideas' : null;
    if (sec) {
      const d = await ea.dbGet(p);
      dirty.delete(sec); clearTimeout(timers[sec]); delete pendingRemote[sec];
      S[sec] = normalize(sec, d ? clone(d) : null);
      lastSaved[sec] = stable(d);
      refreshSection(sec);
      if (editing && editing.k === sec) editorSync();
    } else if (k === 'planner-tools' && typeof MT !== 'undefined') {
      const d = await ea.dbGet(p);
      MT.links = d && Array.isArray(d.links) ? d.links.map(normLink).filter(Boolean) : DEFAULT_LINKS;
      if (MT.pop && MT.pop.isConnected) renderToolsTab();
    } else if (k.startsWith('board-') && boardApi && boardApi.forget) {
      const reopen = boardApi.forget(k.slice(6));
      if (reopen && findOwner(k.slice(6))) boardApi.open(k.slice(6));
    }
  }
  if (paths.some(p => docKey(p) === 'planner-cal') && typeof miniNotify === 'function') miniNotify();
}
