// Перетаскивание задач мышью и блоки времени дня (цветные группы «с … до …»).
const { test, expect } = require('@playwright/test');
const { tmpDataDir, rmDir, launch, closeApp, addTask, isoDay, calDoc, waitCal } = require('./helpers');

const today = '.col[data-key=day]';
const texts = (page, scope) => page.locator(scope + ' .item .txt').evaluateAll(x => x.map(i => i.value));
const dayDoc = async (page, k = isoDay(0)) => { const c = await calDoc(page); return c && c.days[k]; };
// Перетащить мышью: от центра элемента a к точке элемента b (fy — доля высоты b).
async function drag(page, a, b, fy = 0.5, opts = {}) {
  const ra = await a.boundingBox(), rb = await b.boundingBox();
  await page.mouse.move(ra.x + Math.min(40, ra.width / 2), ra.y + ra.height / 2);
  await page.mouse.down();
  await page.mouse.move(ra.x + 50, ra.y + ra.height / 2 + 8, { steps: 3 });
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height * fy, { steps: 8 });
  if (opts.beforeUp) await opts.beforeUp();
  await page.mouse.up();
}
async function newBlock(page, from, to, title, color) {
  await page.click(today + ' .tool[aria-label^="Добавить блок времени"]');
  await expect(page.locator('.tb-pop')).toBeVisible();
  await page.locator('.tb-pop .tb-time-in').nth(0).fill(from);
  await page.locator('.tb-pop .tb-time-in').nth(1).fill(to);
  if (title) await page.fill('.tb-pop .tb-name', title);
  if (color) await page.click('.tb-pop .tb-sw-b[data-color=' + color + ']');
  await page.click('.tb-pop .tb-btn.primary');
  await expect(page.locator('.tb-pop')).toHaveCount(0);
}

