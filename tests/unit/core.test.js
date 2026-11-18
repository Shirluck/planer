// Модульные тесты чистой логики (src/core.js): node --test, без Electron и окна. Быстрые — секунды.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../src/core.js');

test('даты: ключи дней, соседние дни, понедельник, месяцы', () => {
  assert.equal(C.dkey(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(C.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(C.addDays('2028-02-28', 1), '2028-02-29');          // високосный год
  assert.equal(C.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(C.addDays('2026-03-29', 1), '2026-03-30');          // переход на летнее время не сдвигает дату
  assert.equal(C.mondayOf('2026-11-18'), '2026-11-16');            // среда → понедельник
  assert.equal(C.mondayOf('2026-11-22'), '2026-11-16');            // воскресенье — конец той же недели
  assert.equal(C.monthOf('2026-11-18'), '2026-11');
  assert.equal(C.addMonths('2026-12', 1), '2027-01');
  assert.equal(C.addMonths('2026-01', -1), '2025-12');
  assert.equal(C.isDateKey('2026-02-29'), false);
  assert.equal(C.isDateKey('2028-02-29'), true);
  assert.equal(C.isDateKey('2026-1-5'), false);
});

test('множественное число по-русски', () => {
  const w = n => C.plural(n, 'задача', 'задачи', 'задач');
  assert.deepEqual([1, 2, 5, 11, 12, 21, 22, 25, 101, 111].map(w), ['задача', 'задачи', 'задач', 'задач', 'задач', 'задача', 'задачи', 'задач', 'задача', 'задач']);
});

test('новая задача: !, !!, !!! в конце задают приоритет', () => {
  assert.deepEqual(C.parseNewTask('Купить хлеб !!!'), { text: 'Купить хлеб', pri: 3 });
  assert.deepEqual(C.parseNewTask('  Позвонить!  '), { text: 'Позвонить', pri: 1 });
  assert.deepEqual(C.parseNewTask('!!!'), { text: '!!!', pri: 0 });   // одни восклицательные знаки — это текст
  assert.deepEqual(C.parseNewTask('Без приоритета'), { text: 'Без приоритета', pri: 0 });
});

test('normCal: чистит мусор, убирает ссылки на несуществующие блоки и пустые дни', () => {
  const cal = C.normCal({
    days: {
      '2026-11-18': { items: [{ id: 'a', text: 'A', pri: 7, block: 'b1' }, { id: 'b', text: 'B', block: 'nope' }], blocks: [{ id: 'b1', from: '10:00', to: '12:00', color: 'red' }, { id: 'b2', from: '13:00', to: '12:00' }] },
      '2026-11-19': { items: [] },
      'not-a-date': { items: [{ text: 'x' }] }
    },
    undated: [{ id: 'u', text: 'U', block: 'b1' }],
    urgentOnly: false
  });
  assert.deepEqual(Object.keys(cal.days), ['2026-11-18']);
  const d = cal.days['2026-11-18'];
  assert.equal(d.items[0].pri, 3);
  assert.equal(d.items[0].block, 'b1');
  assert.equal(d.items[1].block, undefined);                       // блока «nope» нет
  assert.deepEqual(d.blocks, [{ id: 'b1', from: '10:00', to: '12:00', title: '', color: 'blue' }]);   // неверный цвет → синий, неверное время — блок отброшен
  assert.equal(cal.undated[0].block, undefined);                    // у задач без даты блоков нет
  assert.equal(cal.urgentOnly, false);
  assert.equal(cal.showCal, true);
});

test('normNode: тип файла (текст или доска) и старые страницы', () => {
  assert.equal(C.normNode({ id: 'p', type: 'page', title: 'T', blocks: [{ t: 'p', text: '' }], boardCount: 3 }).kind, 'board');
  assert.equal(C.normNode({ id: 'p', type: 'page', title: 'T', blocks: [{ t: 'p', text: 'текст' }], boardCount: 3 }).kind, 'text');
  assert.equal(C.normNode({ id: 'p', type: 'page', kind: 'board', blocks: [] }).kind, 'board');
  const f = C.normNode({ type: 'folder', title: 'F', children: [{ type: 'page', title: 'x', blocks: [{ t: 'zzz', text: 'a' }] }] });
  assert.equal(f.children[0].blocks[0].t, 'p');
  assert.equal(C.normNode({ type: 'page', boardId: '../evil' }).boardId, undefined);
});

test('поиск: регистр, «ё», все слова запроса, заголовок важнее текста', () => {
  const recs = [
    { id: 1, title: 'Заметки', text: 'купить ёлку и гирлянды' },
    { id: 2, title: 'Ёлка на Новый год', text: '' },
    { id: 3, title: 'Работа', text: 'отчёт по ёлкам' },
    { id: 4, title: 'Покупки', text: 'хлеб, молоко' }
  ];
  const r = C.search(recs, 'ЕЛК');
  assert.deepEqual(r.map(x => x.id), [2, 1, 3]);                   // совпадение в заголовке — выше
  assert.deepEqual(C.search(recs, 'елку гирлянды').map(x => x.id), [1]);
  assert.deepEqual(C.search(recs, 'елка молоко'), []);              // нужны все слова
  assert.deepEqual(C.search(recs, '   '), []);
  assert.deepEqual(C.matchRanges('Ёлка и ёлки', ['елк']), [[0, 3], [7, 10]]);
  assert.equal(C.snippet('a'.repeat(200) + ' нужное слово ' + 'b'.repeat(200), ['нужное'], 60).includes('нужное'), true);
});

test('таймеры: разбор длительности и формат', () => {
  const m = n => n * 60000;
  assert.equal(C.parseDuration('25'), m(25));
  assert.equal(C.parseDuration('25:00'), m(25));
  assert.equal(C.parseDuration('1:30:00'), m(90));
  assert.equal(C.parseDuration('90м'), m(90));
  assert.equal(C.parseDuration('1ч 30м'), m(90));
  assert.equal(C.parseDuration('1 час 15 минут'), m(75));
  assert.equal(C.parseDuration('1,5 ч'), m(90));
  assert.equal(C.parseDuration('45 сек'), 45000);
  assert.equal(C.parseDuration('0'), null);
  assert.equal(C.parseDuration('25 яблок'), null);
  assert.equal(C.parseDuration('30ч'), null);                       // больше суток
  assert.equal(C.fmtClock(m(25)), '25:00');
  assert.equal(C.fmtClock(m(65) + 5000), '1:05:05');
  assert.equal(C.fmtClock(400), '0:01');                            // округление вверх: пока идёт, не показываем 0:00
  assert.equal(C.fmtDuration(m(90)), '1 ч 30 мин');
  assert.equal(C.fmtDuration(45000), '45 с');
});

test('таймеры: настройки по умолчанию и проверка данных', () => {
  const d = C.normTimers(null);
  assert.deepEqual(d.presets.map(p => p.title), ['Фокус', 'Короткий перерыв', 'Длинный перерыв', 'Глубокая работа']);
  assert.equal(d.sound, 'bell');
  assert.equal(d.volume, 0.7);
  const x = C.normTimers({ presets: [{ id: 'a', title: '  Чтение ', ms: 1200400 }, { id: 'a', title: 'дубль', ms: 60000 }, { title: 'плохой', ms: 10 }], sound: 'boom', volume: 3, repeat: 0 });
  assert.deepEqual(x.presets, [{ id: 'a', title: 'Чтение', ms: 1200000 }]);
  assert.equal(x.sound, 'bell');
  assert.equal(x.volume, 1);
  assert.equal(x.repeat, 3);
  assert.equal(C.normTimers({ presets: [], volume: 0 }).volume, 0);  // пустой список и тишина — допустимы
  assert.deepEqual(C.normTimers({ presets: [] }).presets, []);
});
