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
  // Вместо настоящего Claude Code — поддельный (tests/fake-claude.js): автотесты не тратят лимиты и не ходят в сеть.
  const env = { ...process.env, PLANER_DATA_DIR: dataDir, PLANER_TEST: '1', PLANER_CLAUDE_CMD: JSON.stringify([process.execPath, path.join(__dirname, 'fake-claude.js')]), ...(opts.env || {}) };
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

// Задача на сегодня (колонка «Сегодня») или в открытом окне дня (k = 'sheet').
async function addTask(page, k, text) {
  const scope = k === 'sheet' ? '.day-sheet' : '.col[data-key=' + k + ']';
  const inp = page.locator(scope + ' .add-input');
  await inp.fill(text);
  await inp.press('Enter');
  const item = page.locator(scope + ' .item', { has: page.locator('textarea.txt') }).last();
  await expect(item).toBeVisible();
  return item.getAttribute('data-id');
}
// Новый файл в «Основных планах» или «Идеях»: kind 'text' (редактор страницы) или 'board' (доска); окно закрывается.
async function addPage(page, k, title, kind = 'board') {
  await page.locator('.col[data-key=' + k + '] .tool[aria-label^="Новый файл"]').click();
  await page.click('.menu-it:has-text("' + (kind === 'board' ? 'Доска' : 'Текстовый документ') + '")');
  if (kind === 'board') {
    await expect(page.locator('.bd-title')).toBeFocused();
    await page.keyboard.type(title);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.locator('.bd-sheet')).toHaveCount(0);
  } else {
    await expect(page.locator('.sheet .title-in')).toBeFocused();
    await page.keyboard.type(title);
    await page.keyboard.press('Escape');
    await expect(page.locator('.sheet .title-in')).toHaveCount(0);
  }
  const row = page.locator('.col[data-key=' + k + '] .node.page', { hasText: title }).last();
  await expect(row).toBeVisible();
  return row.getAttribute('data-id');
}
// Доска открывается двойным щелчком по названию файла-доски.
async function openBoard(page, pageId) {
  await page.locator('.node[data-id="' + pageId + '"] .n-title').dblclick();
  await expect(page.locator('.bd-sheet')).toBeVisible();
}
const isoDay = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const calDoc = page => page.evaluate(p => window.electronAPI.dbGet(p), DOC('planner-cal'));
async function waitCal(page, pred, msg) {
  let last = null;
  await expect.poll(async () => { last = await calDoc(page); return !!(last && pred(last)); }, { message: msg || 'calendar doc', timeout: 15000 }).toBe(true);
  return last;
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

module.exports = { ROOT, FIX, fx, DOC, tmpDataDir, rmDir, launch, setSize, closeApp, addTask, addPage, openBoard, boardDoc, waitBoard, vpPoint, toastText, clickCard, isoDay, calDoc, waitCal };
