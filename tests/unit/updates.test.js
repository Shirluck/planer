const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdates } = require('../../lib/updates');

test('Загруженная версия устанавливается после успешного сохранения', async () => {
  class FakeUpdater extends EventEmitter {
    autoInstallOnAppQuit = true;
    installs = [];
    async checkForUpdates() {
      this.emit('update-downloaded', { version: '2.6.1' });
      return { downloadPromise: Promise.resolve() };
    }
    quitAndInstall(silent, restart) { this.installs.push([silent, restart]); }
  }
  const provider = new FakeUpdater();
  let saved = false;
  const updates = createUpdates(provider, () => {}, async () => { if (!saved) throw Error(); }, () => {});
  await updates.check();
  assert.equal(provider.autoInstallOnAppQuit, false);
  assert.equal(updates.ready(), true);
  await updates.install(false);
  assert.deepEqual(provider.installs, []);
  saved = true;
  await updates.install(true);
  assert.deepEqual(provider.installs, [[true, true]]);
});
