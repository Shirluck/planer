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

  test('таймеры, поиск, настройки, восстановление, мини-окно, рисование', async () => {
    await setSize(app, 1280, 800);
    // таймер идёт: кнопка в шапке и панель
    await page.evaluate(() => window.electronAPI.timers.start({ presetId: 'focus' }));
    await page.click('#timerBtn');
    await expect(page.locator('.tm-run')).toHaveCount(1);
    await shot('timers-light');
    await scheme('dark'); await shot('timers-dark'); await scheme('light');
    await page.keyboard.press('Escape');
    // окончание таймера
    await page.evaluate(() => ringTimer({ id: 'x', title: 'Фокус', ms: 25 * 60000 }));
    await shot('timer-done-light');
    await page.locator('.tm-done .primary').click();
    // поиск
    await page.keyboard.press('Control+KeyK');
    await page.locator('.sp-in').fill('фасад');
    await expect(page.locator('.sp-row').first()).toBeVisible();
    await shot('search-light');
    await scheme('dark'); await shot('search-dark'); await scheme('light');
    await page.keyboard.press('Escape');
    // настройки и восстановление
    await page.click('#settingsBtn');
    await shot('settings-light');
    await scheme('dark'); await shot('settings-dark'); await scheme('light');
    await page.locator('.st-tabs').getByText('Резервные копии',{exact:true}).click();
    await page.locator('.st-btns button', { hasText: 'Сделать копию сейчас' }).click();
    await page.locator('.st-btns button', { hasText: 'Восстановить из копии' }).click();
    await expect(page.locator('.rs-doc').first()).toBeVisible();
    await shot('restore-light');
    await page.keyboard.press('Escape');
    // компактный режим
    await page.evaluate(() => setUi({ compact: true }));
    await shot('main-compact-light');
    await page.evaluate(() => setUi({ compact: false }));
    // мини-окно «Сегодня»
    const [mini] = await Promise.all([app.waitForEvent('window'), app.evaluate(() => global.__planerTray.click())]);
    await expect(mini.locator('.mn-item').first()).toBeVisible();
    await mini.waitForTimeout(300);
    await mini.screenshot({ path: path.join(OUT, 'mini-today-light.png') });
    await mini.emulateMedia({ colorScheme: 'dark' }); await mini.waitForTimeout(200);
    await mini.screenshot({ path: path.join(OUT, 'mini-today-dark.png') });
    await app.evaluate(() => global.__planerTray.mini().hide());
    await page.evaluate(() => window.electronAPI.timers.stopAll());
    // рисование от руки на доске
    const tid = await addPage(page, 'ideas', 'Набросок');
    await openBoard(page, tid);
    const vp = await page.locator('.bd-vp').boundingBox();
    const line = async (pts) => { await page.mouse.move(vp.x + pts[0][0], vp.y + pts[0][1]); await page.mouse.down(); for (const p of pts.slice(1)) await page.mouse.move(vp.x + p[0], vp.y + p[1], { steps: 6 }); await page.mouse.up(); };
    await page.click('.bd-rail-btn[aria-label="Рисовать"]');
    await line([[260, 420], [260, 260], [370, 180], [480, 260], [480, 420], [260, 420]]);
    await line([[340, 420], [340, 330], [400, 330], [400, 420]]);
    await page.click('.bd-ib-c[aria-label="Оранжевый"]'); await page.click('.bd-ib-tool[aria-label^="Маркер"]');
    const sun = []; for (let a = 0; a <= 360; a += 15) sun.push([640 + 40 * Math.cos(a * Math.PI / 180), 200 + 40 * Math.sin(a * Math.PI / 180)]);
    await line(sun);
    await page.click('.bd-ib-c[aria-label="Зелёный"]'); await page.click('.bd-ib-tool[aria-label^="Перо"]');
    await line([[180, 440], [300, 445], [420, 438], [560, 446], [700, 440]]);
    await shot('board-drawing-light');
    await scheme('dark'); await shot('board-drawing-dark'); await scheme('light');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  });

  test('заметки как в Notion, моушн-инструменты, выделение задач и выравнивание на доске', async () => {
    await setSize(app, 1280, 800);
    // заметка
    const nid = await addPage(page, 'ideas', 'Сценарий ролика', 'text');
    await page.locator('.node[data-id="' + nid + '"] .n-title').dblclick();
    await page.locator('.ne .nb').first().click();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '# Сценарий\nКороткий ролик на **30 секунд** о новой коллекции.\n## Сцены\n1. Логотип собирается из частиц\n2. Товар крупным планом\n  - медленный наезд камеры\n3. Финальный кадр с призывом\n- [x] раскадровка\n- [ ] анимация\n> Простота — высшая сложность\n---');
      boxEl.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.keyboard.type('/выно'); await page.keyboard.press('Enter'); await page.keyboard.type('Сдать черновик в пятницу');
    await page.locator('.ne .nb').nth(1).hover();
    await shot('notes-light');
    await scheme('dark'); await shot('notes-dark'); await scheme('light');
    await page.keyboard.type('/');
    await shot('notes-slash-light');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.click('#memoryBtn');
    await shot('memory-catalog-light');
    await page.keyboard.press('Escape');
    // выделение задач скопом
    const rows = page.locator('.col[data-key=day] .item');
    await rows.nth(0).locator('.txt').click({ modifiers: ['Control'] });
    await rows.nth(1).locator('.txt').click({ modifiers: ['Control'] });
    await shot('tasks-select-light');
    await page.keyboard.press('Escape');
    // выравнивание на доске
    const bid = await addPage(page, 'ideas', 'Референсы');
    await openBoard(page, bid);
    await page.evaluate(k => Promise.all([['**Свет**\nмягкий, контровой', 0, 30], ['**Цвет**\nтёплая палитра', 300, 0], ['**Шрифт**\nгротеск', 620, 70]].map(([t, x, y]) => boardApi.addCard(k, 'note', t, x, y))), bid);
    await page.click('.bd-zoom .bd-zb[aria-label^="Показать всё"]');
    await page.keyboard.press('Control+a');
    await shot('board-align-light');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  });
});
