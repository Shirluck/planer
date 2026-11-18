// Мост между страницей и основным процессом. Страница не получает доступа к Node.js и не передаёт путей:
// пути к файлам извлекаются здесь, из объектов File (webUtils.getPathForFile).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const BUFFER_MAX = 512 * 1024 * 1024;   // файлы без пути (из браузера/буфера) передаются целиком
let progressCb = null;
ipcRenderer.on('media:progress', (_e, p) => { if (progressCb) progressCb(p); });

async function importFiles(files, token) {
  const out = [];
  for (const f of Array.from(files || [])) {
    let p = '';
    try { p = webUtils.getPathForFile(f) || ''; } catch (_) { p = ''; }
    try {
      if (p) out.push(await ipcRenderer.invoke('media:importPath', p, f.name, token));
      else if (f.size > BUFFER_MAX) out.push({ ok: false, code: 'too_big', error: 'Файл «' + f.name + '» слишком большой для вставки. Сохраните его на диск и перетащите из проводника.' });
      else out.push(await ipcRenderer.invoke('media:importBuffer', f.name, f.type, new Uint8Array(await f.arrayBuffer())));
    } catch (e) {
      out.push({ ok: false, code: 'io', error: 'Не удалось добавить файл «' + f.name + '».' });
    }
  }
  return out;
}

contextBridge.exposeInMainWorld('electronAPI', {
  dbGet:    p => ipcRenderer.invoke('db:get', p),
  dbSet:    (p, d) => ipcRenderer.invoke('db:set', p, d),
  dbDelete: p => ipcRenderer.invoke('db:delete', p),
  hasKey:   () => ipcRenderer.invoke('key:has'),
  setKey:   k => ipcRenderer.invoke('key:set', k),
  clearKey: () => ipcRenderer.invoke('key:clear'),
  anthropic:       (rid, body) => ipcRenderer.invoke('anthropic', rid, body),
  anthropicCancel: rid => ipcRenderer.invoke('anthropic:cancel', rid),
  onAskKey: cb => { ipcRenderer.on('ask-key', () => cb()); },
  // ассистент: режим (подписка Claude через Claude Code или ключ API) и запуск Claude Code
  ai: {
    get:  () => ipcRenderer.invoke('ai:get'),
    set:  patch => ipcRenderer.invoke('ai:set', patch),
    onState:    cb => { ipcRenderer.on('ai:state', (_e, s) => cb(s)); },
    onSettings: cb => { ipcRenderer.on('ai-settings', () => cb()); },
    ccStatus:   () => ipcRenderer.invoke('cc:status'),
    ccRun:      (rid, req) => ipcRenderer.invoke('cc:run', rid, req),
    ccCancel:   rid => ipcRenderer.invoke('cc:cancel', rid),
    ccLogin:    () => ipcRenderer.invoke('cc:login'),
    ccPickPath: () => ipcRenderer.invoke('cc:pickPath')
  },
  media: {
    importFiles,
    importBuffer: (name, mime, data) => ipcRenderer.invoke('media:importBuffer', String(name || ''), String(mime || ''), data),
    putThumb:     (id, ext, data) => ipcRenderer.invoke('media:putThumb', id, ext, data),
    putVector:    json => ipcRenderer.invoke('media:putVector', json),
    getVector:    id => ipcRenderer.invoke('media:getVector', id),
    info:         id => ipcRenderer.invoke('media:info', id),
    openExternal: id => ipcRenderer.invoke('media:openExternal', id),
    savePng:      (name, data) => ipcRenderer.invoke('media:savePng', name, data),
    copyPng:      data => ipcRenderer.invoke('media:copyPng', data),
    onProgress:   cb => { progressCb = typeof cb === 'function' ? cb : null; }
  },
  clipWriteText: t => ipcRenderer.invoke('clip:writeText', t),
  openUrl:  url => ipcRenderer.invoke('app:openUrl', url),
  linkPreview: url => ipcRenderer.invoke('link:preview', url),
  notices:  () => ipcRenderer.invoke('app:notices'),
  appInfo:  () => ipcRenderer.invoke('app:info'),
  onFlush:  cb => { ipcRenderer.on('app:flush', async () => { try { await cb(); } catch (_) {} ipcRenderer.send('app:flushed'); }); },
  onStoreError: cb => { ipcRenderer.on('store:error', (_e, m) => cb(String(m || ''))); },
  // команды из меню и трея: 'search', 'timers', 'settings', 'restore', 'task' <id>, 'toast' <текст>
  onCommand: cb => { ipcRenderer.on('app:command', (_e, cmd, arg) => cb(String(cmd || ''), arg)); },
  // таймеры для фокусировки (идут в основном процессе)
  timers: {
    state:      () => ipcRenderer.invoke('timer:state'),
    start:      a => ipcRenderer.invoke('timer:start', a),
    pause:      id => ipcRenderer.invoke('timer:pause', id),
    resume:     id => ipcRenderer.invoke('timer:resume', id),
    stop:       id => ipcRenderer.invoke('timer:stop', id),
    stopAll:    () => ipcRenderer.invoke('timer:stopAll'),
    add:        (id, ms) => ipcRenderer.invoke('timer:add', id, ms),
    setPresets: list => ipcRenderer.invoke('timer:setPresets', list),
    setSound:   s => ipcRenderer.invoke('timer:setSound', s),
    onState:    cb => { ipcRenderer.on('timer:state', (_e, s) => cb(s)); },
    onDone:     cb => { ipcRenderer.on('timer:done', (_e, t) => cb(t)); }
  },
  // оформление (тема, размер, компактный режим) и автозапуск
  ui: {
    get:     () => ipcRenderer.invoke('ui:get'),
    set:     patch => ipcRenderer.invoke('ui:set', patch),
    onState: cb => { ipcRenderer.on('ui:state', (_e, s) => cb(s)); }
  },
  autostart: {
    get:     () => ipcRenderer.invoke('autostart:get'),
    set:     on => ipcRenderer.invoke('autostart:set', on),
    onState: cb => { ipcRenderer.on('autostart:state', (_e, s) => cb(s)); }
  },
  // резервные копии: список, документ из копии, восстановление (текущее сначала сохраняется в копию)
  backups: {
    list:       () => ipcRenderer.invoke('backup:list'),
    read:       (id, p) => ipcRenderer.invoke('backup:read', id, p),
    restore:    (id, paths) => ipcRenderer.invoke('backup:restore', id, paths),
    snapshot:   () => ipcRenderer.invoke('backup:snapshot'),
    openFolder: () => ipcRenderer.invoke('backup:openFolder')
  },
  // мини-окно «Сегодня»: главное окно отвечает на его запросы (состояние живёт здесь)
  miniHost: {
    onOp:    cb => { ipcRenderer.on('mini:op', async (_e, m) => { let r = null; try { r = await cb(m.op, m.args); } catch (_) { r = null; } ipcRenderer.send('mini:reply', m.id, r); }); },
    changed: () => ipcRenderer.send('mini:changed')
  },
  // само мини-окно (mini.html)
  mini: {
    call:     (op, args) => ipcRenderer.invoke('mini:call', op, args),
    openMain: what => ipcRenderer.invoke('mini:openMain', what),
    hide:     () => ipcRenderer.invoke('mini:hide'),
    onRefresh: cb => { ipcRenderer.on('mini:refresh', () => cb()); }
  }
});
