// Рисование от руки прямо на доске: перо, маркер, ластик, группировка штрихов в рисунки, отмена, сохранение, ассистент.
const { test, expect } = require('@playwright/test');
const { tmpDataDir, rmDir, launch, closeApp, addPage, openBoard, waitBoard, DOC } = require('./helpers');

async function line(page, vp, pts) {
  await page.mouse.move(vp.x + pts[0][0], vp.y + pts[0][1]);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(vp.x + p[0], vp.y + p[1], { steps: 8 });
  await page.mouse.up();
}
const inks = d => d.items.filter(i => i.type === 'ink');

test('рисование на доске: штрихи, рисунки, маркер, ластик, отмена и сохранение', async () => {
  const dir = tmpDataDir('ink');
  const { app, page, errors } = await launch(dir, { size: [1440, 900] });
  try {
    const id = await addPage(page, 'ideas', 'Эскизы');
    await openBoard(page, id);
    const vp = await page.locator('.bd-vp').boundingBox();
    // заметка, поверх которой потом окажется рисунок
    await page.mouse.dblclick(vp.x + 330, vp.y + 330);
    await page.keyboard.type('Под рисунком');
    await page.mouse.click(vp.x + 8, vp.y + 8);
    await waitBoard(page, id, d => d.items.length === 1);

    await page.click('.bd-rail-btn[aria-label="Рисовать"]');
    await expect(page.locator('.bd-inkbar')).toBeVisible();
    await expect(page.locator('.bd-rail-btn[aria-label="Рисовать"]')).toHaveAttribute('aria-pressed', 'true');
    // два штриха рядом — один рисунок; далеко — второй
    await line(page, vp, [[250, 250], [450, 250], [450, 450], [250, 450], [250, 250]]);
    await line(page, vp, [[300, 300], [400, 400]]);
    await line(page, vp, [[900, 600], [1000, 650]]);
    let d = await waitBoard(page, id, d => inks(d).length === 2);
    const box = inks(d).find(i => i.strokes.length === 2);
    expect(box).toBeTruthy();
    expect(box.strokes[0].p.length).toBeLessThan(40);            // прямые отрезки упрощены до углов
    expect(box.strokes[0].c).toBe('ink');
    // маркер красным
    await page.click('.bd-ib-tool[aria-label^="Маркер"]');
    await page.click('.bd-ib-c[aria-label="Красный"]');
    await line(page, vp, [[900, 300], [1000, 320]]);
    d = await waitBoard(page, id, d => inks(d).some(i => i.strokes.some(s => s.c === 'red')));
    const red = inks(d).flatMap(i => i.strokes).find(s => s.c === 'red');
    expect(red.m).toBe(1);
    expect(red.w).toBeGreaterThan(box.strokes[0].w * 2);          // маркер толще пера
    await expect(page.locator('.bd-ink-p.ink-c-red.marker')).toHaveCount(1);
    // клавиши: E — ластик; стереть диагональ квадрата
    await page.keyboard.press('KeyE');
    await expect(page.locator('.bd-ib-tool[aria-label^="Ластик"]')).toHaveAttribute('aria-checked', 'true');
    await line(page, vp, [[345, 355], [355, 345]]);
    d = await waitBoard(page, id, d => inks(d).some(i => i.id === box.id && i.strokes.length === 1));
    // отмена возвращает стёртое
    await page.keyboard.press('Control+KeyZ');
    d = await waitBoard(page, id, d => inks(d).some(i => i.id === box.id && i.strokes.length === 2));
    // Esc — выйти из рисования (доска остаётся открытой)
    await page.keyboard.press('Escape');
    await expect(page.locator('.bd-inkbar')).toBeHidden();
    await expect(page.locator('.bd-sheet')).toBeVisible();
    // щелчок по линии выделяет рисунок, по пустоте внутри рамки — карточку под ним
    await page.mouse.click(vp.x + 450, vp.y + 350);
    await expect(page.locator('.bd-card.t-ink.sel')).toHaveCount(1);
    await page.mouse.click(vp.x + 340, vp.y + 330);
    await expect(page.locator('.bd-card.t-note.sel')).toHaveCount(1);
    // рисунок двигается как карточка
    await page.mouse.click(vp.x + 450, vp.y + 350);
    await page.keyboard.press('ArrowRight');
    d = await waitBoard(page, id, d => inks(d).some(i => i.id === box.id && i.x === box.x + 10));
    // P снова включает рисование
    await page.keyboard.press('KeyP');
    await expect(page.locator('.bd-inkbar')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('.bd-sheet')).toHaveCount(0);
    // после повторного открытия рисунки на месте
    await openBoard(page, id);
    await expect(page.locator('.bd-card.t-ink')).toHaveCount(3);
    await expect(page.locator('.node[data-id="' + id + '"] .n-meta')).toHaveText('4');
    // ассистент видит рисунки и может посмотреть на них
    const cards = await page.evaluate(k => boardApi.readBoard(k), id);
    expect(cards.filter(c => c.type === 'ink').every(c => c.strokes >= 1 && c.drawing)).toBe(true);
    const img = await page.evaluate(async cid => { const f = await boardApi.findCard(cid); const r = await boardApi.imageForAI(f.item); return { t: r.mediaType, w: r.width, head: r.data.slice(0, 4) }; }, box.id);
    expect(img.t).toBe('image/jpeg');
    expect(img.head).toBe('/9j/');
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); }
});

test('рисунок с испорченными данными проверяется при загрузке', async () => {
  const dir = tmpDataDir('ink2');
  const { app, page, errors } = await launch(dir);
  try {
    const id = await addPage(page, 'plans', 'Проверка');
    await page.evaluate(([p, page]) => window.electronAPI.dbSet(p, { v: 1, view: { x: 200, y: 200, zoom: 1 }, items: [
      { id: 'a', type: 'ink', x: 10, y: 10, w: 100, h: 50, vw: 100, vh: 50, strokes: [{ c: 'url(javascript:1)', w: 'x', p: [1, 2, 'x', NaN, 30, 40] }, { c: 'red', p: 'плохо' }] },
      { id: 'b', type: 'ink', x: 0, y: 0, w: 10, h: 10, strokes: [] }
    ] }), [DOC('board-' + id), id]);
    await page.evaluate(k => { const l = findOwner(k); l.node.boardCount = 2; boardApi.forget(k); }, id);
    await openBoard(page, id);
    await expect(page.locator('.bd-card.t-ink')).toHaveCount(1);              // пустой рисунок отброшен
    await expect(page.locator('.bd-ink-p')).toHaveCount(1);
    await expect(page.locator('.bd-ink-p')).toHaveClass(/ink-c-ink/);         // неизвестный цвет → обычный
    expect(await page.locator('.bd-ink-p').getAttribute('d')).toBe('M1 2L30 40');
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); }
});
