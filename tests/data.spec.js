// Хранение: миграция старого planner-data.json, повреждённые и пустые файлы, сборка мусора медиа.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { fx, tmpDataDir, rmDir, launch, closeApp, openBoard, addPage } = require('./helpers');

const legacy = {
  'data/users/local/planner-day': { items: [{ id: 't1', text: 'Старая задача', done: false, pri: 3, note: 'заметка из v1', boardCount: 2 }, { id: 't2', text: 'Сделано', done: true, pri: 0, note: '' }], hideDone: false },
  'data/users/local/planner-week': { items: [{ id: 't3', text: 'Задача недели', done: false, pri: 1, note: '' }], hideDone: false },
  'data/users/local/planner-plans': { nodes: [{ id: 'f1', type: 'folder', title: 'Работа', open: true, children: [{ id: 'p1', type: 'page', title: 'План', blocks: [{ id: 'b1', t: 'todo', text: 'Пункт', done: true }] }] }] },
  'data/users/local/planner-ideas': { nodes: [] },
  'data/users/local/board-t1': { v: 1, view: { x: 0, y: 0, zoom: 1 }, items: [
    { id: 'n1', type: 'note', x: 0, y: 0, w: 240, h: 80, z: 1, text: 'Заметка со старой доски' },
    { id: 'n2', type: 'checklist', x: 300, y: 0, w: 260, h: 90, z: 2, title: 'Список', items: [{ id: 'i1', text: 'Пункт', done: false }] }] }
};
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

test('миграция старого planner-data.json без потерь и с копией', async () => {
  const dir = tmpDataDir('migrate');
  fs.writeFileSync(path.join(dir, 'planner-data.json'), JSON.stringify(legacy));
  const { app, page, errors } = await launch(dir);
  try {
    // «Сегодня» версии 1 → задачи на сегодняшнюю дату
    await expect(page.locator('.col[data-key=day] .item')).toHaveCount(2);
    await expect(page.locator('.col[data-key=day] .item').first().locator('.txt')).toHaveValue('Старая задача');
    await expect(page.locator('.col[data-key=day] .item').first()).toHaveAttribute('data-pri', '3');
    await expect(page.locator('.col[data-key=day] .note-prev').first()).toHaveText('заметка из v1');
    // «Неделя» версии 1 → «Без даты» в календаре
    await expect(page.locator('.col[data-key=week] .wk-day.undated .wk-task .wk-t')).toHaveText('Задача недели');
    await expect(page.locator('.col[data-key=plans] .node.page .n-title', { hasText: 'План' })).toBeVisible();
    // доска старой задачи → страница в «Основных планах» → «Доски задач», карточки на месте
    const pg = page.locator('.col[data-key=plans] .node.page', { hasText: 'Старая задача' });
    await expect(pg.locator('.n-meta')).toHaveText('2');
    await expect(pg).toHaveClass(/kind-board/);
    await pg.locator('.n-title').dblclick();
    await expect(page.locator('.bd-card')).toHaveCount(2);
    await expect(page.locator('.bd-card.t-note')).toContainText('Заметка со старой доски');
    await page.keyboard.press('Escape');
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'planer-meta.json'), 'utf8'));
    expect(meta.schema).toBe(2);
    expect(fs.readdirSync(path.join(dir, 'backups')).some(f => /^planner-data-before-schema-2-.*\.json$/.test(f))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'docs', 'data__users__local__planner-day.json'))).toBe(true);   // старые документы не удалены
    expect(fs.existsSync(path.join(dir, 'planner-data.json'))).toBe(true);
    await expect(page.locator('#status')).toHaveText('Сохранено');
    expect(errors).toEqual([]);
  } finally { await closeApp(app); }
  // после миграции изменения пишутся в planner-cal и не теряются; повторной миграции нет
  const r2 = await launch(dir);
  try {
    await expect(r2.page.locator('.col[data-key=day] .item')).toHaveCount(2);
    await expect(r2.page.locator('.col[data-key=plans] .node.page', { hasText: 'Старая задача' })).toHaveCount(1);
    await r2.page.locator('.col[data-key=day] .item').first().locator('.cb').click();
    await expect(r2.page.locator('#status')).toHaveText('Сохранено');
  } finally { await closeApp(r2.app); }
  const cal = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'data__users__local__planner-cal.json'), 'utf8'));
  expect(cal.days[today()].items[0].done).toBe(true);
  expect(cal.undated.map(t => t.text)).toEqual(['Задача недели']);
  rmDir(dir);
});

