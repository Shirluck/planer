// Поиск по всему (Ctrl+K): задачи за все дни и заметки к ним, текст страниц, карточки досок, быстрые действия.
const { test, expect } = require('@playwright/test');
const { tmpDataDir, rmDir, launch, closeApp, addTask, addPage, isoDay } = require('./helpers');

test('поиск находит задачи, страницы, карточки досок и открывает найденное', async () => {
  const dir = tmpDataDir('search');
  const { app, page, errors } = await launch(dir, { size: [1440, 900] });
  try {
    await addTask(page, 'day', 'Купить ёлку');
    await page.evaluate(() => {
      dayItems(addDays(todayKey(), 10), true).push({ id: 'far1', text: 'Записаться к стоматологу', done: false, pri: 0, note: 'клиника на улице Ленина' });
      S.cal.undated.push({ id: 'und1', text: 'Разобрать гараж', done: false, pri: 0, note: '' });
      touch('cal'); refreshCal();
    });
    // текстовая страница с текстом
    await addPage(page, 'plans', 'Отпуск', 'text');
    await page.locator('.node.page', { hasText: 'Отпуск' }).dblclick();
    await page.locator('.ne .nb').first().click();
    await page.keyboard.type('Посчитать бюджет поездки');
    await page.keyboard.press('Escape');
    // доска с заметкой
    const boardId = await addPage(page, 'ideas', 'Сад');
    await page.evaluate(id => boardApi.addCard(id, 'note', 'Посадить кактус у окна'), boardId);
    await expect(page.locator('.node[data-id="' + boardId + '"] .n-meta')).toHaveText('1');

    const open = async q => {
      await page.keyboard.press('Control+KeyK');
      await expect(page.locator('.sp-box')).toBeVisible();
      await page.locator('.sp-in').fill(q);
    };
    // пустой запрос — быстрые действия; Esc закрывает
    await page.keyboard.press('Control+KeyK');
    await expect(page.locator('.sp-group').first()).toHaveText('Быстрые действия');
    await page.keyboard.press('Escape');
    await expect(page.locator('.sp-box')).toHaveCount(0);

    // задача на другой день — открывается её день, строка в фокусе
    await open('стомат');
    await expect(page.locator('.sp-row').first().locator('.sp-title')).toHaveText('Записаться к стоматологу');
    await expect(page.locator('.sp-row').first().locator('mark')).toHaveText('стомат');
    await page.keyboard.press('Enter');
    await expect(page.locator('.day-sheet')).toBeVisible();
    await expect(page.locator('.day-sheet .item .txt:focus')).toHaveValue('Записаться к стоматологу');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await expect(page.locator('.day-sheet')).toHaveCount(0);

    // слова из заметки к задаче, регистр и «ё» не важны
    await open('УЛИЦЕ ленина');
    await expect(page.locator('.sp-row').first().locator('.sp-snip')).toContainText('Ленина');
    await page.keyboard.press('Escape');
    await open('елку');
    await page.keyboard.press('Enter');
    await expect(page.locator('.col[data-key=day] .item .txt:focus')).toHaveValue('Купить ёлку');

    // карточка доски: доски читаются в фоне, потом появляются в выдаче
    await open('кактус');
    const card = page.locator('.sp-row', { hasText: 'Посадить кактус' });
    await expect(card).toBeVisible();
    await expect(card.locator('.sp-sub')).toContainText('Доска «Сад»');
    await card.click();
    await expect(page.locator('.bd-sheet')).toBeVisible();
    await expect(page.locator('.bd-card.sel')).toContainText('Посадить кактус');
    await page.keyboard.press('Escape');
    await expect(page.locator('.bd-sheet')).toHaveCount(0);

    // текст страницы: открывается редактор, найденное слово выделено
    await open('бюджет');
    await expect(page.locator('.sp-row').first().locator('.sp-title')).toHaveText('Отпуск');
    await page.keyboard.press('Enter');
    await expect(page.locator('.sheet .title-in')).toHaveValue('Отпуск');
    expect(await page.evaluate(() => String(window.getSelection()))).toBe('бюджет');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');   // снять выделение, закрыть страницу

    // задача без даты, выбор стрелками
    await open('гараж');
    await expect(page.locator('.sp-row').first().locator('.sp-sub')).toContainText('Без даты');
    await page.keyboard.press('Enter');
    await expect(page.locator('.day-sheet .day-title')).toHaveText('Без даты');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');

    // дата: переход к дню
    await open('завтра');
    await expect(page.locator('.sp-row').first()).toContainText('Открыть день');
    await page.keyboard.press('Enter');
    await expect(page.locator('.day-sheet')).toBeVisible();
    expect(await page.evaluate(() => dayView.date)).toBe(isoDay(1));
    await page.keyboard.press('Escape');

    // действие: тема
    await open('тёмная');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
    await expect(page.locator('.sp-row[aria-selected=true]')).toContainText('Тема: тёмная');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // кнопка поиска в шапке
    await page.click('#searchBtn');
    await expect(page.locator('.sp-in')).toBeFocused();
    await page.locator('.sp-in').fill('нет такого слова');
    await expect(page.locator('.sp-none')).toContainText('Ничего не найдено');
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); }
});
