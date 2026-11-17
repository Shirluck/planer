// Прежние функции не сломаны: колонки, чекбоксы, приоритеты, заметки, сортировка, перенос, удаление с отменой,
// папки и страницы (редактор блоков), сохранение после перезапуска, резервные копии.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { tmpDataDir, rmDir, launch, closeApp, addTask } = require('./helpers');

test('задачи, страницы и папки работают как раньше', async () => {
  const dir = tmpDataDir('legacy');
  let { app, page, errors } = await launch(dir, { size: [1440, 900] });
  try {
    // задачи: приоритет через «!!!», чекбокс, заметка, сортировка
    await addTask(page, 'day', 'Обычная');
    await addTask(page, 'day', 'Срочная !!!');
    const items = page.locator('.col[data-key=day] .item');
    await expect(items.nth(1)).toHaveAttribute('data-pri', '3');
    await expect(items.nth(1).locator('.txt')).toHaveValue('Срочная');
    await items.nth(0).locator('.cb').click();
    await expect(items.nth(0)).toHaveClass(/done/);
    await expect(page.locator('.col[data-key=day] .prog .n')).toHaveText('1 / 2');
    await items.nth(1).hover();
    await items.nth(1).locator('.note-btn').click();
    await page.keyboard.type('детали');
    await page.locator('.col[data-key=day] .col-title').click();
    await expect(items.nth(1)).toHaveClass(/has-note/);
    await page.locator('.col[data-key=day] .tool[aria-label="Отсортировать по приоритету"]').click();
    await expect(items.nth(0).locator('.txt')).toHaveValue('Срочная');
    // перенос на завтра через меню и обратно отменой
    await items.nth(0).hover();
    await items.nth(0).locator('.more').click();
    await page.click('.menu-it:has-text("Перенести на завтра")');
    await expect(items).toHaveCount(1);                       // задача ушла на завтра
    await page.click('.toast button');
    await expect(items).toHaveCount(2);
    // удаление с отменой
    await items.nth(1).hover();
    await items.nth(1).locator('.more').click();
    await page.click('.menu-it:has-text("Удалить")');
    await expect(items).toHaveCount(1);
    await page.click('.toast button:has-text("Отменить")');
    await expect(items).toHaveCount(2);
    // страницы и папки
    await page.locator('.col[data-key=plans] .tool[aria-label="Новая страница"]').click();
    await expect(page.locator('.sheet')).toBeVisible();
    await page.keyboard.type('Цели на год');
    await page.keyboard.press('Enter');
    await page.keyboard.type('[] Выучить испанский');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Бегать');
    await page.keyboard.press('Escape');
    await expect(page.locator('.col[data-key=plans] .node.page .n-title', { hasText: 'Цели на год' })).toBeVisible();
    await expect(page.locator('.col[data-key=plans] .node.page', { hasText: 'Цели на год' }).locator('.n-meta')).toHaveText('0/2');
    await page.locator('.col[data-key=ideas] .tool[aria-label="Новая папка"]').click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Путешествия');
    await page.keyboard.press('Enter');
    await expect(page.locator('.col[data-key=ideas] .node.folder .n-title', { hasText: 'Путешествия' })).toBeVisible();
    await expect(page.locator('#status')).toHaveText('Сохранено');
    expect(errors).toEqual([]);
  } finally { await closeApp(app); }
  // после перезапуска всё на месте; есть ежедневная копия
  ({ app, page } = await launch(dir));
  try {
    await expect(page.locator('.col[data-key=day] .item')).toHaveCount(2);
    await expect(page.locator('.col[data-key=day] .item').first().locator('.txt')).toHaveValue('Срочная');
    await expect(page.locator('.col[data-key=day] .item').first()).toHaveClass(/has-note/);
    await expect(page.locator('.col[data-key=plans] .node.page .n-title', { hasText: 'Цели на год' })).toBeVisible();
    await expect(page.locator('.col[data-key=ideas] .node.folder .n-title', { hasText: 'Путешествия' })).toBeVisible();
    const today = 'docs-' + new Date().toISOString().slice(0, 10);
    expect(fs.existsSync(path.join(dir, 'backups', today))).toBe(true);
  } finally { await closeApp(app); rmDir(dir); }
});

test('смена ключа API: диалог из меню и сохранение в основном процессе', async () => {
  const dir = tmpDataDir('key');
  const { app, page } = await launch(dir);
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('ask-key'));
    await expect(page.locator('.pk-box')).toBeVisible();
    await page.fill('.pk-in', 'sk-ant-test-0123456789-abcdefghij');
    await page.click('.pk-ok');
    await expect(page.locator('.pk-box')).toHaveCount(0);
    expect(await page.evaluate(() => window.electronAPI.hasKey())).toBe(true);
    expect(fs.existsSync(path.join(dir, 'api-key.bin'))).toBe(true);
    const raw = fs.readFileSync(path.join(dir, 'api-key.bin'));
    expect(raw.toString('latin1')).not.toContain('sk-ant-test-0123456789');   // ключ зашифрован safeStorage
    await page.evaluate(() => window.electronAPI.clearKey());
    expect(await page.evaluate(() => window.electronAPI.hasKey())).toBe(false);
  } finally { await closeApp(app); rmDir(dir); }
});
