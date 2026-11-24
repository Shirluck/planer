// Основной процесс: окно, хранение данных (документы + медиа), ассистент (подписка Claude через Claude Code
// или ключ API Anthropic), превью ссылок, трей и мини-окно «Сегодня», таймеры, оформление, автозапуск, резервные копии.
// @ts-check
const { app, BrowserWindow, Menu, Tray, ipcMain, shell, safeStorage, protocol, dialog, clipboard, nativeImage, nativeTheme, Notification, screen, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore, writeAtomic } = require('./lib/store');
const { createMedia, sniff } = require('./lib/media');
const { createLinkPreview } = require('./lib/linkpreview');
const { createClaudeCode } = require('./lib/claudecode');
const { createTimers } = require('./lib/timers');
const { createBackups } = require('./lib/backups');
const { fmtClock, fmtDuration } = require('./src/core.js');

// Одинаковая папка данных и в режиме разработки, и в собранном приложении:
//   Windows: %APPDATA%\Planer     macOS: ~/Library/Application Support/Planer     Linux: ~/.config/Planer
// PLANER_DATA_DIR — отдельная папка данных (используется автотестами, чтобы не трогать настоящие данные).
app.setPath('userData', process.env.PLANER_DATA_DIR ? path.resolve(process.env.PLANER_DATA_DIR) : path.join(app.getPath('appData'), 'Planer'));

// Схема media:// для отдачи картинок и видео странице (до готовности приложения).
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

const isMac = process.platform === 'darwin';
const dataLocation = require('./lib/data-location').createLocation(app.getPath('userData'));
const dir = () => dataLocation.state().active;
ipcMain.handle('location:get', () => dataLocation.state());
ipcMain.handle('location:pick', async ev => {
  if (!win || ev.sender !== win.webContents) return;
  const choice = await dialog.showOpenDialog(win,{title:'Где хранить данные Планера?',properties:['openDirectory','createDirectory']});
  if (!choice.canceled) {
    try { dataLocation.choose(choice.filePaths[0]); }
    catch(err) { return {...dataLocation.state(),error:err.message}; }
  }
  return dataLocation.state();
});
ipcMain.handle('location:cancel', ev => {
  if (win && ev.sender === win.webContents) dataLocation.cancel();
  return dataLocation.state();
});
const keyFile = () => path.join(dir(), 'api-key.bin');
const iconFile = path.join(__dirname, 'build', 'icon.png');
// На Windows окна и трей берут .ico с готовыми маленькими размерами (16–256 px, подогнаны под пиксели) —
// так значок в панели задач и в трее совпадает с ярлыком; из PNG 1024 px Windows уменьшала бы сама, и он выглядел бы иначе.
const icoFile = path.join(__dirname, 'build', 'icon.ico');
const appIcon = () => (process.platform === 'win32' && fs.existsSync(icoFile) ? icoFile : fs.existsSync(iconFile) ? iconFile : undefined);
/** @type {BrowserWindow|null} */
let win = null;
/** @type {BrowserWindow|null} */
let mini = null;
let store = null, media = null, linkPreview = null, claudeCode = null, timers = null, backups = null;
const notices = [];
const TIMERS_DOC = 'data/users/local/planner-timers';
const startHidden = process.argv.includes('--hidden');   // автозапуск с Windows: сразу в трей, без окна

/** @param {string} channel @param {...any} args */
function sendToPage(channel, ...args) { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args); }
/** Сообщение всем окнам Планера (главному и мини-окну). @param {string} channel @param {...any} args */
function broadcast(channel, ...args) { for (const w of [win, mini]) if (w && !w.isDestroyed()) w.webContents.send(channel, ...args); }

/* ---------- данные ---------- */
function initStorage() {
  fs.mkdirSync(dir(), { recursive: true });
  store = createStore(dir(), {
    onNotice: m => notices.push(m),
    onError: m => sendToPage('store:error', m),
    onWrite: (_p, json) => { if (media) media.touchRefsInText(json); }
  });
  try { store.migrate(); } catch (e) {
    console.error('migrate:', e);
    notices.push('Не удалось подготовить хранилище данных: ' + ((e && e.message) || e));
  }
  media = createMedia(dir(), { nativeImage });
  linkPreview = createLinkPreview({ media, allowLocal: process.env.PLANER_ALLOW_LOCAL_PREVIEW === '1' });
  claudeCode = createClaudeCode({ workDir: path.join(dir(), 'claude-work'), getCustomPath: () => readSettings().claudePath || null });
  backups = createBackups({ dir: dir(), store });
  timers = createTimers({
    load: () => store.get(TIMERS_DOC),
    save: d => store.set(TIMERS_DOC, d),
    onChange: st => { broadcast('timer:state', st); updateTray(true); },
    onDone: timerDone
  });
  peerSync = require('./lib/peer-sync').createSync({ dir:dir(), store, media, backups, flush:flushPage,
    changed:paths => { if(paths.includes(TIMERS_DOC)) timers.reload(); sendToPage('sync:changed', paths); },
    activity:state => sendToPage('sync:state',state)
  });
  setInterval(() => { if(win && !win.isDestroyed()) void peerSync.tick(); }, 15000).unref();
  store.dailyBackup();
}

