// Ассистент через подписку Claude (локальный Claude Code). Вместо настоящего Claude Code — tests/fake-claude.js:
// он записывает, с какими параметрами его запустили и что пришло, и отвечает по сценарию из script.json.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { fx, tmpDataDir, rmDir, launch, closeApp, addPage, openBoard, waitBoard, waitCal, isoDay } = require('./helpers');

const entries = cc => { try { return fs.readFileSync(path.join(cc, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => !e.login); } catch (_) { return []; } };
const logins = cc => { try { return fs.readFileSync(path.join(cc, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.login); } catch (_) { return []; } };
const arg = (args, n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const KEEP = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_GIT_BASH_PATH'];

test('подписка Claude: без входа — подсказка; вход и выбор режима в окне подключения', async () => {
  const dir = tmpDataDir('cc-login'), cc = tmpDataDir('cc-fake');
  const { app, page, errors } = await launch(dir, { env: { FAKE_CC_DIR: cc } });
  try {
    // без ключа API по умолчанию — подписка Claude
    expect(await page.evaluate(() => window.electronAPI.ai.get())).toEqual({ mode: 'claude-code', model: 'sonnet' });
    await page.click('#aiBtn');
    await expect(page.locator('.ai-mode')).toHaveText('через подписку Claude');
    await page.fill('.ai-in', 'Привет');
    await page.keyboard.press('Enter');
    const bot = page.locator('.msg.bot').last();
    await expect(bot).toContainText('не выполнил вход', { timeout: 15000 });
    await expect(page.locator('.pk-ov')).toHaveCount(0);                    // ключ API не спрашивается
    await bot.locator('.ai-fix').click();
    const dlg = page.locator('.as-box');
    await expect(dlg.locator('.as-st')).toContainText('вход не выполнен');
    await expect(dlg.locator('.as-st')).toContainText('9.9.9');
    await dlg.locator('.as-login').click();
    await expect(dlg.locator('.as-st')).toContainText('Готово', { timeout: 15000 });   // окно само проверяет вход
    await expect(dlg.locator('.as-st')).toContainText('tester@example.com');
    await expect(dlg.locator('.as-login')).toBeHidden();
    expect(logins(cc).map(e => e.login)).toEqual([['--claudeai']]);
    // переключение режимов и модели
    await dlg.locator('.as-opt[data-mode=api]').click();
    await expect(page.locator('.ai-mode')).toHaveText('через ключ API');
    expect((await page.evaluate(() => window.electronAPI.ai.get())).mode).toBe('api');
    await dlg.locator('.as-opt[data-mode=claude-code]').click();
    await dlg.locator('.as-model').selectOption('opus');
    await expect(page.locator('.ai-mode')).toHaveText('через подписку Claude · Opus');
    await dlg.locator('.pk-ok').click();
    await expect(dlg).toHaveCount(0);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))).toMatchObject({ aiMode: 'claude-code', ccModel: 'opus' });
    // теперь ответ приходит
    await page.fill('.ai-in', 'Привет ещё раз');
    await page.keyboard.press('Enter');
    await expect(page.locator('.msg.bot').last()).toContainText('(тестовый ответ)', { timeout: 15000 });
    expect(arg(entries(cc).pop().args, '--model')).toBe('opus');
    expect(entries(cc).pop().content[0].text).not.toContain('<предыдущий разговор>');   // неудачный обмен в историю не попал
    // следующий запрос несёт предыдущий разговор
    await page.fill('.ai-in', 'И что дальше?');
    await page.keyboard.press('Enter');
    await expect(page.locator('.msg.bot')).toHaveCount(4, { timeout: 15000 });
    await expect.poll(() => entries(cc).length).toBe(3);
    const t = entries(cc).pop().content[0].text;
    expect(t).toContain('<предыдущий разговор>\nПользователь: Привет ещё раз\n\nАссистент: (тестовый ответ)\n</предыдущий разговор>');
    expect(t).toContain('Запрос пользователя: И что дальше?');
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); rmDir(cc); }
});

