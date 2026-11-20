// Файлы «Основных планов» и «Идей»: текст или доска, открытие двойным щелчком; превью ссылок на доске; трей.
const { test, expect } = require('@playwright/test');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { fx, tmpDataDir, rmDir, launch, closeApp, addTask, openBoard, waitBoard, isoDay } = require('./helpers');

const plans = '.col[data-key=plans]';

test('тип файла: текст или доска, иконки, двойной щелчок, смена типа без потерь', async () => {
  const dir = tmpDataDir('files');
  const { app, page, errors } = await launch(dir, { size: [1440, 900] });
  try {
    // текстовый документ
    await page.locator(plans + ' .tool[aria-label^="Новый файл"]').click();
    await page.click('.menu-it:has-text("Текстовый документ")');
    await page.keyboard.type('Способ повысить доход');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Первая мысль');
    await page.keyboard.press('Escape');
    // доска
    await page.locator(plans + ' .tool[aria-label^="Новый файл"]').click();
    await page.click('.menu-it:has-text("Доска")');
    await expect(page.locator('.bd-title')).toBeFocused();
    await page.keyboard.type('Развитие и техники');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const text = page.locator(plans + ' .node.page', { hasText: 'Способ повысить доход' });
    const board = page.locator(plans + ' .node.page', { hasText: 'Развитие и техники' });
    await expect(text).toHaveClass(/kind-text/);
    await expect(board).toHaveClass(/kind-board/);
    await expect(page.locator(plans + ' .col-sub')).toHaveText('1 текст · 1 доска');
    // один щелчок только выделяет
    await text.locator('.n-title').click();
    await expect(text).toBeFocused();
    await expect(page.locator('.sheet, .bd-sheet')).toHaveCount(0);
    // двойной щелчок открывает по типу
    await text.locator('.n-title').dblclick();
    await expect(page.locator('.sheet .title-in')).toHaveValue('Способ повысить доход');
    await page.keyboard.press('Escape');
    await board.locator('.n-title').dblclick();
    await expect(page.locator('.bd-sheet')).toBeVisible();
    await expect(page.locator('.bd-title')).toHaveValue('Развитие и техники');
    await page.keyboard.press('Escape');
    await expect(page.locator('.bd-sheet')).toHaveCount(0);
    // Enter на выделенной строке тоже открывает
    await text.focus(); await page.keyboard.press('Enter');
    await expect(page.locator('.sheet .title-in')).toBeVisible();
    await page.keyboard.press('Escape');
    // смена типа: текст → доска (текст сохраняется) → обратно
    await text.hover(); await text.locator('.n-more').click();
    await page.click('.menu-it:has-text("Сделать доской")');
    await expect(text).toHaveClass(/kind-board/);
    await text.locator('.n-title').dblclick();
    await expect(page.locator('.bd-sheet')).toBeVisible();
    await page.keyboard.press('Escape');
    await text.hover(); await text.locator('.n-more').click();
    await page.click('.menu-it:has-text("Сделать текстовым документом")');
    await expect(text).toHaveClass(/kind-text/);
    await text.locator('.n-title').dblclick();
    await expect(page.locator('.ne .nb').first()).toHaveText('Первая мысль');
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); }
});

test('старые страницы: с доской и без текста становятся досками', async () => {
  const dir = tmpDataDir('files-old');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'planer-meta.json'), JSON.stringify({ schema: 2 }));
  fs.writeFileSync(path.join(dir, 'docs', 'data__users__local__planner-plans.json'), JSON.stringify({ nodes: [{ id: 'f1', type: 'folder', title: 'Портфолио', open: true, children: [
    { id: 'p1', type: 'page', title: 'Развитие и техники', blocks: [{ id: 'b1', t: 'p', text: '' }], boardCount: 8 },
    { id: 'p2', type: 'page', title: 'Способ повысить доход', blocks: [{ id: 'b2', t: 'p', text: 'Идея' }] }] }] }));
  const { app, page } = await launch(dir);
  try {
    await expect(page.locator('.node[data-id=p1]')).toHaveClass(/kind-board/);
    await expect(page.locator('.node[data-id=p1] .n-meta')).toHaveText('8');
    await expect(page.locator('.node[data-id=p2]')).toHaveClass(/kind-text/);
  } finally { await closeApp(app); rmDir(dir); }
});