/* ---------- настройки ассистента ---------- */
// settings.json: { aiMode: 'claude-code' | 'api', ccModel: 'sonnet' | 'opus' | 'haiku', claudePath? }
// Без настройки: есть сохранённый ключ API — работаем через него, иначе через подписку Claude (Claude Code).
const settingsFile = () => path.join(dir(), 'settings.json');
const CC_MODELS = ['sonnet', 'opus', 'haiku'];
function readSettings() {
  try { const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); return s && typeof s === 'object' ? s : {}; } catch (_) { return {}; }
}
function writeSettings(patch) {
  const s = Object.assign(readSettings(), patch);
  writeAtomic(settingsFile(), Buffer.from(JSON.stringify(s, null, 2), 'utf8'));
  return s;
}
function aiState() {
  const s = readSettings();
  const mode = s.aiMode === 'api' || s.aiMode === 'claude-code' ? s.aiMode : (readKey() ? 'api' : 'claude-code');
  return { mode, model: CC_MODELS.includes(s.ccModel) ? s.ccModel : 'sonnet' };
}
function setAi(patch) {
  const p = {};
  if (patch && (patch.mode === 'api' || patch.mode === 'claude-code')) p.aiMode = patch.mode;
  if (patch && CC_MODELS.includes(patch.model)) p.ccModel = patch.model;
  if (Object.keys(p).length) writeSettings(p);
  buildMenu();
  const st = aiState();
  sendToPage('ai:state', st);
  return st;
}
ipcMain.handle('ai:get', () => aiState());
ipcMain.handle('ai:set', (_e, patch) => setAi(patch));

/* ---------- оформление: тема, размер интерфейса, компактный режим ---------- */
// settings.json: { theme: 'system' | 'light' | 'dark', zoom: 0.8…1.5, compact: boolean }
const THEMES = ['system', 'light', 'dark'];
const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.5];
function uiState() {
  const s = readSettings();
  const zoom = ZOOMS.includes(s.zoom) ? s.zoom : 1;
  return { style: ['clean','neon','atelier'].includes(s.style) ? s.style : 'clean', neon: /^#[a-f0-9]{6}$/i.test(s.neon) ? s.neon : '#29dbc5', theme: THEMES.includes(s.theme) ? s.theme : 'system', zoom, compact: !!s.compact, dark: nativeTheme.shouldUseDarkColors };
}
const themeBg = () => nativeTheme.shouldUseDarkColors ? '#131210' : '#f3f1ec';
function applyUi() {
  const st = uiState();
  nativeTheme.themeSource = /** @type {'system'|'light'|'dark'} */ (st.theme);
  for (const w of [win, mini]) if (w && !w.isDestroyed()) w.setBackgroundColor(themeBg());
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(st.zoom);
  return st;
}
/** @param {any} patch */
function setUi(patch) {
  const p = {};
  if (patch && ['clean','neon','atelier'].includes(patch.style)) p.style = patch.style;
  if (patch && typeof patch.neon === 'string' && /^#[a-f0-9]{6}$/i.test(patch.neon)) p.neon = patch.neon;
  if (patch && THEMES.includes(patch.theme)) p.theme = patch.theme;
  if (patch && ZOOMS.includes(patch.zoom)) p.zoom = patch.zoom;
  if (patch && typeof patch.compact === 'boolean') p.compact = patch.compact;
  if (Object.keys(p).length) writeSettings(p);
  applyUi(); buildMenu();
  const st = uiState();
  broadcast('ui:state', st);
  return st;
}
/** Крупнее (+1), мельче (−1) или обычный размер (0). @param {number} dir */
function zoomStep(dir) {
  const i = ZOOMS.indexOf(uiState().zoom);
  return setUi({ zoom: dir === 0 ? 1 : ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, i + dir))] });
}
ipcMain.handle('ui:get', () => uiState());
ipcMain.handle('ui:set', (_e, patch) => setUi(patch));
nativeTheme.on('updated', () => { for (const w of [win, mini]) if (w && !w.isDestroyed()) w.setBackgroundColor(themeBg()); broadcast('ui:state', uiState()); });

/* ---------- автозапуск вместе с Windows (сразу в трей) ---------- */
// В автотестах (PLANER_TEST) системный автозапуск не трогаем — только запоминаем, что было бы записано.
let testLoginItem = null;
function loginItemTarget() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;     // portable-версия распаковывается во временную папку
  return { path: exe, args: app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'] };
}
function autostartState() {
  const available = process.platform === 'win32' || isMac;
  return { enabled: !!readSettings().autostart && available, available, portable: !!process.env.PORTABLE_EXECUTABLE_FILE };
}
/** @param {boolean} on */
function setAutostart(on) {
  if (!autostartState().available) return autostartState();
  writeSettings({ autostart: !!on });
  const t = loginItemTarget();
  const opts = { openAtLogin: !!on, path: t.path, args: t.args };
  if (process.env.PLANER_TEST) testLoginItem = opts;
  else { try { app.setLoginItemSettings(opts); } catch (e) { console.error('autostart:', e); } }
  buildMenu(); updateTray(true);
  const r = autostartState();
  broadcast('autostart:state', r);
  return r;
}
ipcMain.handle('autostart:get', () => autostartState());
ipcMain.handle('autostart:set', (_e, on) => setAutostart(on === true));

