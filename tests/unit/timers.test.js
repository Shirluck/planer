// Модульные тесты таймеров основного процесса (lib/timers.js) с поддельными часами.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTimers, MAX_RUNNING } = require('../../lib/timers.js');

function rig(doc) {
  const clock = { t: 1_000_000 }, pending = [];
  const saved = [], done = [], states = [];
  const T = createTimers({
    load: () => doc, save: d => saved.push(d), onDone: r => done.push(r.title), onChange: s => states.push(s),
    now: () => clock.t,
    setTimer: (fn, ms) => { const h = { fn, at: clock.t + ms }; pending.push(h); return h; },
    clearTimer: h => { const i = pending.indexOf(h); if (i >= 0) pending.splice(i, 1); }
  });
  const advance = ms => {                                   // продвинуть часы и выполнить наступившие таймеры
    clock.t += ms;
    for (;;) { const h = pending.filter(x => x.at <= clock.t).sort((a, b) => a.at - b.at)[0]; if (!h) break; pending.splice(pending.indexOf(h), 1); h.fn(); }
  };
  return { T, clock, advance, saved, done, states, pending };
}

test('шаблон запускается, идёт, звучит в конце и исчезает из списка', () => {
  const { T, advance, done } = rig(null);
  const r = T.start({ presetId: 'focus' });
  assert.equal(r.ok, true);
  assert.equal(T.state().running[0].left, 25 * 60000);
  advance(10 * 60000);
  assert.equal(T.state().running[0].left, 15 * 60000);
  advance(15 * 60000 - 1000);
  assert.deepEqual(done, []);
  advance(1000);
  assert.deepEqual(done, ['Фокус']);
  assert.equal(T.state().running.length, 0);
});

test('пауза, продолжение, +1 минута, остановка', () => {
  const { T, advance, done } = rig(null);
  const { id } = T.start({ title: 'Чтение', ms: 120000 });
  advance(30000);
  assert.equal(T.pause(id), true);
  advance(10 * 60000);                                      // на паузе время не идёт
  assert.equal(T.state().running[0].left, 90000);
  assert.equal(T.state().running[0].paused, true);
  T.add(id, 60000);
  assert.equal(T.state().running[0].left, 150000);
  T.resume(id);
  advance(149000);
  assert.deepEqual(done, []);
  advance(1000);
  assert.deepEqual(done, ['Чтение']);
  const b = T.start({ title: 'Ещё', ms: 60000 });
  assert.equal(T.stop(b.id), true);
  advance(120000);
  assert.deepEqual(done, ['Чтение']);                         // остановленный не звучит
});

test('несколько таймеров: каждый заканчивается в своё время; ограничение количества', () => {
  const { T, advance, done } = rig(null);
  T.start({ title: 'A', ms: 3000 }); T.start({ title: 'B', ms: 1000 }); T.start({ title: 'C', ms: 2000 });
  advance(1000); assert.deepEqual(done, ['B']);
  advance(1000); assert.deepEqual(done, ['B', 'C']);
  advance(1000); assert.deepEqual(done, ['B', 'C', 'A']);
  for (let i = 0; i < MAX_RUNNING; i++) assert.equal(T.start({ title: 'x' + i, ms: 60000 }).ok, true);
  assert.equal(T.start({ title: 'лишний', ms: 60000 }).ok, false);
  assert.equal(T.stopAll(), true);
  assert.equal(T.state().running.length, 0);
});

test('неверные данные не запускаются; шаблоны и звук сохраняются', () => {
  const { T, saved } = rig({ presets: [{ id: 'a', title: 'Мой', ms: 600000 }], sound: 'soft', volume: 0.4 });
  assert.equal(T.start({ title: 'x', ms: 10 }).ok, false);
  assert.equal(T.start({ title: 'x', ms: 'abc' }).ok, false);
  assert.equal(T.start({ presetId: 'нет' }).ok, false);
  assert.equal(T.state().sound, 'soft');
  T.setPresets([{ id: 'b', title: 'Новый', ms: 90000 }, { title: '', ms: 5 }]);
  assert.deepEqual(T.state().presets, [{ id: 'b', title: 'Новый', ms: 90000 }]);
  T.setSound({ sound: 'alarm', volume: 2, repeat: 5 });
  assert.deepEqual([T.state().sound, T.state().volume, T.state().repeat], ['alarm', 1, 5]);
  T.setSound({ sound: 'nope' });
  assert.equal(T.state().sound, 'alarm');
  assert.deepEqual(saved[saved.length - 1].presets, [{ id: 'b', title: 'Новый', ms: 90000 }]);
});

test('ближайший таймер для значка в трее', () => {
  const { T } = rig(null);
  assert.equal(T.nearest(), null);
  const a = T.start({ title: 'Долгий', ms: 600000 });
  T.start({ title: 'Короткий', ms: 60000 });
  assert.equal(T.nearest().title, 'Короткий');
  assert.equal(T.nearest().count, 2);
  T.pause(a.id);
  assert.equal(T.nearest().title, 'Короткий');
});
