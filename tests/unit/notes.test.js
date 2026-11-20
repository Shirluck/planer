// Модульные тесты логики заметок (src/core.js): типы блоков, разметка внутри строки, Markdown ↔ блоки.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/core.js');

const segs = s => C.parseInline(s).map(g => { const o = { text: g.text }; for (const k of ['b', 'i', 'u', 's', 'code', 'href']) if (g[k]) o[k] = g[k]; return o; });

test('блоки: новые типы, старый «h» → заголовок 2, отступы и выноска', () => {
  assert.equal(C.normBlock({ t: 'h', text: 'Старый заголовок' }).t, 'h2');
  assert.equal(C.normBlock({ t: 'bullet' }).t, 'ul');
  assert.equal(C.normBlock({ t: 'нечто' }).t, 'p');
  assert.deepEqual(C.normBlock({ id: 'a', t: 'todo', text: 'x', done: 1, ind: 9 }), { id: 'a', t: 'todo', text: 'x', done: true, ind: 6 });
  assert.equal(C.normBlock({ t: 'h1', ind: 2 }).ind, undefined);          // заголовки без отступа
  assert.equal(C.normBlock({ t: 'callout' }).emoji, '💡');
  assert.equal(C.normBlock({ t: 'hr', text: 'мусор' }).text, '');
  assert.equal(C.normBlock({ t: 'p', done: true }).done, false);
});

test('разметка внутри строки: жирный, курсив, вложенность, код, ссылки, экранирование', () => {
  assert.deepEqual(segs('Обычный **жирный** и *курсив*'), [{ text: 'Обычный ' }, { text: 'жирный', b: true }, { text: ' и ' }, { text: 'курсив', i: true }]);
  assert.deepEqual(segs('***оба***'), [{ text: 'оба', b: true, i: true }]);
  assert.deepEqual(segs('*курсив с **жирным** внутри*'), [{ text: 'курсив с ', i: true }, { text: 'жирным', b: true, i: true }, { text: ' внутри', i: true }]);
  assert.deepEqual(segs('~~нет~~ ++да++ `a*b*c`'), [{ text: 'нет', s: true }, { text: ' ' }, { text: 'да', u: true }, { text: ' ' }, { text: 'a*b*c', code: true }]);
  assert.deepEqual(segs('[сайт](https://example.com) и [плохая](javascript:alert(1))'),
    [{ text: 'сайт', href: 'https://example.com' }, { text: ' и [плохая](javascript:alert(1))' }]);
  assert.deepEqual(segs('5 * 3 * 2 = 30'), [{ text: '5 * 3 * 2 = 30' }]);   // звёздочки с пробелами — не курсив
  assert.deepEqual(segs('не **закрыто'), [{ text: 'не **закрыто' }]);
  assert.deepEqual(segs('звёздочка \\*не курсив\\*'), [{ text: 'звёздочка *не курсив*' }]);
});

test('соседние пометки разного вида разбираются однозначно', () => {
  assert.deepEqual(segs('**a***b*'), [{ text: 'a', b: true }, { text: 'b', i: true }]);
  assert.deepEqual(segs('*a***b**'), [{ text: 'a', i: true }, { text: 'b', b: true }]);
  assert.deepEqual(segs('**a*b***'), [{ text: 'a', b: true }, { text: 'b', b: true, i: true }]);
  // любые соседние отрезки после записи читаются так же
  const cases = [
    [{ text: 'a', b: true }, { text: 'b', i: true }],
    [{ text: 'a', i: true }, { text: 'b', b: true }],
    [{ text: 'a', b: true }, { text: 'b', b: true, i: true }],
    [{ text: 'a', s: true }, { text: 'b', u: true }, { text: 'c', b: true, s: true }],
    [{ text: 'x ' }, { text: 'y', code: true }, { text: 'z', href: 'https://a.b' }]
  ];
  for (const c of cases) assert.deepEqual(segs(C.inlineToMd(c)), c, C.inlineToMd(c));
});

test('разметка: запись обратно даёт тот же текст', () => {
  for (const s of ['Обычный **жирный** и *курсив*', '***оба***', '~~нет~~ ++да++ `код`', '[сайт](https://example.com)', 'a\\*b \\` c', 'строка\nвторая']) {
    assert.equal(C.inlineToMd(C.parseInline(s)), s, s);
  }
  assert.equal(C.mdEscape('2*2 ~ `x` ++'), '2\\*2 \\~ \\`x\\` \\+\\+');
  assert.equal(C.mdPlain('**Жирный** [ссылка](https://a.b) `код`'), 'Жирный ссылка код');
});

test('Markdown → блоки и обратно', () => {
  const md = '# Цели\n\nОбычный текст\n- пункт\n  - вложенный\n1. первый\n2. второй\n- [ ] сделать\n- [x] сделано\n> цитата\n---\n```\nconst a = 1;\n```';
  const bl = C.markdownToBlocks(md);
  assert.deepEqual(bl.map(b => [b.t, b.text, b.ind || 0, b.done]), [
    ['h1', 'Цели', 0, false], ['p', 'Обычный текст', 0, false], ['ul', 'пункт', 0, false], ['ul', 'вложенный', 1, false],
    ['ol', 'первый', 0, false], ['ol', 'второй', 0, false], ['todo', 'сделать', 0, false], ['todo', 'сделано', 0, true],
    ['quote', 'цитата', 0, false], ['hr', '', 0, false], ['code', 'const a = 1;', 0, false]
  ]);
  assert.equal(C.blocksToMarkdown(bl), md.replace('\n\n', '\n'));
  assert.equal(C.blocksToMarkdown([{ t: 'callout', emoji: '🔥', text: 'Важно' }]), '> 🔥 Важно');
});
