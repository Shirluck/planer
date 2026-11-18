// Восстановление из резервных копий: календарь и доска возвращаются без перезапуска, восстановление можно отменить.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { tmpDataDir, rmDir, launch, closeApp, addTask, addPage, openBoard, waitCal, waitBoard, isoDay } = require('./helpers');

test('восстановление календаря и доски из копии, отмена восстановления', async () => {
  const dir = tmpDataDir('restore');
  const { app, page, errors } = await launch(dir, { size: [1440, 900] });
  try {
    await addTask(page, 'day', 'Важная задача');
    const boardId = await addPage(page, 'plans', 'Доска проекта');
    await page.evaluate(id => boardApi.addCard(id, 'note', 'Карточка, которую жалко потерять'), boardId);
    await waitBoard(page, boardId, d => d.items.length === 1);
    // копия вручную из настроек
    await page.click('#settingsBtn');
    await page.locator('.st-btns button', { hasText: 'Сделать копию сейчас' }).click();
    await expect(page.locator('.toast')).toContainText('Копия данных сделана');
    await page.keyboard.press('Escape');
    // «испортить» данные: удалить задачу и карточку
    const row = page.locator('.col[data-key=day] .item');
    await row.locator('.more').click();
    await page.locator('.menu-it', { hasText: 'Удалить' }).click();
    await waitCal(page, c => !c.days[isoDay(0)]);
    await openBoard(page, boardId);
    await page.locator('.bd-card').click();
    await page.keyboard.press('Delete');
    await waitBoard(page, boardId, d => d.items.length === 0);
    // окно восстановления (доска остаётся открытой)
    await page.evaluate(() => openRestore());
    const dlg = page.locator('.rs-box');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.rs-item').first()).toContainText('Сделана вручную');
    await expect(dlg.locator('.rs-item[aria-selected=true]')).toHaveCount(1);
    const cal = dlg.locator('.rs-doc', { hasText: 'Календарь' });
    await expect(cal).toContainText('в копии 1 задача · сейчас 0 задач');
    const brd = dlg.locator('.rs-doc', { hasText: 'Доска «Доска проекта»' });
    await expect(brd).toContainText('карточек в копии: 1 · сейчас: 0');
    await expect(dlg.locator('.rs-doc', { hasText: 'Основные планы' })).toContainText('совпадает с текущими данными');
    // подтверждение вторым нажатием
    await cal.locator('.rs-go').click();
    await expect(cal.locator('.rs-go')).toHaveText('Точно восстановить?');
    await cal.locator('.rs-go').click();
    await expect(page.locator('.toast')).toContainText('Восстановлено');
    await expect(page.locator('.col[data-key=day] .item .txt')).toHaveValue('Важная задача');     // без перезапуска
    await waitCal(page, c => c.days[isoDay(0)] && c.days[isoDay(0)].items[0].text === 'Важная задача');
    // отмена восстановления
    await page.locator('.toast button').click();
    await expect(page.locator('.col[data-key=day] .item')).toHaveCount(0);
    await expect(page.locator('.toast')).toContainText('Восстановление отменено');
    // восстановить доску: открытая доска перечитывается
    await expect(dlg.locator('.rs-item').first()).toContainText('Перед восстановлением');
    await dlg.locator('.rs-item', { hasText: 'Сделана вручную' }).click();
    const brd2 = dlg.locator('.rs-doc', { hasText: 'Доска «Доска проекта»' });
    await brd2.locator('.rs-go').click(); await brd2.locator('.rs-go').click();
    await expect(page.locator('.toast')).toContainText('Восстановлено');
    await waitBoard(page, boardId, d => d.items.length === 1 && d.items[0].text === 'Карточка, которую жалко потерять');
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(page.locator('.bd-card')).toContainText('Карточка, которую жалко потерять');
    // на диске остались копии: ручная и две «перед восстановлением»
    const kinds = fs.readdirSync(path.join(dir, 'backups')).filter(n => /^(manual|before-restore)-/.test(n)).map(n => n.split('-20')[0]).sort();
    expect(kinds).toEqual(['before-restore', 'before-restore', 'before-restore', 'manual']);
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); }
});

test('копии: неверные запросы отклоняются, меню «Данные» открывает восстановление', async () => {
  const dir = tmpDataDir('restore2');
  const { app, page } = await launch(dir);
  try {
    const api = (fn, ...a) => page.evaluate(([fn, a]) => window.electronAPI.backups[fn](...a), [fn, a]);
    expect(await api('read', '../docs', 'data/users/local/planner-cal')).toBe(null);
    expect(await api('read', 'docs-2026-01-01', '../../../secret')).toBe(null);
    expect((await api('restore', 'manual-x', ['data/users/local/planner-cal'])).ok).toBe(false);
    expect((await api('restore', 'docs-2099-01-01', ['data/users/local/planner-cal'])).ok).toBe(false);
    const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === 'Данные').submenu.items.map(i => i.label));
    expect(labels).toEqual(expect.arrayContaining(['Восстановить из копии…', 'Сделать копию сейчас']));
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find(i => i.label === 'Данные').submenu.items.find(i => i.label === 'Восстановить из копии…').click());
    await expect(page.locator('.rs-box')).toBeVisible();
    await expect(page.locator('.rs-empty')).toContainText('Копий пока нет');               // новая папка данных: копировать ещё нечего
  } finally { await closeApp(app); rmDir(dir); }
});
