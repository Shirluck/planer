// Ассистент: доски страниц (read_board, add_board_card, look_at_image — картинка уходит блоком image, JPEG ≤ 1568 px) и задачи по датам (add_task).
// Сеть не используется: обработчик запросов к API подменяется в основном процессе сценарием.
const { test, expect } = require('@playwright/test');
const sharp = require('sharp');
const { fx, tmpDataDir, rmDir, launch, closeApp, addPage, openBoard, waitBoard, vpPoint, isoDay, waitCal } = require('./helpers');

test('ассистент читает доску, смотрит картинку и добавляет чек-лист', async () => {
  const dir = tmpDataDir('ai');
  const { app, page } = await launch(dir, { size: [1440, 900] });
  try {
    const taskId = await addPage(page, 'ideas', 'Ремонт кухни');
    await openBoard(page, taskId);
    const p = await vpPoint(page, 0.35, 0.35);
    await page.mouse.dblclick(p.x, p.y);
    await page.keyboard.type('Бюджет 300 тысяч');
    await page.locator('.bd-vp').click({ position: { x: 5, y: 5 } });
    await page.setInputFiles('.bd-file', fx('photo.png'));
    await waitBoard(page, taskId, d => d.items.length === 2);
    await page.keyboard.press('Escape');

    // поддельный API: сценарий из четырёх ответов
    await app.evaluate(({ ipcMain }, taskId) => {
      globalThis.__reqs = [];
      ipcMain.removeHandler('key:has'); ipcMain.handle('key:has', () => true);
      ipcMain.removeHandler('anthropic');
      ipcMain.handle('anthropic', (_e, _rid, body) => {
        globalThis.__reqs.push(JSON.parse(JSON.stringify(body)));
        const n = globalThis.__reqs.length;
        const use = (id, name, input) => ({ ok: true, status: 200, data: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });
        if (n === 1) return use('t1', 'read_board', { pageId: taskId });
        if (n === 2) {
          const last = body.messages[body.messages.length - 1].content[0].content;
          const card = JSON.parse(last).cards.find(c => c.type === 'image');
          return use('t2', 'look_at_image', { cardId: card.id });
        }
        if (n === 3) return use('t3', 'add_board_card', { pageId: taskId, type: 'checklist', text: 'Что купить\n[ ] Фасады\n[x] Смеситель' });
        if (n === 4) return use('t4', 'add_task', { date: 'tomorrow', text: 'Заказать фасады', priority: 3 });
        return { ok: true, status: 200, data: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'На фото горы и солнце. Добавил чек-лист.' }] } };
      });
    }, taskId);

    await page.evaluate(() => window.electronAPI.ai.set({ mode: 'api' }));   // этот сценарий — через ключ API
    await page.click('#aiBtn');
    await page.fill('.ai-in', 'Посмотри картинку на доске ремонта и составь список покупок');
    await page.keyboard.press('Enter');
    await expect(page.locator('.msg.bot').last()).toContainText('Добавил чек-лист', { timeout: 20000 });
    await expect(page.locator('.act', { hasText: 'Прочитана доска' })).toHaveCount(1);
    await expect(page.locator('.act', { hasText: 'Отправляю ассистенту картинку' })).toHaveCount(1);
    await expect(page.locator('.act img.act-thumb')).toHaveCount(1);

    const reqs = await app.evaluate(() => globalThis.__reqs);
    expect(reqs).toHaveLength(5);
    const prompt = reqs[0].messages[reqs[0].messages.length - 1].content;
    expect(prompt).toContain('read_board');
    expect(prompt).toContain('{доска: карточек 2}');
    expect(prompt).toContain('== КАЛЕНДАРЬ');
    expect(reqs[0].tools.map(t => t.name)).toEqual(expect.arrayContaining(['read_board', 'add_board_card', 'look_at_image', 'add_task', 'move_task']));
    // задача от ассистента легла на завтрашнюю дату и стала срочной
    const cal = await waitCal(page, c => c.days[isoDay(1)] && c.days[isoDay(1)].items.some(t => t.text === 'Заказать фасады'));
    expect(cal.days[isoDay(1)].items.find(t => t.text === 'Заказать фасады').pri).toBe(3);
    await expect(page.locator('.act', { hasText: 'Добавлено на завтра' })).toHaveCount(1);
    // третий запрос несёт результат look_at_image с блоком image
    const tr = reqs[2].messages[reqs[2].messages.length - 1].content[0];
    expect(tr.type).toBe('tool_result');
    const img = tr.content.find(b => b.type === 'image');
    expect(img.source.media_type).toBe('image/jpeg');
    const jpeg = Buffer.from(img.source.data, 'base64');
    expect(jpeg[0]).toBe(0xFF); expect(jpeg[1]).toBe(0xD8);
    const meta = await sharp(jpeg).metadata();
    expect(Math.max(meta.width, meta.height)).toBe(1568);       // исходник 1600×1000 уменьшен до 1568
    // чек-лист добавлен на доску и не перекрывает другие карточки
    const d = await waitBoard(page, taskId, d => d.items.some(i => i.type === 'checklist'));
    const cl = d.items.find(i => i.type === 'checklist');
    expect(cl.title).toBe('Что купить');
    expect(cl.items.map(x => [x.text, x.done])).toEqual([['Фасады', false], ['Смеситель', true]]);
    for (const o of d.items.filter(i => i !== cl)) {
      const r = o.type === 'note' ? { ...o, h: Math.max(o.h, 60) } : o;
      const overlap = cl.x < r.x + r.w && r.x < cl.x + cl.w && cl.y < r.y + r.h && r.y < cl.y + 120;
      expect(overlap).toBe(false);
    }
    await expect(page.locator('.node[data-id="' + taskId + '"]  .n-meta')).toHaveText('3');
  } finally { await closeApp(app); rmDir(dir); }
});
