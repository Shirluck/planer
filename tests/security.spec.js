// Безопасность: схема media://, IPC, изоляция страницы, CSP.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { fx, tmpDataDir, rmDir, launch, closeApp } = require('./helpers');

test.describe.serial('Безопасность', () => {
  let dir, app, page, id;
  const get = (url, headers) => app.evaluate(async ({ net }, [url, headers]) => {
    try { const r = await net.fetch(url, { headers: headers || {} }); return { status: r.status, len: (await r.arrayBuffer()).byteLength, range: r.headers.get('content-range'), type: r.headers.get('content-type') }; }
    catch (e) { return { status: -1, error: String(e.message || e) }; }
  }, [url, headers]);

  test.beforeAll(async () => {
    dir = tmpDataDir('sec');
    ({ app, page } = await launch(dir));
    const r = await page.evaluate(async b => window.electronAPI.media.importBuffer('p.png', 'image/png', new Uint8Array(b)), [...fs.readFileSync(fx('photo.png'))]);
    id = r.meta.id;
  });
  test.afterAll(async () => { await closeApp(app); rmDir(dir); });

  test('media:// отдаёт только файлы по корректному id', async () => {
    expect((await get('media://' + id)).status).toBe(200);
    expect((await get('media://' + id)).type).toBe('image/png');
    const r = await get('media://' + id, { Range: 'bytes=0-15' });
    expect(r.status).toBe(206); expect(r.len).toBe(16);
    expect((await get('media://' + id, { Range: 'bytes=999999999-' })).status).toBe(416);
    for (const bad of ['media://../../something', 'media://..%2F..%2Fwindows%2Fwin.ini', 'media://abc', 'media://' + id.slice(1),
      'media://' + id + '/../../../main.js', 'media://' + id + '/thumb/../../x', 'media://' + id + '?x=1', 'media://' + id + '/other']) {
      const res = await get(bad);
      expect(res.status, bad).not.toBe(200);
      expect(res.status, bad).not.toBe(206);
    }
    expect((await get('media://' + 'f'.repeat(64))).status).toBe(404);
  });

  test('IPC отклоняет неверные данные без падений', async () => {
    const r = await page.evaluate(async () => {
      const api = window.electronAPI, out = {};
      try { await api.dbGet('../../secret'); out.db = 'accepted'; } catch (e) { out.db = 'rejected'; }
      try { await api.dbSet('data/users/local/..', {}); out.dbSet = 'accepted'; } catch (e) { out.dbSet = 'rejected'; }
      out.vec = await api.media.getVector('../../main.js');
      out.thumb = await api.media.putThumb('../../x', 'png', new Uint8Array([1, 2, 3]));
      out.thumb2 = await api.media.putThumb('a'.repeat(64), 'png', new Uint8Array([1, 2, 3]));
      out.info = await api.media.info('../x');
      out.ext = await api.media.openExternal('C:\\Windows\\notepad.exe');
      const exe = new Uint8Array([0x4D, 0x5A, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xFF, 0xFF]);
      out.exeAsPng = await api.media.importBuffer('virus.png', 'image/png', exe);
      out.exe = await api.media.importBuffer('virus.exe', 'application/x-msdownload', exe);
      out.html = await api.media.importBuffer('page.svg', 'image/svg+xml', new TextEncoder().encode('<html><script>alert(1)</script></html>'));
      out.url = await api.openUrl('file:///C:/Windows/System32/calc.exe');
      out.url2 = await api.openUrl('javascript:alert(1)');
      out.cc = await api.ai.ccRun('x', { content: 'нет блоков', system: 1 });
      out.cc2 = await api.ai.ccRun('y', { content: [{ type: 'image', source: { type: 'url', url: 'file:///C:/x.png' } }] });
      out.mode = (await api.ai.set({ mode: 'evil', model: 'gpt' }));
      return out;
    });
    expect(r.db).toBe('rejected');
    expect(r.dbSet).toBe('rejected');
    expect(r.vec).toBeNull();
    expect(r.thumb).toBe(false);
    expect(r.thumb2).toBe(false);
    expect(r.info).toBeNull();
    expect(r.ext.ok).toBe(false);
    expect(r.exeAsPng.ok).toBe(false); expect(r.exeAsPng.error).toMatch(/не соответствует|повреждён/);
    expect(r.exe.ok).toBe(false); expect(r.exe.error).toMatch(/не поддерживается/);
    expect(r.html.ok).toBe(false);
    expect(r.url).toBe(false); expect(r.url2).toBe(false);
    expect(r.cc).toMatchObject({ ok: false, code: 'bad_request' });     // запросы к Claude Code проверяются в основном процессе
    expect(r.cc2).toMatchObject({ ok: false, code: 'bad_request' });
    expect(r.mode).toEqual({ mode: 'claude-code', model: 'sonnet' });
    await expect(page.locator('.col')).toHaveCount(4);          // приложение живо
  });

  test('страница изолирована: нет Node.js, сеть закрыта CSP', async () => {
    const r = await page.evaluate(async id => {
      const out = { require: typeof require, process: typeof process, module: typeof module, ipc: typeof (window.electronAPI && window.electronAPI.ipcRenderer) };
      try { await fetch('media://' + id); out.fetchMedia = 'ok'; } catch (e) { out.fetchMedia = 'blocked'; }
      try { await fetch('https://example.com'); out.fetchNet = 'ok'; } catch (e) { out.fetchNet = 'blocked'; }
      return out;
    }, id);
    expect(r).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined', ipc: 'undefined', fetchMedia: 'blocked', fetchNet: 'blocked' });
    const prefs = await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(); return { ci: w.contextIsolation, sb: w.sandbox, ni: w.nodeIntegration }; });
    expect(prefs).toEqual({ ci: true, sb: true, ni: false });
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain('img-src \'self\' data: media:');
    expect(csp).toContain('media-src media:');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toMatch(/script-src 'self';/);                       // встроенных скриптов на странице нет — 'unsafe-inline' не нужен
    const inlineRuns = await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.append(s); return window.__inline === 1; });
    expect(inlineRuns).toBe(false);
  });

  test('новые каналы IPC (таймеры, оформление, автозапуск, копии) не принимают мусор', async () => {
    const r = await page.evaluate(async () => {
      const a = window.electronAPI;
      const out = {};
      out.t1 = await a.timers.start({ title: '<b>x</b>', ms: -5 });
      out.t2 = await a.timers.start({ presetId: { evil: 1 } });
      out.t3 = await a.timers.start('строка');
      out.t4 = await a.timers.add('нет-такого', 60000);
      out.p = await a.timers.setPresets([{ id: '../../x', title: 'x'.repeat(500), ms: 60000 }, { title: 'bad', ms: 'abc' }]);
      out.au = await a.autostart.set('yes');
      out.bk = await a.backups.read('docs-2026-01-01', 'data/users/local/../../secret');
      out.mini = await a.mini.call('today');
      return out;
    });
    expect(r.t1.ok).toBe(false); expect(r.t2.ok).toBe(false); expect(r.t3.ok).toBe(false); expect(r.t4).toBe(false);
    expect(r.p).toEqual([{ id: 'x', title: 'x'.repeat(60), ms: 60000 }]);
    expect(r.au.enabled).toBe(false);                                // только true включает автозапуск
    expect(r.bk).toBe(null);
    expect(r.mini).toEqual({ ok: false });                           // запросы мини-окна — только от мини-окна
  });

  test('переход со страницы (например, брошенный в окно файл) блокируется', async () => {
    const url = page.url();
    await page.evaluate(p => { location.href = p; }, 'file:///' + fx('photo.png').replace(/\\/g, '/'));
    await page.waitForTimeout(800);
    // проверяем через основной процесс: Playwright считает отменённый переход «незавершённым»
    const st = await app.evaluate(async ({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      return { url: wc.getURL(), cols: await wc.executeJavaScript('document.querySelectorAll(".col").length') };
    });
    expect(st.url).toBe(url);
    expect(st.cols).toBe(4);
  });
});
