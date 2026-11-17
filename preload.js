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
  onStoreError: cb => { ipcRenderer.on('store:error', (_e, m) => cb(String(m || ''))); }
});
