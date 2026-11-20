// Редактор заметок в стиле Notion: одно поле на весь документ, блоки, «/»-меню, Markdown при вводе, выделение всего текста,
// копирование и вставка Markdown, отмена, перестановка блоков, задачи, совместимость со старыми страницами.
const { test, expect } = require('@playwright/test');
const { tmpDataDir, rmDir, launch, closeApp, addPage, DOC } = require('./helpers');

const blocks = page => page.evaluate(() => editNode().blocks.map(b => [b.t, b.text, b.ind || 0, !!b.done]));
async function openText(page, title) {
  const id = await addPage(page, 'ideas', title, 'text');
  await page.locator('.node[data-id="' + id + '"] .n-title').dblclick();
  await expect(page.locator('.ne')).toBeVisible();
  return id;
}

test('ввод как в Notion: Markdown-сокращения, вложенность, «/»-меню, форматирование', async () => {
  const dir = tmpDataDir('notes');
  const { app, page, errors } = await launch(dir, { size: [1440, 900] });
  try {
    await openText(page, 'План ролика');
    await page.locator('.ne .nb').first().click();
    const k = page.keyboard;
    await k.type('# Концепция'); await k.press('Enter');
    await k.type('Текст с '); await k.press('Control+b'); await k.type('жирным'); await k.press('Control+b'); await k.type(' словом'); await k.press('Enter');
    await k.type('- пункт'); await k.press('Enter'); await k.press('Tab'); await k.type('вложенный'); await k.press('Enter'); await k.press('Enter'); await k.press('Enter');
    await k.type('1. раз'); await k.press('Enter'); await k.type('два'); await k.press('Enter'); await k.press('Enter');
    await k.type('[] референсы'); await k.press('Enter'); await k.press('Enter');
    await k.type('/выно');
    await expect(page.locator('.ne-slash .menu-it')).toHaveCount(1);
    await expect(page.locator('.ne-slash .menu-it')).toHaveText('Выноска');
    await k.press('Enter'); await k.type('Важно'); await k.press('Enter');
    await k.type('---');
    await k.type('```'); await k.type(' '); await k.type('wiggle(2, 30);'); await k.press('Enter'); await k.type('loopOut();');
    expect(await blocks(page)).toEqual([
      ['h1', 'Концепция', 0, false], ['p', 'Текст с **жирным** словом', 0, false], ['ul', 'пункт', 0, false], ['ul', 'вложенный', 1, false],
      ['ol', 'раз', 0, false], ['ol', 'два', 0, false], ['todo', 'референсы', 0, false], ['callout', 'Важно', 0, false], ['hr', '', 0, false],
      ['code', 'wiggle(2, 30);\nloopOut();', 0, false]
    ]);
    await expect(page.locator('.ne .nb[data-t=ol]').nth(1)).toHaveAttribute('data-num', '2.');
    // задача отмечается щелчком по квадратику слева
    const todo = page.locator('.ne .nb[data-t=todo]');
    const tb = await todo.boundingBox();
    await page.mouse.click(tb.x + 10, tb.y + tb.height / 2);
    await expect(todo).toHaveAttribute('data-done', 'true');
    await expect(page.locator('.sheet-foot')).toContainText('Выполнено: 1 из 1');
    // сохраняется в документ
    await page.keyboard.press('Escape');
    let pg = '';
    await expect.poll(async () => { pg = JSON.stringify(await page.evaluate(p => window.electronAPI.dbGet(p), DOC('planner-ideas'))); return pg.includes('Текст с **жирным** словом'); }).toBe(true);
    expect(pg).toContain('"t":"callout"');
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); }
});

test('весь текст выделяется (Ctrl+A), копируется Markdown, вставка Markdown превращается в блоки, отмена', async () => {
  const dir = tmpDataDir('notes2');
  const { app, page, errors } = await launch(dir, { size: [1440, 900] });
  try {
    await openText(page, 'Заметка');
    await page.locator('.ne .nb').first().click();
    // вставка многострочного Markdown
    await page.evaluate(() => {
      const dt = new DataTransfer(); dt.setData('text/plain', '## Список дел\n- [ ] свет\n- [x] звук\n\nпросто текст **важно**\n> цитата');
      boxEl.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    expect(await blocks(page)).toEqual([['h2', 'Список дел', 0, false], ['todo', 'свет', 0, false], ['todo', 'звук', 0, true], ['p', 'просто текст **важно**', 0, false], ['quote', 'цитата', 0, false]]);
    await expect(page.locator('.ne b')).toHaveText('важно');
    // Ctrl+A — весь документ
    await page.keyboard.press('Control+a');
    const sel = await page.evaluate(() => String(window.getSelection()));
    expect(sel).toContain('Список дел'); expect(sel).toContain('цитата');
    const md = await page.evaluate(() => { const dt = new DataTransfer(); boxEl.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true })); return dt.getData('text/plain'); });
    expect(md).toBe('## Список дел\n- [ ] свет\n- [x] звук\nпросто текст **важно**\n> цитата');
    // удалить всё выделенное одним нажатием — и вернуть отменой
    await page.keyboard.press('Delete');
    expect((await blocks(page)).length).toBe(1);
    await page.keyboard.press('Control+z');
    expect((await blocks(page)).length).toBe(5);
    await page.keyboard.press('Control+Shift+z');
    expect((await blocks(page)).length).toBe(1);
    await page.keyboard.press('Control+z');
    // Backspace в начале блока объединяет со строкой выше
    await page.locator('.ne .nb[data-t=quote]').click();
    await page.keyboard.press('Home'); await page.keyboard.press('Backspace');       // цитата → текст
    await page.keyboard.press('Backspace');                                          // соединить с предыдущим
    expect((await blocks(page)).slice(-1)).toEqual([['p', 'просто текст **важно**цитата', 0, false]]);
    // перестановка блока: Alt+↑
    await page.locator('.ne .nb[data-t=todo]').nth(1).click();
    await page.keyboard.press('Alt+ArrowUp');
    expect((await blocks(page)).slice(1, 3).map(b => b[1])).toEqual(['звук', 'свет']);
    // меню блока по ручке
    await page.locator('.ne .nb').first().hover();
    await page.locator('.ne-grip').click();
    await page.click('.menu-it:has-text("Превратить: заголовок 1")');
    expect((await blocks(page))[0][0]).toBe('h1');
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); }
});

test('старая страница с блоком «h» открывается как заголовок 2, ассистент видит Markdown', async () => {
  const dir = tmpDataDir('notes3');
  const { app, page, errors } = await launch(dir);
  try {
    await page.evaluate(() => {
      S.ideas.nodes.push({ id: 'old1', type: 'page', kind: 'text', title: 'Старая', blocks: [{ id: 'a', t: 'h', text: 'Заголовок', done: false }, { id: 'b', t: 'todo', text: 'дело', done: true }] });
      S.ideas = normalize('ideas', S.ideas); touch('ideas'); refreshTree('ideas');
    });
    await page.locator('.node[data-id=old1] .n-title').dblclick();
    await expect(page.locator('.ne .nb').first()).toHaveAttribute('data-t', 'h2');
    const read = await page.evaluate(async () => { const t = aiTools(document.createElement('div')).find(x => x.name === 'read_page'); return t.execute({ id: 'old1' }); });
    expect(read.markdown).toBe('## Заголовок\n- [x] дело');
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); }
});