test('подписка Claude: цикл инструментов, картинка с доски, без ключей API в окружении', async () => {
  const dir = tmpDataDir('cc-tools'), cc = tmpDataDir('cc-fake');
  fs.writeFileSync(path.join(cc, 'logged-in'), '1');
  const { app, page } = await launch(dir, { size: [1440, 900], env: { FAKE_CC_DIR: cc, ANTHROPIC_API_KEY: 'sk-ant-test-must-not-leak', CLAUDECODE: '1', CLAUDE_CODE_SIMPLE: '1' } });
  try {
    const pageId = await addPage(page, 'ideas', 'Ремонт кухни');
    await openBoard(page, pageId);
    await page.setInputFiles('.bd-file', fx('photo.png'));
    const d = await waitBoard(page, pageId, d => d.items.length === 1 && d.items[0].mediaId);
    await page.keyboard.press('Escape');
    fs.writeFileSync(path.join(cc, 'script.json'), JSON.stringify([
      { reply: '', tool_calls: [{ name: 'look_at_image', input: { cardId: d.items[0].id } }, { name: 'add_task', input: { date: 'tomorrow', text: 'Заказать фасады', priority: 3 } }] },
      { reply: 'Смотрю дальше.', tool_calls: [{ name: 'no_such_tool', input: {} }] },
      { reply: 'На фото горы. Добавил задачу на завтра.', tool_calls: [] }
    ]));
    await page.click('#aiBtn');
    await page.fill('.ai-in', 'Посмотри картинку и запланируй фасады');
    await page.keyboard.press('Enter');
    const bot = page.locator('.msg.bot').last();
    await expect(bot).toContainText('Добавил задачу на завтра', { timeout: 30000 });
    await expect(bot).toContainText('Смотрю дальше.');
    await expect(page.locator('.act', { hasText: 'Отправляю ассистенту картинку' })).toHaveCount(1);
    await expect(page.locator('.act', { hasText: 'Добавлено на завтра' })).toHaveCount(1);
    const cal = await waitCal(page, c => c.days[isoDay(1)] && c.days[isoDay(1)].items.some(t => t.text === 'Заказать фасады'));
    expect(cal.days[isoDay(1)].items.find(t => t.text === 'Заказать фасады').pri).toBe(3);

    const log = entries(cc);
    expect(log).toHaveLength(3);
    const a = log[0].args;
    expect(a).toEqual(expect.arrayContaining(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']));
    expect(arg(a, '--tools')).toBe('');                 // встроенные инструменты Claude Code (файлы, терминал) выключены
    expect(arg(a, '--setting-sources')).toBe('');
    expect(arg(a, '--model')).toBe('sonnet');
    const schema = JSON.parse(arg(a, '--json-schema'));
    expect(schema.required).toEqual(['reply', 'tool_calls']);
    expect(schema.properties.tool_calls.items.properties.name.enum).toEqual(expect.arrayContaining(['add_task', 'read_board', 'look_at_image', 'add_time_block']));
    expect(log[0].system).toContain('look_at_image');
    expect(log[0].system).toContain('"tool_calls"');
    expect(log[0].content[0].text).toContain('== КАЛЕНДАРЬ');
    expect(log[0].content[0].text).toContain('Запрос пользователя: Посмотри картинку и запланируй фасады');
    // ни ключей API, ни переменных чужого сеанса Claude Code
    expect(log[0].env.filter(k => !KEEP.includes(k.toUpperCase()))).toEqual([]);
    expect(path.resolve(log[0].cwd).toLowerCase()).toBe(path.join(dir, 'claude-work').toLowerCase());
    // второй шаг: результаты первого; картинка — блоком image (JPEG)
    const c2 = log[1].content;
    const img = c2.find(b => b.type === 'image');
    expect(img.source.media_type).toBe('image/jpeg');
    expect(Buffer.from(img.source.data, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xFF, 0xD8]));
    expect(c2.some(b => b.type === 'text' && /add_task → \{"ok":true/.test(b.text))).toBe(true);
    // третий шаг: ошибка инструмента передана модели
    expect(log[2].content.some(b => b.type === 'text' && b.text.includes('no_such_tool → ОШИБКА'))).toBe(true);
    // временные файлы системного промпта удалены
    expect(fs.readdirSync(path.join(dir, 'claude-work')).filter(f => f.startsWith('system-'))).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); rmDir(cc); }
});

test('подписка Claude: «Стоп» прерывает запрос', async () => {
  const dir = tmpDataDir('cc-stop'), cc = tmpDataDir('cc-fake');
  fs.writeFileSync(path.join(cc, 'logged-in'), '1');
  fs.writeFileSync(path.join(cc, 'script.json'), JSON.stringify([{ delayMs: 20000, reply: 'Слишком поздно', tool_calls: [] }]));
  const { app, page } = await launch(dir, { env: { FAKE_CC_DIR: cc } });
  try {
    await page.click('#aiBtn');
    await page.fill('.ai-in', 'Долгий вопрос');
    await page.keyboard.press('Enter');
    await expect(page.locator('.msg.bot .md.thinking')).toHaveCount(1);
    await expect.poll(() => entries(cc).length).toBe(1);
    const t0 = Date.now();
    await page.click('.send[aria-label="Остановить"]');
    await expect(page.locator('.msg.bot').last()).toContainText('Остановлено.');
    expect(Date.now() - t0).toBeLessThan(5000);
    await expect(page.locator('.send[aria-label="Отправить"]')).toBeVisible();
  } finally { await closeApp(app); rmDir(dir); rmDir(cc); }
});
