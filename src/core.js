/* Планер — чистая логика без DOM и Electron: даты, нормализация данных, разбор ввода, поиск, таймеры.
   Один файл для страницы (window.PlanerCore) и для Node (require: основной процесс и модульные тесты tests/unit). */
// @ts-check
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else /** @type {any} */ (root).PlanerCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** @typedef {{id:string, text:string, done:boolean, pri:number, note:string, block?:string}} Task */
  /** @typedef {{id:string, from:string, to:string, title:string, color:string}} TimeBlock */
  /** @typedef {{items:Task[], blocks?:TimeBlock[]}} Day */
  /** @typedef {{v:1, days:Object<string, Day>, undated:Task[], hideDone:boolean, urgentOnly:boolean, showCal:boolean}} Cal */

  const newId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const BLOCK_TYPES = ['p', 'h', 'todo', 'ul'];
  const BLOCK_COLOR_IDS = ['blue', 'green', 'yellow', 'orange', 'pink', 'purple'];

  /* ---------- даты: ключ дня — 'ГГГГ-ММ-ДД' по местному времени ---------- */
  /** @param {number} n */
  const pad2 = n => String(n).padStart(2, '0');
  /** @param {Date} d */
  const dkey = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const todayKey = () => dkey(new Date());
  /** @param {string} k */
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  /** Настоящая ли это дата (не 2026-02-31). @param {string} k */
  const isDateKey = k => typeof k === 'string' && DATE_RE.test(k) && dkey(parseKey(k)) === k;
  /** @param {string} k @param {number} n */
  const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dkey(d); };
  /** @param {string} k */
  const mondayOf = k => { const d = parseKey(k); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return dkey(d); };
  /** @param {string} k */
  const monthOf = k => k.slice(0, 7);
  /** @param {string} m @param {number} n */
  const addMonths = (m, n) => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + n, 1); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); };
  /** @param {string} s */
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  /** Русское множественное число: plural(5, 'задача', 'задачи', 'задач'). @param {number} n @param {string} a @param {string} b @param {string} c */
  const plural = (n, a, b, c) => { const x = Math.abs(n) % 100, y = x % 10; return x > 10 && x < 20 ? c : y === 1 ? a : y >= 2 && y <= 4 ? b : c; };

  /* ---------- нормализация данных ---------- */
  /** @param {any} t @returns {Task} */
  const normTask = t => {
    /** @type {Task} */
    const o = { id: String(t.id || newId()), text: String(t.text || ''), done: !!t.done, pri: Math.min(3, Math.max(0, t.pri | 0)), note: String(t.note || '') };
    if (typeof t.block === 'string' && t.block) o.block = t.block.slice(0, 40);      // блок времени дня
    return o;
  };
  /** @param {any} b @returns {TimeBlock|null} */
  const normTimeBlock = b => (b && TIME_RE.test(b.from) && TIME_RE.test(b.to) && b.from < b.to)
    ? { id: String(b.id || newId()).slice(0, 40), from: b.from, to: b.to, title: String(b.title || '').slice(0, 60), color: BLOCK_COLOR_IDS.includes(b.color) ? b.color : 'blue' } : null;
  /** @param {any} b */
  const normBlock = b => ({ id: String(b.id || newId()), t: BLOCK_TYPES.includes(b.t) ? b.t : 'p', text: String(b.text || ''), done: !!b.done });
  /** @param {any} n @returns {any} */
  function normNode(n) {
    if (n && n.type === 'folder') return { id: String(n.id || newId()), type: 'folder', title: String(n.title || ''), open: n.open !== false, children: (n.children || []).map(normNode) };
    /** @type {any} */
    const p = { id: String((n && n.id) || newId()), type: 'page', title: String((n && n.title) || ''), blocks: ((n && n.blocks) || []).map(normBlock) };
    if (n && typeof n.boardId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(n.boardId)) p.boardId = n.boardId;   // доска, перенесённая со старой задачи
    if (n && n.boardCount > 0) p.boardCount = n.boardCount | 0;
    const hasText = p.blocks.some(/** @param {any} b */ b => b.text.trim()) || p.blocks.length > 1;
    p.kind = n && (n.kind === 'board' || n.kind === 'text') ? n.kind : (p.boardCount && !hasText ? 'board' : 'text');
    return p;
  }
  /** @param {any} d @returns {Cal} */
  function normCal(d) {
    d = d || {};
    /** @type {Object<string, Day>} */
    const days = {};
    if (d.days && typeof d.days === 'object') for (const [k, v] of Object.entries(d.days)) {
      if (!DATE_RE.test(k) || !v) continue;
      const items = (Array.isArray(v.items) ? v.items : []).map(normTask);
      const blocks = /** @type {TimeBlock[]} */ ((Array.isArray(v.blocks) ? v.blocks : []).map(normTimeBlock).filter(Boolean));
      const ids = new Set(blocks.map(b => b.id));
      items.forEach(/** @param {Task} t */ t => { if (t.block && !ids.has(t.block)) delete t.block; });
      if (items.length || blocks.length) days[k] = blocks.length ? { items, blocks } : { items };
    }
    const undated = (Array.isArray(d.undated) ? d.undated : []).map(normTask);
    undated.forEach(/** @param {Task} t */ t => { delete t.block; });
    return { v: 1, days, undated, hideDone: !!d.hideDone, urgentOnly: d.urgentOnly !== false, showCal: d.showCal !== false };
  }
  /** «Купить хлеб !!!» → { text: 'Купить хлеб', pri: 3 }. @param {any} raw */
  function parseNewTask(raw) {
    let text = String(raw || '').trim(), pri = 0;
    const m = text.match(/\s*(!{1,3})$/);
    if (m && text.length > m[0].length) { pri = m[1].length; text = text.slice(0, text.length - m[0].length).trim(); }
    return { text, pri };
  }

  /* ---------- поиск: без учёта регистра и «ё», все слова запроса должны встретиться ---------- */
  /** Нормализация с сохранением длины строки (позиции совпадений совпадают с исходным текстом). @param {any} s */
  const normSearch = s => String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е');
  /** @param {any} q */
  const searchTokens = q => normSearch(q).split(/[\s,.;:!?«»"()]+/).filter(Boolean).slice(0, 8);
  const WORD_CH = /[\p{L}\p{N}]/u;
  /**
   * Оценка совпадения: -1 — не все слова найдены. Совпадение в заголовке ценнее, с начала слова — ещё ценнее.
   * @param {string} title @param {string} text @param {string[]} tokens
   */
  function matchScore(title, text, tokens) {
    if (!tokens.length) return -1;
    const T = normSearch(title), X = normSearch(text);
    let score = 0;
    for (const tok of tokens) {
      const it = T.indexOf(tok), ix = X.indexOf(tok);
      if (it < 0 && ix < 0) return -1;
      const atWord = /** @param {string} s @param {number} i */ (s, i) => i === 0 || !WORD_CH.test(s[i - 1]);
      if (it >= 0) score += 6 + (atWord(T, it) ? 3 : 0) + (it === 0 ? 2 : 0);
      else score += 2 + (atWord(X, ix) ? 1 : 0);
    }
    if (T === tokens.join(' ')) score += 5;
    return score;
  }
  /** Диапазоны [начало, конец) совпадений слов запроса — для подсветки. @param {string} text @param {string[]} tokens */
  function matchRanges(text, tokens) {
    const X = normSearch(text), out = /** @type {number[][]} */ ([]);
    for (const tok of tokens) { let i = X.indexOf(tok); while (i >= 0 && out.length < 50) { out.push([i, i + tok.length]); i = X.indexOf(tok, i + tok.length); } }
    out.sort((a, b) => a[0] - b[0]);
    const merged = /** @type {number[][]} */ ([]);
    for (const r of out) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push(r.slice()); }
    return merged;
  }
  /** Фрагмент текста вокруг первого совпадения. @param {string} text @param {string[]} tokens @param {number} [len] */
  function snippet(text, tokens, len = 90) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (s.length <= len) return s;
    const X = normSearch(s);
    let at = -1;
    for (const t of tokens) { const i = X.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
    if (at < 0) return s.slice(0, len - 1) + '…';
    const start = Math.max(0, Math.min(at - Math.floor(len / 3), s.length - len));
    return (start > 0 ? '…' : '') + s.slice(start, start + len).trim() + (start + len < s.length ? '…' : '');
  }
  /**
   * Поиск по записям { title, text, ... }: подходящие записи по убыванию оценки (при равенстве — исходный порядок).
   * @template {{title:string, text:string}} R
   * @param {R[]} records @param {string} query @param {number} [limit]
   * @returns {(R & {score:number})[]}
   */
  function search(records, query, limit = 60) {
    const tokens = searchTokens(query);
    if (!tokens.length) return [];
    const out = [];
    for (let i = 0; i < records.length; i++) {
      const r = records[i], sc = matchScore(r.title, r.text, tokens);
      if (sc >= 0) out.push({ r, sc, i });
    }
    out.sort((a, b) => (b.sc - a.sc) || (a.i - b.i));
    return out.slice(0, limit).map(x => Object.assign({}, x.r, { score: x.sc }));
  }

  /* ---------- таймеры ---------- */
  const SOUNDS = ['bell', 'soft', 'alarm', 'beep'];
  const TIMER_MIN = 1000, TIMER_MAX = 24 * 3600 * 1000;
  /** «25:00», «1:05:00», «0:09». @param {number} ms */
  function fmtClock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000)), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
    return (hh ? hh + ':' + pad2(mm) : String(mm)) + ':' + pad2(ss);
  }
  /** «25 мин», «1 ч 30 мин», «45 с». @param {number} ms */
  function fmtDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000)), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
    return [hh ? hh + ' ч' : '', mm ? mm + ' мин' : '', ss ? ss + ' с' : ''].filter(Boolean).join(' ') || '0 с';
  }
  /**
   * Длительность из строки: «25» (минуты), «25:00», «1:30:00», «90м», «1ч 30м», «1,5 ч», «45 сек». null — не понятно.
   * @param {any} input @returns {number|null}
   */
  function parseDuration(input) {
    const s = String(input == null ? '' : input).trim().toLowerCase().replace(/ё/g, 'е').replace(',', '.');
    if (!s) return null;
    let ms = null;
    let m = s.match(/^(\d{1,3}(?:\.\d+)?)$/);
    if (m) ms = Number(m[1]) * 60000;
    else if ((m = s.match(/^(\d{1,3}):([0-5]?\d)$/))) ms = (Number(m[1]) * 60 + Number(m[2])) * 1000;
    else if ((m = s.match(/^(\d{1,2}):([0-5]\d):([0-5]\d)$/))) ms = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
    else {
      const re = /(\d+(?:\.\d+)?)\s*(ч|час|часа|часов|h|м|мин|минут|минуты|минута|m|min|с|сек|секунд|секунды|секунда|s|sec)(?!\p{L})\.?/gu;
      let rest = s, total = 0, any = false, mm;
      while ((mm = re.exec(s))) {
        const v = Number(mm[1]), u = mm[2];
        total += /^(ч|h)/.test(u) ? v * 3600000 : /^(м|m)/.test(u) ? v * 60000 : v * 1000;
        any = true; rest = rest.replace(mm[0], '');
      }
      if (any && !rest.replace(/[\s,и]+/g, '')) ms = total;
    }
    if (ms == null || !isFinite(ms)) return null;
    ms = Math.round(ms / 1000) * 1000;
    return ms >= TIMER_MIN && ms <= TIMER_MAX ? ms : null;
  }
  const DEFAULT_PRESETS = [
    { id: 'focus', title: 'Фокус', ms: 25 * 60000 },
    { id: 'short', title: 'Короткий перерыв', ms: 5 * 60000 },
    { id: 'long', title: 'Длинный перерыв', ms: 15 * 60000 },
    { id: 'deep', title: 'Глубокая работа', ms: 50 * 60000 }
  ];
  /** @param {any} p */
  const normPreset = p => {
    const ms = Math.round(Number(p && p.ms) / 1000) * 1000;
    if (!p || !isFinite(ms) || ms < TIMER_MIN || ms > TIMER_MAX) return null;
    const id = String(p.id || '').replace(/[^\w-]/g, '').slice(0, 40) || newId();
    return { id, title: String(p.title || '').trim().slice(0, 60) || 'Таймер', ms };
  };
  /** Настройки таймеров (документ planner-timers). @param {any} d */
  function normTimers(d) {
    d = d && typeof d === 'object' ? d : null;
    const seen = new Set();
    const presets = (d && Array.isArray(d.presets) ? d.presets : DEFAULT_PRESETS).map(normPreset)
      .filter(/** @param {any} p */ p => p && !seen.has(p.id) && seen.add(p.id)).slice(0, 30);
    const vol = Number(d && d.volume);
    const rep = Number(d && d.repeat);
    return {
      v: 1, presets,
      sound: d && SOUNDS.includes(d.sound) ? d.sound : 'bell',
      volume: isFinite(vol) && d && d.volume != null ? Math.min(1, Math.max(0, vol)) : 0.7,
      repeat: isFinite(rep) && rep >= 1 ? Math.min(10, Math.round(rep)) : 3
    };
  }

  return {
    newId, DATE_RE, TIME_RE, BLOCK_TYPES, BLOCK_COLOR_IDS,
    pad2, dkey, todayKey, parseKey, isDateKey, addDays, mondayOf, monthOf, addMonths, cap, plural,
    normTask, normTimeBlock, normBlock, normNode, normCal, parseNewTask,
    normSearch, searchTokens, matchScore, matchRanges, snippet, search,
    SOUNDS, TIMER_MIN, TIMER_MAX, fmtClock, fmtDuration, parseDuration, DEFAULT_PRESETS, normPreset, normTimers
  };
});
