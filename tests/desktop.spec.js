// Настольные функции: мини-окно «Сегодня» из трея, оформление (тема, размер, компактный режим), автозапуск, запуск в трей.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { tmpDataDir, rmDir, launch, closeApp, addTask, waitCal, isoDay } = require('./helpers');

const settingsJson = dir => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));

test('мини-окно «Сегодня»: задачи, отметка, новая задача, таймер — всё синхронно с главным окном', async () => {
  const dir = tmpDataDir('mini');
  const { app, page, errors } = await launch(dir, { env: { PLANER_MINI_KEEP: '1' } });
  try {
    await addTask(page, 'day', 'Утренняя пробежка');
    await addTask(page, 'day', 'Сдать отчёт !!!');
    const [mini] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => global.__planerTray.click())]);
    const merr = [];
    mini.on('pageerror', e => merr.push(String(e)));
    await expect(mini.locator('.mn-item')).toHaveCount(2);
    await expect(mini.locator('.mn-item[data-pri="3"] .mn-t')).toHaveText('Сдать отчёт');
    await expect(mini.locator('#mnCount')).toHaveText('0 / 2');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.isVisible()).map(w => w.getTitle()).sort())).toContain('Планер — сегодня');
    // отметка в мини-окне → главное окно и документ
    await mini.locator('.mn-item', { hasText: 'Утренняя пробежка' }).locator('.mn-cb').click();
    await expect(page.locator('.col[data-key=day] .item.done .txt')).toHaveValue('Утренняя пробежка');
    await waitCal(page, c => c.days[isoDay(0)].items.find(t => t.text === 'Утренняя пробежка').done === true);
    // новая задача из мини-окна (!!! — срочно)
    await mini.locator('#mnInput').fill('Позвонить маме !!!');
    await mini.locator('#mnInput').press('Enter');
    await expect(mini.locator('.mn-item')).toHaveCount(3);
    await waitCal(page, c => c.days[isoDay(0)].items.some(t => t.text === 'Позвонить маме' && t.pri === 3));
    // изменение в главном окне → мини-окно обновляется само
    await addTask(page, 'day', 'Из главного окна');
    await expect(mini.locator('.mn-item', { hasText: 'Из главного окна' })).toHaveCount(1);
    // таймер из мини-окна
    await mini.locator('.mn-chip', { hasText: 'Фокус' }).click();
    await expect(mini.locator('.mn-tm')).toHaveCount(1);
    await expect(page.locator('#timerBtn')).toHaveClass(/running/);
    await mini.locator('.mn-tm button[aria-label="Остановить"]').click();
    await expect(mini.locator('.mn-tm')).toHaveCount(0);
    // щелчок по задаче открывает главное окно с этой задачей
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Планер').hide());
    await mini.locator('.mn-t', { hasText: 'Сдать отчёт' }).click();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Планер').isVisible())).toBe(true);
    await expect(page.locator('.col[data-key=day] .item .txt:focus')).toHaveValue('Сдать отчёт');
    expect(await app.evaluate(() => global.__planerTray.mini().isVisible())).toBe(false);
    // запросы мини-окна принимаются только от него самого
    expect(await page.evaluate(() => window.electronAPI.mini.call('add', { text: 'чужой запрос' }))).toEqual({ ok: false });
    expect(errors).toEqual([]); expect(merr).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); }
});

test('оформление: тема, размер интерфейса и компактный режим сохраняются и применяются', async () => {
  const dir = tmpDataDir('ui');
  let { app, page, errors } = await launch(dir);
  try {
    await page.click('#settingsBtn');
    const box = page.locator('.st-box');
    await expect(box).toBeVisible();
    await box.locator('.st-seg button', { hasText: 'Тёмная' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(20, 21, 24)');
    expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
    await box.locator('button[aria-label="Крупнее"]').click();
    await expect(box.locator('.st-zv')).toHaveText('110%');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBeCloseTo(1.1, 2);
    await box.locator('button[role=switch][aria-label="Компактный режим"]').click();
    await expect(page.locator('body')).toHaveClass(/compact/);
    expect(settingsJson(dir)).toMatchObject({ theme: 'dark', zoom: 1.1, compact: true });
    // пункты меню «Вид» отражают настройки
    const view = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === 'Вид').submenu.items.filter(i => i.type !== 'separator').map(i => [i.label, i.checked]));
    expect(view).toEqual(expect.arrayContaining([['Тема: тёмная', true], ['Компактный режим', true]]));
    await page.keyboard.press('Escape');
    await expect(box).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await closeApp(app); }
  // после перезапуска всё на месте
  ({ app, page, errors } = await launch(dir));
  try {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveClass(/compact/);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBeCloseTo(1.1, 2);
    // меню «Вид» → «Обычный размер», тема «как в системе»
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === 'Вид').submenu.items.find(i => i.label.startsWith('Обычный размер')).click());
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())).toBeCloseTo(1, 2);
    expect(await page.evaluate(() => window.electronAPI.ui.set({ theme: 'nope', zoom: 7, compact: 'yes' }))).toMatchObject({ theme: 'dark', zoom: 1, compact: true });   // неверные значения игнорируются
    await page.evaluate(() => window.electronAPI.ui.set({ theme: 'system' }));
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  } finally { await closeApp(app); rmDir(dir); }
});

test('автозапуск с Windows: переключатель в настройках и в меню трея, запуск сразу в трей', async () => {
  const dir = tmpDataDir('auto');
  let { app, page, errors } = await launch(dir);
  try {
    await page.click('#settingsBtn');
    await page.locator('.st-tabs').getByText('Запуск',{exact:true}).click();
    const sw = page.locator('button[role=switch][aria-label="Запускать вместе с Windows"]');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    const li = await app.evaluate(() => global.__planerTray.loginItem());
    expect(li.openAtLogin).toBe(true);
    expect(li.args).toContain('--hidden');
    expect(settingsJson(dir).autostart).toBe(true);
    expect(await app.evaluate(() => global.__planerTray.menu()[2])).toBe(true);        // галочка в меню трея
    await sw.click();
    expect((await app.evaluate(() => global.__planerTray.loginItem())).openAtLogin).toBe(false);
    expect(errors).toEqual([]);
  } finally { await closeApp(app); }
  // запуск с --hidden (так стартует автозапуск): окно не показывается, программа в трее
  ({ app, page, errors } = await launch(dir, { args: ['--hidden'] }));
  try {
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
    expect(await app.evaluate(() => global.__planerTray.isActive())).toBe(true);
    await app.evaluate(() => global.__planerTray.show());
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  } finally { await closeApp(app); rmDir(dir); }
});
