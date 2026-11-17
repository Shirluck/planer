// Основной процесс: окно, хранение данных в файле, хранение ключа, запросы к API Anthropic.
const { app, BrowserWindow, Menu, ipcMain, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

// Одинаковая папка данных и в режиме разработки, и в собранном приложении:
//   Windows: %APPDATA%\Planer     macOS: ~/Library/Application Support/Planer     Linux: ~/.config/Planer
app.setPath('userData', path.join(app.getPath('appData'), 'Planer'));

const isMac = process.platform === 'darwin';
const dir = () => app.getPath('userData');
const dataFile = () => path.join(dir(), 'planner-data.json');
const keyFile = () => path.join(dir(), 'api-key.bin');
let win = null;

/* ---------- файл с данными ---------- */
let data = {};
let saveTimer = null;

function writeAtomic(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}
function loadData() {
  try { data = JSON.parse(fs.readFileSync(dataFile(), 'utf8')) || {}; }
  catch (e) {
    data = {};
    if (fs.existsSync(dataFile())) {          // файл есть, но повреждён: не затираем, откладываем в сторону
      try { fs.renameSync(dataFile(), dataFile() + '.corrupt-' + Date.now()); } catch (_) {}
    }
  }
}
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  try { writeAtomic(dataFile(), JSON.stringify(data)); }
  catch (e) { console.error('Не удалось сохранить данные:', e); }
}
const scheduleSave = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); };

// Ежедневная копия на случай ошибки: backups/planner-data-ГГГГ-ММ-ДД.json, хранятся последние 14
function dailyBackup() {
  try {
    if (!fs.existsSync(dataFile())) return;
    const bdir = path.join(dir(), 'backups');
    fs.mkdirSync(bdir, { recursive: true });
    const name = 'planner-data-' + new Date().toISOString().slice(0, 10) + '.json';
    const dst = path.join(bdir, name);
    if (!fs.existsSync(dst)) fs.copyFileSync(dataFile(), dst);
    const all = fs.readdirSync(bdir).filter(f => /^planner-data-.*\.json$/.test(f)).sort();
    all.slice(0, Math.max(0, all.length - 14)).forEach(f => { try { fs.unlinkSync(path.join(bdir, f)); } catch (_) {} });
  } catch (e) { console.error('backup:', e); }
}

ipcMain.handle('db:get', (_e, p) => (Object.prototype.hasOwnProperty.call(data, p) ? data[p] : null));
ipcMain.handle('db:set', (_e, p, d) => { data[p] = d; scheduleSave(); return true; });
ipcMain.handle('db:delete', (_e, p) => { delete data[p]; scheduleSave(); return true; });

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
ipcMain.handle('key:set', (_e, k) => { if (typeof k !== 'string' || k.length < 20 || k.length > 400) throw new Error('bad key'); writeKey(k.trim()); return true; });
ipcMain.handle('key:clear', () => { clearKey(); return true; });

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
function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 920, minWidth: 760, minHeight: 560,
    title: 'Планер', backgroundColor: '#f3f1ec', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) e.preventDefault(); });
  win.on('closed', () => { win = null; });
}
function buildMenu() {
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { label: 'Ассистент', submenu: [
      { label: 'Ключ API Anthropic…', click: () => win && win.webContents.send('ask-key') },
      { label: 'Удалить сохранённый ключ', click: () => clearKey() },
      { type: 'separator' },
      { label: 'Создать ключ (console.anthropic.com)', click: () => shell.openExternal('https://console.anthropic.com/settings/keys') }
    ] },
    { label: 'Данные', submenu: [
      { label: 'Показать файл с данными', click: () => { saveNow(); shell.showItemInFolder(dataFile()); } }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();           // второй экземпляр не запускаем: два окна затирали бы данные друг друга
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    loadData(); dailyBackup(); buildMenu(); createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('before-quit', saveNow);
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
