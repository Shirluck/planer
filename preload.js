// Мост между страницей и основным процессом. Страница не получает доступа к Node.js.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  dbGet:    p => ipcRenderer.invoke('db:get', p),
  dbSet:    (p, d) => ipcRenderer.invoke('db:set', p, d),
  dbDelete: p => ipcRenderer.invoke('db:delete', p),
  hasKey:   () => ipcRenderer.invoke('key:has'),
  setKey:   k => ipcRenderer.invoke('key:set', k),
  clearKey: () => ipcRenderer.invoke('key:clear'),
  anthropic:       (rid, body) => ipcRenderer.invoke('anthropic', rid, body),
  anthropicCancel: rid => ipcRenderer.invoke('anthropic:cancel', rid),
  onAskKey: cb => { ipcRenderer.on('ask-key', () => cb()); }
});