/* ---------- таймеры (lib/timers.js) ---------- */
let lastDone = null;
/** @param {any} r */
function timerDone(r) {
  broadcast('timer:done', { id: r.id, presetId: r.presetId, title: r.title, ms: r.ms });
  lastDone = { title: r.title, at: Date.now() };
  if (Notification.isSupported() && !process.env.PLANER_TEST) {
    try {
      const n = new Notification({ title: 'Таймер «' + r.title + '» закончился', body: fmtDuration(r.ms) + ' · нажмите, чтобы открыть Планер', silent: true,
        icon: fs.existsSync(iconFile) ? nativeImage.createFromPath(iconFile) : undefined });
      n.on('click', () => showWindow());
      n.show();
    } catch (e) { console.error('notification:', e); }
  }
  updateTray(true);
}
ipcMain.handle('timer:state', () => timers.state());
ipcMain.handle('timer:start', (_e, a) => timers.start(a && typeof a === 'object' ? { presetId: a.presetId, title: a.title, ms: a.ms } : {}));
ipcMain.handle('timer:pause', (_e, id) => timers.pause(id));
ipcMain.handle('timer:resume', (_e, id) => timers.resume(id));
ipcMain.handle('timer:stop', (_e, id) => timers.stop(id));
ipcMain.handle('timer:stopAll', () => timers.stopAll());
ipcMain.handle('timer:add', (_e, id, ms) => timers.add(id, ms));
ipcMain.handle('timer:setPresets', (_e, list) => timers.setPresets(list));
ipcMain.handle('timer:setSound', (_e, s) => timers.setSound(s));

/* ---------- резервные копии и восстановление (lib/backups.js) ---------- */
ipcMain.handle('backup:list', () => backups.list());
ipcMain.handle('backup:read', (_e, id, p) => { try { return backups.read(id, p); } catch (_) { return null; } });
ipcMain.handle('backup:restore', (_e, id, paths) => {
  let r;
  try { r = backups.restore(id, paths); } catch (_) { return { ok: false, error: 'Неверная копия или документ.' }; }
  if (r.ok && r.restored.includes(TIMERS_DOC)) timers.reload();
  return r;
});
ipcMain.handle('backup:snapshot', () => { try { return { ok: true, ...backups.snapshot('manual') }; } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } });
ipcMain.handle('backup:openFolder', () => { fs.mkdirSync(backups.backupsDir, { recursive: true }); shell.openPath(backups.backupsDir); return true; });

/* ---------- мини-окно «Сегодня»: данные — у главного окна (там живёт состояние), здесь только пересылка ---------- */
const relayWait = new Map();
let relaySeq = 0;
/** @param {string} op @param {any} args */
function askMainPage(op, args) {
  return new Promise((resolve, reject) => {
    if (!win || win.isDestroyed() || win.webContents.isLoading()) { reject(new Error('main window not ready')); return; }
    const id = ++relaySeq;
    const t = setTimeout(() => { relayWait.delete(id); reject(new Error('timeout')); }, 4000);
    relayWait.set(id, v => { clearTimeout(t); relayWait.delete(id); resolve(v); });
    win.webContents.send('mini:op', { id, op, args });
  });
}
ipcMain.on('mini:reply', (e, id, result) => { if (win && e.sender === win.webContents && relayWait.has(id)) relayWait.get(id)(result); });
ipcMain.handle('mini:call', async (e, op, args) => {
  if (!mini || e.sender !== mini.webContents) return { ok: false };
  const a = args && typeof args === 'object' ? args : {};
  let safe;
  if (op === 'today') safe = {};
  else if (op === 'toggle') safe = { id: String(a.id || '').slice(0, 40) };
  else if (op === 'add') { const text = String(a.text || '').trim().slice(0, 500); if (!text) return { ok: false }; safe = { text }; }
  else return { ok: false };
  try { return { ok: true, data: await askMainPage(op, safe) }; } catch (_) { return { ok: false }; }
});
ipcMain.on('mini:changed', e => { if (win && e.sender === win.webContents && mini && !mini.isDestroyed() && mini.isVisible()) mini.webContents.send('mini:refresh'); });
ipcMain.handle('mini:openMain', (e, what) => {
  if (!mini || e.sender !== mini.webContents) return false;
  mini.hide(); showWindow();
  const w = what && typeof what === 'object' ? what : {};
  if (w.command === 'timers' || w.command === 'search') sendToPage('app:command', w.command);
  else if (typeof w.taskId === 'string') sendToPage('app:command', 'task', w.taskId.slice(0, 40));
  return true;
});
ipcMain.handle('mini:hide', e => { if (mini && e.sender === mini.webContents) mini.hide(); return true; });

