/* Планер — инструменты моушн-дизайнера (чистая логика, без DOM): экспрешены After Effects по шаблонам,
   кадры ↔ секунды ↔ таймкод, темп музыки в кадрах, цвета для экспрешенов, форматы кадра.
   Один файл для страницы (window.PlanerMotion) и для Node (модульные тесты tests/unit/motion.test.js). */
// @ts-check
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else /** @type {any} */ (root).PlanerMotion = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** @param {any} v @param {number} d */
  const num = (v, d) => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : d; };
  /** число для кода: без лишних нулей, точка как разделитель @param {any} v @param {number} d */
  const fmt = (v, d) => String(Math.round(num(v, d) * 10000) / 10000);
  /** строка в двойных кавычках для экспрешена @param {any} s */
  const q = s => '"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

  /**
   * Шаблоны экспрешенов. params: { id, label, type:'number'|'select'|'text'|'bool', def, options? }.
   * where — куда вставлять (свойство слоя), hint — пояснение.
   * @type {{id:string, title:string, where:string, hint:string, params:any[], build:(p:any)=>string}[]}
   */
  const EXPRESSIONS = [
    { id: 'wiggle', title: 'Wiggle — дрожание', where: 'Position, Rotation, Scale…', hint: 'Случайное движение: частота — колебаний в секунду, амплитуда — насколько далеко.',
      params: [{ id: 'freq', label: 'Частота, раз в секунду', type: 'number', def: 2 }, { id: 'amp', label: 'Амплитуда', type: 'number', def: 30 },
        { id: 'axis', label: 'Оси', type: 'select', def: 'all', options: [['all', 'Все'], ['x', 'Только X'], ['y', 'Только Y']] },
        { id: 'seed', label: 'Свой seed (0 — нет)', type: 'number', def: 0 }],
      build: p => {
        const seed = Math.round(num(p.seed, 0)) ? 'seedRandom(' + Math.round(num(p.seed, 0)) + ', true);\n' : '';
        const w = 'wiggle(' + fmt(p.freq, 2) + ', ' + fmt(p.amp, 30) + ')';
        if (p.axis === 'x') return seed + 'w = ' + w + ';\n[w[0], value[1]];';
        if (p.axis === 'y') return seed + 'w = ' + w + ';\n[value[0], w[1]];';
        return seed + w + ';';
      } },
    { id: 'loop', title: 'Loop — повтор ключей', where: 'Любое свойство с ключами', hint: 'cycle — по кругу, pingpong — туда-обратно, offset — с накоплением, continue — продолжить движение.',
      params: [{ id: 'type', label: 'Вид', type: 'select', def: 'cycle', options: [['cycle', 'cycle — по кругу'], ['pingpong', 'pingpong — туда-обратно'], ['offset', 'offset — с накоплением'], ['continue', 'continue — продолжить']] },
        { id: 'dir', label: 'Направление', type: 'select', def: 'out', options: [['out', 'После ключей (loopOut)'], ['in', 'До ключей (loopIn)']] },
        { id: 'keys', label: 'Сколько последних ключей (0 — все)', type: 'number', def: 0 }],
      build: p => (p.dir === 'in' ? 'loopIn' : 'loopOut') + '(' + q(p.type || 'cycle') + (p.type === 'continue' ? '' : ', ' + Math.max(0, Math.round(num(p.keys, 0)))) + ');' },
    { id: 'inertia', title: 'Инерция — overshoot', where: 'Position, Scale, Rotation с ключами', hint: 'Пружинистая «отдача» после последнего ключа. Скорость берётся из анимации.',
      params: [{ id: 'amp', label: 'Сила', type: 'number', def: 0.06 }, { id: 'freq', label: 'Частота', type: 'number', def: 2.5 }, { id: 'decay', label: 'Затухание', type: 'number', def: 5 }],
      build: p => 'amp = ' + fmt(p.amp, 0.06) + '; freq = ' + fmt(p.freq, 2.5) + '; decay = ' + fmt(p.decay, 5) + ';\n' +
        'n = 0;\nif (numKeys > 0) {\n  n = nearestKey(time).index;\n  if (key(n).time > time) n--;\n}\n' +
        't = (n == 0) ? 0 : time - key(n).time;\n' +
        'if (n > 0 && t < 1) {\n  v = velocityAtTime(key(n).time - thisComp.frameDuration / 10);\n  value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);\n} else {\n  value;\n}' },
    { id: 'bounce', title: 'Отскок — мяч', where: 'Position, Scale с ключами', hint: 'Физичный отскок после ключа: упругость 0…1, гравитация — как быстро падает.',
      params: [{ id: 'e', label: 'Упругость (0…1)', type: 'number', def: 0.7 }, { id: 'g', label: 'Гравитация', type: 'number', def: 5000 }, { id: 'n', label: 'Отскоков максимум', type: 'number', def: 9 }],
      build: p => 'e = ' + fmt(p.e, 0.7) + '; g = ' + fmt(p.g, 5000) + '; nMax = ' + Math.round(num(p.n, 9)) + ';\n' +
        'n = 0;\nif (numKeys > 0) {\n  n = nearestKey(time).index;\n  if (key(n).time > time) n--;\n}\n' +
        'if (n > 0) {\n  t = time - key(n).time;\n  v = -velocityAtTime(key(n).time - .001) * e;\n  vl = length(v);\n' +
        '  if (value instanceof Array) { vu = (vl > 0) ? normalize(v) : [0, 0, 0]; } else { vu = (v < 0) ? -1 : 1; }\n' +
        '  tCur = 0; segDur = 2 * vl / g; tNext = segDur; nb = 1;\n' +
        '  while (tNext < t && nb <= nMax) { vl *= e; segDur *= e; tCur = tNext; tNext += segDur; nb++; }\n' +
        '  if (nb <= nMax) { delta = t - tCur; value + vu * delta * (vl - g * delta / 2); } else { value; }\n} else {\n  value;\n}' },
    { id: 'spin', title: 'Вращение с постоянной скоростью', where: 'Rotation', hint: 'Градусов в секунду; минус — против часовой.',
      params: [{ id: 'speed', label: 'Градусов в секунду', type: 'number', def: 90 }],
      build: p => 'value + time * ' + fmt(p.speed, 90) + ';' },
    { id: 'posterize', title: 'Покадровость (stop motion)', where: 'Любое свойство', hint: 'Анимация обновляется реже — как рисованная. Можно добавить дрожание.',
      params: [{ id: 'fps', label: 'Кадров в секунду', type: 'number', def: 12 }, { id: 'wig', label: 'Добавить wiggle', type: 'bool', def: false }, { id: 'amp', label: 'Амплитуда wiggle', type: 'number', def: 5 }],
      build: p => 'posterizeTime(' + fmt(p.fps, 12) + ');\n' + (p.wig ? 'wiggle(' + fmt(p.fps, 12) + ', ' + fmt(p.amp, 5) + ');' : 'value;') },
    { id: 'delay', title: 'Следовать с задержкой', where: 'Position, Rotation, Scale, Opacity', hint: 'Повторяет движение другого слоя с опозданием. Каскад — каждый следующий слой позже.',
      params: [{ id: 'mode', label: 'От кого', type: 'select', def: 'name', options: [['name', 'От слоя по имени'], ['index', 'Каскадом от слоя выше']] },
        { id: 'layer', label: 'Имя ведущего слоя', type: 'text', def: 'Ведущий' },
        { id: 'prop', label: 'Свойство', type: 'select', def: 'position', options: [['position', 'Position'], ['rotation', 'Rotation'], ['scale', 'Scale'], ['opacity', 'Opacity']] },
        { id: 'delay', label: 'Задержка, секунд', type: 'number', def: 0.1 }],
      build: p => {
        const prop = ['position', 'rotation', 'scale', 'opacity'].includes(p.prop) ? p.prop : 'position';
        if (p.mode === 'index') return 'd = ' + fmt(p.delay, 0.1) + ';\nthisComp.layer(index - 1).transform.' + prop + '.valueAtTime(time - d);';
        return 'thisComp.layer(' + q(p.layer || 'Ведущий') + ').transform.' + prop + '.valueAtTime(time - ' + fmt(p.delay, 0.1) + ');';
      } },
    { id: 'counter', title: 'Счётчик чисел', where: 'Source Text текстового слоя', hint: 'Плавно считает от одного числа до другого; разделитель тысяч, знаки после запятой, текст до и после.',
      params: [{ id: 'from', label: 'От', type: 'number', def: 0 }, { id: 'to', label: 'До', type: 'number', def: 1000 },
        { id: 'start', label: 'Начало, секунд', type: 'number', def: 0 }, { id: 'dur', label: 'Длительность, секунд', type: 'number', def: 2 },
        { id: 'dec', label: 'Знаков после запятой', type: 'number', def: 0 },
        { id: 'sep', label: 'Разделитель тысяч', type: 'select', def: ' ', options: [[' ', 'Пробел'], [',', 'Запятая'], ['.', 'Точка'], ['', 'Нет']] },
        { id: 'prefix', label: 'Текст до', type: 'text', def: '' }, { id: 'suffix', label: 'Текст после', type: 'text', def: '' }],
      build: p => {
        const dec = Math.max(0, Math.min(6, Math.round(num(p.dec, 0))));
        return 's = ' + fmt(p.start, 0) + '; d = ' + fmt(p.dur, 2) + ';\nv = ease(time, s, s + d, ' + fmt(p.from, 0) + ', ' + fmt(p.to, 1000) + ');\n' +
          'parts = v.toFixed(' + dec + ').split(".");\nparts[0] = parts[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ' + q(p.sep == null ? ' ' : p.sep) + ');\n' +
          (p.prefix ? q(p.prefix) + ' + ' : '') + 'parts.join(' + q(p.sep === ',' ? '.' : ',') + ')' + (p.suffix ? ' + ' + q(p.suffix) : '') + ';';
      } },
    { id: 'typewriter', title: 'Печатная машинка', where: 'Source Text текстового слоя', hint: 'Текст появляется по буквам; можно мигающий курсор.',
      params: [{ id: 'cps', label: 'Букв в секунду', type: 'number', def: 15 }, { id: 'start', label: 'Начало, секунд', type: 'number', def: 0 }, { id: 'cursor', label: 'Мигающий курсор', type: 'bool', def: true }],
      build: p => 'cps = ' + fmt(p.cps, 15) + '; st = ' + fmt(p.start, 0) + ';\nn = Math.max(0, Math.floor((time - st) * cps));\n' +
        (p.cursor ? 'cur = (Math.floor(time * 2) % 2 == 0) ? "|" : "";\nvalue.substr(0, n) + cur;' : 'value.substr(0, n);') },
    { id: 'countdown', title: 'Таймер обратного отсчёта', where: 'Source Text текстового слоя', hint: 'Показывает мм:сс, считает от заданного числа секунд до нуля.',
      params: [{ id: 'from', label: 'Секунд всего', type: 'number', def: 60 }, { id: 'start', label: 'Начало, секунд', type: 'number', def: 0 }],
      build: p => 't = Math.max(0, ' + fmt(p.from, 60) + ' - (time - ' + fmt(p.start, 0) + '));\nm = Math.floor(t / 60); s = Math.floor(t % 60);\n' +
        '(m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;' },
    { id: 'blink', title: 'Мигание', where: 'Opacity', hint: 'Резкое (вкл/выкл) или плавное мигание с заданной частотой.',
      params: [{ id: 'freq', label: 'Раз в секунду', type: 'number', def: 2 }, { id: 'smooth', label: 'Плавно', type: 'bool', def: false }],
      build: p => p.smooth ? '50 + 50 * Math.sin(time * ' + fmt(p.freq, 2) + ' * Math.PI * 2);' : '(Math.sin(time * ' + fmt(p.freq, 2) + ' * Math.PI * 2) > 0) ? 100 : 0;' },
    { id: 'lookat', title: 'Смотреть на слой', where: 'Rotation (2D-слой)', hint: 'Слой всегда повёрнут к другому слою. Смещение — если «нос» нарисован не вправо.',
      params: [{ id: 'layer', label: 'Имя слоя-цели', type: 'text', def: 'Цель' }, { id: 'offset', label: 'Смещение угла', type: 'number', def: 0 }],
      build: p => 'target = thisComp.layer(' + q(p.layer || 'Цель') + ').toComp([0, 0]);\nme = toComp(anchorPoint);\nd = target - me;\n' +
        'radiansToDegrees(Math.atan2(d[1], d[0])) + ' + fmt(p.offset, 0) + ';' },
    { id: 'stroke', title: 'Толщина обводки не меняется при масштабе', where: 'Stroke Width у слоя-фигуры', hint: 'Обводка остаётся той же толщины, когда слой или родитель масштабируют.',
      params: [],
      build: () => 's = length(toComp([0, 0]), toComp([0.7071, 0.7071])) || 0.001;\nvalue / s;' },
    { id: 'slider', title: 'Связать с ползунком', where: 'Любое свойство; на слой — эффект Slider Control', hint: 'Ползунок 0…100 управляет свойством в нужном диапазоне.',
      params: [{ id: 'min', label: 'Значение при 0', type: 'number', def: 0 }, { id: 'max', label: 'Значение при 100', type: 'number', def: 360 }, { id: 'name', label: 'Имя эффекта', type: 'text', def: 'Slider Control' }],
      build: p => 'linear(effect(' + q(p.name || 'Slider Control') + ')("Slider"), 0, 100, ' + fmt(p.min, 0) + ', ' + fmt(p.max, 360) + ');' }
  ];
  /** Экспрешен по шаблону с параметрами (недостающие — по умолчанию). @param {string} id @param {any} params */
  function buildExpression(id, params) {
    const t = EXPRESSIONS.find(x => x.id === id); if (!t) return '';
    const p = {};
    for (const d of t.params) p[d.id] = params && params[d.id] !== undefined ? params[d.id] : d.def;
    return t.build(p);
  }

  /* ---------- кадры, секунды, таймкод ---------- */
  const FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
  /** номинальная частота для таймкода (23.976 → 24, 29.97 → 30) @param {number} fps */
  const tcBase = fps => Math.round(fps);
  /** кадры → «ЧЧ:ММ:СС:КК» (без drop-frame) @param {number} frames @param {number} fps */
  function framesToTC(frames, fps) {
    const b = tcBase(fps), f = Math.max(0, Math.round(frames));
    const p2 = n => String(n).padStart(2, '0');
    return p2(Math.floor(f / (b * 3600))) + ':' + p2(Math.floor(f / (b * 60)) % 60) + ':' + p2(Math.floor(f / b) % 60) + ':' + p2(f % b);
  }
  /** «ЧЧ:ММ:СС:КК», «ММ:СС:КК» или «СС:КК» → кадры; null — не разобрать @param {any} tc @param {number} fps */
  function tcToFrames(tc, fps) {
    const parts = String(tc || '').trim().split(/[:;.]/).map(Number);
    if (!parts.length || parts.some(n => !isFinite(n) || n < 0) || parts.length > 4) return null;
    while (parts.length < 4) parts.unshift(0);
    const [hh, mm, ss, ff] = parts, b = tcBase(fps);
    if (ff >= b || ss >= 60 || mm >= 60) return null;
    return ((hh * 60 + mm) * 60 + ss) * b + ff;
  }
  const framesToSec = (f, fps) => f / fps;
  const secToFrames = (s, fps) => Math.round(s * fps);
  /** темп музыки → кадров на долю и на такт @param {number} bpm @param {number} fps @param {number} [beats] */
  function beatFrames(bpm, fps, beats = 4) {
    if (!(bpm > 0) || !(fps > 0)) return null;
    const perBeat = fps * 60 / bpm;
    return { perBeat, perBar: perBeat * beats, secBeat: 60 / bpm };
  }

  /* ---------- цвет ---------- */
  /** «#3af», «3AA0FF», «rgb(58,160,255)», «58, 160, 255», «[0.23, 0.63, 1, 1]» → {r,g,b} 0..255 или null @param {any} s */
  function parseColor(s) {
    const t = String(s || '').trim();
    let m = t.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) { let h = m[1]; if (h.length === 3) h = h.split('').map(c => c + c).join(''); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }; }
    m = t.match(/^\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+)?\s*\]$/);
    if (m) { const v = [m[1], m[2], m[3]].map(Number); if (v.every(x => x <= 1)) return { r: Math.round(v[0] * 255), g: Math.round(v[1] * 255), b: Math.round(v[2] * 255) }; }
    m = t.replace(/^rgba?\(|\)$/gi, '').match(/^\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[, ]\s*[\d.]+\s*)?$/);
    if (m) { const v = [m[1], m[2], m[3]].map(Number); if (v.every(x => x <= 255)) return { r: v[0], g: v[1], b: v[2] }; }
    return null;
  }
  /** {r,g,b} → разные записи: HEX, RGB, массив для экспрешена AE, HSL @param {{r:number,g:number,b:number}} c */
  function colorFormats(c) {
    const hex = '#' + [c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    const n = v => String(Math.round(v / 255 * 1000) / 1000);
    const r = c.r / 255, g = c.g / 255, b = c.b / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    let hh = 0, s = 0;
    if (max !== min) {
      const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      hh = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60;
    }
    return { hex, rgb: 'rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')', ae: '[' + n(c.r) + ', ' + n(c.g) + ', ' + n(c.b) + ', 1]',
      hsl: 'hsl(' + Math.round(hh) + ', ' + Math.round(s * 100) + '%, ' + Math.round(l * 100) + '%)' };
  }

  /* ---------- форматы кадра ---------- */
  const FORMATS = [
    { title: 'Full HD 16:9', w: 1920, h: 1080, use: 'YouTube, презентации, ТВ' },
    { title: '4K UHD 16:9', w: 3840, h: 2160, use: 'Мастер-копия, YouTube 4K' },
    { title: 'Вертикальное 9:16', w: 1080, h: 1920, use: 'Reels, Shorts, TikTok, Stories' },
    { title: 'Пост 4:5', w: 1080, h: 1350, use: 'Лента Instagram' },
    { title: 'Квадрат 1:1', w: 1080, h: 1080, use: 'Соцсети, превью' },
    { title: 'HD 16:9', w: 1280, h: 720, use: 'Черновики, веб' },
    { title: 'Кино 2.39:1', w: 2048, h: 858, use: 'Широкий кадр (DCI 2K Scope)' },
    { title: 'Ultrawide 21:9', w: 2560, h: 1080, use: 'Широкие экраны' },
    { title: 'DCI 2K', w: 2048, h: 1080, use: 'Кинопоказ' }
  ];
  /** соотношение сторон в простых числах: 1920×1080 → «16:9» @param {number} w @param {number} h */
  function aspect(w, h) {
    w = Math.round(w); h = Math.round(h);
    if (!(w > 0 && h > 0)) return '';
    const gcd = (a, b) => b ? gcd(b, a % b) : a, g = gcd(w, h);
    const a = w / g, b = h / g;
    return a > 50 || b > 50 ? (w / h).toFixed(2).replace(/\.?0+$/, '') + ':1' : a + ':' + b;
  }

  return { EXPRESSIONS, buildExpression, FPS, framesToTC, tcToFrames, framesToSec, secToFrames, beatFrames, parseColor, colorFormats, FORMATS, aspect };
});
