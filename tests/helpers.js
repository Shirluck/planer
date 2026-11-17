// Общие помощники автотестов.
const { _electron, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(__dirname, '.fixtures');
const fx = name => path.join(FIX, name);
const DOC = name => 'data/users/local/' + name;

function tmpDataDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'planer-' + (tag || 'test') + '-')); }
function rmDir(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }

async function launch(dataDir, opts = {}) {
  const env = { ...process.env, PLANER_DATA_DIR: dataDir, ...(opts.env || {}) };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = opts.executablePath
    ? await _electron.launch({ executablePath: opts.executablePath, args: [], env })
    : await _electron.launch({ args: [ROOT], cwd: ROOT, env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.waitForSelector('#board:not(.loading) .col', { timeout: 30000 });
  if (opts.size) await setSize(app, opts.size[0], opts.size[1]);
  return { app, page, errors };
}
async function setSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(w, h); }, [w, h]);
  await new Promise(r => setTimeout(r, 250));
}
async function closeApp(app) { if (app) { try { await app.close(); } catch (_) {} } }

async function addTask(page, k, text) {
  const inp = page.locator('.col[data-key=' + k + '] .add-input');
  await inp.fill(text);
  await inp.press('Enter');
  const item = page.locator('.col[data-key=' + k + '] .item', { has: page.locator('textarea.txt') }).last();
  await expect(item).toBeVisible();
  return item.getAttribute('data-id');
}
async function openBoard(page, taskId) {
  const item = page.locator('.item[data-id="' + taskId + '"]');
  await item.hover();
  await item.locator('.board-btn').click();
  await expect(page.locator('.bd-sheet')).toBeVisible();
}
const boardDoc = (page, taskId) => page.evaluate(p => window.electronAPI.dbGet(p), DOC('board-' + taskId));
async function waitBoard(page, taskId, pred, msg) {
  let last = null;
  await expect.poll(async () => { last = await boardDoc(page, taskId); return !!(last && pred(last)); }, { message: msg || 'board doc', timeout: 15000 }).toBe(true);
  return last;
}
async function vpPoint(page, fx, fy) {
  const b = await page.locator('.bd-vp').boundingBox();
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}
// Щелчок по видимой (не перекрытой другими карточками) точке карточки.
async function clickCard(page, loc, opts = {}) {
  const find = () => loc.evaluate(el => {
    const r = el.getBoundingClientRect();
    for (const fy of [0.85, 0.5, 0.2]) for (const fx of [0.2, 0.5, 0.8]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy, t = document.elementFromPoint(x, y);
      if (t && el.contains(t) && !t.closest('button,.bd-rs,video,.bd-cbx')) return { x, y };
    }
    return null;
  });
  let pt = await find();
  if (!pt) {                                   // карточка за краем экрана — показать всю доску
    await page.click('.bd-zoom .bd-zb[aria-label^="Показать всё"]');
    await page.waitForTimeout(100);
    pt = await find();
  }
  if (!pt) throw new Error('card is fully covered');
  if (opts.double) await page.mouse.dblclick(pt.x, pt.y);
  else await page.mouse.click(pt.x, pt.y, { button: opts.button || 'left' });
}
async function toastText(page) {
  const t = page.locator('.toast');
  await expect(t).toBeVisible();
  return t.textContent();
}

module.exports = { ROOT, FIX, fx, DOC, tmpDataDir, rmDir, launch, setSize, closeApp, addTask, openBoard, boardDoc, waitBoard, vpPoint, toastText, clickCard };
