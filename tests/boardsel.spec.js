// Доска: выделение рамкой по пустому месту, «рука» (H), Ctrl+щелчок, выравнивание, распределение, сетка, притяжение с направляющими.
const { test, expect } = require('@playwright/test');
const { tmpDataDir, rmDir, launch, closeApp, addPage, openBoard, waitBoard } = require('./helpers');

test('выделение рамкой, рука, выравнивание, распределение и притяжение', async () => {
  const dir = tmpDataDir('boardsel');
  const { app, page, errors } = await launch(dir, { size: [1440, 900] });
  try {
    const id = await addPage(page, 'ideas', 'Мудборд');
    await openBoard(page, id);
    await page.evaluate(k => { for (const [t, x, y] of [['А', 0, 0], ['Б', 300, 60], ['В', 640, 20]]) boardApi.addCard(k, 'note', t, x, y); }, id);
    await waitBoard(page, id, d => d.items.length === 3);
    // точка холста → экран (по текущему сдвигу и масштабу холста)
    const vp = await page.locator('.bd-vp').boundingBox();
    let view;
    const readView = async () => { await page.waitForTimeout(150); view = await page.evaluate(() => { const t = document.querySelector('.bd-world').style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([\d.]+)\)/); return { x: +t[1], y: +t[2], z: +t[3] }; }); };
    const W = (x, y) => ({ x: vp.x + view.x + x * view.z, y: vp.y + view.y + y * view.z });
    const empty = { x: vp.x + 60, y: vp.y + vp.height - 60 };                  // пустое место холста (левый нижний угол)
    await page.click('.bd-zoom .bd-zb[aria-label^="Показать всё"]');
    await readView();
    // рамка по пустому месту выделяет (а не двигает холст)
    let a = W(-40, -40), b = W(560, 200);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
    await expect(page.locator('.bd-card.sel')).toHaveCount(2);
    // щелчок по пустому месту снимает выделение
    await page.mouse.click(empty.x, empty.y);
    await expect(page.locator('.bd-card.sel')).toHaveCount(0);
    // Ctrl+щелчок добавляет к выделению
    await page.locator('.bd-card', { hasText: 'А' }).click();
    await page.locator('.bd-card', { hasText: 'В' }).click({ modifiers: ['Control'] });
    await expect(page.locator('.bd-card.sel')).toHaveCount(2);
    await page.locator('.bd-card', { hasText: 'Б' }).click({ modifiers: ['Control'] });
    await expect(page.locator('.bd-card.sel')).toHaveCount(3);
    // выравнивание по верхнему краю, распределение по горизонтали
    await page.getByRole('button',{name:'Выровнять',exact:true}).click();
    await page.locator('.menu-it').getByText('По верхнему краю',{exact:true}).click();
    let d = await waitBoard(page, id, d => d.items.every(i => i.y === 0));
    await page.getByRole('button',{name:'Выровнять',exact:true}).click();
    await page.locator('.menu-it').getByText('Распределить по горизонтали',{exact:true}).click();
    d = await waitBoard(page, id, d => { const xs = d.items.map(i => i.x).sort((p, q) => p - q); return xs[1] === 320; });
    expect(d.items.map(i => i.x).sort((p, q) => p - q)).toEqual([0, 320, 640]);        // ширина 240 → промежутки по 80
    await page.getByRole('button',{name:'Выровнять',exact:true}).click();
    await page.locator('.menu-it').getByText('Выровнять по левому краю',{exact:true}).click();
    await waitBoard(page, id, d => d.items.every(i => i.x === 0));
    await page.keyboard.press('Control+z');
    await waitBoard(page, id, d => d.items.some(i => i.x === 640));
    await page.getByRole('button',{name:'Выровнять',exact:true}).click();
    await page.locator('.menu-it').getByText('Разложить аккуратной сеткой',{exact:true}).click();
    await waitBoard(page, id, d => new Set(d.items.map(i => i.y)).size >= 1);
    // притяжение: тянем «Б» вниз почти к нижнему краю «А» — встаёт ровно и видна направляющая
    const cards = await page.evaluate(k => boardApi.readBoard(k), id);
    const A = cards.find(c => c.text === 'А'), B = cards.find(c => c.text === 'Б');
    await page.evaluate(([k, a, b]) => boardApi.moveCards(k, [{ id: a, x: 0, y: 0 }, { id: b, x: 400, y: 300 }]), [id, A.id, B.id]);
    await page.click('.bd-zoom .bd-zb[aria-label^="Показать всё"]'); await readView();
    await page.mouse.click(empty.x, empty.y);
    const start = W(400 + 30, 300 + 20);
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x - 397 * view.z, start.y - 100 * view.z, { steps: 10 });                       // левый край «Б» ≈ x 3 → притянется к 0
    await expect(page.locator('.bd-guide.v')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('.bd-guide')).toHaveCount(0);
    d = await waitBoard(page, id, d => d.items.find(i => i.id === B.id).x === 0);
    // Alt — без притяжения
    const s2 = W(30, 200 + 20);
    await page.mouse.move(s2.x, s2.y); await page.keyboard.down('Alt'); await page.mouse.down();
    await page.mouse.move(s2.x + 4, s2.y + 30, { steps: 6 }); await page.mouse.up(); await page.keyboard.up('Alt');
    d = await waitBoard(page, id, d => d.items.find(i => i.id === B.id).x === Math.round(4 / view.z));
    // «Рука»: протягивание по пустому месту двигает холст
    await page.keyboard.press('KeyH');
    await expect(page.locator('.bd-zb[data-tool=hand]')).toHaveAttribute('aria-pressed', 'true');
    const before = await page.evaluate(() => document.querySelector('.bd-world').style.transform);
    const p0 = empty;
    await page.mouse.move(p0.x, p0.y); await page.mouse.down(); await page.mouse.move(p0.x + 120, p0.y - 60, { steps: 6 }); await page.mouse.up();
    expect(await page.evaluate(() => document.querySelector('.bd-world').style.transform)).not.toBe(before);
    await expect(page.locator('.bd-card.sel')).toHaveCount(1);                 // рука двигает холст, выделение не трогает
    await page.keyboard.press('KeyV');
    await expect(page.locator('.bd-zb[data-tool=select]')).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); }
});