test.describe.serial('Перетаскивание и блоки времени', () => {
  let dir, app, page, errors;
  test.beforeAll(() => { dir = tmpDataDir('blocks'); });
  test.afterAll(async () => { await closeApp(app); rmDir(dir); });

  test('задачи меняются местами мышью: за текст и за ручку; Esc отменяет', async () => {
    ({ app, page, errors } = await launch(dir, { size: [1440, 900] }));
    for (const t of ['Первая', 'Вторая', 'Третья']) await addTask(page, 'day', t);
    const rows = page.locator(today + ' .item');
    // «Третья» за текст — наверх (над «Первой»)
    await drag(page, rows.nth(2).locator('.txt'), rows.nth(0), 0.2);
    await expect.poll(() => texts(page, today)).toEqual(['Третья', 'Первая', 'Вторая']);
    // «Третья» за ручку — вниз (под «Вторую»)
    await rows.nth(0).hover();
    await drag(page, rows.nth(0).locator('.grip'), rows.nth(2), 0.85);
    await expect.poll(() => texts(page, today)).toEqual(['Первая', 'Вторая', 'Третья']);
    await waitCal(page, c => c.days[isoDay(0)].items.map(t => t.text).join() === 'Первая,Вторая,Третья');
    // Esc посреди перетаскивания — ничего не меняется
    await drag(page, rows.nth(0).locator('.txt'), rows.nth(2), 0.9, { beforeUp: () => page.keyboard.press('Escape') });
    await expect.poll(() => texts(page, today)).toEqual(['Первая', 'Вторая', 'Третья']);
    await expect(page.locator('.task-ghost')).toHaveCount(0);
  });

  test('щелчок по тексту по-прежнему редактирует задачу', async () => {
    const t = page.locator(today + ' .item').nth(1).locator('.txt');
    await t.click();
    await expect(t).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.type(' (изм.)');
    await page.keyboard.press('Enter');
    await expect(t).toHaveValue('Вторая (изм.)');
    // выделение текста внутри поля в режиме ввода не превращается в перенос
    await t.click();
    const r = await t.boundingBox();
    await page.mouse.move(r.x + 4, r.y + r.height / 2); await page.mouse.down();
    await page.mouse.move(r.x + 60, r.y + r.height / 2 + 30, { steps: 5 }); await page.mouse.up();
    await expect(page.locator('.task-ghost')).toHaveCount(0);
    await expect.poll(() => texts(page, today)).toEqual(['Первая', 'Вторая (изм.)', 'Третья']);
    await page.keyboard.press('Escape');
  });

  test('блоки времени: создание, проверка времени, порядок и цвет', async () => {
    await newBlock(page, '12:00', '18:00', 'Дела', 'orange');
    await newBlock(page, '10:00', '12:00', 'Работа', 'blue');
    // конец раньше начала — понятная ошибка
    await page.click(today + ' .tool[aria-label^="Добавить блок времени"]');
    await page.locator('.tb-pop .tb-time-in').nth(0).fill('18:00');
    await page.locator('.tb-pop .tb-time-in').nth(1).fill('06:00');
    await page.click('.tb-pop .tb-btn.primary');
    await expect(page.locator('.tb-err')).toContainText('позже начала');
    await page.keyboard.press('Escape');
    await expect(page.locator('.tb-pop')).toHaveCount(0);
    const blocks = page.locator(today + ' .tblock');
    await expect(blocks).toHaveCount(2);
    await expect(blocks.nth(0).locator('.tb-time')).toHaveText('10:00 – 12:00');           // по времени начала
    await expect(blocks.nth(0).locator('.tb-title')).toHaveText('Работа');
    await expect(blocks.nth(1)).toHaveAttribute('data-color', 'orange');
    const d = await waitCal(page, c => c.days[isoDay(0)].blocks && c.days[isoDay(0)].blocks.length === 2);
    expect(d.days[isoDay(0)].blocks.map(b => b.from + '-' + b.to).sort()).toEqual(['10:00-12:00', '12:00-18:00']);
  });

  test('задачи попадают в блок: перетаскиванием, через «+» блока и через меню', async () => {
    const work = page.locator(today + ' .tblock', { hasText: 'Работа' }), deals = page.locator(today + ' .tblock', { hasText: 'Дела' });
    await drag(page, page.locator(today + ' .item', { has: page.locator('.txt') }).nth(0).locator('.txt'), work.locator('.tb-empty'));
    await expect(work.locator('.item .txt')).toHaveValue('Первая');
    // «+» в блоке: несколько задач подряд
    await deals.locator('.tb-add').click();
    await page.keyboard.type('Обед'); await page.keyboard.press('Enter');
    await page.keyboard.type('Спортзал !!!'); await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect.poll(() => texts(page, today + ' .tblock[data-color=orange]')).toEqual(['Обед', 'Спортзал']);
    // меню задачи: «В блок …»
    const loose = page.locator(today + ' .tz[data-block=""] .item').first();
    await expect(loose.locator('.txt')).toHaveValue('Вторая (изм.)');
    await loose.hover(); await loose.locator('.more').click();
    await page.click('.menu-it:has-text("В блок 10:00–12:00")');
    await expect.poll(() => texts(page, today + ' .tblock[data-color=blue]')).toEqual(['Первая', 'Вторая (изм.)']);
    // из блока обратно в «В любое время» перетаскиванием
    await drag(page, work.locator('.item').nth(1).locator('.txt'), page.locator(today + ' .tz[data-block=""] .item').first(), 0.8);
    await expect.poll(() => texts(page, today + ' .tz[data-block=""]')).toEqual(['Третья', 'Вторая (изм.)']);
    const d = await waitCal(page, c => c.days[isoDay(0)].items.filter(t => t.block).length === 3);
    const blockOf = (txt) => { const t = d.days[isoDay(0)].items.find(x => x.text === txt); return t.block ? d.days[isoDay(0)].blocks.find(b => b.id === t.block).title : null; };
    expect([blockOf('Первая'), blockOf('Обед'), blockOf('Спортзал'), blockOf('Третья')]).toEqual(['Работа', 'Дела', 'Дела', null]);
    // срочная задача из блока видна в обзоре недели со временем блока
    await expect(page.locator('.col[data-key=week] .wk-day.today .wk-task .wk-time')).toHaveText('12:00');
  });

  test('изменение и удаление блока (задачи остаются), отмена удаления', async () => {
    const work = page.locator(today + ' .tblock', { hasText: 'Работа' });
    await work.locator('.tb-more').click();
    await page.click('.menu-it:has-text("Изменить время")');
    await page.locator('.tb-pop .tb-time-in').nth(0).fill('09:00');
    await page.click('.tb-pop .tb-sw-b[data-color=green]');
    await page.click('.tb-pop .tb-btn.primary');
    await expect(work.locator('.tb-time')).toHaveText('09:00 – 12:00');
    await expect(work).toHaveAttribute('data-color', 'green');
    await work.locator('.tb-more').click();
    await page.click('.menu-it:has-text("Удалить блок")');
    await expect(page.locator(today + ' .tblock')).toHaveCount(1);
    await expect.poll(async () => (await texts(page, today + ' .tz[data-block=""]')).sort()).toEqual(['Вторая (изм.)', 'Первая', 'Третья']);   // задачи блока остались в дне
    await page.click('.toast button:has-text("Отменить")');
    await expect(page.locator(today + ' .tblock')).toHaveCount(2);
    await expect.poll(() => texts(page, today + ' .tblock[data-color=green]')).toEqual(['Первая']);
  });

  test('блоки дня копируются на другой день; перенос задачи в другой день убирает блок', async () => {
    const other = isoDay(1);
    await page.locator('.col[data-key=week] .mc-day[data-date="' + other + '"]').click().catch(async () => {
      await page.locator('.col[data-key=week] .mc-nav[aria-label="Следующий месяц"]').click();
      await page.locator('.col[data-key=week] .mc-day[data-date="' + other + '"]').click();
    });
    await expect(page.locator('.day-sheet')).toBeVisible();
    await page.click('.day-sheet .day-block-btn');
    await page.click('.tb-pop .tb-copy');
    await expect(page.locator('.day-sheet .tblock')).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(page.locator('.day-sheet')).toHaveCount(0);
    // задача из блока «Дела» → на завтра: блок снимается (у каждого дня свои блоки)
    const lunch = page.locator(today + ' .tblock[data-color=orange] .item').first();
    await lunch.hover(); await lunch.locator('.more').click();
    await page.click('.menu-it:has-text("Перенести на завтра")');
    const c = await waitCal(page, c => c.days[isoDay(1)] && c.days[isoDay(1)].items.some(t => t.text === 'Обед'));
    expect(c.days[isoDay(1)].items.find(t => t.text === 'Обед').block).toBeUndefined();
    expect(c.days[isoDay(1)].blocks.length).toBe(2);
  });

  test('блок, который идёт сейчас, отмечен «сейчас»', async () => {
    const d = new Date(), hh = d.getHours();
    const from = String(Math.max(0, hh - 1)).padStart(2, '0') + ':00', to = hh >= 23 ? '23:59' : String(hh + 1).padStart(2, '0') + ':00';
    await newBlock(page, from, to, 'Сейчас', 'pink');
    await expect(page.locator(today + ' .tblock[data-color=pink]')).toHaveClass(/now/);
    await expect(page.locator(today + ' .tblock[data-color=pink] .tb-now')).toBeVisible();
  });

  test('блоки и порядок задач переживают перезапуск', async () => {
    expect(errors).toEqual([]);
    const before = await texts(page, today);
    await page.waitForTimeout(700);
    await closeApp(app);
    ({ app, page, errors } = await launch(dir, { size: [1440, 900] }));
    await expect(page.locator(today + ' .tblock')).toHaveCount(3);
    expect(await texts(page, today)).toEqual(before);
    await expect(page.locator(today + ' .tblock[data-color=green] .tb-time')).toHaveText('09:00 – 12:00');
  });
});

