// Модульные тесты резервных копий (lib/backups.js) на временной папке с настоящим хранилищем lib/store.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../../lib/store.js');
const { createBackups } = require('../../lib/backups.js');

const CAL = 'data/users/local/planner-cal', PLANS = 'data/users/local/planner-plans', BOARD = 'data/users/local/board-abc';

function rig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'planer-unit-bk-'));
  const store = createStore(dir, {});
  store.migrate();
  const bk = createBackups({ dir, store });
  return { dir, store, bk, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('ежедневная и ручная копии видны в списке, документы читаются', () => {
  const { store, bk, done } = rig();
  try {
    store.set(CAL, { v: 1, days: { '2026-11-18': { items: [{ id: 'a', text: 'старое' }] } } });
    store.set(PLANS, { nodes: [] });
    store.flush();
    store.dailyBackup();
    const m = bk.snapshot('manual');
    const all = bk.list();
    assert.deepEqual(all.map(b => b.kind).sort(), ['daily', 'manual']);
    assert.equal(all.find(b => b.kind === 'manual').id, m.id);
    assert.deepEqual(all[0].docs.map(d => d.path).sort(), [CAL, PLANS]);
    assert.equal(bk.read(m.id, CAL).days['2026-11-18'].items[0].text, 'старое');
    assert.equal(bk.read(m.id, BOARD), null);
  } finally { done(); }
});

test('восстановление: текущее уходит в копию «перед восстановлением», отмена возвращает его', () => {
  const { store, bk, done } = rig();
  try {
    store.set(CAL, { v: 1, days: {}, undated: [{ id: 'x', text: 'было' }] });
    store.set(BOARD, { v: 1, items: [{ id: 'n', type: 'note', text: 'доска' }] });
    const m = bk.snapshot('manual');
    store.set(CAL, { v: 1, days: {}, undated: [{ id: 'x', text: 'испорчено' }] });
    store.set(BOARD, { v: 1, items: [] });
    store.flush();

    const r = bk.restore(m.id, [CAL]);                         // только календарь
    assert.equal(r.ok, true);
    assert.equal(store.get(CAL).undated[0].text, 'было');
    assert.deepEqual(store.get(BOARD).items, []);              // доска не тронута
    const onDisk = JSON.parse(fs.readFileSync(path.join(store.docsDir, 'data__users__local__planner-cal.json'), 'utf8'));
    assert.equal(onDisk.undated[0].text, 'было');
    assert.equal(bk.read(r.undoId, CAL).undated[0].text, 'испорчено');

    const u = bk.restore(r.undoId, [CAL]);                     // отмена восстановления
    assert.equal(u.ok, true);
    assert.equal(store.get(CAL).undated[0].text, 'испорчено');
  } finally { done(); }
});

test('неверные имена и пути отклоняются; при нехватке документа ничего не меняется', () => {
  const { store, bk, done } = rig();
  try {
    store.set(CAL, { v: 1, undated: [{ text: 'a' }] });
    const m = bk.snapshot('manual');
    assert.throws(() => bk.read('../docs', CAL));
    assert.throws(() => bk.read('docs-2026-11-18/../x', CAL));
    assert.throws(() => bk.read(m.id, '../../secret'));
    assert.throws(() => bk.restore('manual-evil', [CAL]));
    const before = bk.list().length;
    const r = bk.restore(m.id, [CAL, BOARD]);                  // доски в копии нет
    assert.equal(r.ok, false);
    assert.equal(bk.list().length, before);                    // и копия «перед восстановлением» не создавалась
    assert.equal(bk.restore(m.id, []).ok, false);
  } finally { done(); }
});

test('ежедневная копия, сделанная до первых данных, пересоздаётся, когда данные появились', () => {
  const { store, bk, done } = rig();
  try {
    store.dailyBackup();
    assert.deepEqual(bk.list().map(b => b.docs.length), [0]);
    store.set(CAL, { v: 1 }); store.flush();
    store.dailyBackup();
    assert.deepEqual(bk.list().map(b => b.docs.length), [1]);
    store.set(PLANS, { nodes: [] }); store.flush();
    store.dailyBackup();                                        // непустая копия дня не перезаписывается
    assert.deepEqual(bk.list().map(b => b.docs.length), [1]);
  } finally { done(); }
});

test('копий «вручную» хранится не больше 20', () => {
  const { store, bk, done } = rig();
  try {
    store.set(CAL, { v: 1 });
    for (let i = 0; i < 23; i++) { bk.snapshot('manual'); const t = Date.now(); while (Date.now() === t) { /* разные метки времени */ } }
    assert.equal(bk.list().filter(b => b.kind === 'manual').length, 20);
  } finally { done(); }
});

test('две копии в одну миллисекунду и кратковременная блокировка переименования', t => {
  const { store, bk, done } = rig();
  try {
    store.set(CAL, { text:'первая' });
    const now = Date.now();
    t.mock.method(Date, 'now', () => now);
    const rename = fs.renameSync;
    let blocked = false;
    t.mock.method(fs, 'renameSync', (from,to) => {
      if (!blocked && String(from).endsWith('.partial')) {
        blocked = true;
        throw Object.assign(Error('busy'), {code:'EBUSY'});
      }
      return rename(from,to);
    });
    const first = bk.snapshot('manual');
    store.set(CAL, { text:'вторая' });
    const second = bk.snapshot('manual');
    assert.ok(blocked);
    assert.notEqual(first.id, second.id);
    assert.equal(bk.read(first.id, CAL).text, 'первая');
    assert.equal(bk.read(second.id, CAL).text, 'вторая');
  } finally { done(); }
});
