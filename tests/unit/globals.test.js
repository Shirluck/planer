// Код главного окна — обычные скрипты с общей глобальной областью (src/app/*.js, порядок — в index.html).
// Одинаковое имя функции в двух файлах молча заменяет первую — такие совпадения здесь запрещены.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

test('в скриптах окна нет повторяющихся имён верхнего уровня', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const files = [...html.matchAll(/src="(src\/app\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(files.length >= 10, 'скрипты окна найдены');
  const seen = new Map(), dups = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const names = [...src.matchAll(/^(?:async\s+)?function\s+([\w$]+)|^(?:const|let|var)\s+([\w$]+)/gm)].map(m => m[1] || m[2]);
    for (const m of src.matchAll(/^const \{([^}]+)\} =/gm)) names.push(...m[1].split(',').map(x => x.trim().split(':').pop().trim()).filter(Boolean));
    for (const n of names) { if (seen.has(n) && seen.get(n) !== f) dups.push(n + ': ' + seen.get(n) + ' и ' + f); else seen.set(n, f); }
  }
  assert.deepEqual(dups, []);
});
