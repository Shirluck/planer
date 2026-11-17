// «Сегодня» и «Неделя»-календарь: задачи по датам, обзор только срочного, окно дня, перенос, прошлые хвосты.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { tmpDataDir, rmDir, launch, closeApp, addTask, toastText, isoDay, calDoc, waitCal } = require('./helpers');

const week = '.col[data-key=week]';
const today = '.col[data-key=day]';
const dayBlock = (page, k) => page.locator(week + ' .wk-day[data-date="' + k + '"]');
const plusDay = (k, n) => { const [y, m, d] = k.split('-').map(Number); const x = new Date(y, m - 1, d + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };

test.describe.serial('Календарь', () => {
  let dir, app, page, errors, other;          // other — дни текущей недели, кроме сегодняшнего (тест не зависит от дня недели)
  test.beforeAll(() => { dir = tmpDataDir('cal'); });
  test.afterAll(async () => { await closeApp(app); rmDir(dir); });

  test('«Сегодня» пишет задачи на сегодняшнюю дату; в «Неделе» видно только срочное', async () => {
    ({ app, page, errors } = await launch(dir, { size: [1440, 900] }));
    other = (await page.locator(week + ' .wk-day').evaluateAll(els => els.map(e => e.dataset.date))).filter(k => k && k !== isoDay(0));
    expect(other).toHaveLength(6);
    other.sort((a, b) => (plusDay(a, 1) === isoDay(0)) - (plusDay(b, 1) === isoDay(0)));   // следующий за other[0] день — не сегодня
    await expect(page.locator(today + ' .col-sub')).toContainText(new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date()));
    await addTask(page, 'day', 'Сдать отчёт !!!');
    await addTask(page, 'day', 'Купить продукты');
    await addTask(page, 'day', 'Позвонить маме !');
    const d = await waitCal(page, c => c.days[isoDay(0)] && c.days[isoDay(0)].items.length === 3);
    expect(d.days[isoDay(0)].items.map(t => [t.text, t.pri])).toEqual([['Сдать отчёт', 3], ['Купить продукты', 0], ['Позвонить маме', 1]]);
    const blk = dayBlock(page, isoDay(0));
    await expect(blk).toHaveClass(/today/);
    await expect(blk.locator('.wk-task')).toHaveCount(1);
    await expect(blk.locator('.wk-task')).toHaveText('Сдать отчёт');
    await expect(blk.locator('.wk-cnt')).toHaveText('+ ещё 2');
    // переключатель «все задачи / только срочные»
    await page.locator(week + ' .col-tools .tool').first().click();
    await expect(blk.locator('.wk-task')).toHaveCount(3);
    await page.locator(week + ' .col-tools .tool').first().click();
    await expect(blk.locator('.wk-task')).toHaveCount(1);
  });

  test('щелчок по дню открывает его целиком; можно расписать любой день', async () => {
    await dayBlock(page, other[0]).locator('.wk-head').click();
    await expect(page.locator('.day-sheet')).toBeVisible();
    if (other[0] === isoDay(1)) await expect(page.locator('.day-rel')).toContainText('Завтра');
    if (other[0] === isoDay(-1)) await expect(page.locator('.day-rel')).toContainText('Вчера');
    await addTask(page, 'sheet', 'Встреча с клиентом !!!');
    await addTask(page, 'sheet', 'Подготовить слайды');
    await expect(page.locator('.day-sheet .item')).toHaveCount(2);
    // следующий день стрелкой
    await page.click('.day-sheet .tool[aria-label="Следующий день"]');
    await expect(page.locator('.day-sheet .item')).toHaveCount(0);
    await addTask(page, 'sheet', 'Спортзал');
    await page.keyboard.press('Escape');
    await expect(page.locator('.day-sheet')).toHaveCount(0);
    await expect(dayBlock(page, other[0]).locator('.wk-task')).toHaveText(['Встреча с клиентом']);
    const c = await waitCal(page, c => c.days[plusDay(other[0], 1)]);
    expect(c.days[other[0]].items.length).toBe(2);
    expect(c.days[plusDay(other[0], 1)].items[0].text).toBe('Спортзал');
    // в «Сегодня» только сегодняшние задачи
    await expect(page.locator(today + ' .item')).toHaveCount(3);
    // щелчок по срочной задаче в обзоре открывает её день
    await dayBlock(page, other[0]).locator('.wk-task .wk-t').click();
    await expect(page.locator('.day-sheet .item .txt').first()).toBeFocused();
    await page.keyboard.press('Escape');                     // выход из поля
    await page.keyboard.press('Escape');                     // закрыть окно
    await expect(page.locator('.day-sheet')).toHaveCount(0);
  });

  test('календарь месяца: листание, отметки дней, выбор дня', async () => {
    const cal = page.locator(week + ' .mc');
    const title0 = await cal.locator('.mc-title').textContent();
    await expect(cal.locator('.mc-day.today')).toHaveCount(1);
    await expect(cal.locator('.mc-day[data-date="' + other[0] + '"]')).toHaveClass(/urgent/);
    await cal.locator('.mc-nav[aria-label="Следующий месяц"]').click();
    await cal.locator('.mc-nav[aria-label="Следующий месяц"]').click();
    const title2 = await page.locator(week + ' .mc-title').textContent();
    expect(title2).not.toBe(title0);
    // неделя под календарём следует за месяцем
    const firstDay = await page.locator(week + ' .wk-day').first().getAttribute('data-date');
    expect(firstDay > isoDay(20)).toBe(true);
    // выбрать 15-е число этого месяца
    const cell = page.locator(week + ' .mc-day:not(.out)', { hasText: /^15$/ });
    const k = await cell.getAttribute('data-date');
    await cell.click();
    await expect(page.locator('.day-sheet')).toBeVisible();
    await addTask(page, 'sheet', 'Записаться к врачу !!!');
    await page.keyboard.press('Escape');
    await expect(page.locator(week + ' .mc-day[data-date="' + k + '"]')).toHaveClass(/urgent/);
    await expect(page.locator(week + ' .mc-day[data-date="' + k + '"]')).toHaveClass(/inweek/);
    await expect(dayBlock(page, k).locator('.wk-task')).toHaveText(['Записаться к врачу']);
    // назад к текущей неделе
    await page.click(week + ' .tool[aria-label="К текущей неделе"]');
    await expect(page.locator(week + ' .mc-title')).toHaveText(title0);
    await expect(dayBlock(page, isoDay(0))).toHaveCount(1);
  });

  test('перенос задачи: на завтра, на выбранный день, отмена переноса', async () => {
    const item = page.locator(today + ' .item', { hasText: '' }).filter({ has: page.locator('.txt') }).nth(1);   // «Купить продукты»
    await expect(item.locator('.txt')).toHaveValue('Купить продукты');
    await item.hover(); await item.locator('.more').click();
    await page.click('.menu-it:has-text("Перенести на завтра")');
    await expect(page.locator(today + ' .item')).toHaveCount(2);
    expect(await toastText(page)).toContain('завтра');
    const n1 = c0 => (c0.days[isoDay(1)] ? c0.days[isoDay(1)].items.length : 0);
    let c = await waitCal(page, c => c.days[isoDay(1)] && c.days[isoDay(1)].items.some(t => t.text === 'Купить продукты'));
    const tomorrowCount = n1(c);
    await page.click('.toast button:has-text("Отменить")');
    await expect(page.locator(today + ' .item')).toHaveCount(3);
    c = await waitCal(page, c => n1(c) === tomorrowCount - 1);
    // «Перенести на другой день…» — выбор в календаре
    const it2 = page.locator(today + ' .item').nth(2);
    await expect(it2.locator('.txt')).toHaveValue('Позвонить маме');
    await it2.hover(); await it2.locator('.more').click();
    await page.click('.menu-it:has-text("Перенести на другой день")');
    await expect(page.locator('.date-pop')).toBeVisible();
    const target = await page.locator('.date-pop .mc-day:not(.out):not(.today)').last().getAttribute('data-date');
    await page.click('.date-pop .mc-day[data-date="' + target + '"]');
    await expect(page.locator('.date-pop')).toHaveCount(0);
    c = await waitCal(page, c => c.days[target] && c.days[target].items.some(t => t.text === 'Позвонить маме'));
    await expect(page.locator(today + ' .item')).toHaveCount(2);
  });

  test('перетаскивание задачи из «Сегодня» на день недели', async () => {
    const it = page.locator(today + ' .item').filter({ has: page.locator('.txt') }).nth(1);
    await expect(it.locator('.txt')).toHaveValue('Купить продукты');
    await it.hover();
    await it.locator('.grip').dragTo(dayBlock(page, other[3]).locator('.wk-head'));
    await waitCal(page, c => c.days[other[3]] && c.days[other[3]].items.some(t => t.text === 'Купить продукты'), 'drag to day');
    await expect(page.locator(today + ' .item')).toHaveCount(1);
  });

  test('данные календаря переживают перезапуск', async () => {
    expect(errors).toEqual([]);
    await closeApp(app);
    ({ app, page, errors } = await launch(dir, { size: [1440, 900] }));
    await expect(page.locator(today + ' .item')).toHaveCount(1);
    await expect(dayBlock(page, other[0]).locator('.wk-task')).toHaveText(['Встреча с клиентом']);
    await dayBlock(page, other[0]).locator('.wk-head').click();
    await expect(page.locator('.day-sheet .item')).toHaveCount(2);
    await page.keyboard.press('Escape');
  });
});