test('ассистент создаёт блок времени и кладёт в него задачу', async () => {
  const dir = tmpDataDir('blocks-ai');
  const { app, page } = await launch(dir);
  try {
    await app.evaluate(({ ipcMain }) => {
      globalThis.__reqs = [];
      ipcMain.removeHandler('key:has'); ipcMain.handle('key:has', () => true);
      ipcMain.removeHandler('anthropic');
      ipcMain.handle('anthropic', (_e, _rid, body) => {
        globalThis.__reqs.push(JSON.parse(JSON.stringify(body)));
        const n = globalThis.__reqs.length, use = (id, name, input) => ({ ok: true, status: 200, data: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });
        if (n === 1) return use('t1', 'add_time_block', { date: 'today', from: '10:00', to: '12:00', title: 'Работа', color: 'green' });
        if (n === 2) { const r = JSON.parse(body.messages[body.messages.length - 1].content[0].content); return use('t2', 'add_task', { date: 'today', text: 'Отчёт', block: r.id }); }
        return { ok: true, status: 200, data: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Готово.' }] } };
      });
    });
    await page.evaluate(() => window.electronAPI.ai.set({ mode: 'api' }));   // этот сценарий — через ключ API
    await page.click('#aiBtn');
    await page.fill('.ai-in', 'Сделай блок с 10 до 12 «Работа» и положи туда отчёт');
    await page.keyboard.press('Enter');
    await expect(page.locator('.msg.bot').last()).toContainText('Готово', { timeout: 20000 });
    await expect(page.locator(today + ' .tblock[data-color=green] .item .txt')).toHaveValue('Отчёт');
    const reqs = await app.evaluate(() => globalThis.__reqs);
    expect(reqs[0].tools.map(t => t.name)).toContain('add_time_block');
  } finally { await closeApp(app); rmDir(dir); }
});