/* ---------- ассистент через подписку Claude (локальный Claude Code) ---------- */
const IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
function ccRequest(req) {
  const r = req || {};
  const system = String(r.system || '').slice(0, 60000);
  const names = (Array.isArray(r.toolNames) ? r.toolNames : []).filter(n => typeof n === 'string' && /^[a-z][a-z0-9_]{0,40}$/.test(n)).slice(0, 40);
  let size = 0;
  const content = (Array.isArray(r.content) ? r.content : []).slice(0, 80).map(b => {
    if (b && b.type === 'text' && typeof b.text === 'string') { size += b.text.length; return { type: 'text', text: b.text }; }
    if (b && b.type === 'image' && b.source && b.source.type === 'base64' && IMG_TYPES.includes(b.source.media_type) && typeof b.source.data === 'string' && /^[A-Za-z0-9+/=]+$/.test(b.source.data.slice(0, 200))) {
      size += b.source.data.length; return { type: 'image', source: { type: 'base64', media_type: b.source.media_type, data: b.source.data } };
    }
    return null;
  }).filter(Boolean);
  if (!content.length) throw new Error('empty request');
  if (size > 24e6) throw new Error('request too large');
  return { system, content, toolNames: names, model: aiState().model };
}
ipcMain.handle('cc:status', () => claudeCode.status());
ipcMain.handle('cc:run', async (_e, rid, req) => {
  let q; try { q = ccRequest(req); } catch (e) { return { ok: false, code: 'bad_request', error: String(e.message || e) }; }
  return claudeCode.run(String(rid || '').slice(0, 80) || 'x', q);
});
ipcMain.handle('cc:cancel', (_e, rid) => claudeCode.cancel(String(rid || '')));
ipcMain.handle('cc:login', () => claudeCode.openLogin());
ipcMain.handle('cc:pickPath', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Где находится Claude Code (claude.exe)?', properties: ['openFile'],
    filters: process.platform === 'win32' ? [{ name: 'claude.exe', extensions: ['exe'] }] : [] });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  const f = r.filePaths[0];
  if (!/^claude(\.exe)?$/i.test(path.basename(f))) return { ok: false, error: 'Нужен файл claude.exe (Claude Code).' };
  writeSettings({ claudePath: f });
  return { ok: true, path: f };
});

const docPath = p => { if (!store.validPath(p)) throw new Error('bad path'); return p; };
ipcMain.handle('db:get', (_e, p) => store.get(docPath(p)));
ipcMain.handle('db:set', (_e, p, d) => { store.set(docPath(p), d); return true; });
ipcMain.handle('db:delete', (_e, p) => { store.remove(docPath(p)); return true; });

/* ---------- медиа ---------- */
const isId = id => typeof id === 'string' && media.ID_RE.test(id);
ipcMain.handle('media:importPath', (e, p, name, token) => media.importPath(p, name, (loaded, total, nm) => {
  if (!e.sender.isDestroyed()) e.sender.send('media:progress', { token: String(token || ''), loaded, total, name: nm });
}));
ipcMain.handle('media:importBuffer', (_e, name, mime, data) => media.importBuffer(name, mime, data));
ipcMain.handle('media:putThumb', (_e, id, ext, data) => { try { return media.putThumb(id, ext, data); } catch (_) { return false; } });
ipcMain.handle('media:putVector', (_e, json) => media.putVector(json));
ipcMain.handle('media:getVector', (_e, id) => media.getVector(id));
ipcMain.handle('media:info', (_e, id) => (isId(id) ? media.info(id) : null));
ipcMain.handle('media:openExternal', async (_e, id) => {
  const f = isId(id) ? media.filePathOf(id) : null;
  if (!f) return { ok: false, error: 'Файл не найден.' };
  const err = await shell.openPath(f);
  return err ? { ok: false, error: 'Не удалось открыть файл во внешней программе: ' + err } : { ok: true };
});
const toBuf = d => Buffer.from(d instanceof Uint8Array ? d : new Uint8Array(d || []));
ipcMain.handle('media:savePng', async (_e, name, data) => {
  const buf = toBuf(data);
  if (sniff(buf) !== 'png') return { ok: false, error: 'Не удалось подготовить изображение.' };
  const base = String(name || 'image').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\.[a-z0-9]{2,4}$/i, '').trim().slice(0, 80) || 'image';
  const r = await dialog.showSaveDialog(win, { title: 'Сохранить как PNG', defaultPath: path.join(app.getPath('pictures'), base + '.png'), filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try { writeAtomic(r.filePath, buf); return { ok: true, path: r.filePath }; }
  catch (e) { return { ok: false, error: e.code === 'ENOSPC' ? 'Недостаточно места на диске.' : 'Не удалось сохранить файл.' }; }
});
// Буфер обмена: в Electron 45+ асинхронный API в стиле W3C (ClipboardItem), в старых версиях — writeImage.
ipcMain.handle('media:copyPng', async (_e, data) => {
  const buf = toBuf(data);
  if (sniff(buf) !== 'png') return false;
  try {
    const legacy = /** @type {any} */ (clipboard);   // writeImage есть только в старых версиях Electron
    if (typeof legacy.writeImage === 'function') {
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return false;
      legacy.writeImage(img);
    } else {
      const { ClipboardItem } = require('electron');
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([buf], { type: 'image/png' }) })]);
    }
    return true;
  } catch (e) { console.error('copyPng:', e); return false; }
});
ipcMain.handle('clip:writeText', async (_e, t) => {
  if (typeof t !== 'string' || t.length > 1e6) return false;
  try { await clipboard.writeText(t); return true; } catch (_) { return false; }
});
// Превью ссылки на доске: заголовок, описание, картинка (страницу загружает основной процесс).
ipcMain.handle('link:preview', async (_e, url) => { try { return await linkPreview.fetchPreview(String(url || '').slice(0, 2048)); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } });
ipcMain.handle('app:openUrl', async (_e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    await shell.openExternal(u.href);
    return true;
  } catch (_) { return false; }
});
ipcMain.handle('app:notices', () => notices.splice(0));
ipcMain.handle('app:info', () => ({ version: app.getVersion(), dataDir: dir(), schema: store.SCHEMA }));