test('невыполненное с прошлых дней показывается в «Сегодня» и переносится', async () => {
  const dir = tmpDataDir('overdue');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'planer-meta.json'), JSON.stringify({ schema: 2 }));
  fs.writeFileSync(path.join(dir, 'docs', 'data__users__local__planner-cal.json'), JSON.stringify({ v: 1, days: {
    [isoDay(-3)]: { items: [{ id: 'o1', text: 'Старый хвост', done: false, pri: 3, note: '' }, { id: 'o2', text: 'Сделано давно', done: true, pri: 0, note: '' }] },
    [isoDay(-1)]: { items: [{ id: 'o3', text: 'Вчерашнее', done: false, pri: 0, note: '' }] }
  }, undated: [] }));
  const { app, page } = await launch(dir);
  try {
    const box = page.locator(today + ' .overdue');
    await expect(box.locator('.od-head b')).toHaveText('2');
    await box.locator('.od-head').click();
    await expect(box.locator('.od-row')).toHaveCount(2);
    await box.locator('.od-row', { hasText: 'Старый хвост' }).locator('.od-move').click();
    await expect(page.locator(today + ' .item .txt')).toHaveValue('Старый хвост');
    await page.click(today + ' .od-head');
    await expect(page.locator(today + ' .overdue .od-head b')).toHaveText('1');
    await page.click(today + ' .overdue .od-head');
    await page.locator(today + ' .od-row .od-move').click();
    await expect(page.locator(today + ' .overdue')).toHaveCount(0);
    const c = await waitCal(page, c => c.days[isoDay(0)] && c.days[isoDay(0)].items.length === 2);
    expect(c.days[isoDay(-3)].items.map(t => t.text)).toEqual(['Сделано давно']);
    expect(c.days[isoDay(-1)]).toBeUndefined();
  } finally { await closeApp(app); rmDir(dir); }
});
