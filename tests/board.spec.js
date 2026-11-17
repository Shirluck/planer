// Сквозной сценарий доски: страница «Основных планов» → доска → заметка, фото, видео, зарисовка → перемещение, размер,
// отмена/повтор, удаление → перезапуск приложения → данные на месте.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { fx, tmpDataDir, rmDir, launch, closeApp, addPage, openBoard, boardDoc, waitBoard, vpPoint, toastText, clickCard } = require('./helpers');

test.describe.serial('Доска страницы', () => {
  let dataDir, app, page, errors, taskId;
  const cards = () => page.locator('.bd-card');
  const itemsOf = async () => ((await boardDoc(page, taskId)) || { items: [] }).items;

  test.beforeAll(() => { dataDir = tmpDataDir('board'); });
  test.afterAll(async () => { await closeApp(app); rmDir(dataDir); });

  test('главный экран открывается, страница создаётся', async () => {
    ({ app, page, errors } = await launch(dataDir, { size: [1440, 900] }));
    await expect(page.locator('.col')).toHaveCount(4);
    await expect(page.locator('#status')).toHaveText('Сохранено');
    taskId = await addPage(page, 'plans', 'Подготовить презентацию');
    expect(taskId).toBeTruthy();
  });

  test('доска открывается и закрывается по Esc', async () => {
    await openBoard(page, taskId);
    await expect(page.locator('.bd-title')).toHaveValue('Подготовить презентацию');
    await expect(page.locator('.bd-emptyhint')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.bd-sheet')).toHaveCount(0);
    await openBoard(page, taskId);
  });

  test('заметка по двойному щелчку', async () => {
    const p = await vpPoint(page, 0.3, 0.3);
    await page.mouse.dblclick(p.x, p.y);
    await expect(page.locator('.bd-card.t-note textarea.bd-ta')).toBeFocused();
    await page.keyboard.type('**Главное:** собрать референсы');
    const empty = await vpPoint(page, 0.85, 0.15);
    await page.mouse.click(empty.x, empty.y);
    await expect(page.locator('.bd-card.t-note .bd-note b')).toHaveText('Главное:');
    const items = await waitBoard(page, taskId, d => d.items.some(i => i.type === 'note' && i.text.includes('референсы')), 'note saved');
    expect(items.items).toHaveLength(1);
  });

  test('изображение через выбор файла', async () => {
    await page.setInputFiles('.bd-file', fx('photo.png'));
    const img = page.locator('.bd-card.t-image img.bd-img');
    await expect(img).toHaveCount(1);
    await expect.poll(() => img.evaluate(i => i.complete && i.naturalWidth)).toBeGreaterThan(0);
    const d = await waitBoard(page, taskId, d => d.items.some(i => i.type === 'image'));
    const it = d.items.find(i => i.type === 'image');
    expect(it.mediaId).toMatch(/^[a-f0-9]{64}$/);
    expect(it.width).toBe(1600); expect(it.height).toBe(1000);
    expect(Math.abs(it.w / it.h - 1.6)).toBeLessThan(0.02);
    // файл скопирован в media/<sha256>.png, есть миниатюра, в JSON нет base64
    expect(fs.existsSync(path.join(dataDir, 'media', it.mediaId + '.png'))).toBe(true);
    expect(fs.existsSync(path.join(dataDir, 'media', 'thumbs', it.mediaId + '.png'))).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/base64|data:image/);
  });

  test('видео: постер и воспроизведение', async () => {
    await page.setInputFiles('.bd-file', fx('clip.webm'));
    const card = page.locator('.bd-card.t-video');
    await expect(card).toHaveCount(1);
    const d = await waitBoard(page, taskId, d => d.items.some(i => i.type === 'video'));
    const it = d.items.find(i => i.type === 'video');
    expect(it.width).toBe(320); expect(it.height).toBe(180);
    expect(it.thumb).toBe(true);
    await card.scrollIntoViewIfNeeded();
    await card.locator('.bd-play').click();
    const v = card.locator('video');
    await expect(v).toHaveCount(1);
    await expect.poll(() => v.evaluate(x => x.readyState)).toBeGreaterThanOrEqual(2);
    await expect(card.locator('.bd-vid-err')).toHaveCount(0);
    // перемотка: сервер media:// отдаёт диапазоны (206)
    const r = await app.evaluate(async ({ net }, id) => { const res = await net.fetch('media://' + id, { headers: { Range: 'bytes=100-199' } }); return [res.status, res.headers.get('content-range'), (await res.arrayBuffer()).byteLength]; }, it.mediaId);
    expect(r[0]).toBe(206); expect(r[2]).toBe(100); expect(r[1]).toMatch(/^bytes 100-199\//);
    await v.evaluate(x => { x.pause(); x.currentTime = 1; });
    await expect.poll(() => v.evaluate(x => !x.seeking && x.currentTime > 0.5)).toBe(true);
  });

  test('зарисовка: создать и перерисовать', async () => {
    await page.click('.bd-rail-btn[aria-label="Зарисовка"]');
    await expect(page.locator('.sk-ov')).toBeVisible();
    const st = await page.locator('.sk-stage').boundingBox();
    await page.mouse.move(st.x + st.width * 0.3, st.y + st.height * 0.5);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) await page.mouse.move(st.x + st.width * (0.3 + i * 0.01), st.y + st.height * 0.5);
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await expect(page.locator('.sk-ov')).toHaveCount(0);
    const d1 = await waitBoard(page, taskId, d => d.items.some(i => i.type === 'sketch' && i.mediaId));
    const s1 = d1.items.find(i => i.type === 'sketch');
    expect(s1.strokesId).toMatch(/^[a-f0-9]{64}$/);
    const v1 = JSON.parse(await page.evaluate(id => window.electronAPI.media.getVector(id), s1.strokesId));
    expect(v1.strokes).toHaveLength(1);
    expect(v1.strokes[0].pts.length / 3).toBeLessThanOrEqual(4);          // прямой штрих из 30 движений прорежен до 2–4 точек
    const skImg = page.locator('.bd-card.t-sketch img.bd-img');
    await expect.poll(() => skImg.evaluate(i => i.complete && i.naturalWidth)).toBeGreaterThan(0);

    // повторное открытие: старые штрихи на месте, добавляем линию
    await page.locator('.bd-card.t-sketch').dblclick();
    await expect(page.locator('.sk-ov')).toBeVisible();
    await expect(page.locator('.sk-acts .tool[aria-label="Очистить холст"]')).toBeEnabled();
    await page.keyboard.press('l');
    await page.mouse.move(st.x + st.width * 0.2, st.y + st.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(st.x + st.width * 0.7, st.y + st.height * 0.3, { steps: 6 });
    await page.mouse.up();
    // текстовая подпись: Enter завершает ввод, редактор остаётся открытым
    await page.keyboard.press('t');
    await page.mouse.click(st.x + st.width * 0.6, st.y + st.height * 0.7);
    await page.keyboard.type('Главное');
    await page.keyboard.press('Enter');
    await expect(page.locator('.sk-textin')).toHaveCount(0);
    await expect(page.locator('.sk-ov')).toBeVisible();
    await page.keyboard.press('Escape');
    const d2 = await waitBoard(page, taskId, d => d.items.some(i => i.type === 'sketch' && i.strokesId !== s1.strokesId));
    const s2 = d2.items.find(i => i.type === 'sketch');
    expect(s2.mediaId).not.toBe(s1.mediaId);
    const v2 = JSON.parse(await page.evaluate(id => window.electronAPI.media.getVector(id), s2.strokesId));
    expect(v2.strokes.map(s => s.t)).toEqual(['pen', 'line', 'text']);
    expect(v2.strokes[2].s).toBe('Главное');

    // «Отмена» в редакторе отбрасывает правки
    await page.locator('.bd-card.t-sketch').dblclick();
    await page.keyboard.press('r');
    await page.mouse.move(st.x + 100, st.y + 100); await page.mouse.down(); await page.mouse.move(st.x + 300, st.y + 260, { steps: 4 }); await page.mouse.up();
    await page.click('.sk-btn:has-text("Отмена")');
    await page.waitForTimeout(600);
    expect((await itemsOf()).find(i => i.type === 'sketch').strokesId).toBe(s2.strokesId);
  });

  test('перемещение и изменение размера', async () => {
    await page.click('.bd-zoom .bd-zb[aria-label^="Показать всё"]');
    const note = page.locator('.bd-card.t-note');
    const before = (await itemsOf()).find(i => i.type === 'note');
    const b = await note.boundingBox();
    await page.mouse.move(b.x + 30, b.y + 15);
    await page.mouse.down();
    await page.mouse.move(b.x + 130, b.y + 75, { steps: 8 });
    await page.mouse.up();
    const iz = await page.evaluate(() => parseFloat(document.querySelector('.bd-world').style.getPropertyValue('--iz')));
    const moved = await waitBoard(page, taskId, d => { const n = d.items.find(i => i.type === 'note'); return n.x !== before.x; });
    const n1 = moved.items.find(i => i.type === 'note');
    expect(Math.abs((n1.x - before.x) - 100 * iz)).toBeLessThan(3);      // 100 px экрана = 100/масштаб на холсте
    expect(Math.abs((n1.y - before.y) - 60 * iz)).toBeLessThan(3);
    // изменение размера за угол
    const rs = note.locator('.bd-rs');
    const rb = await rs.boundingBox();
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.mouse.move(rb.x + 80, rb.y + 40, { steps: 6 });
    await page.mouse.up();
    const resized = await waitBoard(page, taskId, d => d.items.find(i => i.type === 'note').w > n1.w);
    expect(resized.items.find(i => i.type === 'note').w).toBeGreaterThan(n1.w + 20);
    // изображение сохраняет пропорции
    const img = page.locator('.bd-card.t-image');
    const imb = await img.boundingBox();
    await img.click({ position: { x: imb.width - 40, y: imb.height - 30 } });
    const ib = await img.locator('.bd-rs').boundingBox();
    await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
    await page.mouse.down(); await page.mouse.move(ib.x + 60, ib.y + 10, { steps: 5 }); await page.mouse.up();
    const ir = (await waitBoard(page, taskId, d => true)).items.find(i => i.type === 'image');
    expect(Math.abs(ir.w / ir.h - 1.6)).toBeLessThan(0.02);
  });

  test('отмена и повтор (Ctrl+Z / Ctrl+Shift+Z)', async () => {
    const before = await itemsOf();
    const note = page.locator('.bd-card.t-note');
    const empty = await vpPoint(page, 0.97, 0.05);
    await page.mouse.click(empty.x, empty.y);            // снять выделение
    await note.click({ position: { x: 20, y: 10 } });    // выделить (не редактировать)
    await expect(note).toHaveClass(/sel/);
    await expect(note).not.toHaveClass(/editing/);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const after = await waitBoard(page, taskId, d => d.items.find(i => i.type === 'note').x === before.find(i => i.type === 'note').x + 20);
    expect(after).toBeTruthy();
    await page.keyboard.press('Control+z');
    await waitBoard(page, taskId, d => d.items.find(i => i.type === 'note').x === before.find(i => i.type === 'note').x, 'undo');
    await page.keyboard.press('Control+Shift+z');
    await waitBoard(page, taskId, d => d.items.find(i => i.type === 'note').x === before.find(i => i.type === 'note').x + 20, 'redo');
    // глубина истории: 55 копий и 55 отмен
    const n0 = (await itemsOf()).length;
    for (let i = 0; i < 55; i++) await page.keyboard.press('Control+d');
    await waitBoard(page, taskId, d => d.items.length === n0 + 55, 'duplicates');
    for (let i = 0; i < 55; i++) await page.keyboard.press('Control+z');
    await waitBoard(page, taskId, d => d.items.length === n0, '55 undo steps');
  });

  test('удаление и отмена удаления', async () => {
    const n0 = (await itemsOf()).length;
    await clickCard(page, page.locator('.bd-card.t-image'));
    await page.keyboard.press('Delete');
    await expect(page.locator('.bd-card.t-image')).toHaveCount(0);
    expect(await toastText(page)).toContain('удалена');
    await waitBoard(page, taskId, d => d.items.length === n0 - 1);
    await page.keyboard.press('Control+z');
    await expect(page.locator('.bd-card.t-image')).toHaveCount(1);
    await waitBoard(page, taskId, d => d.items.length === n0);
  });

  test('копирование, вставка, вставка картинки из буфера, ссылки и перетаскивание файлов', async () => {
    const n0 = (await itemsOf()).length;
    const empty = await vpPoint(page, 0.97, 0.05);
    await page.mouse.click(empty.x, empty.y);
    await page.locator('.bd-card.t-note').click({ position: { x: 10, y: 8 } });
    await expect(page.locator('.bd-card.t-note')).toHaveClass(/sel/);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await waitBoard(page, taskId, d => d.items.length === n0 + 1, 'pasted card');
    // картинка из системного буфера (как скриншот)
    const shot = [...fs.readFileSync(fx('photo.png'))];
    await app.evaluate(async ({ clipboard, ClipboardItem }, bytes) => {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }) })]);
    }, shot);
    await page.locator('.bd-vp').focus();
    await page.keyboard.press('Control+v');
    await waitBoard(page, taskId, d => d.items.length === n0 + 2 && d.items.filter(i => i.type === 'image').length === 2, 'pasted image');
    // ссылка из буфера
    await app.evaluate(({ clipboard }) => clipboard.writeText('https://example.com/article?id=1'));
    await page.keyboard.press('Control+v');
    const dl = await waitBoard(page, taskId, d => d.items.some(i => i.type === 'link'));
    expect(dl.items.find(i => i.type === 'link').url).toBe('https://example.com/article?id=1');
    // перетаскивание трёх файлов (без пути, как из браузера): раскладываются сеткой без наложений
    const n1 = dl.items.length;
    const bytes = [fs.readFileSync(fx('small.webp')), fs.readFileSync(fx('cat.jpg')), fs.readFileSync(fx('photo.png'))].map(b => [...b]);
    const p = await vpPoint(page, 0.5, 0.5);
    await page.evaluate(({ bytes, p }) => {
      const dt = new DataTransfer();
      ['a.webp', 'b.jpg', 'c.png'].forEach((n, i) => dt.items.add(new File([new Uint8Array(bytes[i])], n, { type: n.endsWith('webp') ? 'image/webp' : n.endsWith('jpg') ? 'image/jpeg' : 'image/png' })));
      const vp = document.querySelector('.bd-vp');
      vp.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true }));
      vp.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true }));
    }, { bytes, p });
    const dd = await waitBoard(page, taskId, d => d.items.length === n1 + 3, 'dropped files');
    const dropped = dd.items.slice(-3);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      const a = dropped[i], b = dropped[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      expect(overlap, 'карточки ' + i + ' и ' + j + ' не перекрываются').toBe(false);
    }
  });

  test('неподдерживаемые и испорченные файлы — понятные ошибки', async () => {
    const n0 = (await itemsOf()).length;
    await page.setInputFiles('.bd-file', fx('notes.txt'));
    expect(await toastText(page)).toMatch(/не поддерживается/);
    await page.setInputFiles('.bd-file', fx('fake-video.mp4'));
    await expect(page.locator('.toast')).toContainText('не соответствует расширению');
    await page.setInputFiles('.bd-file', fx('fake-image.jpg'));
    await expect(page.locator('.toast')).toContainText('повреждён');
    await page.setInputFiles('.bd-file', fx('empty.png'));
    await expect(page.locator('.toast')).toContainText('пустой');
    await page.waitForTimeout(500);
    expect((await itemsOf()).length).toBe(n0);
  });

  test('страница показывает число карточек; данные переживают перезапуск', async () => {
    const items = await itemsOf();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('.bd-sheet')).toHaveCount(0);
    await expect(page.locator('.node[data-id="' + taskId + '"] .n-board .bc')).toHaveText(String(items.length));
    expect(errors.filter(e => !/Autofill|DevTools/.test(e))).toEqual([]);
    await closeApp(app);
    ({ app, page, errors } = await launch(dataDir, { size: [1440, 900] }));
    await expect(page.locator('.node[data-id="' + taskId + '"] .n-board .bc')).toHaveText(String(items.length));
    await openBoard(page, taskId);
    await expect(cards()).toHaveCount(items.length);
    await page.click('.bd-zoom .bd-zb[aria-label^="Показать всё"]');
    const imgs = page.locator('.bd-card.t-image img.bd-img');
    await expect.poll(async () => (await imgs.evaluateAll(list => list.filter(i => i.complete && i.naturalWidth > 0).length))).toBe(await imgs.count());
    await expect(page.locator('.bd-card.t-note .bd-note b').first()).toHaveText('Главное:');
    // просмотр изображения во весь экран
    await clickCard(page, page.locator('.bd-card.t-image').first(), { double: true });
    await expect(page.locator('.bd-lb')).toBeVisible();
    await expect.poll(() => page.locator('.bd-lb-img').evaluate(i => i.naturalWidth)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.bd-lb')).toHaveCount(0);
    await expect(page.locator('.bd-sheet')).toBeVisible();
  });

  test('рисунок поверх изображения не меняет оригинал', async () => {
    const before = (await itemsOf()).find(i => i.type === 'image');
    const card = page.locator('.bd-card[data-id="' + before.id + '"]');
    await clickCard(page, card, { button: 'right' });
    await page.click('.menu-it:has-text("Нарисовать поверх")');
    await expect(page.locator('.sk-ov')).toBeVisible();
    await expect(page.locator('.sk-bgs')).toHaveCount(0);
    const st = await page.locator('.sk-stage').boundingBox();
    await page.keyboard.press('p');
    await page.mouse.move(st.x + st.width * 0.4, st.y + st.height * 0.4); await page.mouse.down();
    await page.mouse.move(st.x + st.width * 0.6, st.y + st.height * 0.6, { steps: 10 }); await page.mouse.up();
    await page.click('.sk-btn.primary');
    const d = await waitBoard(page, taskId, d => !!d.items.find(i => i.id === before.id).overlay);
    const it = d.items.find(i => i.id === before.id);
    expect(it.mediaId).toBe(before.mediaId);
    expect(it.overlay.mediaId).toMatch(/^[a-f0-9]{64}$/);
    await expect(card.locator('img.bd-ovl')).toHaveCount(1);
  });
});

test('видео, которое не воспроизводится: понятное сообщение и внешний плеер', async () => {
  const dir = tmpDataDir('codec');
  // MP4-заголовок (ftyp) с испорченным содержимым — так ведёт себя файл с неподдерживаемым кодеком
  const bad = path.join(dir, 'hevc-clip.mp4');
  const head = Buffer.from('000000206674797069736f6d0000020069736f6d69736f32617663316d703431', 'hex');
  fs.writeFileSync(bad, Buffer.concat([head, Buffer.alloc(4096, 7)]));
  const { app, page } = await launch(dir, { size: [1280, 800] });
  try {
    const id = await addPage(page, 'plans', 'Видео');
    await openBoard(page, id);
    await page.setInputFiles('.bd-file', bad);
    const card = page.locator('.bd-card.t-video');
    await expect(card).toHaveCount(1);
    await card.locator('.bd-play').click();
    await expect(card.locator('.bd-vid-err')).toBeVisible();
    await expect(card.locator('.bd-vid-err')).toContainText('не удаётся воспроизвести');
    await expect(card.locator('.bd-vid-err button')).toHaveText('Открыть во внешнем плеере');
    await expect(page.locator('.col')).toHaveCount(4);
  } finally { await closeApp(app); rmDir(dir); }
});
