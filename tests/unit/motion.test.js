// Модульные тесты инструментов моушн-дизайнера (src/motion.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../src/motion.js');

test('экспрешены: параметры подставляются, оси, loop, счётчик', () => {
  assert.equal(M.buildExpression('wiggle', {}), 'wiggle(2, 30);');
  assert.equal(M.buildExpression('wiggle', { freq: '3,5', amp: 12, axis: 'x' }), 'w = wiggle(3.5, 12);\n[w[0], value[1]];');
  assert.equal(M.buildExpression('wiggle', { seed: 7 }), 'seedRandom(7, true);\nwiggle(2, 30);');
  assert.equal(M.buildExpression('loop', { type: 'pingpong', dir: 'in' }), 'loopIn("pingpong", 0);');
  assert.equal(M.buildExpression('loop', { type: 'continue' }), 'loopOut("continue");');
  assert.equal(M.buildExpression('spin', { speed: -45 }), 'value + time * -45;');
  assert.match(M.buildExpression('counter', { to: 2500, sep: ',', prefix: '$' }), /ease\(time, s, s \+ d, 0, 2500\)/);
  assert.match(M.buildExpression('counter', { sep: ',' }), /parts\.join\("\."\)/);
  assert.equal(M.buildExpression('delay', { mode: 'index', prop: 'rotation', delay: 0.25 }), 'd = 0.25;\nthisComp.layer(index - 1).transform.rotation.valueAtTime(time - d);');
  assert.equal(M.buildExpression('delay', { layer: 'Мяч "1"' }), 'thisComp.layer("Мяч \\"1\\"").transform.position.valueAtTime(time - 0.1);');   // кавычки экранируются
  assert.equal(M.buildExpression('nope', {}), '');
  for (const e of M.EXPRESSIONS) assert.ok(M.buildExpression(e.id, {}).length > 5, e.id);
});

test('таймкод: кадры ↔ ЧЧ:ММ:СС:КК, неверный ввод', () => {
  assert.equal(M.framesToTC(0, 25), '00:00:00:00');
  assert.equal(M.framesToTC(25 * 3600 + 25 * 61 + 7, 25), '01:01:01:07');
  assert.equal(M.framesToTC(48, 23.976), '00:00:02:00');
  assert.equal(M.tcToFrames('01:01:01:07', 25), 25 * 3600 + 25 * 61 + 7);
  assert.equal(M.tcToFrames('2:12', 30), 72);
  assert.equal(M.tcToFrames('00:00:00:30', 30), null);
  assert.equal(M.tcToFrames('abc', 25), null);
  assert.equal(M.secToFrames(2.5, 24), 60);
  const b = M.beatFrames(120, 24);
  assert.equal(b.perBeat, 12); assert.equal(b.perBar, 48); assert.equal(b.secBeat, 0.5);
  assert.equal(M.beatFrames(0, 24), null);
});

test('цвет: разные записи и массив для экспрешена', () => {
  assert.deepEqual(M.parseColor('#3af'), { r: 51, g: 170, b: 255 });
  assert.deepEqual(M.parseColor('3AA0FF'), { r: 58, g: 160, b: 255 });
  assert.deepEqual(M.parseColor('rgb(58, 160, 255)'), { r: 58, g: 160, b: 255 });
  assert.deepEqual(M.parseColor('[0.2, 0.4, 1, 1]'), { r: 51, g: 102, b: 255 });
  assert.equal(M.parseColor('300, 1, 1'), null);
  assert.equal(M.parseColor('красный'), null);
  const f = M.colorFormats({ r: 255, g: 128, b: 0 });
  assert.equal(f.hex, '#FF8000');
  assert.equal(f.ae, '[1, 0.502, 0, 1]');
  assert.equal(f.hsl, 'hsl(30, 100%, 50%)');
});

test('соотношение сторон', () => {
  assert.equal(M.aspect(1920, 1080), '16:9');
  assert.equal(M.aspect(1080, 1350), '4:5');
  assert.equal(M.aspect(2048, 858), '2.39:1');
  assert.equal(M.aspect(0, 10), '');
});
