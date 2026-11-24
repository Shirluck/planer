'use strict';

function createUpdates(updater, notify, prepare, announce) {
  let message = 'Источник обновлений — GitHub Releases.';
  let busy = false, ready = false;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  function report(text, working = false) {
    message = text;
    busy = working;
    notify();
  }
  const failed = () => report('Не удалось получить обновление. Можно повторить проверку позже.');
  updater.on('error', failed);
  updater.on('update-available', info => report('Загружается версия ' + info.version + '…', true));
  updater.on('update-not-available', () => report('Установлена актуальная версия.'));
  updater.on('update-downloaded', info => {
    ready = true;
    report('Версия ' + info.version + ' готова к установке.');
    announce(info.version);
  });
  async function check() {
    if (busy || ready) return;
    report('Проверяем GitHub Releases…', true);
    try {
      const result = await updater.checkForUpdates();
      if (!result) failed();
      else if (result.downloadPromise) await result.downloadPromise;
    } catch (_) { failed(); }
  }
  async function install(restart) {
    if (!ready || busy) return;
    report('Сохраняем данные перед обновлением…', true);
    try { await prepare(); }
    catch (_) { report('Установка отложена. Проверьте сохранение данных и место на диске.'); return; }
    try { updater.quitAndInstall(true, restart); }
    catch (_) { report('Не удалось запустить установщик. Повторите попытку.'); }
  }
  return { check, install, ready: () => ready, status: () => ({ message, busy, ready }) };
}
module.exports = { createUpdates };