/* ---------- ключ API ---------- */
function readKey() {
  try {
    const buf = fs.readFileSync(keyFile());
    if (!buf.length) return null;
    return buf[0] === 1 ? safeStorage.decryptString(buf.subarray(1)) : buf.subarray(1).toString('utf8');
  } catch (e) { return null; }
}
function writeKey(k) {
  const enc = safeStorage.isEncryptionAvailable();
  const body = enc ? Buffer.concat([Buffer.from([1]), safeStorage.encryptString(k)])
                   : Buffer.concat([Buffer.from([0]), Buffer.from(k, 'utf8')]);
  writeAtomic(keyFile(), body, 0o600);
}
const clearKey = () => { try { fs.unlinkSync(keyFile()); } catch (_) {} };
ipcMain.handle('key:has', () => !!readKey());
ipcMain.handle('key:set', (_e, k) => { if (typeof k !== 'string' || k.length < 20 || k.length > 400) throw new Error('bad key'); writeKey(k.trim()); setAi({}); return true; });
ipcMain.handle('key:clear', () => { clearKey(); setAi({}); return true; });

/* ---------- запросы к API Anthropic (ключ не покидает основной процесс) ---------- */
const inflight = new Map();
ipcMain.handle('anthropic', async (_e, rid, body) => {
  const key = readKey();
  if (!key) return { ok: false, status: 401, data: { error: { message: 'Нет ключа API' } } };
  const b = body || {};
  const payload = { model: b.model, max_tokens: b.max_tokens, messages: b.messages };
  if (Array.isArray(b.tools) && b.tools.length) payload.tools = b.tools;
  const ctrl = new AbortController();
  inflight.set(rid, ctrl);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
    let json = null;
    try { json = await r.json(); } catch (_) {}
    return { ok: r.ok, status: r.status, data: json };
  } catch (e) {
    return { ok: false, status: 0, aborted: ctrl.signal.aborted, data: { error: { message: String((e && e.message) || e) } } };
  } finally { inflight.delete(rid); }
});
ipcMain.handle('anthropic:cancel', (_e, rid) => { const c = inflight.get(rid); if (c) c.abort(); return true; });

/* ---------- окно и меню ---------- */
let peerSync = null;
ipcMain.handle('sync:get', () => peerSync.state());
ipcMain.handle('sync:setup', async (e, enable) => {
  if (!win || e.sender !== win.webContents || typeof enable !== 'boolean') return;
  try {
    let root = '';
    if (enable) {
      const choice = await dialog.showOpenDialog(win,{title:'Выберите общую папку двух ПК',properties:['openDirectory']});
      if (choice.canceled) return;
      root = choice.filePaths[0];
      if(!await flushPage()) throw Error('Не удалось сохранить все изменения');
    }
    peerSync.setup(root);
    if(enable) void peerSync.tick();
  } catch(err) { sendToPage('app:command','toast',err.message); }
});
let quitting = false;
const webPrefs = () => ({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
  autoplayPolicy: /** @type {'no-user-gesture-required'} */ ('no-user-gesture-required') });   // звук таймера, даже когда окно в трее
/** Окну нельзя уходить со своей страницы и открывать новые окна. @param {BrowserWindow} w @param {string} file */
function lockNavigation(w, file) {
  const pageUrl = require('url').pathToFileURL(path.join(__dirname, file)).href;
  w.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // Никаких переходов со страницы (в том числе при случайном перетаскивании файла в окно).
  w.webContents.on('will-navigate', (e, url) => { if (url.split('#')[0] !== pageUrl) e.preventDefault(); });
}
function createWindow() {
  const show = !(startHidden && tray);
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 760, minHeight: 560, show,
    title: 'Планер', backgroundColor: themeBg(), autoHideMenuBar: true,
    icon: appIcon(),
    webPreferences: webPrefs()
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  lockNavigation(win, 'index.html');
  win.webContents.on('did-finish-load', () => { if (win) win.webContents.setZoomFactor(uiState().zoom); });
  // Ctrl+колесо вне доски — размер интерфейса (на доске колесо с Ctrl меняет масштаб холста).
  win.webContents.on('zoom-changed', (_e, d) => zoomStep(d === 'in' ? 1 : -1));

  // Крестик и «Свернуть» убирают окно в трей; полностью программа закрывается из меню значка в трее.
  // Перед настоящим закрытием страница дописывает несохранённые изменения.
  let closeReady = false;
  win.on('close', e => {
    if (closeReady || win.webContents.isCrashed()) return;
    e.preventDefault();
    if (!quitting && tray) { hideToTray(); return; }
    flushPage().then(() => {
      closeReady = true;
      try { store.flush(); } catch (_) {}
      if (win && !win.isDestroyed()) win.close();
      if (quitting) app.quit();
    });
  });
  win.on('minimize', () => { if (tray && !isMac && !quitting) hideToTray(); });
  win.on('closed', () => { win = null; if (mini && !mini.isDestroyed()) mini.destroy(); mini = null; });
}
// Страница дописывает несохранённое (ответ app:flushed или не дольше 2 секунд).
function flushPage() {
  return new Promise(resolve => {
    if (!win || win.isDestroyed() || win.webContents.isCrashed()) { resolve(false); return; }
    let done = false;
    const finish = saved => { if (done) return; done = true; ipcMain.removeListener('app:flushed', onFlushed); resolve(saved); };
    const onFlushed = (ev, saved) => { if (win && ev.sender === win.webContents) finish(saved === true); };
    ipcMain.on('app:flushed', onFlushed);
    win.webContents.send('app:flush');
    setTimeout(() => finish(false), 5000);
  });
}

