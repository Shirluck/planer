// Таймеры для фокусировки: кнопка в шапке, панель, шаблоны, пауза/продолжение, окончание со звуком и сообщением.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { tmpDataDir, rmDir, launch, closeApp, DOC } = require('./helpers');

const timersDoc = page => page.evaluate(p => window.electronAPI.dbGet(p), DOC('planner-timers'));

test('таймер: запуск из панели, отсчёт в шапке и трее, пауза, +1 минута, остановка', async () => {
  const dir = tmpDataDir('timers');
  const { app, page, errors } = await launch(dir);
  try {
    const btn = page.locator('#timerBtn');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Таймеры');
    // кнопка — в левом углу шапки, сразу после названия
    const [bb, brand] = await Promise.all([btn.boundingBox(), page.locator('.brand').boundingBox()]);
    expect(bb.x).toBeLessThan(400);
    expect(bb.x).toBeGreaterThan(brand.x + brand.width - 1);
    await btn.click();
    const pop = page.locator('.tm-pop');
    await expect(pop).toBeVisible();
    await expect(pop.locator('.tm-pre')).toHaveCount(4);                 // шаблоны по умолчанию
    await pop.locator('.tm-pre[data-pid=focus] .tm-start').click();
    const run = pop.locator('.tm-run');
    await expect(run).toHaveCount(1);
    await expect(run.locator('.tm-time')).toHaveText(/^2[45]:\d\d$/);
    await expect(btn).toHaveClass(/running/);
    await expect(btn.locator('.tm-btn-time')).toHaveText(/^2[45]:\d\d$/);
    await expect(btn.locator('.tm-btn-name')).toHaveText('Фокус');
    const t1 = await btn.locator('.tm-btn-time').textContent();
    await expect.poll(() => btn.locator('.tm-btn-time').textContent(), { timeout: 4000 }).not.toBe(t1);    // время идёт
    expect(await app.evaluate(() => global.__planerTray.tooltip())).toMatch(/^Фокус 2\d:\d\d$/);
    // пауза: время стоит
    await run.locator('.tm-pp').click();
    await expect(run).toHaveClass(/paused/);
    const paused = await run.locator('.tm-time').textContent();
    await page.waitForTimeout(1300);
    await expect(run.locator('.tm-time')).toHaveText(paused);
    await run.locator('.tm-plus').click();                                  // +1 минута
    const [m, s] = paused.split(':').map(Number);
    await expect(run.locator('.tm-time')).toHaveText((m + 1) + ':' + String(s).padStart(2, '0'));
    await run.locator('.tm-pp').click();
    await expect(run).not.toHaveClass(/paused/);
    await run.locator('.tm-stop').click();
    await expect(run).toHaveCount(0);
    await expect(btn).not.toHaveClass(/running/);
    await expect(btn.locator('.tm-btn-time')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); }
});

test('свой таймер: создать, запустить, в конце — звук и сообщение; правка и удаление с отменой', async () => {
  const dir = tmpDataDir('timers2');
  const { app, page, errors } = await launch(dir);
  try {
    await page.click('#timerBtn');
    const pop = page.locator('.tm-pop');
    await pop.locator('.tm-name').fill('Чтение');
    await pop.locator('.tm-dur').fill('абв');
    await pop.locator('.tm-form .tb-btn.primary').click();
    await expect(pop.locator('.tm-err')).toContainText('Длительность');     // неверная длительность — подсказка
    await pop.locator('.tm-dur').fill('3 сек');
    await pop.getByRole('button', { name: 'Добавить и запустить' }).click();
    await expect(pop.locator('.tm-pre')).toHaveCount(5);
    await expect(pop.locator('.tm-pre').last().locator('.tm-pre-t')).toHaveText('Чтение');
    await expect(pop.locator('.tm-run')).toHaveCount(1);
    // шаблон сохранён в документе таймеров (как остальные данные: с копиями)
    const doc = await timersDoc(page);
    expect(doc.presets.find(p => p.title === 'Чтение').ms).toBe(3000);
    // окончание
    const done = page.locator('.tm-done');
    await expect(done).toBeVisible({ timeout: 8000 });
    await expect(done).toContainText('«Чтение» — время вышло');
    expect(await page.evaluate(() => TM.lastSound && TM.lastSound.title)).toBe('Чтение');
    await expect(page.locator('#timerBtn')).not.toHaveClass(/running/);
    // «Ещё 5 мин» запускает разовый таймер с тем же названием
    await done.getByRole('button', { name: 'Ещё 5 мин' }).click();
    await expect(done).toHaveCount(0);
    await expect(page.locator('#timerBtn .tm-btn-time')).toHaveText(/^[45]:\d\d$/);
    await page.evaluate(() => window.electronAPI.timers.stopAll());
    // правка шаблона
    await page.click('#timerBtn');
    const row = pop.locator('.tm-pre', { hasText: 'Чтение' });
    await row.hover();
    await row.locator('.tm-edit').click();
    await expect(pop.locator('.tm-form .tm-cap')).toHaveText('Изменить «Чтение»');
    await pop.locator('.tm-dur').fill('1ч 30м');
    await pop.locator('.tm-form .tb-btn.primary').click();
    await expect(row.locator('.tm-pre-d')).toHaveText('1 ч 30 мин');
    // удаление с отменой
    await row.hover();
    await row.locator('.tm-del').click();
    await expect(pop.locator('.tm-pre', { hasText: 'Чтение' })).toHaveCount(0);
    await page.locator('.toast button').click();
    await expect(pop.locator('.tm-pre', { hasText: 'Чтение' })).toHaveCount(1);
    // звук: вид и громкость сохраняются
    await pop.locator('.tm-sound select').first().selectOption('soft');
    await expect.poll(async () => (await timersDoc(page)).sound).toBe('soft');
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); }
});

test('таймеры из меню значка в трее и из главного меню', async () => {
  const dir = tmpDataDir('timers3');
  const { app, page } = await launch(dir);
  try {
    const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(i => i.label));
    expect(labels).toContain('Таймеры');
    // в меню трея — запуск шаблона
    expect(await app.evaluate(() => global.__planerTray.menu()[0].map(p => p.title))).toEqual(['Фокус', 'Короткий перерыв', 'Длинный перерыв', 'Глубокая работа']);
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === 'Таймеры').submenu.items[0].click());
    await expect(page.locator('.tm-pop')).toBeVisible();
  } finally { await closeApp(app); rmDir(dir); }
});