test('повреждённый и пустой файлы данных: приложение стартует, копия сохранена', async () => {
  const dir = tmpDataDir('corrupt');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'planer-meta.json'), JSON.stringify({ schema: 2 }));
  fs.writeFileSync(path.join(dir, 'docs', 'data__users__local__planner-day.json'), '{"items":[{"id":"x", "text": обрыв');
  fs.writeFileSync(path.join(dir, 'docs', 'data__users__local__planner-week.json'), '');
  fs.writeFileSync(path.join(dir, 'docs', 'data__users__local__planner-cal.json'), '{"days": {"2026-');
  const { app, page } = await launch(dir);
  try {
    await expect(page.locator('.col')).toHaveCount(4);
    await expect(page.locator('#banner')).toContainText('повреждён');
    const files = fs.readdirSync(path.join(dir, 'docs'));
    expect(files.some(f => f.startsWith('data__users__local__planner-day.json.corrupt-'))).toBe(true);
    expect(files.some(f => f.startsWith('data__users__local__planner-week.json.corrupt-'))).toBe(true);
    expect(files.some(f => f.startsWith('data__users__local__planner-cal.json.corrupt-'))).toBe(true);
    await page.fill('.col[data-key=day] .add-input', 'Новая задача после сбоя');
    await page.press('.col[data-key=day] .add-input', 'Enter');
    await expect(page.locator('#status')).toHaveText('Сохранено');
  } finally { await closeApp(app); rmDir(dir); }
});

test('повреждённый и пустой старый planner-data.json', async () => {
  for (const content of ['не json {{{', '']) {
    const dir = tmpDataDir('legacy-bad');
    fs.writeFileSync(path.join(dir, 'planner-data.json'), content);
    const { app, page } = await launch(dir);
    try {
      await expect(page.locator('.col')).toHaveCount(4);
      expect(fs.readdirSync(path.join(dir, 'backups')).length).toBeGreaterThan(0);
    } finally { await closeApp(app); rmDir(dir); }
  }
});

test('сборка мусора: удаляются только старые файлы без ссылок', async () => {
  const dir = tmpDataDir('gc');
  const media = path.join(dir, 'media');
  fs.mkdirSync(path.join(media, 'thumbs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  const png = fs.readFileSync(fx('photo.png'));
  const id = c => c.repeat(64);
  const old = (Date.now() - 10 * 24 * 3600 * 1000) / 1000;
  fs.writeFileSync(path.join(media, id('a') + '.png'), png);            // старый, без ссылок -> удалить
  fs.writeFileSync(path.join(media, 'thumbs', id('a') + '.png'), png);
  fs.utimesSync(path.join(media, id('a') + '.png'), old, old);
  fs.writeFileSync(path.join(media, id('b') + '.png'), png);            // старый, но есть ссылка -> оставить
  fs.utimesSync(path.join(media, id('b') + '.png'), old, old);
  fs.writeFileSync(path.join(media, id('c') + '.png'), png);            // свежий без ссылок (отмена удаления) -> оставить
  fs.writeFileSync(path.join(dir, 'planer-meta.json'), JSON.stringify({ schema: 2 }));
  fs.writeFileSync(path.join(dir, 'docs', 'data__users__local__board-t1.json'), JSON.stringify({ v: 1, view: { x: 0, y: 0, zoom: 1 }, items: [{ id: 'i1', type: 'image', x: 0, y: 0, w: 200, h: 120, z: 1, mediaId: id('b'), name: 'b.png' }] }));
  const { app } = await launch(dir, { env: { PLANER_GC_DELAY_MS: '300' } });
  try {
    await expect.poll(() => fs.existsSync(path.join(media, id('a') + '.png')), { timeout: 10000 }).toBe(false);
    expect(fs.existsSync(path.join(media, 'thumbs', id('a') + '.png'))).toBe(false);
    expect(fs.existsSync(path.join(media, id('b') + '.png'))).toBe(true);
    expect(fs.existsSync(path.join(media, id('c') + '.png'))).toBe(true);
  } finally { await closeApp(app); rmDir(dir); }
});

test('большие файлы: прогресс копирования и предел размера', async () => {
  const dir = tmpDataDir('big');
  const big = path.join(dir, 'big-video.mp4');
  fs.writeFileSync(big, Buffer.alloc(3 * 1024 * 1024));
  const { app, page } = await launch(dir, { env: { PLANER_MAX_MEDIA_BYTES: String(2 * 1024 * 1024), PLANER_PROGRESS_MIN_BYTES: String(200 * 1024) } });
  try {
    const id = await addPage(page, 'plans', 'Видео');
    await openBoard(page, id);
    await page.evaluate(() => { window.__prog = []; window.electronAPI.media.onProgress(p => window.__prog.push(p)); });
    await page.setInputFiles('.bd-file', big);
    await expect(page.locator('.toast')).toContainText('слишком большой');
    await expect(page.locator('.toast')).toContainText('2 МБ');
    // файл больше порога прогресса, но меньше предела — приходят события прогресса
    await page.evaluate(() => { window.__prog = []; window.electronAPI.media.onProgress(p => window.__prog.push(p)); });
    const res = await page.evaluate(async () => {
      const r = await window.electronAPI.media.importFiles([], 'x'); return r;
    });
    expect(res).toEqual([]);
    await page.setInputFiles('.bd-file', fx('noise.png'));
    await expect(page.locator('.bd-card.t-image')).toHaveCount(1);
    expect(await page.evaluate(() => window.__prog.length)).toBeGreaterThan(0);
  } finally { await closeApp(app); rmDir(dir); }
});