/* ---------- трей ---------- */
/** @type {Tray|null} */
let tray = null;
let trayHintShown = false;
function showWindow() {
  if (!win) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function hideToTray() {
  if (!win || win.isDestroyed()) return;
  win.hide();
  flushPage().then(() => { try { store.flush(); } catch (_) {} });
  if (process.platform === 'win32' && !trayHintShown && !process.env.PLANER_TEST) {
    trayHintShown = true;
    const flag = path.join(dir(), 'tray-hint-shown');
    if (!fs.existsSync(flag)) {
      try { tray.displayBalloon({ title: 'Планер работает в трее', content: 'Окно убрано к часам. Щелчок по значку — дела на сегодня, правая кнопка → «Выйти из Планера» — выход.', iconType: 'info' }); fs.writeFileSync(flag, '1'); } catch (_) {}
    }
  }
}
function quitFully() {
  if (updates && updates.ready()) { void updates.install(false); return; }
  quitting = true; app.quit();
}
let updates = null;
const portableBuild = !!process.env.PORTABLE_EXECUTABLE_FILE;
function updateState() {
  return { available: !!updates, portable: portableBuild, enabled: readSettings().updates !== false, status: updates?.status() };
}
ipcMain.handle('update:get', updateState);
ipcMain.handle('update:action', (ev, action) => {
  if (!win || ev.sender !== win.webContents || !updates) return;
  if (typeof action === 'boolean') { writeSettings({ updates: action }); sendToPage('update:state', updateState()); }
  if (action === 'check') void updates.check();
  if (action === 'install') void updates.install(true);
});
function initUpdates() {
  if (!app.isPackaged || process.platform !== 'win32' || portableBuild || process.env.PLANER_TEST || process.env.PLANER_SMOKE ||
      !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return;
  updates = require('./lib/updates').createUpdates(require('electron-updater').autoUpdater,
    () => sendToPage('update:state', updateState()), async () => {
      if (!await flushPage() || !store.flush()) throw new Error('save');
      backups.snapshot('manual');
    }, version => sendToPage('app:command', 'toast', 'Версия ' + version + ' готова. Откройте настройки для установки.'));
  const tick = () => { if (updateState().enabled) void updates.check(); };
  setTimeout(tick, 15000).unref();
  setInterval(tick, 4 * 60 * 60 * 1000).unref();
}
/** @param {string} cmd @param {...any} args */
function pageCommand(cmd, ...args) { showWindow(); sendToPage('app:command', cmd, ...args); }

// Подсказка у значка: идущий таймер с оставшимся временем; меню — запуск таймеров и автозапуск.
let trayTick = null, trayMenuKey = '';
/** @param {boolean} [menuToo] */
function updateTray(menuToo) {
  if (!tray || tray.isDestroyed()) return;
  const n = timers ? timers.nearest() : null;
  const tip = n ? 'Планер · ' + n.title + ' ' + (n.paused ? '(пауза) ' : '') + fmtClock(n.left) + (n.count > 1 ? ' · таймеров: ' + n.count : '') : 'Планер';
  tray.setToolTip(tip);
  if (n && !n.paused && !trayTick) trayTick = setInterval(() => updateTray(false), 1000);
  if ((!n || n.paused) && trayTick) { clearInterval(trayTick); trayTick = null; }
  if (menuToo) buildTrayMenu();
}
function buildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const st = timers ? timers.state() : { presets: [], running: [] };
  const auto = autostartState();
  const key = JSON.stringify([st.presets, st.running.length, auto.enabled]);
  if (key === trayMenuKey) return;
  trayMenuKey = key;
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const tpl = [
    { label: 'Сегодня…', click: () => toggleMini(true) },
    { label: 'Открыть Планер', click: showWindow },
    { type: 'separator' },
    { label: 'Запустить таймер', enabled: st.presets.length > 0, submenu: st.presets.length
      ? st.presets.map(p => ({ label: p.title + ' — ' + fmtDuration(p.ms), click: () => timers.start({ presetId: p.id }) }))
      : [{ label: 'Нет таймеров', enabled: false }] },
    { label: st.running.length > 1 ? 'Остановить таймеры (' + st.running.length + ')' : 'Остановить таймер', enabled: st.running.length > 0, click: () => timers.stopAll() },
    { label: 'Таймеры…', click: () => pageCommand('timers') },
    { type: 'separator' }
  ];
  if (auto.available) tpl.push({ label: 'Запускать вместе с Windows', type: 'checkbox', checked: auto.enabled, click: mi => setAutostart(mi.checked) }, { type: 'separator' });
  tpl.push({ label: 'Выйти из Планера', click: quitFully });
  tray.setContextMenu(Menu.buildFromTemplate(tpl));
}
function createTray() {
  const file = appIcon(); if (!file) return;
  const img = file.endsWith('.ico') ? nativeImage.createFromPath(file)     // Windows сама выберет 16/24/32 px под масштаб экрана
    : nativeImage.createFromPath(file).resize({ width: isMac ? 18 : 32, height: isMac ? 18 : 32, quality: 'best' });
  tray = new Tray(img);
  tray.setToolTip('Планер');
  updateTray(true);
  tray.on('click', () => toggleMini());                // щелчок — мини-окно «Сегодня»
  tray.on('double-click', showWindow);                 // двойной щелчок — всё приложение
  global.__planerTray = {                              // для автотестов
    isActive: () => !!tray && !tray.isDestroyed(), show: showWindow, quit: quitFully, click: () => toggleMini(),
    mini: () => mini, tooltip: () => trayTip(), menu: () => trayMenuLabels(), loginItem: () => testLoginItem
  };
}
const trayTip = () => { const n = timers && timers.nearest(); return n ? n.title + ' ' + fmtClock(n.left) : 'Планер'; };
const trayMenuLabels = () => { try { buildTrayMenu(); return JSON.parse(trayMenuKey); } catch (_) { return null; } };

/* ---------- мини-окно «Сегодня» (щелчок по значку в трее) ---------- */
const MINI_W = 360, MINI_H = 520;
function createMini() {
  mini = new BrowserWindow({
    width: MINI_W, height: MINI_H, show: false, frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, title: 'Планер — сегодня', backgroundColor: themeBg(),
    icon: appIcon(), webPreferences: webPrefs()
  });
  mini.loadFile(path.join(__dirname, 'mini.html'));
  lockNavigation(mini, 'mini.html');
  mini.on('blur', () => { if (mini && Date.now() - (miniShownAt || 0) > 300 && !process.env.PLANER_MINI_KEEP) mini.hide(); });
  mini.on('closed', () => { mini = null; });
}
let miniShownAt = 0;
function placeMini() {
  const tb = tray && !tray.isDestroyed() ? tray.getBounds() : null;
  const pt = tb && tb.width ? { x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 } : screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint({ x: Math.round(pt.x), y: Math.round(pt.y) }).workArea;
  const x = Math.round(Math.min(Math.max(pt.x - MINI_W / 2, wa.x + 8), wa.x + wa.width - MINI_W - 8));
  const y = pt.y > wa.y + wa.height / 2 ? wa.y + wa.height - MINI_H - 8 : wa.y + 8;
  mini.setBounds({ x, y, width: MINI_W, height: MINI_H });
}
/** @param {boolean} [forceShow] */
function toggleMini(forceShow) {
  if (!mini || mini.isDestroyed()) createMini();
  if (mini.isVisible() && !forceShow) { mini.hide(); return; }
  placeMini();
  miniShownAt = Date.now();
  mini.show(); mini.focus();
  mini.webContents.send('mini:refresh');
}

function showAbout() {
  dialog.showMessageBox(win, {
    type: 'info', title: 'О программе', message: 'Планер', buttons: ['OK'],
    icon: fs.existsSync(iconFile) ? nativeImage.createFromPath(iconFile) : undefined,
    detail: 'Версия ' + app.getVersion() + '\nЛичный планировщик с досками задач.\n\nДанные: ' + dir() +
      '\nElectron ' + process.versions.electron + ', Chromium ' + process.versions.chrome
  });
}
function buildMenu() {
  const ai = aiState(), ui = uiState(), auto = autostartState();
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const view = [
    { label: 'Найти… (Ctrl+K)', click: () => pageCommand('search') },
    { type: 'separator' },
    { label: 'Тема: как в системе', type: 'radio', checked: ui.theme === 'system', click: () => setUi({ theme: 'system' }) },
    { label: 'Тема: светлая', type: 'radio', checked: ui.theme === 'light', click: () => setUi({ theme: 'light' }) },
    { label: 'Тема: тёмная', type: 'radio', checked: ui.theme === 'dark', click: () => setUi({ theme: 'dark' }) },
    { type: 'separator' },
    { label: 'Компактный режим', type: 'checkbox', checked: ui.compact, click: mi => setUi({ compact: mi.checked }) },
    { label: 'Крупнее', accelerator: 'CmdOrCtrl+=', click: () => zoomStep(1) },
    { label: 'Мельче', accelerator: 'CmdOrCtrl+-', click: () => zoomStep(-1) },
    { label: 'Обычный размер интерфейса (' + Math.round(ui.zoom * 100) + '%)', accelerator: 'CmdOrCtrl+0', click: () => zoomStep(0) },
    { type: 'separator' },
    { label: 'Настройки…', click: () => pageCommand('settings') },
    { role: 'togglefullscreen', label: 'Во весь экран' }
  ];
  if (!app.isPackaged) view.push({ type: 'separator' }, { role: 'reload', label: 'Перезагрузить' }, { role: 'toggleDevTools', label: 'Инструменты разработчика' });
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [];
  if (isMac) template.push({ role: 'appMenu' });
  template.push(
    { label: 'Правка', submenu: [
      { role: 'undo', label: 'Отменить' }, { role: 'redo', label: 'Повторить' }, { type: 'separator' },
      { role: 'cut', label: 'Вырезать' }, { role: 'copy', label: 'Копировать' }, { role: 'paste', label: 'Вставить' },
      { role: 'selectAll', label: 'Выделить всё' }
    ] },
    { label: 'Вид', submenu: view },
    { role: 'windowMenu', label: 'Окно' },
    { label: 'Таймеры', submenu: [
      { label: 'Таймеры…', click: () => pageCommand('timers') },
      { label: 'Остановить все таймеры', click: () => timers.stopAll() },
      { type: 'separator' },
      { label: 'Моушн: ссылки, экспрешены, тайминг…', click: () => pageCommand('tools') }
    ] },
    { label: 'Ассистент', submenu: [
      { label: 'Через подписку Claude (Claude Code)', type: 'radio', checked: ai.mode === 'claude-code', click: () => setAi({ mode: 'claude-code' }) },
      { label: 'Через ключ API Anthropic', type: 'radio', checked: ai.mode === 'api', click: () => setAi({ mode: 'api' }) },
      { type: 'separator' },
      { label: 'Подключение и вход в Claude…', click: () => { showWindow(); sendToPage('ai-settings'); } },
      { type: 'separator' },
      { label: 'Ключ API Anthropic…', click: () => sendToPage('ask-key') },
      { label: 'Удалить сохранённый ключ', click: () => { clearKey(); setAi({}); } },
      { label: 'Создать ключ (console.anthropic.com)', click: () => shell.openExternal('https://console.anthropic.com/settings/keys') }
    ] },
    { label: 'Данные', submenu: [
      { label: 'Восстановить из копии…', click: () => pageCommand('restore') },
      { label: 'Сделать копию сейчас', click: () => { try { backups.snapshot('manual'); sendToPage('app:command', 'toast', 'Копия данных сделана'); } catch (e) { console.error('snapshot:', e); } } },
      { type: 'separator' },
      { label: 'Открыть папку с данными', click: () => { try { store.flush(); } catch (_) {} shell.openPath(dir()); } },
      { label: 'Открыть папку с резервными копиями', click: () => { const b = path.join(dir(), 'backups'); fs.mkdirSync(b, { recursive: true }); shell.openPath(b); } },
      ...(auto.available ? [{ type: /** @type {'separator'} */ ('separator') },
        { label: 'Запускать вместе с Windows', type: /** @type {'checkbox'} */ ('checkbox'), checked: auto.enabled, click: mi => setAutostart(mi.checked) }] : [])
    ] },
    { label: 'Справка', submenu: [{ label: 'О программе', click: showAbout }, { type: 'separator' }, { label: 'Выйти из Планера', accelerator: 'CmdOrCtrl+Q', click: () => quitFully() }] }
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- проверка собранного приложения (scripts/packaged-check.js) ---------- */
// PLANER_SMOKE=1: дождаться загрузки окна, записать итог в <папка данных>/smoke.json и выйти. Пишет только в папку данных.
function smokeCheck() {
  const errors = [];
  win.webContents.on('console-message', (/** @type {any} */ e) => { if (e && e.level === 'error') errors.push(String(e.message).slice(0, 300)); });
  win.webContents.once('did-finish-load', () => setTimeout(async () => {
    let page = null;
    try { page = await win.webContents.executeJavaScript('({ cols: document.querySelectorAll(".col").length, loading: document.getElementById("board").classList.contains("loading"), core: !!window.PlanerCore, board: !!window.PlanerBoard, api: !!window.electronAPI, node: typeof require })'); } catch (e) { errors.push(String(e)); }
    fs.writeFileSync(path.join(dir(), 'smoke.json'), JSON.stringify({ version: app.getVersion(), packaged: app.isPackaged, page, errors }));
    quitFully();
  }, 2500));
}

process.on('uncaughtException', e => { console.error('uncaught:', e); });
process.on('unhandledRejection', e => { console.error('unhandled:', e); });

if (!app.requestSingleInstanceLock()) {
  app.quit();           // второй экземпляр не запускаем: два окна затирали бы данные друг друга
} else {
  app.on('second-instance', () => { if (store) showWindow(); });
  if (process.platform === 'win32') app.setAppUserModelId('local.planer.desktop');
  app.setAboutPanelOptions({ applicationName: 'Планер', applicationVersion: app.getVersion() });
  app.whenReady().then(async () => {
    try {
      const notice = await dataLocation.start();
      if (notice) notices.push(notice);
    } catch(err) {
      dialog.showErrorBox('Папка данных недоступна',err.message);
      app.quit(); return;
    }
    initStorage();
    applyUi();
    protocol.handle('media', req => media.handleRequest(req));
    initUpdates();
    buildMenu();
    try { createTray(); } catch (e) { console.error('tray:', e); tray = null; }
    createWindow();
    if (process.env.PLANER_SMOKE === '1') smokeCheck();
    // Сборка мусора в медиа — после запуска, в фоне.
    setTimeout(() => { media.gc(() => store.allDocTexts()).catch(e => console.error('gc:', e)); }, Number(process.env.PLANER_GC_DELAY_MS) || 8000);
    // Программа живёт в трее днями: ежедневная копия делается и без перезапуска.
    setInterval(() => { try { store.flush(); store.dailyBackup(); } catch (e) { console.error('backup:', e); } }, 60 * 60 * 1000);
    // После сна компьютера таймеры, время которых вышло, срабатывают сразу.
    powerMonitor.on('resume', () => { if (timers) timers.check(); });
    app.on('activate', () => showWindow());
  });
  app.on('before-quit', () => { quitting = true; try { if (claudeCode) claudeCode.cancelAll(); if (timers) timers.dispose(); if (store) store.flush(); if (media) media.saveIndex(); } catch (_) {} });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
