// Инструменты моушн-дизайнера рядом с таймером: свои ссылки, экспрешены After Effects, тайминг, цвет, форматы, вопрос ассистенту.
// Ссылки здесь не открываются — это запустило бы настоящий браузер.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { tmpDataDir, rmDir, launch, closeApp, DOC } = require('./helpers');

const clip = app => app.evaluate(({ clipboard }) => clipboard.readText());

test('моушн: ссылки, экспрешены, тайминг, цвет и форматы', async () => {
  const dir = tmpDataDir('tools'), cc = tmpDataDir('cc-fake');
  fs.writeFileSync(path.join(cc, 'logged-in'), '1');
  const { app, page, errors } = await launch(dir, { size: [1440, 900], env: { FAKE_CC_DIR: cc } });
  try {
    const btn = page.locator('#toolsBtn');
    await expect(btn).toBeVisible();
    const [tb, mb] = await Promise.all([page.locator('#timerBtn').boundingBox(), btn.boundingBox()]);
    expect(mb.x).toBeGreaterThan(tb.x + tb.width - 1);                       // сразу за таймером
    await btn.click();
    const pop = page.locator('.mt-pop');
    await expect(pop).toBeVisible();
    // ссылки: по умолчанию набор сайтов; добавить свой, убрать с отменой
    await expect(pop.locator('.mt-link')).toHaveCount(10);
    await pop.locator('.mt-add .tm-in').nth(0).fill('Мой Behance');
    await pop.locator('.mt-add .tm-in').nth(1).fill('behance.net/shirluck');
    await pop.locator('.mt-add .tb-btn').click();
    await expect(pop.locator('.mt-link').last()).toContainText('Мой Behance');
    await expect.poll(async () => { const d = await page.evaluate(p => window.electronAPI.dbGet(p), DOC('planner-tools')); return d && d.links.length; }).toBe(11);
    expect((await page.evaluate(p => window.electronAPI.dbGet(p), DOC('planner-tools'))).links[10].url).toBe('https://behance.net/shirluck');
    await pop.locator('.mt-add .tm-in').nth(1).fill('не адрес');
    await pop.locator('.mt-add .tb-btn').click();
    await expect(pop.locator('.tm-err')).toContainText('Нужен адрес сайта');
    await pop.locator('.mt-linkbtn').click();                                 // «Изменить»
    await pop.locator('.mt-link', { hasText: 'Pinterest' }).locator('.mt-del').click();
    await expect(pop.locator('.mt-link', { hasText: 'Pinterest' })).toHaveCount(0);
    await page.locator('.toast button').click();
    await expect(pop.locator('.mt-link', { hasText: 'Pinterest' })).toHaveCount(1);
    // экспрешены: шаблон, параметры, копирование
    await pop.locator('.mt-tab[data-tab=expr]').click();
    await pop.locator('.mt-li', { hasText: 'Wiggle' }).click();
    await pop.locator('.mt-field', { hasText: 'Частота' }).locator('input').fill('4');
    await pop.locator('.mt-field', { hasText: 'Оси' }).locator('select').selectOption('y');
    await expect(pop.locator('.mt-code')).toHaveText('w = wiggle(4, 30);\n[value[0], w[1]];');
    await pop.locator('.mt-copy-main').click();
    expect(await clip(app)).toBe('w = wiggle(4, 30);\n[value[0], w[1]];');
    await pop.locator('.mt-li', { hasText: 'Loop' }).click();
    await expect(pop.locator('.mt-code')).toHaveText('loopOut("cycle", 0);');
    // тайминг: таймкод → кадры и секунды, смена fps, темп
    await pop.locator('.mt-tab[data-tab=time]').click();
    await pop.locator('.mt-field', { hasText: 'Таймкод' }).locator('input').fill('00:00:02:12');
    await expect(pop.locator('.mt-field', { hasText: 'Кадры' }).locator('input')).toHaveValue('62');
    await expect(pop.locator('.mt-field', { hasText: 'Секунды' }).locator('input')).toHaveValue('2.48');
    await pop.locator('.mt-field', { hasText: 'Частота кадров' }).locator('select').selectOption('30');
    await expect(pop.locator('.mt-field', { hasText: 'Кадры' }).locator('input')).toHaveValue('74');
    await pop.locator('.mt-field', { hasText: 'BPM' }).locator('input').fill('120');
    await expect(pop.locator('.mt-beat')).toContainText('15 кадр.');
    // цвет: HEX → массив для экспрешена
    await pop.locator('.mt-tab[data-tab=color]').click();
    await pop.locator('.mt-color .tm-in').fill('#ff8000');
    const ae = pop.locator('.mt-cv', { hasText: 'After Effects' });
    await expect(ae.locator('code')).toHaveText('[1, 0.502, 0, 1]');
    await ae.locator('.mt-copy').click();
    expect(await clip(app)).toBe('[1, 0.502, 0, 1]');
    // форматы: копирование размера, соотношение сторон
    await pop.locator('.mt-tab[data-tab=formats]').click();
    await pop.locator('.mt-fmt', { hasText: 'Вертикальное 9:16' }).locator('.mt-copy').click();
    expect(await clip(app)).toBe('1080x1920');
    await pop.locator('.mt-field', { hasText: 'Высота' }).locator('input').fill('1350');
    await pop.locator('.mt-field', { hasText: 'Ширина' }).locator('input').fill('1080');
    await expect(pop.locator('.mt-ar')).toHaveText('4:5');
    // настройки запоминаются: панель открывается на последней вкладке
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await btn.click();
    await expect(page.locator('.mt-tab[aria-selected=true]')).toHaveText('Форматы');
    // экспрешен по описанию — через ассистента
    fs.writeFileSync(path.join(cc, 'script.json'), JSON.stringify([{ reply: 'Вот:\n```\nMath.sin(time * 2) * 30;\n```\nВставьте в Rotation.', tool_calls: [] }]));
    await page.locator('.mt-tab[data-tab=expr]').click();
    await page.locator('.mt-ask').fill('слой качается как маятник');
    await page.locator('.mt-ai .tb-btn').click();
    const bot = page.locator('.msg.bot').last();
    await expect(bot.locator('.ai-code code')).toHaveText('Math.sin(time * 2) * 30;', { timeout: 30000 });
    const log = fs.readFileSync(path.join(cc, 'log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(e => !e.login);
    expect(log[0].content[0].text).toContain('Напиши экспрешн для After Effects: слой качается как маятник');
    expect(errors).toEqual([]);
  } finally { await closeApp(app); rmDir(dir); rmDir(cc); }
});
