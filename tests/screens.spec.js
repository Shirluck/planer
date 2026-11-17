// Скриншоты ключевых состояний в tests/screens/ (светлая и тёмная темы, 1280×800, 1920×1080, минимальный размер)
// и проверка плавности холста на 150 карточках.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { fx, DOC, tmpDataDir, rmDir, launch, setSize, closeApp, addTask, addPage, openBoard, waitBoard, vpPoint, clickCard } = require('./helpers');

const OUT = path.join(__dirname, 'screens');

test.describe.serial('Скриншоты', () => {
  let dir, app, page, taskId;
  const shot = async name => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, name + '.png') }); };
  const scheme = s => page.emulateMedia({ colorScheme: s });

  test.beforeAll(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    dir = tmpDataDir('screens');
    ({ app, page } = await launch(dir, { size: [1280, 800] }));
  });
  test.afterAll(async () => { await closeApp(app); rmDir(dir); });

  test('главный экран', async () => {
    await addTask(page, 'day', 'Подготовить презентацию для клиента !!!');
    await addTask(page, 'day', 'Позвонить в типографию');
    await addTask(page, 'day', 'Купить фасады для кухни !');
    await page.locator('.col[data-key=day] .item').nth(1).locator('.cb').click();
    // блоки времени дня
    for (const [f, t, n, c] of [['10:00', '12:00', 'Работа', 'blue'], ['14:00', '18:00', 'Встречи', 'orange']]) {
      await page.click('.col[data-key=day] .tool[aria-label^="Добавить блок времени"]');
      await page.locator('.tb-pop .tb-time-in').nth(0).fill(f); await page.locator('.tb-pop .tb-time-in').nth(1).fill(t);
      await page.fill('.tb-pop .tb-name', n); await page.click('.tb-pop .tb-sw-b[data-color=' + c + ']');
      if (n === 'Работа') await shot('time-block-editor-light');
      await page.click('.tb-pop .tb-btn.primary');
    }
    const first = page.locator('.col[data-key=day] .tz[data-block=""] .item').first();
    await first.hover(); await first.locator('.more').click(); await page.click('.menu-it:has-text("В блок 10:00–12:00")');
    await page.locator('.col[data-key=day] .tblock').nth(1).locator('.tb-add').click();
    await page.keyboard.type('Созвон с подрядчиком'); await page.keyboard.press('Enter'); await page.keyboard.press('Escape');
    // расписать другие дни недели через окно дня
    const days = (await page.locator('.col[data-key=week] .wk-day').evaluateAll(els => els.map(e => e.dataset.date))).filter(Boolean);
    const todayK = await page.locator('.col[data-key=week] .wk-day.today').getAttribute('data-date');
    const others = days.filter(k => k !== todayK);
    const plan = [['Встреча с подрядчиком !!!', 'Выбрать плитку для кухни', 'Забрать заказ'], ['Отпуск: купить билеты !!!', 'Тренировка'], ['Сдать квартальный отчёт !!!']];
    for (let i = 0; i < plan.length; i++) {
      await page.locator('.col[data-key=week] .wk-day[data-date="' + others[i] + '"] .wk-head').click();
      for (const t of plan[i]) await addTask(page, 'sheet', t);
      if (i === 0) {
        await shot('day-sheet-light-1280x800');
        await scheme('dark'); await shot('day-sheet-dark-1280x800'); await scheme('light');
      }
      await page.keyboard.press('Escape');
    }
    // выбор дня для переноса
    const it = page.locator('.col[data-key=day] .item').nth(2);
    await it.hover(); await it.locator('.more').click();
    await shot('task-menu-light');
    await page.click('.menu-it:has-text("Перенести на другой день")');
    await shot('date-picker-light');
    await page.keyboard.press('Escape');
    // страница с доской в «Основных планах»
    taskId = await addPage(page, 'plans', 'Презентация для клиента');
    await addPage(page, 'ideas', 'Кухня мечты');
    await openBoard(page, taskId);
    const p = await vpPoint(page, 0.18, 0.2);
    await page.mouse.dblclick(p.x, p.y);
    await page.keyboard.type('**Структура:** 10 слайдов\n- проблема\nрешение\nцены\n[ ] согласовать с Машей');
    await page.locator('.bd-vp').click({ position: { x: 4, y: 4 } });
    await page.click('.bd-rail-btn[aria-label="Чек-лист"]');
    await page.keyboard.type('До пятницы');
    await page.keyboard.press('Enter'); await page.keyboard.type('Тезисы');
    await page.keyboard.press('Enter'); await page.keyboard.type('Макет обложки');
    await page.keyboard.press('Enter'); await page.keyboard.type('Прогон с командой');
    await page.locator('.bd-vp').click({ position: { x: 4, y: 4 } });
    await page.locator('.bd-card.t-checklist .bd-cbx').first().click();
    await page.setInputFiles('.bd-file', [fx('photo.png'), fx('clip.webm'), fx('cat.jpg')]);
    await waitBoard(page, taskId, d => d.items.length === 5);
    await page.click('.bd-rail-btn[aria-label="Ссылка"]');
    await page.keyboard.type('https://www.behance.net/gallery/presentation');
    await page.keyboard.press('Enter');
    await page.click('.bd-rail-btn[aria-label="Зарисовка"]');
    const st = await page.locator('.sk-stage').boundingBox();
    const cx = st.x + st.width / 2, cy = st.y + st.height / 2;
    await page.mouse.move(cx - 200, cy + 40); await page.mouse.down();
    for (let i = 0; i <= 40; i++) await page.mouse.move(cx - 200 + i * 10, cy + 40 - Math.sin(i / 6) * 70);
    await page.mouse.up();
    await page.keyboard.press('r');
    await page.mouse.move(cx - 120, cy - 150); await page.mouse.down(); await page.mouse.move(cx + 120, cy - 40, { steps: 5 }); await page.mouse.up();
    await page.keyboard.press('a');
    await page.click('.sk-col[data-c="#d93a40"]');
    await page.mouse.move(cx + 260, cy - 160); await page.mouse.down(); await page.mouse.move(cx + 140, cy - 100, { steps: 5 }); await page.mouse.up();
    await page.keyboard.press('t');
    await page.mouse.click(cx + 200, cy - 210);
    await page.keyboard.type('главное!');
    await page.keyboard.press('Enter');
    await shot('sketch-editor-light-1280x800');
    await scheme('dark'); await shot('sketch-editor-dark-1280x800'); await scheme('light');
    await page.keyboard.press('Escape');
    await waitBoard(page, taskId, d => d.items.length === 7);
    // цветная заметка
    await page.click('.bd-rail-btn[aria-label="Заметка"]');
    await page.keyboard.type('Идея: закончить историей клиента');
    await page.click('.bd-ctx .bd-sw-b[data-color=yellow]');
    await page.locator('.bd-vp').click({ position: { x: 4, y: 4 } });
    // подпись к фото
    const img = page.locator('.bd-card.t-image').first();
    await clickCard(page, img, { button: 'right' });
    await page.click('.menu-it:has-text("подпись")');
    await page.keyboard.type('Референс для обложки');
    await page.keyboard.press('Enter');
    await page.click('.bd-zoom .bd-zb[aria-label^="Показать всё"]');
    await page.keyboard.press('Escape');
    await expect(page.locator('.bd-sheet')).toHaveCount(0);

    await page.locator('.node[data-id="' + taskId + '"]').hover();
    await shot('main-light-1280x800');
    await scheme('dark'); await shot('main-dark-1280x800'); await scheme('light');
    await setSize(app, 1920, 1080); await shot('main-light-1920x1080');
    await setSize(app, 760, 560); await shot('main-light-min-760x560');
    await scheme('dark'); await shot('main-dark-min-760x560'); await scheme('light');
    await setSize(app, 1280, 800);
  });

  test('доска', async () => {
    await openBoard(page, taskId);
    await page.click('.bd-zoom .bd-zb[aria-label^="Показать всё"]');
    await clickCard(page, page.locator('.bd-card.t-checklist'));
    await shot('board-light-1280x800');
    await scheme('dark'); await shot('board-dark-1280x800'); await scheme('light');
    await setSize(app, 1920, 1080); await page.click('.bd-zoom .bd-zb[aria-label^="Показать всё"]'); await shot('board-light-1920x1080');
    await scheme('dark'); await shot('board-dark-1920x1080'); await scheme('light');
    await setSize(app, 760, 560); await page.click('.bd-zoom .bd-zb[aria-label^="Показать всё"]'); await shot('board-light-min-760x560');
    await scheme('dark'); await shot('board-dark-min-760x560'); await scheme('light');
    await setSize(app, 1280, 800); await page.click('.bd-zoom .bd-zb[aria-label^="Показать всё"]');
    // редактирование заметки с панелью форматирования
    const note = page.locator('.bd-card.t-note').first();
    await clickCard(page, note, { double: true });
    await shot('board-note-editing-light');
    await page.keyboard.press('Escape');
    // контекстное меню карточки
    await clickCard(page, page.locator('.bd-card.t-image').first(), { button: 'right' });
    await shot('board-card-menu-light');
    await page.keyboard.press('Escape');
    // видео играет
    const v = page.locator('.bd-card.t-video');
    await v.locator('.bd-play').click();
    await page.waitForTimeout(700);
    await shot('board-video-playing-light');
    // просмотр изображения
    await clickCard(page, page.locator('.bd-card.t-image').first(), { double: true });
    await expect(page.locator('.bd-lb')).toBeVisible();
    await shot('viewer-1280x800');
    await page.keyboard.press('Escape');
    // пустая доска
    await page.keyboard.press('Escape');
    const t2 = page.locator('.col[data-key=ideas] .node.page').first();
    await t2.locator('.n-title').dblclick();
    await shot('board-empty-light');
    await scheme('dark'); await shot('board-empty-dark'); await scheme('light');
    await page.keyboard.press('Escape');
  });

  test('плавность: 150 карточек', async () => {
    const r = await page.evaluate(async b => window.electronAPI.media.importBuffer('photo.png', 'image/png', new Uint8Array(b)), [...fs.readFileSync(fx('photo.png'))]);
    const id = r.meta.id;
    const tid = await addPage(page, 'ideas', 'Мудборд на 150 карточек', 'text');
    const items = [];
    for (let i = 0; i < 150; i++) {
      const x = (i % 15) * 280, y = Math.floor(i / 15) * 230;
      items.push(i % 3 === 0
        ? { id: 'c' + i, type: 'image', x, y, w: 240, h: 150, z: i, mediaId: id, name: 'photo.png', width: 1600, height: 1000, thumb: true, caption: '' }
        : { id: 'c' + i, type: 'note', x, y, w: 240, h: 90, z: i, text: 'Карточка ' + i + '\n- пункт\n[ ] задача', color: ['', 'yellow', 'green', 'blue', 'pink', 'purple'][i % 6] });
    }
    await page.evaluate(([p, d]) => window.electronAPI.dbSet(p, d), [DOC('board-' + tid), { v: 1, items }]);
    const row = page.locator('.node[data-id="' + tid + '"]');
    await row.hover(); await row.locator('.n-more').click();
    await page.click('.menu-it:has-text("Сделать доской")');
    await expect(row).toHaveClass(/kind-board/);
    await openBoard(page, tid);
    await expect(page.locator('.bd-card')).toHaveCount(150);
    await page.waitForTimeout(500);
    const vp = await page.locator('.bd-vp').boundingBox();
    await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
    await page.evaluate(() => { window.__ft = []; let last = performance.now(); const loop = t => { window.__ft.push(t - last); last = t; if (window.__ft.length < 400) requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
    for (let i = 0; i < 30; i++) { await page.mouse.wheel(40, 30); }
    await page.keyboard.down('Control');
    for (let i = 0; i < 15; i++) { await page.mouse.wheel(0, i < 8 ? 120 : -120); }
    await page.keyboard.up('Control');
    // перетаскивание холста
    await page.mouse.down();
    for (let i = 0; i < 30; i++) await page.mouse.move(vp.x + vp.width / 2 - i * 8, vp.y + vp.height / 2 - i * 4);
    await page.mouse.up();
    const ft = await page.evaluate(() => window.__ft.slice(2));
    ft.sort((a, b) => a - b);
    const p95 = ft[Math.floor(ft.length * 0.95)], med = ft[Math.floor(ft.length / 2)];
    console.log('frame time: median ' + med.toFixed(1) + ' ms, p95 ' + p95.toFixed(1) + ' ms, frames ' + ft.length);
    expect(med).toBeLessThan(25);
    expect(p95).toBeLessThan(60);
    await page.click('.bd-zoom .bd-zb[aria-label^="Показать всё"]');
    await shot('board-150-cards-light');
    await page.keyboard.press('Escape');
  });
});
