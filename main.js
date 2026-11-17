// Основной процесс: окно, хранение данных (документы + медиа), ассистент (подписка Claude через Claude Code
// или ключ API Anthropic), превью ссылок, трей.
const { app, BrowserWindow, Menu, Tray, ipcMain, shell, safeStorage, protocol, dialog, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { createStore, writeAtomic } = require('./lib/store');
const { createMedia, sniff } = require('./lib/media');
const { createLinkPreview } = require('./lib/linkpreview');
const { createClaudeCode } = require('./lib/claudecode');

// Одинаковая папка данных и в режиме разработки, и в собранном приложении:
//   Windows: %APPDATA%\Planer     macOS: ~/Library/Application Support/Planer     Linux: ~/.config/Planer
// PLANER_DATA_DIR — отдельная папка данных (используется автотестами, чтобы не трогать настоящие данные).
app.setPath('userData', process.env.PLANER_DATA_DIR ? path.resolve(process.env.PLANER_DATA_DIR) : path.join(app.getPath('appData'), 'Planer'));

// Схема media:// для отдачи картинок и видео странице (до готовности приложения).
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

const isMac = process.platform === 'darwin';
const dir = () => app.getPath('userData');
const keyFile = () => path.join(dir(), 'api-key.bin');
const iconFile = path.join(__dirname, 'build', 'icon.png');
let win = null;
let store = null, media = null, linkPreview = null, claudeCode = null;
const notices = [];

function sendToPage(channel, ...args) { if (win && !win.isDestroyed()) win.webContents.send(channel, ...args); }

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
    if (typeof clipboard.writeImage === 'function') {
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return false;
      clipboard.writeImage(img);
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
let quitting = false;
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 760, minHeight: 560,
    title: 'Планер', backgroundColor: '#f3f1ec', autoHideMenuBar: true,
    icon: fs.existsSync(iconFile) ? iconFile : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  const pageUrl = require('url').pathToFileURL(path.join(__dirname, 'index.html')).href;
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  // Никаких переходов со страницы (в том числе при случайном перетаскивании файла в окно).
  win.webContents.on('will-navigate', (e, url) => { if (url.split('#')[0] !== pageUrl) e.preventDefault(); });

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
  win.on('closed', () => { win = null; });
}
// Страница дописывает несохранённое (ответ app:flushed или не дольше 2 секунд).
function flushPage() {
  return new Promise(resolve => {
    if (!win || win.isDestroyed() || win.webContents.isCrashed()) { resolve(); return; }
    let done = false;
    const finish = () => { if (done) return; done = true; ipcMain.removeListener('app:flushed', onFlushed); resolve(); };
    const onFlushed = ev => { if (win && ev.sender === win.webContents) finish(); };
    ipcMain.on('app:flushed', onFlushed);
    win.webContents.send('app:flush');
    setTimeout(finish, 2000);
  });
}

/* ---------- трей ---------- */
let tray = null, trayHintShown = false;
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
      try { tray.displayBalloon({ title: 'Планер работает в трее', content: 'Окно убрано к часам. Чтобы выйти полностью, щёлкните значок правой кнопкой → «Выйти из Планера».', iconType: 'info' }); fs.writeFileSync(flag, '1'); } catch (_) {}
    }
  }
}
function quitFully() { quitting = true; app.quit(); }
function createTray() {
  if (!fs.existsSync(iconFile)) return;
  const img = nativeImage.createFromPath(iconFile).resize({ width: isMac ? 18 : 32, height: isMac ? 18 : 32, quality: 'best' });
  tray = new Tray(img);
  tray.setToolTip('Планер');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Планер', click: showWindow },
    { type: 'separator' },
    { label: 'Выйти из Планера', click: quitFully }
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  global.__planerTray = { isActive: () => !!tray && !tray.isDestroyed(), show: showWindow, quit: quitFully };   // для автотестов
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
  const ai = aiState();
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'Правка', submenu: [
      { role: 'undo', label: 'Отменить' }, { role: 'redo', label: 'Повторить' }, { type: 'separator' },
      { role: 'cut', label: 'Вырезать' }, { role: 'copy', label: 'Копировать' }, { role: 'paste', label: 'Вставить' },
      { role: 'selectAll', label: 'Выделить всё' }
    ] },
    { label: 'Вид', submenu: [
      { role: 'resetZoom', label: 'Обычный размер интерфейса' }, { role: 'zoomIn', label: 'Крупнее' }, { role: 'zoomOut', label: 'Мельче' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Во весь экран' },
      ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'reload', label: 'Перезагрузить' }, { role: 'toggleDevTools', label: 'Инструменты разработчика' }])
    ] },
    { role: 'windowMenu', label: 'Окно' },
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
      { label: 'Открыть папку с данными', click: () => { try { store.flush(); } catch (_) {} shell.openPath(dir()); } },
      { label: 'Открыть папку с резервными копиями', click: () => { const b = path.join(dir(), 'backups'); fs.mkdirSync(b, { recursive: true }); shell.openPath(b); } }
    ] },
    { label: 'Справка', submenu: [{ label: 'О программе', click: showAbout }, { type: 'separator' }, { label: 'Выйти из Планера', accelerator: 'CmdOrCtrl+Q', click: () => quitFully() }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

process.on('uncaughtException', e => { console.error('uncaught:', e); });
process.on('unhandledRejection', e => { console.error('unhandled:', e); });

if (!app.requestSingleInstanceLock()) {
  app.quit();           // второй экземпляр не запускаем: два окна затирали бы данные друг друга
} else {
  app.on('second-instance', () => showWindow());
  if (process.platform === 'win32') app.setAppUserModelId('local.planer.desktop');
  app.setAboutPanelOptions({ applicationName: 'Планер', applicationVersion: app.getVersion() });
  app.whenReady().then(() => {
    initStorage();
    protocol.handle('media', req => media.handleRequest(req));
    buildMenu(); createWindow();
    try { createTray(); } catch (e) { console.error('tray:', e); tray = null; }
    // Сборка мусора в медиа — после запуска, в фоне.
    setTimeout(() => { media.gc(() => store.allDocTexts()).catch(e => console.error('gc:', e)); }, Number(process.env.PLANER_GC_DELAY_MS) || 8000);
    app.on('activate', () => showWindow());
  });
  app.on('before-quit', () => { quitting = true; try { if (claudeCode) claudeCode.cancelAll(); if (store) store.flush(); if (media) media.saveIndex(); } catch (_) {} });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
