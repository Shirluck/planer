// Сквозной тест собранного приложения: dist/win-unpacked/Planer.exe (или путь из PLANER_EXE).
// Запуск: npm run dist:dir && npm run test:packaged
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { ROOT, fx, tmpDataDir, rmDir, launch, closeApp, addTask, addPage, openBoard, waitBoard, vpPoint, waitCal, isoDay } = require('./helpers');

const exe = process.env.PLANER_EXE || path.join(ROOT, 'dist', 'win-unpacked', process.platform === 'win32' ? 'Planer.exe' : 'planer');

test('собранное приложение: запуск, доска, медиа, перезапуск', async () => {
  test.skip(!fs.existsSync(exe), 'нет сборки: выполните npm run dist:dir');
  const dir = tmpDataDir('packaged');
  let { app, page, errors } = await launch(dir, { executablePath: exe, size: [1280, 800] });
  let taskId;
  try {
    const info = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion(), name: app.getName(), appPath: app.getAppPath() }));
    expect(info.packaged).toBe(true);
    expect(info.version).toBe(require(path.join(ROOT, 'package.json')).version);
    expect(info.appPath).toMatch(/app\.asar$/);
    expect(await page.evaluate(() => window.electronAPI.appInfo().then(i => i.version))).toBe(info.version);
    await addTask(page, 'day', 'Задача из сборки !!!');
    await waitCal(page, c => c.days[isoDay(0)] && c.days[isoDay(0)].items.length === 1);
    taskId = await addPage(page, 'plans', 'Проверка сборки');
    await openBoard(page, taskId);
    const p = await vpPoint(page, 0.3, 0.3);
    await page.mouse.dblclick(p.x, p.y);
    await page.keyboard.type('Заметка из сборки');
    await page.locator('.bd-vp').click({ position: { x: 5, y: 5 } });
    await page.setInputFiles('.bd-file', [fx('photo.png'), fx('clip.webm')]);
    const d = await waitBoard(page, taskId, d => d.items.length === 3);
    const img = d.items.find(i => i.type === 'image');
    expect(fs.existsSync(path.join(dir, 'media', img.mediaId + '.png'))).toBe(true);
    expect(d.items.find(i => i.type === 'video').thumb).toBe(true);
    // зарисовка в упакованном приложении
    await page.click('.bd-rail-btn[aria-label="Зарисовка"]');
    const st = await page.locator('.sk-stage').boundingBox();
    await page.mouse.move(st.x + 200, st.y + 200); await page.mouse.down(); await page.mouse.move(st.x + 400, st.y + 260, { steps: 8 }); await page.mouse.up();
    await page.keyboard.press('Escape');
    await waitBoard(page, taskId, d => d.items.some(i => i.type === 'sketch' && i.mediaId));
    expect(errors).toEqual([]);
  } finally { await closeApp(app); }

  ({ app, page, errors } = await launch(dir, { executablePath: exe, size: [1280, 800] }));
  try {
    await expect(page.locator('.col[data-key=day] .item .txt')).toHaveValue('Задача из сборки');
    await expect(page.locator('.col[data-key=week] .wk-day.today .wk-task')).toHaveText('Задача из сборки');
    await expect(page.locator('.node[data-id="' + taskId + '"] .n-board .bc')).toHaveText('4');
    await openBoard(page, taskId);
    await page.click('.bd-zoom .bd-zb[aria-label^="Показать всё"]');
    await expect(page.locator('.bd-card')).toHaveCount(4);
    for (const sel of ['.bd-card.t-image img.bd-img', '.bd-card.t-video img.bd-img', '.bd-card.t-sketch img.bd-img']) {
      await expect.poll(() => page.locator(sel).evaluate(i => i.complete && i.naturalWidth), { message: sel }).toBeGreaterThan(0);
    }
    await expect(page.locator('.bd-card.t-note')).toContainText('Заметка из сборки');
    const v = page.locator('.bd-card.t-video');
    await v.locator('.bd-play').click();
    await expect.poll(() => v.locator('video').evaluate(x => x.readyState)).toBeGreaterThanOrEqual(2);
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); }
});
