// Ассистент организует доску и переписывает страницы (через поддельный Claude Code, tests/fake-claude.js):
// переставляет и раскладывает карточки, меняет их, добавляет ссылку, удаляет по просьбе; «Вернуть как было»; блоки кода с копированием.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { tmpDataDir, rmDir, launch, closeApp, addPage, openBoard, waitBoard, DOC } = require('./helpers');

test('ассистент двигает, раскладывает и меняет карточки доски; всё можно вернуть', async () => {
  const dir = tmpDataDir('aiboard'), cc = tmpDataDir('cc-fake');
  fs.writeFileSync(path.join(cc, 'logged-in'), '1');
  const { app, page, errors } = await launch(dir, { size: [1440, 900], env: { FAKE_CC_DIR: cc } });
  try {
    const id = await addPage(page, 'ideas', 'Ремонт');
    await page.evaluate(k => Promise.all([['Кухня', 0, 0], ['Ванная', 900, 500], ['Свет', 40, 700]].map(([t, x, y]) => boardApi.addCard(k, 'note', t, x, y))), id);
    const d0 = await waitBoard(page, id, d => d.items.length === 3);
    const [a, b, c] = ['Кухня', 'Ванная', 'Свет'].map(t => d0.items.find(i => i.text === t).id);
    fs.writeFileSync(path.join(cc, 'script.json'), JSON.stringify([
      { reply: '', tool_calls: [{ name: 'read_board', input: { pageId: id } }] },
      { reply: '', tool_calls: [
        { name: 'arrange_board_cards', input: { pageId: id, moves: [{ id: b, x: 264, y: 0 }, { id: c, x: 528, y: 0, w: 300 }, { id: 'нет-такой', x: 1, y: 1 }] } },
        { name: 'update_board_card', input: { pageId: id, cardId: a, text: '**Кухня**\n- фасады', color: 'yellow' } },
        { name: 'add_board_card', input: { pageId: id, type: 'link', text: 'https://example.com/plitka', title: 'Плитка' } }
      ] },
      { reply: 'Разложил карточки в ряд, выделил кухню и добавил ссылку.', tool_calls: [] }
    ]));
    await page.click('#aiBtn');
    await page.fill('.ai-in', 'Наведи порядок на доске «Ремонт»');
    await page.keyboard.press('Enter');
    const bot = page.locator('.msg.bot').last();
    await expect(bot).toContainText('Разложил карточки в ряд', { timeout: 30000 });
    let d = await waitBoard(page, id, d => d.items.length === 4);
    const by = x => d.items.find(i => i.id === x);
    expect([by(b).x, by(b).y, by(c).x, by(c).y, by(c).w]).toEqual([264, 0, 528, 0, 300]);
    expect(by(a)).toMatchObject({ text: '**Кухня**\n- фасады', color: 'yellow' });
    expect(d.items.find(i => i.type === 'link')).toMatchObject({ url: 'https://example.com/plitka', title: 'Плитка' });
    // ответ инструмента сообщил о несуществующей карточке
    const log = fs.readFileSync(path.join(cc, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(log[2].content.some(x => x.type === 'text' && x.text.includes('"missing":["нет-такой"]'))).toBe(true);
    expect(log[0].system).toContain('arrange_board_cards');
    // «Вернуть как было» для перестановки
    await bot.locator('.act', { hasText: 'Переставлено карточек' }).locator('.act-undo').click();
    d = await waitBoard(page, id, d => d.items.find(i => i.id === b).x === 900);
    await expect(bot.locator('.act-undo').first()).toHaveText('Возвращено');
    // раскладка сеткой и удаление по просьбе
    fs.writeFileSync(path.join(cc, 'script.json'), JSON.stringify([
      { reply: '', tool_calls: [{ name: 'tidy_board', input: { pageId: id, layout: 'columns' } }, { name: 'remove_board_cards', input: { pageId: id, ids: [c] } }] },
      { reply: 'Готово: колонками по типу, «Свет» удалил.', tool_calls: [] }
    ]));
    fs.writeFileSync(path.join(cc, 'log.jsonl'), '');
    await page.fill('.ai-in', 'Разложи колонками и удали «Свет»');
    await page.keyboard.press('Enter');
    await expect(page.locator('.msg.bot').last()).toContainText('колонками по типу', { timeout: 30000 });
    d = await waitBoard(page, id, d => d.items.length === 3 && !d.items.some(i => i.id === c));
    const notes = d.items.filter(i => i.type === 'note'), link = d.items.find(i => i.type === 'link');
    expect(new Set(notes.map(n => n.x)).size).toBe(1);                       // заметки — одной колонкой
    expect(link.x).toBeGreaterThan(notes[0].x);                              // ссылки — следующей
    // открытая доска: отмена Ctrl+Z тоже возвращает удалённое
    await page.locator('.ai .ai-head .tool[aria-label="Закрыть"]').click();      // закрыть панель ассистента
    await expect(page.locator('.ai.open')).toHaveCount(0);
    await openBoard(page, id);
    await page.keyboard.press('Control+z');
    await waitBoard(page, id, d => d.items.some(i => i.id === c));
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); rmDir(cc); }
});

test('ассистент переписывает страницу (с возвратом) и отвечает кодом с кнопкой «Копировать»', async () => {
  const dir = tmpDataDir('aipage'), cc = tmpDataDir('cc-fake');
  fs.writeFileSync(path.join(cc, 'logged-in'), '1');
  const { app, page, errors } = await launch(dir, { size: [1440, 900], env: { FAKE_CC_DIR: cc } });
  try {
    const id = await addPage(page, 'plans', 'Черновик', 'text');
    fs.writeFileSync(path.join(cc, 'script.json'), JSON.stringify([
      { reply: '', tool_calls: [{ name: 'replace_page', input: { id, blocks: [{ type: 'h1', text: 'План' }, { type: 'todo', text: 'раскадровка', done: true }, { type: 'callout', text: 'Сдать в пятницу', emoji: '🔥' }, { type: 'code', text: 'wiggle(2, 30);' }] } }] },
      { reply: 'Переписал страницу. Экспрешн:\n```\nwiggle(2, 30);\n```\nВставьте в Position.', tool_calls: [] }
    ]));
    await page.click('#aiBtn');
    await page.fill('.ai-in', 'Перепиши черновик красиво');
    await page.keyboard.press('Enter');
    const bot = page.locator('.msg.bot').last();
    await expect(bot).toContainText('Вставьте в Position', { timeout: 30000 });
    const pg = () => page.evaluate(k => { const l = findNode('plans', k); return l.node.blocks.map(b => b.t + ':' + b.text + (b.emoji ? ':' + b.emoji : '')); }, id);
    expect(await pg()).toEqual(['h1:План', 'todo:раскадровка', 'callout:Сдать в пятницу:🔥', 'code:wiggle(2, 30);']);
    // код в ответе — отдельным блоком с кнопкой
    await expect(bot.locator('.ai-code code')).toHaveText('wiggle(2, 30);');
    await bot.locator('.ai-copy').click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('wiggle(2, 30);');
    // вернуть страницу как было
    await bot.locator('.act-undo').click();
    await expect.poll(pg).toEqual(['p:']);
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); rmDir(cc); }
});