test('ссылка на доске показывает заголовок, описание и превью', async () => {
  const img = fs.readFileSync(fx('photo.png'));
  const server = http.createServer((req, res) => {
    if (req.url === '/cover.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(img); return; }
    if (req.url === '/moved') { res.writeHead(302, { location: '/article' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><head><title>Запасной заголовок</title><meta property="og:title" content="Как вести планер &amp; не выгореть">' +
      '<meta property="og:description" content="Разбор привычек и инструментов: недельный обзор, блоки времени, доски.">' +
      '<meta property="og:site_name" content="Блог о продуктивности"><meta property="og:image" content="/cover.png"></head><body>…</body></html>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/moved';
  const dir = tmpDataDir('links');
  const { app, page } = await launch(dir, { size: [1280, 800], env: { PLANER_ALLOW_LOCAL_PREVIEW: '1' } });
  try {
    await page.locator(plans + ' .tool[aria-label^="Новый файл"]').click();
    await page.click('.menu-it:has-text("Доска")');
    await page.keyboard.type('Курсы и видео'); await page.keyboard.press('Enter');
    const id = await page.locator(plans + ' .node.page', { hasText: 'Курсы и видео' }).getAttribute('data-id');
    await app.evaluate(({ clipboard }, u) => clipboard.writeText(u), url);
    await page.keyboard.press('Control+v');
    const card = page.locator('.bd-card.t-link');
    await expect(card.locator('.bd-link-title')).toHaveText('Как вести планер & не выгореть');
    await expect(card.locator('.bd-link-desc')).toContainText('блоки времени');
    await expect(card.locator('.bd-link-site')).toContainText('Блог о продуктивности');
    await expect.poll(() => card.locator('.bd-link-img img').evaluate(i => i.complete && i.naturalWidth)).toBeGreaterThan(0);
    const d = await waitBoard(page, id, d => d.items.some(i => i.type === 'link' && i.pv === 'ok'));
    const it = d.items.find(i => i.type === 'link');
    expect(it.image).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(path.join(dir, 'media', it.image + '.png'))).toBe(true);    // картинка сохранена локально
    expect(it.ptitle).toBe('Как вести планер & не выгореть');
  } finally { await closeApp(app); rmDir(dir); server.close(); }
});

test('без разрешения адреса локальной сети не загружаются', async () => {
  const dir = tmpDataDir('links-private');
  const { app, page } = await launch(dir);
  try {
    const r = await page.evaluate(() => window.electronAPI.linkPreview('http://127.0.0.1:9/'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('private');
    const r2 = await page.evaluate(() => window.electronAPI.linkPreview('file:///C:/Windows/win.ini'));
    expect(r2.ok).toBe(false);
  } finally { await closeApp(app); rmDir(dir); }
});

test('крестик и «свернуть» убирают окно в трей; выход — из меню трея', async () => {
  const dir = tmpDataDir('tray');
  const { app, page } = await launch(dir);
  let exited = false;
  try {
    await addTask(page, 'day', 'Не потерять при сворачивании');
    const state = () => app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; return w ? { visible: w.isVisible(), destroyed: w.isDestroyed() } : null; });
    expect(await app.evaluate(() => global.__planerTray.isActive())).toBe(true);
    // крестик
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect.poll(state).toEqual({ visible: false, destroyed: false });
    // данные дописаны на диск при уходе в трей
    await expect.poll(() => { try { const c = JSON.parse(fs.readFileSync(path.join(dir, 'docs', 'data__users__local__planner-cal.json'), 'utf8')); return c.days[isoDay(0)].items[0].text; } catch (_) { return null; } }).toBe('Не потерять при сворачивании');
    // открыть из трея
    await app.evaluate(() => global.__planerTray.show());
    await expect.poll(state).toEqual({ visible: true, destroyed: false });
    // «свернуть»
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
    await expect.poll(state).toEqual({ visible: false, destroyed: false });
    await app.evaluate(() => global.__planerTray.show());
    await expect.poll(state).toEqual({ visible: true, destroyed: false });
    // «Выйти из Планера» в меню трея закрывает программу полностью
    const done = new Promise(r => app.process().once('exit', r));
    await app.evaluate(() => { setTimeout(() => global.__planerTray.quit(), 50); });
    await Promise.race([done, new Promise((_, rej) => setTimeout(() => rej(new Error('app did not quit')), 15000))]);
    exited = true;
  } finally { if (!exited) await closeApp(app); rmDir(dir); }
});
