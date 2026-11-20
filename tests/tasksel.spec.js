// Выделение нескольких задач: Ctrl/Shift+щелчок, панель действий, перенос группой (кнопкой и перетаскиванием), отмена.
const { test, expect } = require('@playwright/test');
const { tmpDataDir, rmDir, launch, closeApp, addTask, waitCal, isoDay } = require('./helpers');

test('задачи выделяются скопом и меняются разом', async () => {
  const dir = tmpDataDir('tasksel');
  const { app, page, errors } = await launch(dir, { size: [1440, 900] });
  try {
    for (const t of ['Один', 'Два', 'Три', 'Четыре', 'Пять']) await addTask(page, 'day', t);
    const row = n => page.locator('.col[data-key=day] .item').nth(n);
    await row(0).locator('.txt').click({ modifiers: ['Control'] });
    await row(2).locator('.txt').click({ modifiers: ['Control'] });
    await expect(page.locator('.col[data-key=day] .item.tsel')).toHaveCount(2);
    await expect(page.locator('.tsel-bar .tsel-n')).toHaveText('Выбрано: 2');
    expect(await page.evaluate(() => document.activeElement.classList.contains('txt'))).toBe(false);   // курсор в текст не ставится
    await row(4).locator('.txt').click({ modifiers: ['Shift'] });                                     // диапазон от последнего
    expect(await page.locator('.col[data-key=day] .item.tsel .txt').evaluateAll(x => x.map(e => e.value))).toEqual(['Один', 'Три', 'Четыре', 'Пять']);
    // выполнено и приоритет разом
    await page.locator('.tsel-b', { hasText: 'Выполнено' }).click();
    await waitCal(page, c => c.days[isoDay(0)].items.filter(t => t.done).length === 4);
    await page.locator('.tsel-b', { hasText: 'Приоритет' }).click();
    await page.locator('.menu-it', { hasText: 'Срочно' }).click();
    await waitCal(page, c => c.days[isoDay(0)].items.filter(t => t.pri === 3).length === 4);
    // перенос на завтра одной кнопкой и отмена одним действием
    await page.locator('.tsel-b', { hasText: 'На завтра' }).click();
    await waitCal(page, c => c.days[isoDay(1)] && c.days[isoDay(1)].items.length === 4);
    await expect(page.locator('.tsel-bar')).toHaveCount(0);
    await expect(page.locator('.toast')).toContainText('Перенесено на завтра: 4 задачи');
    await page.locator('.toast button').click();
    await waitCal(page, c => c.days[isoDay(0)].items.length === 5 && !c.days[isoDay(1)]);
    // Esc снимает выделение
    await row(1).locator('.txt').click({ modifiers: ['Control'] });
    await expect(page.locator('.tsel-bar')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.tsel')).toHaveCount(0);
    // перетаскивание выделенных на завтрашний день в «Неделе»
    await row(1).locator('.txt').click({ modifiers: ['Control'] });
    await row(3).locator('.txt').click({ modifiers: ['Control'] });
    const src = await row(3).boundingBox();
    const tomorrow = page.locator('.col[data-key=week] .wk-day[data-date="' + isoDay(1) + '"]');
    await expect(tomorrow).toBeVisible();
    const dst = await tomorrow.boundingBox();
    await page.mouse.move(src.x + 70, src.y + 12); await page.mouse.down();
    await page.mouse.move(src.x + 90, src.y + 40, { steps: 4 });
    await expect(page.locator('.task-ghost .tg-count')).toHaveText('2');
    await page.mouse.move(dst.x + 90, dst.y + 14, { steps: 10 }); await page.mouse.up();
    const cal = await waitCal(page, c => c.days[isoDay(1)] && c.days[isoDay(1)].items.length === 2);
    expect(cal.days[isoDay(1)].items.map(t => t.text)).toEqual(['Два', 'Четыре']);
    // удаление выделенных с отменой
    await row(0).locator('.txt').click({ modifiers: ['Control'] });
    await row(1).locator('.txt').click({ modifiers: ['Control'] });
    await page.locator('.tsel-b', { hasText: 'Удалить' }).click();
    await waitCal(page, c => c.days[isoDay(0)].items.length === 1);
    await page.locator('.toast button').click();
    await waitCal(page, c => c.days[isoDay(0)].items.length === 3);
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); }
});
