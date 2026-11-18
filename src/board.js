/* Доска страницы («Основные планы», «Идеи») — свободный холст в стиле Milanote.
   Карточки: заметка, чек-лист, изображение, видео, зарисовка, ссылка. DOM + CSS transform, без библиотек.
   Подключается из index.html: const board = PlanerBoard.create(ctx). Медиа — только по ссылке media://<sha256>. */
(function () {
'use strict';

const ID_RE = /^[a-f0-9]{64}$/;
const TYPES = ['note', 'checklist', 'image', 'video', 'sketch', 'link', 'ink'];
const COLORS = ['', 'yellow', 'green', 'blue', 'pink', 'purple'];
const COLOR_NAMES = { '': 'Без цвета', yellow: 'Жёлтый', green: 'Зелёный', blue: 'Голубой', pink: 'Розовый', purple: 'Сиреневый' };
const TYPE_NAMES = { note: 'Заметка', checklist: 'Чек-лист', image: 'Изображение', video: 'Видео', sketch: 'Зарисовка', link: 'Ссылка', ink: 'Рисунок' };
// Рисование от руки прямо на холсте: штрихи векторами (числа в JSON карточки), цвета — по имени (ink = цвет текста темы).
const INK_COLORS = ['ink', 'red', 'orange', 'green', 'blue', 'purple'];
const INK_COLOR_NAMES = { ink: 'Чёрный', red: 'Красный', orange: 'Оранжевый', green: 'Зелёный', blue: 'Синий', purple: 'Фиолетовый' };
const INK_HEX = { ink: '#25221e', red: '#e5484d', orange: '#f08c1a', green: '#2fa36b', blue: '#2f6fe0', purple: '#9b4dca' };
const INK_SIZES = { s: 2, m: 4, l: 9 };         // толщина пера на экране, px (в мире холста делится на масштаб)
const INK_TOOLS = { pen: 'Перо', marker: 'Маркер', eraser: 'Ластик' };
const BGS = ['transparent', 'white', 'grid', 'lines'];
const ZMIN = 0.1, ZMAX = 4, HISTORY = 100, GAP = 24, GRID = 24;
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml,video/mp4,video/webm,video/quicktime,video/x-matroska,.png,.jpg,.jpeg,.gif,.webp,.avif,.svg,.mp4,.m4v,.webm,.mov,.mkv';

const ICONS = {
  board: '<rect x="3" y="4" width="18" height="16" rx="3"/><rect x="6.5" y="7.5" width="5" height="4" rx="1"/><rect x="13" y="7.5" width="4.5" height="7" rx="1"/><rect x="6.5" y="13.5" width="5" height="3" rx="1"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="9.5" r="1.8"/><path d="M4 18l5.5-5.5 4 4L16 14l4.5 4.5"/>',
  video: '<rect x="3" y="5" width="13" height="14" rx="3"/><path d="M16 10l5-3v10l-5-3"/>',
  brush: '<path d="M14.5 4.5l5 5L10 19H5v-5z"/><path d="M12.5 6.5l5 5"/>',
  link: '<path d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  save: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  front: '<rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" fill-opacity=".25"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  back: '<rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor" fill-opacity=".25"/><path d="M8 16v3a1 1 0 001 1h10a1 1 0 001-1V9a1 1 0 00-1-1h-3"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M14 11v6M11 14h6"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  bold: '<path d="M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z"/>',
  caption: '<path d="M4 6h16M4 12h16M4 18h9"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7c0 4-2.5 7-6 7s-5-2-6.5-4.5L3 12.8a1.5 1.5 0 012.5-1.6L8 14"/>',
  pen: '<path d="M4 20l1.2-4.6L15.6 5a2 2 0 012.8 0l.6.6a2 2 0 010 2.8L8.6 18.8z"/><path d="M13.5 7l3.5 3.5"/><path d="M4 20h7" opacity=".55"/>',
  marker: '<path d="M7 14l7.5-7.5a2.1 2.1 0 013 3L10 17"/><path d="M7 14l-1.5 4.5L10 17z"/><path d="M4 21h9" stroke-width="3" opacity=".45"/>',
  eraser: '<path d="M8.5 20H20"/><path d="M5.6 15.4l8.8-8.8a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L12 19l-3.5 1-3-3a2 2 0 01.1-1.6z"/><path d="M9.5 11.5l5 5"/>',
  noimg: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M4 4l16 16"/>'
};

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const str = (v, max) => String(v == null ? '' : v).slice(0, max);
const mid = v => (typeof v === 'string' && ID_RE.test(v) ? v : null);
const rid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
const isMediaType = t => t === 'image' || t === 'video' || t === 'sketch';
const mediaUrl = id => 'media://' + id;
const thumbUrl = id => 'media://' + id + '/thumb';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function safeUrl(u) {
  let s = String(u || '').trim();
  if (!s) return null;
  if (/^www\./i.test(s)) s = 'https://' + s;
  try { const x = new URL(s); return (x.protocol === 'https:' || x.protocol === 'http:') && x.hostname ? x.href : null; } catch (_) { return null; }
}
const isUrlText = s => /^(https?:\/\/|www\.)\S+$/i.test(String(s || '').trim()) && !!safeUrl(s);
const domainOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return u; } };

function fmtDur(s) {
  s = Math.round(num(s, 0)); if (!s) return '';
  const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
  return (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0');
}
function fmtSize(n) {
  n = num(n, 0); if (!n) return '';
  if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' КБ';
  if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0).replace('.', ',') + ' МБ';
  return (n / 1073741824).toFixed(1).replace('.', ',') + ' ГБ';
}
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}
function fitBox(w, hgt, max) {
  w = num(w, 0) || 400; hgt = num(hgt, 0) || 300;
  const k = Math.min(1, max / Math.max(w, hgt));
  return { w: Math.max(60, Math.round(w * k)), h: Math.max(40, Math.round(hgt * k)) };
}

/* ---------- модель ---------- */
function normItem(it) {
  if (!it || typeof it !== 'object' || !TYPES.includes(it.type)) return null;
  const o = { id: str(it.id, 40) || rid(), type: it.type, x: Math.round(num(it.x, 0)), y: Math.round(num(it.y, 0)),
    w: Math.round(clampN(num(it.w, 240), 40, 6000)), h: Math.round(clampN(num(it.h, 80), 24, 6000)), z: Math.round(num(it.z, 0)) };
  switch (it.type) {
    case 'note':
      o.text = str(it.text, 20000); o.color = COLORS.includes(it.color) ? it.color : ''; break;
    case 'checklist':
      o.title = str(it.title, 300); o.color = COLORS.includes(it.color) ? it.color : '';
      o.items = (Array.isArray(it.items) ? it.items : []).slice(0, 500).map(x => ({ id: str(x && x.id, 40) || rid(), text: str(x && x.text, 2000), done: !!(x && x.done) }));
      break;
    case 'image': case 'video':
      o.mediaId = mid(it.mediaId); if (!o.mediaId) return null;
      o.name = str(it.name, 200); o.mime = str(it.mime, 60); o.size = num(it.size, 0);
      o.width = num(it.width, 0); o.height = num(it.height, 0); o.caption = str(it.caption, 2000); o.thumb = !!it.thumb;
      if (it.type === 'video') o.duration = num(it.duration, 0);
      if (it.type === 'image' && it.overlay && (mid(it.overlay.mediaId) || mid(it.overlay.strokesId)))
        o.overlay = { mediaId: mid(it.overlay.mediaId), strokesId: mid(it.overlay.strokesId), width: num(it.overlay.width, 0), height: num(it.overlay.height, 0) };
      break;
    case 'sketch':
      o.mediaId = mid(it.mediaId); o.strokesId = mid(it.strokesId);
      o.bg = BGS.includes(it.bg) ? it.bg : 'white';
      o.width = clampN(num(it.width, 1200), 50, 4000); o.height = clampN(num(it.height, 800), 50, 4000);
      o.caption = str(it.caption, 2000);
      break;
    case 'link':
      o.url = safeUrl(it.url) || ''; o.title = str(it.title, 300);
      if (!o.url && !it._draft) return null;
      // превью: заголовок страницы, описание, сайт, картинка (media://), состояние загрузки
      if (it.ptitle) o.ptitle = str(it.ptitle, 300);
      if (it.desc) o.desc = str(it.desc, 600);
      if (it.site) o.site = str(it.site, 80);
      if (it.kind === 'video' || it.kind === 'article' || it.kind === 'image') o.kind = it.kind;
      if (mid(it.image)) { o.image = it.image; o.imgW = num(it.imgW, 0); o.imgH = num(it.imgH, 0); o.imgThumb = !!it.imgThumb; }
      if (it.pv === 'ok' || it.pv === 'fail') { o.pv = it.pv; o.pvUrl = str(it.pvUrl, 2000); o.pvAt = num(it.pvAt, 0); }
      break;
    case 'ink':
      o.w = Math.round(clampN(num(it.w, 100), 4, 20000)); o.h = Math.round(clampN(num(it.h, 100), 4, 20000));
      o.vw = clampN(num(it.vw, o.w), 1, 40000); o.vh = clampN(num(it.vh, o.h), 1, 40000);
      o.strokes = (Array.isArray(it.strokes) ? it.strokes : []).slice(0, 3000).map(normStroke).filter(Boolean);
      if (!o.strokes.length) return null;
      break;
  }
  return o;
}
/* ---------- штрихи рисунка: { c: цвет, w: толщина, m: 1 — маркер (полупрозрачный), p: [x, y, x, y, …] } ---------- */
const r1 = v => Math.round(v * 10) / 10;
function normStroke(s) {
  if (!s || !Array.isArray(s.p)) return null;
  const p = [];
  for (let i = 0; i + 1 < s.p.length && p.length < 8000; i += 2) {
    const x = s.p[i], y = s.p[i + 1];
    if (typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y)) p.push(r1(x), r1(y));
  }
  if (!p.length) return null;
  const o = { c: INK_COLORS.includes(s.c) ? s.c : 'ink', w: r1(clampN(num(s.w, 3), 0.3, 600)), p };
  if (s.m) o.m = 1;
  return o;
}
// Линия через точки как есть: плавность даёт плотность точек (упрощение оставляет отклонение меньше пикселя),
// а углы остаются углами — квадрат не превращается в круг.
function inkPath(p) {
  let d = 'M' + p[0] + ' ' + p[1];
  if (p.length === 2) return d + 'l0.01 0';
  for (let i = 2; i + 1 < p.length; i += 2) d += 'L' + p[i] + ' ' + p[i + 1];
  return d;
}
// Упрощение ломаной (Рамер — Дуглас — Пекер): меньше точек при том же виде.
function simplify(p, eps) {
  const n = p.length / 2;
  if (n <= 2) return p.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = p[2 * a], ay = p[2 * a + 1], bx = p[2 * b], by = p[2 * b + 1];
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) { const d = segDist(p[2 * i], p[2 * i + 1], ax, ay, bx, by); if (d > best) { best = d; bi = i; } }
    if (best > eps) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(p[2 * i], p[2 * i + 1]);
  return out;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function strokeHits(s, x, y, r) {
  const p = s.p, lim = r + s.w / 2;
  if (p.length === 2) return Math.hypot(p[0] - x, p[1] - y) <= lim;
  for (let i = 0; i + 3 < p.length; i += 2) if (segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= lim) return true;
  return false;
}
function normDoc(d) {
  d = d && typeof d === 'object' ? d : {};
  const v = d.view && typeof d.view === 'object' ? d.view : null;
  const seen = new Set();
  const items = (Array.isArray(d.items) ? d.items : []).map(normItem).filter(it => it && !seen.has(it.id) && seen.add(it.id));
  return { v: 1, view: { x: num(v && v.x, 0), y: num(v && v.y, 0), zoom: clampN(num(v && v.zoom, 1), ZMIN, ZMAX) }, items, fresh: !v };
}

/* ---------- текст заметок: **жирный**, «- » список, «[ ] »/«[x] » чекбокс ---------- */
const TODO_RE = /^(\s*)(?:[-*]\s+)?\[( |x|X)?\]\s?(.*)$/;
const UL_RE = /^(\s*)[-*•]\s+(.*)$/;
function inlineNodes(s, h) {
  const out = []; const re = /\*\*(.+?)\*\*/g; let last = 0, m;
  while ((m = re.exec(s))) { if (m.index > last) out.push(s.slice(last, m.index)); out.push(h('b', {}, m[1])); last = re.lastIndex; }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
function renderNote(container, text, h, icon) {
  let ul = null;
  String(text || '').split('\n').forEach((ln, i) => {
    let m;
    if ((m = ln.match(TODO_RE))) {
      ul = null;
      const done = !!m[2] && m[2] !== ' ';
      container.append(h('div', { class: 'bd-todo' + (done ? ' done' : '') },
        h('span', { class: 'bd-cbx', role: 'checkbox', 'aria-checked': String(done), 'aria-label': 'Отметить пункт', 'data-line': String(i) }, icon('check', 11)),
        h('span', {}, inlineNodes(m[3], h))));
    } else if ((m = ln.match(UL_RE))) {
      if (!ul) { ul = h('ul'); container.append(ul); }
      ul.append(h('li', {}, inlineNodes(m[2], h)));
    } else {
      ul = null;
      container.append(ln.trim() ? h('p', {}, inlineNodes(ln, h)) : h('p', { class: 'bd-blank' }, ' '));
    }
  });
}
function toggleTodoLine(text, line) {
  const lines = String(text).split('\n');
  const m = (lines[line] || '').match(TODO_RE); if (!m) return text;
  const done = !!m[2] && m[2] !== ' ';
  lines[line] = lines[line].replace(/\[( |x|X)?\]/, done ? '[ ]' : '[x]');
  return lines.join('\n');
}
function noteSummary(it) {
  if (it.type === 'note') return it.text;
  if (it.type === 'checklist') return [it.title].concat(it.items.map(x => (x.done ? '[x] ' : '[ ] ') + x.text)).filter(Boolean).join('\n');
  if (it.type === 'link') return [it.title || it.ptitle, it.url].filter(Boolean).join('\n');
  if (it.type === 'image' || it.type === 'video') return it.caption || it.name;
  return it.caption || '';
}

/* ---------- медиа: подготовка ---------- */
function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.decoding = 'async'; i.onload = () => res(i); i.onerror = () => rej(new Error('image')); i.src = src; });
}
const toBlob = (c, type, q) => new Promise(res => { try { c.toBlob(b => res(b), type, q); } catch (_) { res(null); } });
async function blobBytes(b) { return new Uint8Array(await b.arrayBuffer()); }

window.PlanerBoard = { create, normItem, normDoc, renderNote, toggleTodoLine };

// Последние выбранные инструмент, цвет и толщина пера (только удобство этого компьютера).
function loadInkPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('planer-ink') || '{}') || {}; } catch (_) { p = {}; }
  return { tool: INK_TOOLS[p.tool] ? p.tool : 'pen', color: INK_COLORS.includes(p.color) ? p.color : 'ink', size: INK_SIZES[p.size] ? p.size : 'm' };
}

function create(ctx) {
  const { h, icon, toast } = ctx;
  const inkPrefs = loadInkPrefs();
  Object.assign(ctx.IC, ICONS, (window.PlanerSketch && window.PlanerSketch.ICONS) || {});
  const E = ctx.electron || null, M = E && E.media ? E.media : null;
  const SK = () => window.PlanerSketch || null;

  const docs = new Map();         // taskId -> doc
  const loading = new Map();      // taskId -> Promise
  const saveTimers = new Map();
  const saving = new Set();
  const histories = new Map();    // taskId -> { undo, redo } (живёт всю сессию)
  const probed = new Set();
  let clip = null;                // внутренний буфер карточек { items, text }
  let B = null;                   // открытая доска

  if (M) M.onProgress(p => { if (B && B.progress && p.token === B.progress.token) paintProgress(p); });

  /* ---------- хранение ---------- */
  function loadDoc(taskId) {
    if (docs.has(taskId)) return Promise.resolve(docs.get(taskId));
    if (loading.has(taskId)) return loading.get(taskId);
    const p = (async () => {
      let d = null;
      try { d = await ctx.store.get('board-' + taskId); } catch (_) { d = null; }
      const doc = normDoc(d);
      if (!docs.has(taskId)) docs.set(taskId, doc);
      loading.delete(taskId);
      return docs.get(taskId);
    })();
    loading.set(taskId, p);
    return p;
  }
  function scheduleSave(taskId, ms) {
    if (!taskId) return;
    ctx.pending('board-' + taskId, true);
    clearTimeout(saveTimers.get(taskId));
    saveTimers.set(taskId, setTimeout(() => saveNow(taskId), ms == null ? 400 : ms));
  }
  async function saveNow(taskId) {
    clearTimeout(saveTimers.get(taskId)); saveTimers.delete(taskId);
    const doc = docs.get(taskId); if (!doc) { ctx.pending('board-' + taskId, false); return; }
    const body = JSON.parse(JSON.stringify({ v: 1, view: doc.view, items: doc.items.filter(it => !(it.type === 'link' && !it.url)) }));
    saving.add(taskId);
    try { await ctx.store.set('board-' + taskId, body); }
    catch (e) { ctx.saveError(e); }
    finally {
      saving.delete(taskId);
      if (!saveTimers.has(taskId)) ctx.pending('board-' + taskId, false);
    }
    ctx.setBoardCount(taskId, body.items.length);
  }
  async function flush() {
    if (B && B.editingId) syncEditing();
    await Promise.all([...saveTimers.keys()].map(saveNow));
    for (let i = 0; i < 50 && saving.size; i++) await sleep(20);
  }

  /* ---------- история (отмена/повтор) ---------- */
  function hist(taskId) { let x = histories.get(taskId); if (!x) histories.set(taskId, x = { undo: [], redo: [] }); return x; }
  const snap = () => JSON.stringify(B.doc.items);
  function pushHistory(before) {
    if (!B || before == null || before === snap()) return;
    const H = hist(B.taskId);
    H.undo.push(before); if (H.undo.length > HISTORY) H.undo.shift();
    H.redo.length = 0; B.nudgeAt = 0;
    paintUndo();
  }
  function committed() { renderAll(); scheduleSave(B.taskId); paintCtxBar(); paintEmpty(); }
  function change(fn) {
    if (!B) return;
    const before = snap();
    fn();
    if (before !== snap()) { pushHistory(before); committed(); }
  }
  function restore(json) {
    B.doc.items = JSON.parse(json);
    for (const id of [...B.sel]) if (!itemById(id)) B.sel.delete(id);
    committed(); paintSel(); paintUndo();
  }
  function undo() {
    if (!B) return; exitEdit();
    const H = hist(B.taskId); if (!H.undo.length) return;
    H.redo.push(snap()); restore(H.undo.pop());
  }
  function redo() {
    if (!B) return; exitEdit();
    const H = hist(B.taskId); if (!H.redo.length) return;
    H.undo.push(snap()); restore(H.redo.pop());
  }

  /* ---------- служебное ---------- */
  const itemById = id => B && B.doc.items.find(it => it.id === id);
  const selItems = () => B ? B.doc.items.filter(it => B.sel.has(it.id)) : [];
  const maxZ = () => B.doc.items.reduce((m, it) => Math.max(m, it.z), 0);
  const minZ = () => B.doc.items.reduce((m, it) => Math.min(m, it.z), 0);
  const isTyping = el => !!(el && el.closest && el.closest('input,textarea,select,[contenteditable="true"]'));
  function rectOf(it) {
    const el = B && B.els.get(it.id);
    if (el && el.isConnected) return { x: it.x, y: it.y, w: el.offsetWidth || it.w, h: el.offsetHeight || it.h };
    const extra = isMediaType(it.type) && it.caption ? 30 : 0;
    const textH = it.type === 'note' ? Math.max(it.h, 24 + 21 * Math.min(40, String(it.text).split('\n').length)) :
      it.type === 'checklist' ? Math.max(it.h, 70 + 28 * it.items.length) : it.type === 'link' ? linkHeight(it) : it.h;
    return { x: it.x, y: it.y, w: it.w, h: textH + extra };
  }
  function bbox(items) {
    if (!items.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const it of items) { const r = rectOf(it); x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  // Свободное место для прямоугольника w×h как можно ближе к точке (cx, cy) — без наложения на карточки.
  // Сначала ищем место в видимой части холста, потом — где угодно рядом.
  function findFree(doc, w, hh, cx, cy) {
    const rects = doc.items.map(rectOf);
    const hit = (x, y) => rects.some(r => x < r.x + r.w + GAP && x + w + GAP > r.x && y < r.y + r.h + GAP && y + hh + GAP > r.y);
    const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - hh / 2);
    let vis = null;
    if (B && B.doc === doc) {
      const v = doc.view, r = B.vp.getBoundingClientRect(), m = 16 / v.zoom;
      vis = { x: -v.x / v.zoom + m, y: -v.y / v.zoom + m, w: r.width / v.zoom - 2 * m, h: r.height / v.zoom - 2 * m };
    }
    const inVis = (x, y) => !vis || (x >= vis.x && y >= vis.y && x + w <= vis.x + vis.w && y + hh <= vis.y + vis.h);
    if (!hit(x0, y0)) return { x: x0, y: y0 };
    const step = 32;
    let fallback = null;
    for (let ring = 1; ring < 90; ring++) {
      const cand = [];
      for (let i = -ring; i <= ring; i++) cand.push([i, -ring], [i, ring], [-ring, i], [ring, i]);
      cand.sort((a, b) => Math.hypot(a[0], a[1] * 1.3) - Math.hypot(b[0], b[1] * 1.3));
      for (const [dx, dy] of cand) {
        const x = x0 + dx * step, y = y0 + dy * step;
        if (hit(x, y)) continue;
        if (inVis(x, y)) return { x, y };
        if (!fallback) fallback = { x, y };
      }
      if (fallback && (!vis || ring * step > Math.max(vis.w, vis.h))) return fallback;
    }
    if (fallback) return fallback;
    const bb = bbox(doc.items);
    return { x: bb ? bb.x + bb.w + GAP * 2 : x0, y: bb ? bb.y : y0 };
  }
  function viewCenter() {
    const v = B.doc.view, r = B.vp.getBoundingClientRect();
    return { x: (r.width / 2 - v.x) / v.zoom, y: (r.height / 2 - v.y) / v.zoom };
  }
  function toWorld(cx, cy) {
    const v = B.doc.view, r = B.vp.getBoundingClientRect();
    return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom };
  }

  /* ---------- открытие и закрытие ---------- */
  async function open(taskId) {
    if (!ctx.getTask(taskId)) return;
    if (B && B.taskId === taskId) return;
    if (B) close();
    const doc = await loadDoc(taskId);
    const task = ctx.getTask(taskId); if (!task) return;
    if (B) close();
    ctx.closeMenu();
    B = { taskId, doc, els: new Map(), sel: new Set(), editingId: null, editBefore: null, sub: null, raf: 0, viewTimer: 0, nudgeAt: 0, spaceDown: false, mouse: null, progress: null };
    buildUi(task);
    document.body.append(B.ov);
    B.io = 'IntersectionObserver' in window ? new IntersectionObserver(onIntersect, { root: B.vp, rootMargin: '400px' }) : null;
    if (doc.fresh) { doc.fresh = false; if (doc.items.length) fitAll(false); else centerOrigin(); } else applyView(false);
    renderAll(); paintEmpty(); paintUndo(); paintCtxBar();
    if (!doc.items.length || doc.fresh) { /* view already set */ }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('copy', onCopyEvt, true);
    document.addEventListener('cut', onCutEvt, true);
    window.addEventListener('blur', onWinBlur);
    B.vp.focus({ preventScroll: true });
  }
  function close() {
    if (!B) return;
    if (B.sub && B.subClose) { try { B.subClose(); } catch (_) {} }
    exitEdit();
    const taskId = B.taskId;
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('paste', onPaste, true);
    document.removeEventListener('copy', onCopyEvt, true);
    document.removeEventListener('cut', onCutEvt, true);
    window.removeEventListener('blur', onWinBlur);
    if (B.io) B.io.disconnect();
    cancelAnimationFrame(B.raf);
    B.ov.remove();
    B = null;
    ctx.closeMenu();
    saveNow(taskId);
    ctx.onClosed(taskId);
  }
  const isOpen = () => !!B;
  const openTaskId = () => (B ? B.taskId : null);

  /* ---------- интерфейс ---------- */
  function railBtn(ic, label, run, extra) {
    return h('button', Object.assign({ class: 'bd-rail-btn', type: 'button', 'aria-label': label, title: label, onclick: run }, extra || {}), icon(ic, 20), h('span', {}, label));
  }
  function topTool(ic, label, run, cls) {
    return h('button', { class: 'tool' + (cls ? ' ' + cls : ''), type: 'button', 'aria-label': label, title: label, onclick: run }, icon(ic, 17));
  }
  function buildUi(task) {
    const k = ctx.taskSection(B.taskId) || 'plans';
    B.titleIn = h('input', { class: 'bd-title', type: 'text', maxlength: '500', 'aria-label': 'Название страницы', placeholder: 'Без названия' });
    B.titleIn.value = task.text;
    B.titleIn.addEventListener('input', () => { const v = B.titleIn.value; if (v.trim()) ctx.setTaskText(B.taskId, v); });
    B.titleIn.addEventListener('blur', () => { if (!B) return; if (!B.titleIn.value.trim()) { const t = ctx.getTask(B.taskId); B.titleIn.value = t ? t.text : ''; } });
    B.titleIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); B.vp.focus({ preventScroll: true }); } });
    B.undoBtn = topTool('undo', 'Отменить (Ctrl+Z)', () => undo());
    B.redoBtn = topTool('redo', 'Повторить (Ctrl+Shift+Z)', () => redo());
    B.ctxBar = h('div', { class: 'bd-ctx', role: 'toolbar', 'aria-label': 'Действия с выделенным' });
    const aiBtn = ctx.toggleAi ? topTool('spark', 'Ассистент', () => ctx.toggleAi()) : null;
    B.fileIn = h('input', { type: 'file', multiple: true, accept: ACCEPT, hidden: true, class: 'bd-file', 'aria-hidden': 'true', tabindex: '-1' });
    B.fileIn.addEventListener('change', () => { const f = [...B.fileIn.files]; B.fileIn.value = ''; if (f.length) importFiles(f, null); });

    B.world = h('div', { class: 'bd-world' });
    B.marquee = h('div', { class: 'bd-marquee', hidden: true });
    B.emptyEl = h('div', { class: 'bd-emptyhint' },
      h('div', { class: 'bd-emptyhint-ico' }, icon('board', 30)),
      h('b', {}, 'Доска пока пуста'),
      h('span', {}, 'Дважды щёлкните по холсту, чтобы добавить заметку, перетащите сюда фото и видео или нажмите «Рисовать» и рисуйте прямо здесь.'));
    B.dropHint = h('div', { class: 'bd-drophint', hidden: true }, h('span', {}, icon('image', 18), 'Отпустите, чтобы добавить на доску'));
    B.progEl = h('div', { class: 'bd-progress', hidden: true, role: 'status', 'aria-live': 'polite' }, h('span', { class: 'bd-progress-t' }), h('div', { class: 'bar' }, h('i')));
    B.zoomLbl = h('button', { class: 'bd-zoom-lbl', type: 'button', title: 'Масштаб 100% (Shift+0)', 'aria-label': 'Масштаб 100%', onclick: () => zoomTo(1) }, '100%');
    const zoom = h('div', { class: 'bd-zoom', role: 'group', 'aria-label': 'Масштаб' },
      h('button', { type: 'button', class: 'bd-zb', 'aria-label': 'Уменьшить (−)', title: 'Уменьшить (−)', onclick: () => zoomStep(1 / 1.25) }, icon('minus', 16)),
      B.zoomLbl,
      h('button', { type: 'button', class: 'bd-zb', 'aria-label': 'Увеличить (+)', title: 'Увеличить (+)', onclick: () => zoomStep(1.25) }, icon('plus', 16)),
      h('span', { class: 'bd-zsep' }),
      h('button', { type: 'button', class: 'bd-zb', 'aria-label': 'Показать всё (Shift+1)', title: 'Показать всё (Shift+1)', onclick: () => fitAll(true) }, icon('fit', 16)));
    B.inkLive = svgEl('svg', { class: 'bd-ink-live', 'aria-hidden': 'true' });
    B.world.append(B.inkLive);
    B.inkBar = h('div', { class: 'bd-inkbar', role: 'toolbar', 'aria-label': 'Рисование', hidden: true });
    B.vp = h('div', { class: 'bd-vp', tabindex: '0', role: 'application', 'aria-label': 'Холст доски. Двойной щелчок — новая заметка.', 'aria-roledescription': 'холст' },
      B.world, B.marquee, B.emptyEl, B.dropHint, B.progEl, zoom, B.inkBar);
    B.drawBtn = railBtn('pen', 'Рисовать', () => toggleDraw(), { 'aria-pressed': 'false', title: 'Рисовать от руки прямо на доске (P)' });
    const rail = h('nav', { class: 'bd-rail', 'aria-label': 'Добавить на доску' },
      railBtn('note', 'Заметка', () => addNoteAt(null, '', true)),
      railBtn('todo', 'Чек-лист', () => addChecklistAt(null)),
      B.drawBtn,
      railBtn('image', 'Фото / видео', () => { if (!M) { toast('Фото и видео можно добавлять в настольной версии приложения.'); return; } B.fileIn.click(); }),
      railBtn('brush', 'Зарисовка', () => newSketch()),
      railBtn('link', 'Ссылка', () => addLinkDraft()),
      B.fileIn);
    B.sheet = h('div', { class: 'bd-sheet', 'data-key': k, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Доска страницы' },
      h('header', { class: 'bd-top' },
        h('span', { class: 'bd-crumb' }, icon('board', 16), ctx.sectionTitle(k)),
        B.titleIn,
        B.ctxBar,
        h('div', { class: 'bd-top-tools' }, B.undoBtn, B.redoBtn, h('span', { class: 'bd-tsep' }), aiBtn, topTool('x', 'Закрыть доску (Esc)', () => close()))),
      h('div', { class: 'bd-main' }, rail, B.vp),
      h('footer', { class: 'bd-foot' },
        h('span', {}, 'Двойной щелчок — заметка · ', h('kbd', {}, 'P'), ' — рисовать · ', h('kbd', {}, 'Shift'), '+перетаскивание — выделение · ', h('kbd', {}, 'Ctrl'), '+колесо — масштаб'),
        h('span', {}, h('kbd', {}, 'Ctrl+Z'), ' отмена · ', h('kbd', {}, 'Ctrl+D'), ' копия · ', h('kbd', {}, 'Del'), ' удалить')));
    B.ov = h('div', { class: 'bd-ov' }, B.sheet);
    B.ov.addEventListener('mousedown', e => { if (e.target === B.ov) close(); });

    const vp = B.vp;
    vp.addEventListener('pointerdown', onPointerDown);
    vp.addEventListener('dblclick', onDblClick);
    vp.addEventListener('wheel', onWheel, { passive: false });
    vp.addEventListener('contextmenu', onContextMenu);
    vp.addEventListener('pointermove', e => { if (B) B.mouse = { cx: e.clientX, cy: e.clientY }; });
    vp.addEventListener('pointerleave', () => { if (B) B.mouse = null; });
    vp.addEventListener('scroll', () => { vp.scrollTop = 0; vp.scrollLeft = 0; });
    vp.addEventListener('click', onCardClickButtons);
    vp.addEventListener('focusin', e => {
      const card = e.target.closest && e.target.closest('.bd-card');
      if (card && e.target === card && !B.pointerFocus && !B.sel.has(card.dataset.id)) { B.sel = new Set([card.dataset.id]); paintSel(); }
    });
    vp.addEventListener('dragenter', onDragOver);
    vp.addEventListener('dragover', onDragOver);
    vp.addEventListener('dragleave', e => { if (!vp.contains(e.relatedTarget)) B.dropHint.hidden = true; });
    vp.addEventListener('drop', onDrop);
    if ('ResizeObserver' in window) new ResizeObserver(() => { if (B) applyView(false); }).observe(vp);
  }

  function paintUndo() {
    if (!B) return; const H = hist(B.taskId);
    B.undoBtn.disabled = !H.undo.length; B.redoBtn.disabled = !H.redo.length;
  }
  function paintEmpty() { if (B) B.emptyEl.hidden = B.doc.items.length > 0; }

  /* ---------- вид: перемещение и масштаб ---------- */
  function applyView(save = true) {
    if (!B) return;
    const v = B.doc.view;
    B.world.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.zoom + ')';
    B.world.style.setProperty('--iz', String(1 / v.zoom));
    const g = GRID * v.zoom;
    B.vp.style.backgroundSize = g + 'px ' + g + 'px';
    B.vp.style.backgroundPosition = v.x + 'px ' + v.y + 'px';
    B.vp.classList.toggle('bd-nogrid', v.zoom < 0.3);
    B.zoomLbl.textContent = Math.round(v.zoom * 100) + '%';
    if (save) { clearTimeout(B.viewTimer); const t = B.taskId; B.viewTimer = setTimeout(() => scheduleSave(t, 0), 700); }
  }
  function scheduleView() {
    if (!B || B.raf) return;
    B.raf = requestAnimationFrame(() => { if (!B) return; B.raf = 0; applyView(); });
  }
  function zoomAround(z, px, py) {
    const v = B.doc.view, z1 = clampN(z, ZMIN, ZMAX);
    v.x = px - (px - v.x) * (z1 / v.zoom); v.y = py - (py - v.y) * (z1 / v.zoom); v.zoom = z1;
    scheduleView();
  }
  function zoomStep(f) { const r = B.vp.getBoundingClientRect(); zoomAround(B.doc.view.zoom * f, r.width / 2, r.height / 2); }
  function zoomTo(z) { const r = B.vp.getBoundingClientRect(); zoomAround(z, r.width / 2, r.height / 2); }
  function centerOrigin() { const r = B.vp.getBoundingClientRect(); B.doc.view = { x: Math.round(r.width / 2), y: Math.round(r.height / 2.4), zoom: 1 }; applyView(false); }
  function fitAll(save) {
    if (!B) return;
    const bb = bbox(B.doc.items);
    if (!bb) { centerOrigin(); return; }
    const r = B.vp.getBoundingClientRect(), pad = 70;
    const z = clampN(Math.min((r.width - pad * 2) / Math.max(bb.w, 1), (r.height - pad * 2) / Math.max(bb.h, 1), 1), ZMIN, ZMAX);
    B.doc.view = { x: Math.round(r.width / 2 - (bb.x + bb.w / 2) * z), y: Math.round(r.height / 2 - (bb.y + bb.h / 2) * z), zoom: z };
    applyView(save !== false);
  }
  function onWheel(e) {
    if (!B || B.sub) return;
    if (e.target.closest && e.target.closest('video, .bd-ta, .bd-cl.editing')) { if (!(e.ctrlKey || e.metaKey)) return; }
    e.preventDefault();
    const v = B.doc.view, unit = e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || e.metaKey) {
      const r = B.vp.getBoundingClientRect();
      zoomAround(v.zoom * Math.exp(-e.deltaY * unit * 0.0022), e.clientX - r.left, e.clientY - r.top);
    } else {
      v.x -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit;
      v.y -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit;
      scheduleView();
    }
  }

  /* ---------- отрисовка карточек ---------- */
  function sigOf(it) { const { x, y, w, h: _h, z, ...rest } = it; return JSON.stringify(rest); }
  function renderAll() {
    if (!B) return;
    const alive = new Set();
    for (const it of B.doc.items) {
      alive.add(it.id);
      let el = B.els.get(it.id);
      if (!el) { el = buildCard(it); B.els.set(it.id, el); B.world.append(el); }
      else if (el._sig !== sigOf(it) && B.editingId !== it.id) fillCard(el, it);
      place(el, it);
      if (it.type === 'link' && B.editingId !== it.id && wantPreview(it)) fetchPreview(it);
    }
    for (const [id, el] of B.els) if (!alive.has(id)) { el.remove(); B.els.delete(id); }
    paintSel();
  }
  function place(el, it) {
    el.style.transform = 'translate(' + it.x + 'px,' + it.y + 'px)';
    el.style.width = it.w + 'px';
    el.style.zIndex = String(it.z);
    if (isMediaType(it.type)) { const m = el.querySelector('.bd-media'); if (m) m.style.height = it.h + 'px'; el.style.minHeight = ''; }
    else if (it.type === 'ink') { el.style.height = it.h + 'px'; el.style.minHeight = ''; }
    else el.style.minHeight = it.h + 'px';
  }
  function buildCard(it) {
    const el = h('div', { class: 'bd-card', 'data-id': it.id, tabindex: '0', role: 'group' });
    fillCard(el, it);
    return el;
  }
  function fillCard(el, it) {
    const editing = B && B.editingId === it.id;
    el.className = 'bd-card t-' + it.type + (editing ? ' editing' : '');
    el.dataset.color = it.color || '';
    el.setAttribute('aria-label', TYPE_NAMES[it.type] + (it.type === 'note' && it.text ? ': ' + it.text.slice(0, 60) : it.type === 'checklist' && it.title ? ': ' + it.title : it.name ? ': ' + it.name : ''));
    el._sig = sigOf(it);
    const kids = [];
    if (it.type === 'note') kids.push(editing ? noteEditor(it) : noteView(it));
    else if (it.type === 'checklist') kids.push(editing ? checklistEditor(it) : checklistView(it));
    else if (it.type === 'link') kids.push(editing ? linkEditor(it) : linkView(it));
    else if (it.type === 'ink') kids.push(inkView(it));
    else {
      kids.push(it.type === 'image' ? imageView(it) : it.type === 'video' ? videoView(it) : sketchView(it));
      if (editing) kids.push(captionEditor(it));
      else if (it.caption) kids.push(h('div', { class: 'bd-cap' }, it.caption));
    }
    kids.push(h('button', { class: 'bd-more', type: 'button', tabindex: '-1', 'aria-label': 'Действия с карточкой', title: 'Действия' }, icon('more', 15)));
    kids.push(h('div', { class: 'bd-rs', 'aria-hidden': 'true', title: 'Потяните, чтобы изменить размер' }));
    el.replaceChildren(...kids);
    if (B && B.io) el.querySelectorAll('img[data-src]').forEach(img => B.io.observe(img));
    else el.querySelectorAll('img[data-src]').forEach(img => { img.src = img.dataset.src; });
  }
  function onIntersect(entries) {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const img = en.target;
      if (img.dataset.src) { img.src = img.dataset.src; img.removeAttribute('data-src'); }
      B && B.io && B.io.unobserve(img);
    }
  }

  // Рисунок от руки: SVG в координатах самого рисунка (vw×vh), растягивается до размера карточки.
  // Щёлкнуть по рисунку можно только по линиям (невидимая широкая «линия попадания»), сквозь пустоту — карточки под ним.
  const SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function inkView(it) {
    const sv = svgEl('svg', { class: 'bd-ink', viewBox: '0 0 ' + it.vw + ' ' + it.vh, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const k = it.w / it.vw;
    for (const s of it.strokes) {
      const d = inkPath(s.p);
      sv.append(svgEl('path', { class: 'bd-ink-hit', d, 'stroke-width': String(Math.max(s.w, 12 / k)) }),
        svgEl('path', { class: 'bd-ink-p ink-c-' + s.c + (s.m ? ' marker' : ''), d, 'stroke-width': String(s.w) }));
    }
    return sv;
  }
  function noteView(it) {
    const v = h('div', { class: 'bd-note' });
    if (it.text.trim()) renderNote(v, it.text, h, icon); else v.append(h('div', { class: 'bd-ph' }, 'Пустая заметка'));
    return v;
  }
  function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  function noteEditor(it) {
    const ta = h('textarea', { class: 'bd-ta', 'aria-label': 'Текст заметки', placeholder: 'Текст заметки… (**жирный**, «- » список, «[ ] » чекбокс)', spellcheck: 'false' });
    ta.value = it.text;
    ta.addEventListener('input', () => { it.text = ta.value.slice(0, 20000); autoGrow(ta); scheduleSave(B.taskId); });
    ta.addEventListener('keydown', e => noteKeys(e, ta, it));
    requestAnimationFrame(() => autoGrow(ta));
    return h('div', { class: 'bd-note editing' }, ta);
  }
  function noteKeys(e, ta, it) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyB') { e.preventDefault(); fmt('bold'); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !mod) {
      const pos = ta.selectionStart, start = ta.value.lastIndexOf('\n', pos - 1) + 1, line = ta.value.slice(start, pos);
      const m = line.match(/^(\s*)(\[( |x|X)?\]\s|[-*•]\s+)/);
      if (m) {
        e.preventDefault();
        if (line.trim() === m[0].trim()) { ta.setRangeText('', start, pos, 'end'); }
        else ta.setRangeText('\n' + m[1] + (m[2].startsWith('[') ? '[ ] ' : '- '), pos, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input'));
      }
    }
    if (mod && e.key === 'Enter') { e.preventDefault(); exitEdit(); }
  }
  // Форматирование выделенных строк заметки
  function fmt(kind) {
    const it = B && itemById(B.editingId); if (!it || it.type !== 'note') return;
    const ta = B.els.get(it.id).querySelector('.bd-ta'); if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
    if (kind === 'bold') {
      const sel = v.slice(s, e);
      if (/^\*\*[\s\S]*\*\*$/.test(sel) && sel.length >= 4) ta.setRangeText(sel.slice(2, -2), s, e, 'select');
      else if (sel) ta.setRangeText('**' + sel + '**', s, e, 'select');
      else { ta.setRangeText('****', s, e, 'end'); ta.setSelectionRange(s + 2, s + 2); }
    } else {
      const ls = v.lastIndexOf('\n', s - 1) + 1; let le = v.indexOf('\n', e); if (le < 0) le = v.length;
      const lines = v.slice(ls, le).split('\n');
      const re = kind === 'list' ? /^(\s*)[-*•]\s+/ : /^(\s*)(?:[-*]\s+)?\[( |x|X)?\]\s?/;
      const all = lines.every(l => re.test(l));
      const out = lines.map(l => all ? l.replace(re, '$1') : (kind === 'list' ? '- ' : '[ ] ') + l.replace(/^(\s*)([-*•]\s+|(?:[-*]\s+)?\[( |x|X)?\]\s?)/, '$1'));
      ta.setRangeText(out.join('\n'), ls, le, 'end');
    }
    ta.focus(); ta.dispatchEvent(new Event('input'));
  }

  function checklistView(it) {
    const done = it.items.filter(x => x.done).length, n = it.items.length;
    return h('div', { class: 'bd-cl' },
      h('div', { class: 'bd-cl-title' + (it.title ? '' : ' ph') }, it.title || 'Чек-лист'),
      n ? h('div', { class: 'bd-cl-prog' }, h('div', { class: 'bar' }, h('i', { style: 'width:' + (done / n * 100) + '%' })), h('span', {}, done + '/' + n)) : null,
      h('div', { class: 'bd-cl-rows' }, n ? it.items.map(x => h('div', { class: 'bd-cl-row' + (x.done ? ' done' : ''), 'data-iid': x.id },
        h('span', { class: 'bd-cbx', role: 'checkbox', 'aria-checked': String(x.done), 'aria-label': 'Выполнено: ' + x.text, 'data-iid': x.id }, icon('check', 11)),
        h('span', { class: 'bd-cl-text' }, x.text || ' '))) : h('div', { class: 'bd-ph' }, 'Нет пунктов')));
  }
  function checklistEditor(it) {
    const title = h('input', { class: 'bd-cl-title-in', type: 'text', placeholder: 'Название списка', 'aria-label': 'Название чек-листа', maxlength: '300' });
    title.value = it.title;
    const rows = h('div', { class: 'bd-cl-rows' });
    const save = () => scheduleSave(B.taskId);
    const rowEl = x => {
      const inp = h('input', { class: 'bd-cl-in', type: 'text', placeholder: 'Пункт', 'aria-label': 'Пункт списка', maxlength: '2000' }); inp.value = x.text;
      const r = h('div', { class: 'bd-cl-row' + (x.done ? ' done' : ''), 'data-iid': x.id },
        h('span', { class: 'bd-cbx', role: 'checkbox', tabindex: '0', 'aria-checked': String(x.done), 'aria-label': 'Выполнено', 'data-iid': x.id }, icon('check', 11)),
        inp,
        h('button', { class: 'bd-cl-del', type: 'button', 'aria-label': 'Удалить пункт', title: 'Удалить пункт', onclick: () => { removeRow(x.id, false); } }, icon('x', 13)));
      inp.addEventListener('input', () => { x.text = inp.value; save(); });
      inp.addEventListener('keydown', e => {
        if (e.isComposing) return;
        const idx = it.items.indexOf(x);
        if (e.key === 'Enter') { e.preventDefault(); addRow(idx + 1, inp.value.slice(inp.selectionEnd)); if (inp.selectionEnd < inp.value.length) { x.text = inp.value.slice(0, inp.selectionStart); inp.value = x.text; } }
        else if (e.key === 'Backspace' && !inp.value && it.items.length) { e.preventDefault(); removeRow(x.id, true); }
        else if (e.key === 'ArrowUp' && idx > 0) { e.preventDefault(); focusRow(idx - 1); }
        else if (e.key === 'ArrowDown' && idx < it.items.length - 1) { e.preventDefault(); focusRow(idx + 1); }
      });
      return r;
    };
    const focusRow = (i, end) => { const r = rows.children[i]; const inp = r && r.querySelector('.bd-cl-in'); if (inp) { inp.focus(); const p = end === false ? 0 : inp.value.length; inp.setSelectionRange(p, p); } };
    const addRow = (i, text) => { const x = { id: rid(), text: text || '', done: false }; it.items.splice(i, 0, x); rows.insertBefore(rowEl(x), rows.children[i] || null); save(); focusRow(i, false); };
    const removeRow = (id, focusPrev) => {
      const i = it.items.findIndex(x => x.id === id); if (i < 0) return;
      it.items.splice(i, 1); rows.children[i].remove(); save();
      if (focusPrev) { if (i > 0) focusRow(i - 1); else title.focus(); }
    };
    it.items.forEach(x => rows.append(rowEl(x)));
    title.addEventListener('input', () => { it.title = title.value; save(); });
    title.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (it.items.length) focusRow(0); else addRow(0, ''); } });
    rows.addEventListener('click', e => {
      const cb = e.target.closest('.bd-cbx'); if (!cb) return;
      const x = it.items.find(y => y.id === cb.dataset.iid); if (!x) return;
      x.done = !x.done; cb.setAttribute('aria-checked', String(x.done)); cb.parentElement.classList.toggle('done', x.done); save();
    });
    rows.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && e.target.classList.contains('bd-cbx')) { e.preventDefault(); e.target.click(); } });
    const add = h('button', { class: 'bd-cl-add', type: 'button', onclick: () => addRow(it.items.length, '') }, icon('plus', 14), 'Пункт');
    return h('div', { class: 'bd-cl editing' }, title, rows, add);
  }

  function linkView(it) {
    const title = it.title || it.ptitle;
    const loading = !it.pv && E && E.linkPreview;
    const head = h('div', { class: 'bd-link-head' },
      h('span', { class: 'bd-link-ico' }, icon(it.kind === 'video' ? 'video' : 'globe', 16)),
      h('span', { class: 'bd-link-site' }, it.site ? it.site + ' · ' + domainOf(it.url) : domainOf(it.url)),
      h('button', { class: 'bd-link-open', type: 'button', 'aria-label': 'Открыть ссылку в браузере', title: 'Открыть в браузере' }, icon('ext', 15)));
    const img = it.image ? h('div', { class: 'bd-link-img' + (it.kind === 'video' ? ' video' : '') },
      lazyImg(it.imgThumb ? thumbUrl(it.image) : mediaUrl(it.image), 'bd-img', title || '', it.imgThumb ? mediaUrl(it.image) : null),
      it.kind === 'video' ? h('span', { class: 'bd-link-play', 'aria-hidden': 'true' }, icon('play', 18)) : null) : null;
    return h('div', { class: 'bd-link' + (it.image ? ' has-img' : '') + (loading ? ' loading' : '') },
      img,
      h('div', { class: 'bd-link-body' },
        head,
        h('b', { class: 'bd-link-title' }, title || domainOf(it.url)),
        it.desc ? h('p', { class: 'bd-link-desc' }, it.desc) : null,
        loading ? h('p', { class: 'bd-link-wait' }, 'Загружаю описание…') : null,
        !title && !it.desc && !loading ? h('span', { class: 'bd-link-url' }, it.url) : null));
  }
  // Описание и превью ссылки загружаются один раз (и при смене адреса); без истории отмены.
  const pvBusy = new Set();
  function linkHeight(it) {
    const imgH = it.image ? Math.round((it.w || 320) * 9 / 16) : 0;
    return imgH + 58 + (it.desc ? 56 : 0) + ((it.title || it.ptitle) ? 18 : 0);
  }
  function wantPreview(it) {
    if (!E || !E.linkPreview || it.type !== 'link' || !it.url || pvBusy.has(it.id)) return false;
    return !it.pv || it.pvUrl !== it.url || (it.pv === 'fail' && Date.now() - (it.pvAt || 0) > 6 * 3600 * 1000);   // неудачу повторяем не чаще раза в 6 часов
  }
  function fetchPreview(it, force) {
    if (!E || !E.linkPreview || !it.url || pvBusy.has(it.id)) return;
    if (!force && !wantPreview(it)) return;
    const id = it.id, url = it.url;
    pvBusy.add(id);
    E.linkPreview(url).then(r => r, () => ({ ok: false })).then(r => {
      pvBusy.delete(id);
      for (const [taskId, d] of docs) {
        const x = d.items.find(y => y.id === id && y.type === 'link');
        if (!x || x.url !== url) continue;
        x.pv = r && r.ok ? 'ok' : 'fail'; x.pvUrl = url; x.pvAt = Date.now();
        if (r && r.ok) {
          x.ptitle = str(r.title, 300); x.desc = str(r.description, 600); x.site = str(r.site, 80);
          if (r.kind) x.kind = r.kind; else delete x.kind;
          if (r.image && mid(r.image.id)) { x.image = r.image.id; x.imgW = r.image.width || 0; x.imgH = r.image.height || 0; x.imgThumb = !!r.image.thumb; }
          else { delete x.image; delete x.imgW; delete x.imgH; delete x.imgThumb; }
        } else if (force) toast('Не удалось загрузить описание ссылки — проверьте интернет или адрес.');
        if (B && B.doc === d) renderAll();
        scheduleSave(taskId);
      }
    });
  }
  function linkEditor(it) {
    const u = h('input', { class: 'bd-in', type: 'url', placeholder: 'https://…', 'aria-label': 'Адрес ссылки', maxlength: '2000' });
    const t = h('input', { class: 'bd-in', type: 'text', placeholder: 'Название (необязательно)', 'aria-label': 'Название ссылки', maxlength: '300' });
    u.value = it.url; t.value = it.title;
    u.addEventListener('input', () => { it._raw = u.value; });
    t.addEventListener('input', () => { it.title = t.value; scheduleSave(B.taskId); });
    [u, t].forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); exitEdit(); } }));
    return h('div', { class: 'bd-link editing' }, h('span', { class: 'bd-link-ico' }, icon('link', 18)), h('div', { class: 'bd-link-form' }, u, t));
  }
  function captionEditor(it) {
    const c = h('input', { class: 'bd-cap-in', type: 'text', placeholder: 'Подпись…', 'aria-label': 'Подпись', maxlength: '2000' });
    c.value = it.caption || '';
    c.addEventListener('input', () => { it.caption = c.value; scheduleSave(B.taskId); });
    c.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); exitEdit(); } });
    return c;
  }
  function lazyImg(src, cls, alt, fallback) {
    const img = h('img', { class: cls, alt: alt || '', draggable: 'false', decoding: 'async', 'data-src': src });
    img.addEventListener('error', () => {
      if (fallback && img.src !== fallback) { img.src = fallback; return; }
      const box = img.closest('.bd-media'); if (box) box.classList.add('missing');
    });
    return img;
  }
  function imageView(it) {
    const box = h('div', { class: 'bd-media bd-imgbox' },
      lazyImg(it.thumb ? thumbUrl(it.mediaId) : mediaUrl(it.mediaId), 'bd-img', it.caption || it.name, it.thumb ? mediaUrl(it.mediaId) : null),
      it.overlay && it.overlay.mediaId ? lazyImg(mediaUrl(it.overlay.mediaId), 'bd-ovl', '') : null,
      h('div', { class: 'bd-missing' }, icon('noimg', 22), h('span', {}, 'Файл не найден')));
    return box;
  }
  function videoView(it) {
    const box = h('div', { class: 'bd-media bd-vid' + (it.thumb ? '' : ' noposter') },
      it.thumb ? lazyImg(thumbUrl(it.mediaId), 'bd-img', it.name) : h('div', { class: 'bd-vid-ph' }, icon('video', 30), h('span', {}, it.name || 'Видео')),
      h('button', { class: 'bd-play', type: 'button', 'aria-label': 'Воспроизвести видео', title: 'Воспроизвести' }, icon('play', 22)),
      it.duration ? h('span', { class: 'bd-dur' }, fmtDur(it.duration)) : null,
      h('div', { class: 'bd-missing' }, icon('noimg', 22), h('span', {}, 'Файл не найден')));
    if (!it.thumb && M && !probed.has(it.mediaId)) {
      probed.add(it.mediaId);
      setTimeout(() => probeVideo(it.mediaId).then(r => {
        if (!r.ok || !B) return;
        for (const d of docs.values()) for (const x of d.items) if (x.type === 'video' && x.mediaId === it.mediaId) {
          x.thumb = !!r.thumb; if (r.duration) x.duration = r.duration; if (r.w) { x.width = r.w; x.height = r.h; }
        }
        renderAll(); scheduleSave(B.taskId);
      }), 300);
    }
    return box;
  }
  function sketchView(it) {
    return h('div', { class: 'bd-media bd-sk', 'data-bg': it.bg },
      it.mediaId ? lazyImg(mediaUrl(it.mediaId), 'bd-img', 'Зарисовка') : h('div', { class: 'bd-ph bd-sk-ph' }, icon('brush', 22), h('span', {}, 'Пустая зарисовка — дважды щёлкните, чтобы рисовать')),
      h('div', { class: 'bd-missing' }, icon('noimg', 22), h('span', {}, 'Файл не найден')));
  }

  // Видео проигрывается прямо в карточке; при неподдерживаемом кодеке — понятное сообщение.
  function playVideo(it) {
    const el = B.els.get(it.id); if (!el) return;
    const box = el.querySelector('.bd-media'); if (!box || box.classList.contains('playing')) return;
    box.classList.add('playing');
    const v = h('video', { class: 'bd-video', controls: true, autoplay: true, playsinline: true, preload: 'auto', src: mediaUrl(it.mediaId) });
    const fail = msg => {
      box.classList.add('failed');
      v.remove();
      box.append(h('div', { class: 'bd-vid-err' },
        h('b', {}, msg),
        h('span', {}, 'Встроенный плеер поддерживает MP4 (H.264), WebM и большинство MOV/MKV. Например, HEVC может не воспроизводиться.'),
        h('button', { class: 'bd-btn', type: 'button', onclick: () => openExternal(it) }, icon('ext', 14), 'Открыть во внешнем плеере')));
    };
    v.addEventListener('error', () => fail('Это видео не удаётся воспроизвести здесь.'));
    v.addEventListener('loadedmetadata', () => { if (!v.videoWidth) fail('Видеодорожка в этом формате не поддерживается.'); });
    box.append(v, h('div', { class: 'bd-grab', title: 'Перетащить' }, icon('grip', 13)));
  }
  async function openExternal(it) {
    if (!M) return;
    const r = await M.openExternal(it.mediaId);
    if (!r || !r.ok) toast((r && r.error) || 'Не удалось открыть файл.');
  }

  /* ---------- выделение и контекстная панель ---------- */
  function paintSel() {
    if (!B) return;
    for (const [id, el] of B.els) el.classList.toggle('sel', B.sel.has(id));
    B.world.classList.toggle('multi', B.sel.size > 1);
    paintCtxBar();
  }
  function selectOnly(id) { B.sel = new Set(id ? [id] : []); paintSel(); }
  function clearSel() { if (B.sel.size) { B.sel.clear(); paintSel(); } }
  function swatches(current, pick) {
    return h('div', { class: 'bd-sw', role: 'radiogroup', 'aria-label': 'Цвет карточки' }, COLORS.map(c => h('button', {
      type: 'button', class: 'bd-sw-b', 'data-color': c, role: 'radio', 'aria-checked': String(current === c), 'aria-label': COLOR_NAMES[c], title: COLOR_NAMES[c],
      onmousedown: e => e.preventDefault(), onclick: () => pick(c)
    })));
  }
  function paintCtxBar() {
    if (!B) return;
    const bar = B.ctxBar; bar.replaceChildren();
    const btn = (ic, label, run) => h('button', { class: 'tool', type: 'button', 'aria-label': label, title: label, onmousedown: e => e.preventDefault(), onclick: run }, icon(ic, 16));
    const editing = B.editingId && itemById(B.editingId);
    if (editing && editing.type === 'note') {
      bar.append(btn('bold', 'Жирный (Ctrl+B)', () => fmt('bold')), btn('list', 'Список', () => fmt('list')), btn('todo', 'Чекбокс', () => fmt('todo')),
        h('span', { class: 'bd-tsep' }), swatches(editing.color, c => { editing.color = c; B.els.get(editing.id).dataset.color = c; scheduleSave(B.taskId); paintCtxBar(); }));
      return;
    }
    if (editing) return;
    const items = selItems(); if (!items.length) return;
    const colorable = items.filter(it => it.type === 'note' || it.type === 'checklist');
    if (colorable.length) {
      const cur = colorable.every(it => it.color === colorable[0].color) ? colorable[0].color : null;
      bar.append(swatches(cur, c => change(() => colorable.forEach(it => { it.color = c; }))), h('span', { class: 'bd-tsep' }));
    }
    if (items.length === 1) {
      const it = items[0];
      if (it.type === 'image' || it.type === 'sketch') bar.append(btn('brush', it.type === 'image' ? 'Нарисовать поверх' : 'Редактировать зарисовку', () => it.type === 'image' ? drawOver(it) : editSketch(it)));
      if (it.type === 'image') bar.append(btn('eye', 'Открыть просмотр', () => openViewer(it)));
    }
    bar.append(btn('front', 'На передний план', () => toFront()), btn('back', 'На задний план', () => toBack()),
      btn('dup', 'Дублировать (Ctrl+D)', () => duplicate()), btn('trash', 'Удалить (Delete)', () => deleteSel()));
  }

  /* ---------- редактирование текста ---------- */
  function enterEdit(id, opts = {}) {
    if (!B) return;
    const it = itemById(id); if (!it) return;
    if (B.editingId === id) return;
    exitEdit();
    B.editingId = id; B.editBefore = snap();
    selectOnly(id);
    const el = B.els.get(id); if (!el) return;
    fillCard(el, it); place(el, it);
    const f = el.querySelector(opts.focus || (it.type === 'checklist' ? (it.items.length && !opts.title ? '.bd-cl-in' : '.bd-cl-title-in') : it.type === 'link' ? '.bd-in' : it.type === 'note' ? '.bd-ta' : '.bd-cap-in'));
    if (f) { f.focus({ preventScroll: true }); const p = f.value.length; try { f.setSelectionRange(p, p); } catch (_) {} }
    el.addEventListener('focusout', onEditFocusOut);
    paintCtxBar();
  }
  function onEditFocusOut(e) {
    const el = e.currentTarget;
    setTimeout(() => {
      if (!B || !B.editingId || el.dataset.id !== B.editingId) return;
      const a = document.activeElement;
      if (a && (el.contains(a) || B.ctxBar.contains(a))) return;
      if (B.sub) return;
      exitEdit();
    }, 0);
  }
  function syncEditing() {
    const it = B && itemById(B.editingId); if (!it) return;
    if (it.type === 'link' && it._raw != null) { const u = safeUrl(it._raw); if (u) it.url = u; }
  }
  function exitEdit() {
    if (!B || !B.editingId) return;
    const id = B.editingId, before = B.editBefore;
    const it = itemById(id);
    B.editingId = null; B.editBefore = null;
    const el = B.els.get(id);
    if (el) el.removeEventListener('focusout', onEditFocusOut);
    if (it) {
      if (it.type === 'link') {
        if (it._raw != null) { const u = safeUrl(it._raw); if (u) it.url = u; else if (it._raw.trim()) toast('Это не похоже на адрес сайта. Нужна ссылка вида https://…'); }
        delete it._raw; delete it._draft;
        if (!it.url) B.doc.items.splice(B.doc.items.indexOf(it), 1);
        else if (it.pvUrl !== it.url) { delete it.pv; fetchPreview(it); }
      }
      if (it.type === 'checklist') it.items = it.items.filter(x => x.text.trim() || x.done);
      if (el && itemById(id)) fillCard(el, it);
    }
    if (before !== snap()) pushHistory(before);
    renderAll(); scheduleSave(B.taskId); paintCtxBar(); paintEmpty();
    if (el && el.isConnected) el.focus({ preventScroll: true });
  }

  /* ---------- создание карточек ---------- */
  function addItems(items, opts = {}) {
    if (!B) return;
    let z = maxZ();
    items.forEach(it => { it.z = ++z; });
    change(() => B.doc.items.push(...items));
    B.sel = new Set(items.map(it => it.id)); paintSel();
    if (opts.edit && items[0]) enterEdit(items[0].id, opts);
    if (opts.reveal !== false) revealItems(items);
  }
  // Если новые карточки вне экрана — плавно сдвигаем вид к ним.
  function revealItems(items) {
    const bb = bbox(items); if (!bb) return;
    const v = B.doc.view, r = B.vp.getBoundingClientRect();
    const sx = bb.x * v.zoom + v.x, sy = bb.y * v.zoom + v.y, sw = bb.w * v.zoom, sh = bb.h * v.zoom;
    if (sx >= 0 && sy >= 0 && sx + sw <= r.width && sy + sh <= r.height) return;
    if (sw > r.width - 40 || sh > r.height - 40) { fitAll(true); return; }
    v.x += r.width / 2 - (sx + sw / 2); v.y += r.height / 2 - (sy + sh / 2);
    applyView();
  }
  function spot(w, hh, at) {
    if (at) return { x: Math.round(at.x - Math.min(w / 2, 40)), y: Math.round(at.y - 20) };
    const c = viewCenter();
    return findFree(B.doc, w, hh, c.x, c.y);
  }
  function makeNote(text, color) { return { id: rid(), type: 'note', x: 0, y: 0, w: 240, h: 72, z: 0, text: str(text, 20000), color: color || '' }; }
  function makeChecklist(title, rows) { return { id: rid(), type: 'checklist', x: 0, y: 0, w: 260, h: 90, z: 0, title: str(title, 300), color: '', items: (rows || []).map(r => ({ id: rid(), text: str(r.text, 2000), done: !!r.done })) }; }
  function addNoteAt(at, text, edit) {
    const it = makeNote(text);
    const p = spot(it.w, 90, at); it.x = p.x; it.y = p.y;
    addItems([it], { edit });
    return it;
  }
  function addChecklistAt(at) {
    const it = makeChecklist('', [{ text: '' }]);
    const p = spot(it.w, 120, at); it.x = p.x; it.y = p.y;
    addItems([it], { edit: true, title: true });
  }
  function addLinkDraft(at) {
    const it = { id: rid(), type: 'link', x: 0, y: 0, w: 320, h: 60, z: 0, url: '', title: '', _draft: true };
    const p = spot(it.w, 70, at); it.x = p.x; it.y = p.y;
    exitEdit();
    let z = maxZ(); it.z = z + 1;
    const before = snap();
    B.doc.items.push(it); renderAll(); paintEmpty();
    B.editingId = null;
    enterEdit(it.id);
    B.editBefore = before;
  }
  function addLinks(urls, at) {
    const items = urls.slice(0, 50).map(u => ({ id: rid(), type: 'link', x: 0, y: 0, w: 320, h: 60, z: 0, url: safeUrl(u), title: '' })).filter(it => it.url);
    if (!items.length) return;
    layout(items, at);
    addItems(items);
  }
  // Раскладка нескольких карточек сеткой без наложений: вокруг точки или в свободном месте.
  function layout(items, at) {
    const n = items.length, cols = Math.ceil(Math.sqrt(n));
    const hOf = it => isMediaType(it.type) ? it.h + 34 : it.type === 'link' ? linkHeight(it) : it.h + 20;    // у медиа — запас под подпись
    const colW = Math.max(...items.map(it => it.w));
    let y = 0;
    for (let r = 0; r * cols < n; r++) {
      const row = items.slice(r * cols, r * cols + cols);
      const rh = Math.max(...row.map(hOf));
      row.forEach((it, c) => { it.x = c * (colW + GAP) + Math.round((colW - it.w) / 2); it.y = y + Math.round((rh - hOf(it)) / 2); });
      y += rh + GAP;
    }
    const bw = Math.min(cols, n) * (colW + GAP) - GAP, bh = y - GAP;
    let o;
    if (at) o = { x: at.x - bw / 2, y: at.y - bh / 2 };
    else { const c = viewCenter(); o = findFree(B.doc, bw, bh, c.x, c.y); }
    items.forEach(it => { it.x = Math.round(it.x + o.x); it.y = Math.round(it.y + o.y); });
  }

  /* ---------- файлы ---------- */
  async function prepImage(meta) {
    let w = meta.width, hh = meta.height, thumb = !!meta.thumb;
    try {
      if (!w || !hh || meta.needsThumb) {
        const img = await loadImg(mediaUrl(meta.id));
        w = img.naturalWidth || 400; hh = img.naturalHeight || 300;
        if (meta.ext === 'svg' && (!img.naturalWidth || !img.naturalHeight)) { w = 400; hh = 300; }
        if (meta.needsThumb && Math.max(w, hh) > 512 && meta.ext !== 'gif' && meta.ext !== 'svg' && M) {
          const k = 512 / Math.max(w, hh), c = document.createElement('canvas');
          c.width = Math.round(w * k); c.height = Math.round(hh * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const b = await toBlob(c, 'image/webp', 0.86);
          if (b) thumb = !!(await M.putThumb(meta.id, 'webp', await blobBytes(b)));
        }
      }
    } catch (_) { w = w || 400; hh = hh || 300; }
    return { w, h: hh, thumb };
  }
  function probeVideo(id) {
    return new Promise(resolve => {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.playsInline = true;
      let done = false, seekTm = 0;
      const fin = r => { if (done) return; done = true; clearTimeout(tm); clearTimeout(seekTm); try { v.removeAttribute('src'); v.load(); } catch (_) {} resolve(r); };
      const tm = setTimeout(() => fin({ ok: false }), 15000);
      const dur = () => (isFinite(v.duration) ? v.duration : 0);
      const grab = async () => {
        if (done) return;
        try {
          const W = v.videoWidth, H = v.videoHeight, k = Math.min(1, 512 / Math.max(W, H));
          const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          const b = await toBlob(c, 'image/jpeg', 0.85);
          const thumb = !!(b && M && await M.putThumb(id, 'jpg', await blobBytes(b)));
          fin({ ok: true, w: W, h: H, duration: dur(), thumb });
        } catch (_) { fin({ ok: true, w: v.videoWidth, h: v.videoHeight, duration: dur(), thumb: false }); }
      };
      v.addEventListener('error', () => fin({ ok: false }));
      v.addEventListener('loadeddata', () => {
        if (!v.videoWidth) { fin({ ok: false }); return; }
        const d = dur(), t = d ? Math.min(1, d * 0.2) : 0;
        if (t > 0.04) { v.addEventListener('seeked', grab, { once: true }); seekTm = setTimeout(grab, 3000); v.currentTime = t; }
        else grab();
      }, { once: true });
      v.src = mediaUrl(id);
    });
  }
  async function itemFromMeta(meta) {
    if (meta.kind === 'image') {
      const d = await prepImage(meta);
      const s = fitBox(d.w, d.h, 320);
      return { id: rid(), type: 'image', x: 0, y: 0, w: s.w, h: s.h, z: 0, mediaId: meta.id, name: meta.name, mime: meta.mime, size: meta.size, width: d.w, height: d.h, caption: '', thumb: d.thumb };
    }
    probed.add(meta.id);
    const r = await probeVideo(meta.id);
    const s = fitBox(r.w || 640, r.h || 360, 360);
    return { id: rid(), type: 'video', x: 0, y: 0, w: s.w, h: s.h, z: 0, mediaId: meta.id, name: meta.name, mime: meta.mime, size: meta.size, width: r.w || 0, height: r.h || 0, duration: r.duration || 0, caption: '', thumb: !!r.thumb };
  }
  function paintProgress(p) {
    if (!B) return;
    const pct = p.total ? Math.min(100, Math.round(p.loaded / p.total * 100)) : 0;
    B.progEl.hidden = false;
    B.progEl.querySelector('.bd-progress-t').textContent = 'Копирую «' + p.name + '» — ' + pct + '%';
    B.progEl.querySelector('i').style.width = pct + '%';
  }
  async function importFiles(files, at) {
    if (!B) return;
    if (!M) { toast('Фото и видео можно добавлять в настольной версии приложения.'); return; }
    const list = [...files].slice(0, 200); if (!list.length) return;
    const taskId = B.taskId, token = rid();
    B.progress = { token };
    const total = list.reduce((s, f) => s + (f.size || 0), 0);
    if (list.length > 3 || total > 20 * 1048576) { B.progEl.hidden = false; B.progEl.querySelector('.bd-progress-t').textContent = 'Добавляю файлы: ' + list.length + '…'; B.progEl.querySelector('i').style.width = '0%'; }
    let res;
    try { res = await M.importFiles(list, token); }
    catch (_) { res = list.map(f => ({ ok: false, error: 'Не удалось добавить файл «' + f.name + '».' })); }
    const errs = res.filter(r => !r.ok).map(r => r.error);
    const items = [];
    for (const r of res) if (r.ok) { try { items.push(await itemFromMeta(r.meta)); } catch (_) { errs.push('Не удалось подготовить «' + r.meta.name + '».'); } }
    if (B && B.taskId === taskId) { B.progEl.hidden = true; B.progress = null; }
    if (errs.length) toast(errs[0] + (errs.length > 1 ? ' Ещё ошибок: ' + (errs.length - 1) + '.' : ''));
    if (!items.length) return;
    if (!B || B.taskId !== taskId) {           // доску закрыли, пока копировались файлы
      const doc = await loadDoc(taskId); let z = doc.items.reduce((m, it) => Math.max(m, it.z), 0);
      items.forEach((it, i) => { const p = findFree(doc, it.w, it.h, 0, 0); it.x = p.x; it.y = p.y + i; it.z = ++z; doc.items.push(it); });
      scheduleSave(taskId);
      return;
    }
    layout(items, at);
    addItems(items);
  }
  async function importBlobs(blobs, at) {
    if (!M) { toast('Вставка изображений доступна в настольной версии приложения.'); return; }
    const files = blobs.map((b, i) => b instanceof File ? b : new File([b], 'image-' + (i + 1) + '.' + ((b.type || 'image/png').split('/')[1] || 'png').replace('jpeg', 'jpg'), { type: b.type }));
    await importFiles(files, at);
  }

  /* ---------- указатель: выделение, перемещение, масштаб, рамка ---------- */
  function onPointerDown(e) {
    if (!B || B.sub) return;
    B.pointerFocus = true; setTimeout(() => { if (B) B.pointerFocus = false; }, 0);
    const vp = B.vp;
    if (e.button === 1 || (e.button === 0 && B.spaceDown)) { e.preventDefault(); startPan(e, false); return; }
    if (e.button !== 0) return;
    if (B.draw && !e.target.closest('.bd-zoom, .bd-progress, .bd-inkbar')) {      // режим рисования: перо, маркер, ластик
      e.preventDefault(); vp.focus({ preventScroll: true }); exitEdit();
      if (B.draw.tool === 'eraser') startErase(e); else startInk(e);
      return;
    }
    const card = e.target.closest('.bd-card');
    if (!card) {
      if (e.target.closest('.bd-zoom, .bd-progress, .bd-inkbar')) return;
      if (!isTyping(e.target)) { e.preventDefault(); vp.focus({ preventScroll: true }); }
      if (e.shiftKey || e.ctrlKey || e.metaKey) startMarquee(e, e.shiftKey);
      else startPan(e, true);
      return;
    }
    const id = card.dataset.id, it = itemById(id); if (!it) return;
    if (e.target.closest('.bd-rs')) { e.preventDefault(); if (!B.sel.has(id)) selectOnly(id); startResize(e, it); return; }
    if (B.editingId === id && !e.target.closest('.bd-grab')) return;            // в режиме правки — обычный текстовый ввод
    if (e.target.closest('video')) { if (!B.sel.has(id)) selectOnly(id); return; }
    if (e.target.closest('button') && !e.target.closest('.bd-grab')) { if (!B.sel.has(id) && !e.shiftKey) selectOnly(id); return; }
    if (B.editingId && B.editingId !== id) exitEdit();
    e.preventDefault();
    card.focus({ preventScroll: true });
    const wasSel = B.sel.has(id) && B.sel.size === 1;
    if (e.shiftKey) { if (B.sel.has(id)) B.sel.delete(id); else B.sel.add(id); paintSel(); if (!B.sel.has(id)) return; }
    else if (!B.sel.has(id)) selectOnly(id);
    startDrag(e, card, it, wasSel);
  }
  function capture(e, onMove, onUp) {
    const vp = B.vp, pid = e.pointerId;
    try { vp.setPointerCapture(pid); } catch (_) {}
    const move = ev => { if (ev.pointerId === pid) onMove(ev); };
    const up = ev => {
      if (ev.pointerId !== pid) return;
      vp.removeEventListener('pointermove', move); vp.removeEventListener('pointerup', up); vp.removeEventListener('pointercancel', up);
      try { vp.releasePointerCapture(pid); } catch (_) {}
      onUp(ev, ev.type === 'pointercancel');
    };
    vp.addEventListener('pointermove', move); vp.addEventListener('pointerup', up); vp.addEventListener('pointercancel', up);
  }
  function startPan(e, clickClears) {
    const v = B.doc.view, sx = e.clientX, sy = e.clientY, vx = v.x, vy = v.y;
    let moved = false;
    B.vp.classList.add('bd-panning');
    capture(e, ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      moved = true; v.x = vx + ev.clientX - sx; v.y = vy + ev.clientY - sy; scheduleView();
    }, () => {
      if (!B) return;
      B.vp.classList.remove('bd-panning');
      if (!moved && clickClears) { exitEdit(); clearSel(); }
    });
  }
  function startMarquee(e, additive) {
    const base = additive ? new Set(B.sel) : new Set();
    const r0 = B.vp.getBoundingClientRect(), sx = e.clientX - r0.left, sy = e.clientY - r0.top;
    const mq = B.marquee;
    exitEdit();
    capture(e, ev => {
      const x = ev.clientX - r0.left, y = ev.clientY - r0.top;
      const L = Math.min(sx, x), T = Math.min(sy, y), W = Math.abs(x - sx), H = Math.abs(y - sy);
      mq.hidden = false; mq.style.transform = 'translate(' + L + 'px,' + T + 'px)'; mq.style.width = W + 'px'; mq.style.height = H + 'px';
      const v = B.doc.view, wx = (L - v.x) / v.zoom, wy = (T - v.y) / v.zoom, ww = W / v.zoom, wh = H / v.zoom;
      const sel = new Set(base);
      for (const it of B.doc.items) { const r = rectOf(it); if (r.x < wx + ww && r.x + r.w > wx && r.y < wy + wh && r.y + r.h > wy) sel.add(it.id); }
      B.sel = sel; paintSel();
    }, () => { if (B) mq.hidden = true; });
  }
  function startDrag(e, card, it, wasSel) {
    const sx = e.clientX, sy = e.clientY, z = B.doc.view.zoom;
    const moving = selItems().map(x => ({ it: x, x: x.x, y: x.y }));
    const before = snap();
    const target = e.target;
    let moved = false, raf = 0;
    capture(e, ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
      if (!moved) {
        moved = true; B.vp.classList.add('bd-dragging');
        // перетаскиваемые карточки поднимаются над остальными (порядок между ними сохраняется)
        const top = maxZ(), sorted = moving.slice().sort((a, b) => a.it.z - b.it.z);
        if (sorted.some(m => m.it.z < top) || sorted.length > 1) { let z = top; sorted.forEach(m => { m.it.z = ++z; }); }
      }
      const dx = (ev.clientX - sx) / z, dy = (ev.clientY - sy) / z;
      moving.forEach(m => { m.it.x = Math.round(m.x + dx); m.it.y = Math.round(m.y + dy); });
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (B) moving.forEach(m => { const el = B.els.get(m.it.id); if (el) place(el, m.it); }); });
    }, (ev, cancelled) => {
      if (!B) return;
      cancelAnimationFrame(raf);
      B.vp.classList.remove('bd-dragging');
      moving.forEach(m => { const el = B.els.get(m.it.id); if (el) place(el, m.it); });
      if (moved) { pushHistory(before); scheduleSave(B.taskId); return; }
      if (cancelled) return;
      // щелчок без перемещения
      const cbx = target.closest && target.closest('.bd-cbx');
      if (cbx) { toggleCheck(it, cbx); return; }
      if (wasSel && !ev.shiftKey && (it.type === 'note' || it.type === 'checklist')) enterEdit(it.id);
    });
  }
  function toggleCheck(it, cbx) {
    change(() => {
      if (it.type === 'note' && cbx.dataset.line != null) it.text = toggleTodoLine(it.text, Number(cbx.dataset.line));
      else if (it.type === 'checklist') { const x = it.items.find(y => y.id === cbx.dataset.iid); if (x) x.done = !x.done; }
    });
  }
  function startResize(e, it) {
    const sx = e.clientX, sy = e.clientY, z = B.doc.view.zoom, w0 = it.w, h0 = it.h;
    const el = B.els.get(it.id);
    const h0real = el ? (isMediaType(it.type) ? it.h : el.offsetHeight) : it.h;
    const ratio = isMediaType(it.type) || it.type === 'ink' ? it.h / it.w : 0;     // картинки и рисунки — без искажения
    const minW = it.type === 'link' ? 200 : isMediaType(it.type) ? 60 : it.type === 'ink' ? 12 : 140;
    const before = snap();
    let moved = false;
    exitEdit();
    capture(e, ev => {
      moved = true;
      const dw = (ev.clientX - sx) / z, dh = (ev.clientY - sy) / z;
      it.w = Math.round(clampN(w0 + dw, minW, 4000));
      if (ratio) it.h = Math.max(it.type === 'ink' ? 4 : 30, Math.round(it.w * ratio));
      else if (it.type !== 'link') it.h = Math.round(clampN(h0real + dh, 40, 4000));
      if (el) place(el, it);
    }, () => {
      if (!B) return;
      if (!moved) { it.w = w0; it.h = h0; return; }
      pushHistory(before); scheduleSave(B.taskId);
    });
  }
  function onDblClick(e) {
    if (!B || B.sub || B.draw) return;
    // при захвате указателя событие приходит на холст — настоящую цель находим по координатам
    const tgt = document.elementFromPoint(e.clientX, e.clientY) || e.target;
    if (!B.vp.contains(tgt)) return;
    if (tgt.closest('.bd-zoom, .bd-progress')) return;
    const card = tgt.closest('.bd-card');
    if (!card) { addNoteAt(toWorld(e.clientX, e.clientY), '', true); return; }
    const it = itemById(card.dataset.id); if (!it) return;
    if (B.editingId === it.id) return;
    if (tgt.closest('button, video, .bd-cbx')) return;
    if (it.type === 'image') openViewer(it);
    else if (it.type === 'sketch') editSketch(it);
    else if (it.type === 'video') playVideo(it);
    else enterEdit(it.id);
  }
  function onCardClickButtons(e) {
    if (!B) return;
    const card = e.target.closest('.bd-card'); if (!card) return;
    const it = itemById(card.dataset.id); if (!it) return;
    if (e.target.closest('.bd-more')) { e.stopPropagation(); cardMenu(e.target.closest('.bd-more'), it); }
    else if (e.target.closest('.bd-play')) playVideo(it);
    else if (e.target.closest('.bd-link-open')) openLink(it);
  }
  function onContextMenu(e) {
    if (!B || B.sub) return;
    if (isTyping(e.target)) return;
    e.preventDefault();
    const at = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX + 200, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }) };
    const card = e.target.closest('.bd-card');
    if (!card) {
      const p = toWorld(e.clientX, e.clientY);
      ctx.openMenu(at, [
        { icon: 'note', label: 'Заметка здесь', run: () => addNoteAt(p, '', true) },
        { icon: 'todo', label: 'Чек-лист здесь', run: () => addChecklistAt(p) },
        clip ? { icon: 'copy', label: 'Вставить карточки', run: () => pasteInternal(p) } : null,
        { sep: true },
        { icon: 'fit', label: 'Показать всё', run: () => fitAll(true) },
        B.doc.items.length ? { icon: 'check', label: 'Выделить всё', run: () => { B.sel = new Set(B.doc.items.map(x => x.id)); paintSel(); } } : null
      ]);
      return;
    }
    const it = itemById(card.dataset.id); if (!it) return;
    if (!B.sel.has(it.id)) selectOnly(it.id);
    cardMenu(at, it);
  }
  function openLink(it) {
    if (!it.url) return;
    if (E && E.openUrl) E.openUrl(it.url).then(ok => { if (!ok) toast('Не удалось открыть ссылку.'); });
    else window.open(it.url, '_blank', 'noopener');
  }
  function cardMenu(anchor, it) {
    const multi = B.sel.size > 1 && B.sel.has(it.id);
    const items = [];
    if (!multi) {
      if (it.type === 'note' || it.type === 'checklist' || it.type === 'link') items.push({ icon: 'pencil', label: 'Редактировать', run: () => enterEdit(it.id) });
      if (it.type === 'link') items.push({ icon: 'ext', label: 'Открыть в браузере', run: () => openLink(it) },
        E && E.linkPreview ? { icon: 'undo', label: 'Обновить описание и превью', run: () => fetchPreview(it, true) } : null);
      if (it.type === 'image') items.push({ icon: 'eye', label: 'Открыть просмотр', run: () => openViewer(it) },
        { icon: 'brush', label: it.overlay ? 'Изменить рисунок поверх' : 'Нарисовать поверх', run: () => drawOver(it) },
        it.overlay ? { icon: 'x', label: 'Убрать рисунок поверх', run: () => change(() => { delete it.overlay; }) } : null);
      if (it.type === 'sketch') items.push({ icon: 'brush', label: 'Редактировать зарисовку', run: () => editSketch(it) });
      if (it.type === 'video') items.push({ icon: 'play', label: 'Воспроизвести', run: () => playVideo(it) }, { icon: 'ext', label: 'Открыть во внешнем плеере', run: () => openExternal(it) });
      if (isMediaType(it.type)) items.push({ icon: 'caption', label: it.caption ? 'Изменить подпись' : 'Добавить подпись', run: () => enterEdit(it.id) });
      if ((it.type === 'image' || it.type === 'ink' || (it.type === 'sketch' && it.mediaId)) && M) items.push({ sep: true },
        { icon: 'save', label: 'Сохранить как…', run: () => exportCard(it, 'save') },
        { icon: 'copy', label: 'Копировать в буфер', run: () => exportCard(it, 'copy') });
      if (it.type === 'note' || it.type === 'checklist') items.push({ swatches: COLORS, names: COLOR_NAMES, value: it.color, pick: c => change(() => { it.color = c; }) });
      items.push({ sep: true });
    }
    items.push({ icon: 'dup', label: 'Дублировать', run: () => duplicate() },
      { icon: 'front', label: 'На передний план', run: () => toFront() },
      { icon: 'back', label: 'На задний план', run: () => toBack() },
      { sep: true },
      { icon: 'trash', danger: true, label: multi ? 'Удалить выделенные (' + B.sel.size + ')' : 'Удалить', run: () => deleteSel() });
    ctx.openMenu(anchor, items.filter(Boolean));
  }

  /* ---------- рисование от руки прямо на холсте ---------- */
  // Штрихи, нарисованные подряд рядом друг с другом, собираются в один «рисунок» (карточку ink): его можно двигать,
  // масштабировать, копировать и удалять, как любую карточку. Отмена — общая история доски (Ctrl+Z).
  function toggleDraw(on) {
    if (!B) return;
    const want = on === undefined ? !B.draw : !!on;
    if (want === !!B.draw) return;
    if (want) { exitEdit(); clearSel(); B.draw = Object.assign({ ids: [] }, inkPrefs); }
    else B.draw = null;
    B.vp.classList.toggle('bd-drawing', !!B.draw);
    B.drawBtn.setAttribute('aria-pressed', String(!!B.draw));
    B.drawBtn.classList.toggle('on', !!B.draw);
    paintInkBar();
    B.vp.focus({ preventScroll: true });
  }
  function setInk(patch) {
    Object.assign(inkPrefs, patch);
    try { localStorage.setItem('planer-ink', JSON.stringify(inkPrefs)); } catch (_) {}
    if (B && B.draw) { Object.assign(B.draw, patch); paintInkBar(); }
  }
  function paintInkBar() {
    if (!B) return;
    const bar = B.inkBar, d = B.draw;
    bar.hidden = !d;
    B.vp.dataset.tool = d ? d.tool : '';
    if (!d) { bar.replaceChildren(); return; }
    const tb = (tool, keyHint) => h('button', { type: 'button', class: 'bd-ib-tool', role: 'radio', 'aria-checked': String(d.tool === tool), 'aria-label': INK_TOOLS[tool] + ' (' + keyHint + ')', title: INK_TOOLS[tool] + ' (' + keyHint + ')',
      onclick: () => setInk({ tool }) }, icon(tool, 18));
    bar.replaceChildren(
      h('div', { class: 'bd-ib-grp', role: 'radiogroup', 'aria-label': 'Инструмент' }, tb('pen', 'B'), tb('marker', 'M'), tb('eraser', 'E')),
      h('span', { class: 'bd-tsep' }),
      h('div', { class: 'bd-ib-grp', role: 'radiogroup', 'aria-label': 'Цвет' }, INK_COLORS.map(c => h('button', { type: 'button', class: 'bd-ib-c ink-bg-' + c, role: 'radio',
        'aria-checked': String(d.color === c), 'aria-label': INK_COLOR_NAMES[c], title: INK_COLOR_NAMES[c], disabled: d.tool === 'eraser', onclick: () => setInk({ color: c }) }))),
      h('span', { class: 'bd-tsep' }),
      h('div', { class: 'bd-ib-grp', role: 'radiogroup', 'aria-label': 'Толщина' }, Object.keys(INK_SIZES).map(s => h('button', { type: 'button', class: 'bd-ib-s', role: 'radio', 'data-size': s,
        'aria-checked': String(d.size === s), 'aria-label': { s: 'Тонко', m: 'Средне', l: 'Толсто' }[s], title: { s: 'Тонко', m: 'Средне', l: 'Толсто' }[s], onclick: () => setInk({ size: s }) }, h('i')))),
      h('span', { class: 'bd-tsep' }),
      h('button', { type: 'button', class: 'bd-ib-done', onclick: () => toggleDraw(false), title: 'Закончить рисование (Esc)' }, 'Готово'));
  }
  // Промежуточные («слитые») события указателя дают плавную линию, но бывают пустыми (0, 0) — такие пропускаем.
  function pointerSamples(ev) {
    const evs = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    const r = B.vp.getBoundingClientRect();
    const ok = evs.filter(c => (c.clientX || c.clientY) && c.clientX >= r.left - 40 && c.clientX <= r.right + 40 && c.clientY >= r.top - 40 && c.clientY <= r.bottom + 40);
    return ok.length ? ok : [ev];
  }
  const inkWidth = d => (INK_SIZES[d.size] || 4) * (d.tool === 'marker' ? 3.5 : 1) / B.doc.view.zoom;
  function startInk(e) {
    const d = B.draw, z = B.doc.view.zoom, w = inkWidth(d), marker = d.tool === 'marker';
    const pts = [];
    const add = ev => {
      const p = toWorld(ev.clientX, ev.clientY), n = pts.length;
      if (n >= 2 && Math.hypot(p.x - pts[n - 2], p.y - pts[n - 1]) < 0.6 / z) return;
      if (n < 16000) pts.push(r1(p.x), r1(p.y));
    };
    add(e);
    const path = svgEl('path', { class: 'bd-ink-p ink-c-' + d.color + (marker ? ' marker' : ''), 'stroke-width': String(w) });
    B.inkLive.append(path);
    let raf = 0;
    const paint = () => { raf = 0; path.setAttribute('d', inkPath(pts)); };
    paint();
    capture(e, ev => {
      pointerSamples(ev).forEach(add);
      if (!raf) raf = requestAnimationFrame(paint);
    }, () => {
      cancelAnimationFrame(raf); path.remove();
      if (!B || !B.draw) return;
      commitInk({ c: d.color, w: r1(w), m: marker ? 1 : 0, p: simplify(pts, 0.35 / z) });
    });
  }
  function commitInk(stroke) {
    const p = stroke.p, pad = stroke.w / 2 + 2;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (let i = 0; i < p.length; i += 2) { x1 = Math.min(x1, p[i]); y1 = Math.min(y1, p[i + 1]); x2 = Math.max(x2, p[i]); y2 = Math.max(y2, p[i + 1]); }
    const sb = { x: Math.floor(x1 - pad), y: Math.floor(y1 - pad), x2: Math.ceil(x2 + pad), y2: Math.ceil(y2 + pad) };
    // штрих присоединяется к рисунку этого сеанса, рядом с которым нарисован (ближе 60 px на экране); иначе — новый рисунок
    const near = 60 / B.doc.view.zoom;
    const hit = it => it && it.type === 'ink' && sb.x < it.x + it.w + near && sb.x2 > it.x - near && sb.y < it.y + it.h + near && sb.y2 > it.y - near;
    const target = B.draw.ids.slice().reverse().map(itemById).find(hit) || null;
    const clean = s => { const o = { c: s.c, w: s.w, p: s.p }; if (s.m) o.m = 1; return o; };
    let id;
    change(() => {
      if (target) {
        const k = target.w / target.vw;
        const nx = Math.min(target.x, sb.x), ny = Math.min(target.y, sb.y);
        const nx2 = Math.max(target.x + target.w, sb.x2), ny2 = Math.max(target.y + target.h, sb.y2);
        const dx = (target.x - nx) / k, dy = (target.y - ny) / k;
        if (dx || dy) target.strokes.forEach(s => { for (let i = 0; i < s.p.length; i += 2) { s.p[i] = r1(s.p[i] + dx); s.p[i + 1] = r1(s.p[i + 1] + dy); } });
        const local = []; for (let i = 0; i < p.length; i += 2) local.push(r1((p[i] - nx) / k), r1((p[i + 1] - ny) / k));
        target.strokes.push(clean({ c: stroke.c, w: r1(stroke.w / k), m: stroke.m, p: local }));
        target.x = nx; target.y = ny; target.w = nx2 - nx; target.h = ny2 - ny;
        target.vw = r1(target.w / k); target.vh = r1(target.h / k);
        id = target.id;
      } else {
        const local = []; for (let i = 0; i < p.length; i += 2) local.push(r1(p[i] - sb.x), r1(p[i + 1] - sb.y));
        const w = sb.x2 - sb.x, hh = sb.y2 - sb.y;
        const it = { id: rid(), type: 'ink', x: sb.x, y: sb.y, w, h: hh, z: maxZ() + 1, vw: w, vh: hh, strokes: [clean(Object.assign({}, stroke, { p: local }))] };
        B.doc.items.push(it); id = it.id;
      }
    });
    if (B && B.draw) { B.draw.ids = B.draw.ids.filter(x => x !== id && itemById(x)); B.draw.ids.push(id); }
  }
  // Ластик стирает штрихи, которых касается (целиком); пустые рисунки исчезают. Вся «протирка» — один шаг отмены.
  function startErase(e) {
    const before = snap(), r = 9 / B.doc.view.zoom;
    let removed = 0;
    const erase = ev => {
      const p = toWorld(ev.clientX, ev.clientY);
      for (const it of B.doc.items.slice()) {
        if (it.type !== 'ink' || p.x < it.x - r || p.y < it.y - r || p.x > it.x + it.w + r || p.y > it.y + it.h + r) continue;
        const k = it.w / it.vw, lx = (p.x - it.x) / k, ly = (p.y - it.y) / k;
        const keep = it.strokes.filter(s => !strokeHits(s, lx, ly, r / k));
        if (keep.length === it.strokes.length) continue;
        removed += it.strokes.length - keep.length;
        if (keep.length) it.strokes = keep; else B.doc.items.splice(B.doc.items.indexOf(it), 1);
      }
    };
    erase(e);
    if (removed) renderAll();
    capture(e, ev => {
      const n = removed;
      pointerSamples(ev).forEach(erase);
      if (removed !== n) renderAll();
    }, () => {
      if (!B || !removed) return;
      pushHistory(before); scheduleSave(B.taskId); paintEmpty(); paintCtxBar();
      if (B.draw) B.draw.ids = B.draw.ids.filter(x => itemById(x));
    });
  }

  /* ---------- операции над выделенным ---------- */
  function deleteSel() {
    if (!B || !B.sel.size) return;
    exitEdit();
    const n = B.sel.size, taskId = B.taskId, before = snap();
    change(() => { B.doc.items = B.doc.items.filter(it => !B.sel.has(it.id)); });
    B.sel.clear(); paintSel();
    toast(n === 1 ? 'Карточка удалена' : 'Удалено карточек: ' + n, () => {
      if (B && B.taskId === taskId) { const H = hist(taskId); if (H.undo[H.undo.length - 1] === before) undo(); else restore(before); }
      else { const d = docs.get(taskId); if (d) { d.items = JSON.parse(before); scheduleSave(taskId); } }
    });
  }
  function cloneItems(src, dx, dy) {
    let z = maxZ();
    return src.map(it => Object.assign(JSON.parse(JSON.stringify(it)), { id: rid(), x: it.x + dx, y: it.y + dy, z: ++z },
      it.type === 'checklist' ? { items: it.items.map(x => ({ ...x, id: rid() })) } : {}));
  }
  function duplicate() {
    const src = selItems(); if (!src.length) return;
    exitEdit();
    const copies = cloneItems(src, GAP, GAP);
    change(() => B.doc.items.push(...copies));
    B.sel = new Set(copies.map(x => x.id)); paintSel();
  }
  function toFront() { const s = selItems().sort((a, b) => a.z - b.z); let z = maxZ(); change(() => s.forEach(it => { it.z = ++z; })); }
  function toBack() { const s = selItems().sort((a, b) => b.z - a.z); let z = minZ(); change(() => s.forEach(it => { it.z = --z; })); }
  function nudge(dx, dy) {
    const s = selItems(); if (!s.length) return;
    const now = Date.now(), before = snap();
    s.forEach(it => { it.x += dx; it.y += dy; });
    if (now - B.nudgeAt > 700) pushHistory(before);
    B.nudgeAt = now;
    renderAll(); scheduleSave(B.taskId);
  }
  function copySel(cut) {
    const src = selItems(); if (!src.length) return false;
    clip = { items: JSON.parse(JSON.stringify(src)), text: src.map(noteSummary).filter(Boolean).join('\n\n') || ('Карточки Планера: ' + src.length) };
    if (E && E.clipWriteText) E.clipWriteText(clip.text); else { try { navigator.clipboard.writeText(clip.text); } catch (_) {} }
    if (cut) deleteSel(); else toast(src.length === 1 ? 'Карточка скопирована' : 'Скопировано карточек: ' + src.length);
    return true;
  }
  function pasteInternal(at) {
    if (!clip || !B) return;
    const bb = bbox(clip.items.map(x => normItem(x)).filter(Boolean));
    if (!bb) return;
    let dx, dy;
    if (at) { dx = Math.round(at.x - bb.x - bb.w / 2); dy = Math.round(at.y - bb.y - bb.h / 2); }
    else { const c = viewCenter(), p = findFree(B.doc, bb.w, bb.h, c.x, c.y); dx = p.x - bb.x; dy = p.y - bb.y; }
    const copies = cloneItems(clip.items.map(x => normItem(x)).filter(Boolean), dx, dy);
    change(() => B.doc.items.push(...copies));
    B.sel = new Set(copies.map(x => x.id)); paintSel();
  }

  /* ---------- клавиатура и буфер обмена ---------- */
  function onKey(e) {
    if (!B || B.sub) return;
    if (ctx.isMenuOpen() && e.key === 'Escape') return;           // сначала закрывается меню
    if (document.querySelector('.pk-ov')) return;                // диалог ключа API
    const t = e.target;
    if (!B.ov.contains(t) && t !== document.body && t !== document.documentElement) return;   // фокус в панели ассистента и т.п.
    const typing = isTyping(t);
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (B.editingId) { exitEdit(); return; }
      if (typing) { B.vp.focus({ preventScroll: true }); return; }
      if (B.draw) { toggleDraw(false); return; }
      close(); return;
    }
    if (typing) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (!mod && !e.altKey && e.code === 'KeyP') { stop(); toggleDraw(); return; }
    if (B.draw && !mod && !e.altKey && (e.code === 'KeyE' || e.code === 'KeyM' || e.code === 'KeyB')) {   // E — ластик, M — маркер, B — перо
      stop(); setInk({ tool: e.code === 'KeyE' ? 'eraser' : e.code === 'KeyM' ? 'marker' : 'pen' }); return;
    }
    if (mod && e.code === 'KeyZ') { stop(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.code === 'KeyY') { stop(); redo(); return; }
    if (mod && e.code === 'KeyD') { stop(); duplicate(); return; }
    if (mod && e.code === 'KeyA') { stop(); B.sel = new Set(B.doc.items.map(x => x.id)); paintSel(); return; }
    if (mod && e.code === 'KeyC') { if (B.sel.size) { stop(); copySel(false); } return; }
    if (mod && e.code === 'KeyX') { if (B.sel.size) { stop(); copySel(true); } return; }
    if (mod) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (B.sel.size) { stop(); deleteSel(); } return; }
    if (e.key === 'Enter') {
      const s = selItems(); if (s.length !== 1) return; stop();
      const it = s[0];
      if (it.type === 'image') openViewer(it); else if (it.type === 'sketch') editSketch(it); else if (it.type === 'video') playVideo(it); else enterEdit(it.id);
      return;
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && B.sel.size) { stop(); const k = e.shiftKey ? 1 : 10; nudge(arrows[e.key][0] * k, arrows[e.key][1] * k); return; }
    if (e.code === 'Space') { stop(); if (!B.spaceDown) { B.spaceDown = true; B.vp.classList.add('bd-space'); } return; }
    if (e.key === '+' || e.key === '=') { stop(); zoomStep(1.25); return; }
    if (e.key === '-' || e.key === '_') { stop(); zoomStep(1 / 1.25); return; }
    if (e.shiftKey && e.code === 'Digit0') { stop(); zoomTo(1); return; }
    if (e.shiftKey && e.code === 'Digit1') { stop(); fitAll(true); return; }
    if (!e.shiftKey && e.code === 'KeyN') { stop(); addNoteAt(null, '', true); return; }
  }
  function onKeyUp(e) { if (B && e.code === 'Space') { B.spaceDown = false; B.vp.classList.remove('bd-space'); } }
  function onWinBlur() { if (B) { B.spaceDown = false; B.vp.classList.remove('bd-space'); } }
  function onCopyEvt(e) { if (!B || B.sub || isTyping(e.target) || !B.sel.size) return; e.preventDefault(); copySel(false); }
  function onCutEvt(e) { if (!B || B.sub || isTyping(e.target) || !B.sel.size) return; e.preventDefault(); copySel(true); }
  function pastePoint() { return B.mouse ? toWorld(B.mouse.cx, B.mouse.cy) : null; }
  function onPaste(e) {
    if (!B || B.sub || isTyping(e.target)) return;
    if (!B.ov.contains(e.target) && e.target !== document.body) return;
    const dt = e.clipboardData; if (!dt) return;
    e.preventDefault(); e.stopPropagation();
    const at = pastePoint();
    const files = [...(dt.files || [])];
    if (!files.length) for (const itx of dt.items || []) if (itx.kind === 'file') { const f = itx.getAsFile(); if (f) files.push(f); }
    const text = (dt.getData('text/plain') || '').replace(/\r\n/g, '\n');
    if (clip && text && text === clip.text) { pasteInternal(at); return; }
    if (files.length) { importBlobs(files, at); return; }
    const t = text.trim();
    if (!t) { if (clip) pasteInternal(at); return; }
    const words = t.split(/\s+/);
    if (words.every(isUrlText)) { addLinks(words, at); return; }
    addNoteAt(at, t.slice(0, 20000), false);
  }

  /* ---------- перетаскивание файлов ---------- */
  function dtHas(e, type) { const t = e.dataTransfer && e.dataTransfer.types; return !!t && [...t].includes(type); }
  function onDragOver(e) {
    if (!B || B.sub) return;
    if (!dtHas(e, 'Files') && !dtHas(e, 'text/uri-list') && !dtHas(e, 'text/plain')) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    B.dropHint.hidden = false;
  }
  function onDrop(e) {
    if (!B || B.sub) return;
    e.preventDefault(); e.stopPropagation();
    B.dropHint.hidden = true;
    const at = toWorld(e.clientX, e.clientY);
    const files = [...(e.dataTransfer.files || [])];
    if (files.length) { importFiles(files, at); return; }
    const uris = (e.dataTransfer.getData('text/uri-list') || '').split(/\r?\n/).filter(l => l && !l.startsWith('#')).filter(isUrlText);
    if (uris.length) { addLinks(uris, at); return; }
    const t = (e.dataTransfer.getData('text/plain') || '').trim();
    if (!t) return;
    if (t.split(/\s+/).every(isUrlText)) addLinks(t.split(/\s+/), at); else addNoteAt(at, t.slice(0, 20000), false);
  }

  /* ---------- зарисовки ---------- */
  function subOpen(name, closeFn) { B.sub = name; B.subClose = closeFn; }
  function subDone() { if (B) { B.sub = null; B.subClose = null; B.vp.focus({ preventScroll: true }); } }
  async function readStrokes(id) {
    if (!id || !M) return null;
    try { const j = await M.getVector(id); if (!j) return null; const d = JSON.parse(j); return d && Array.isArray(d.strokes) ? d : null; } catch (_) { return null; }
  }
  async function storeSketch(res) {
    const json = JSON.stringify({ v: 1, w: res.width, h: res.height, bg: res.bg, strokes: res.strokes });
    const strokesId = await M.putVector(json);
    let mediaId = null;
    if (res.png) {
      const r = await M.importBuffer('sketch.png', 'image/png', new Uint8Array(res.png));
      if (!r.ok) throw new Error(r.error);
      mediaId = r.meta.id;
    }
    return { strokesId, mediaId };
  }
  async function newSketch() {
    if (!M || !SK()) { toast('Зарисовки доступны в настольной версии приложения.'); return; }
    exitEdit();
    const taskId = B.taskId;
    subOpen('sketch', null);
    let res = null;
    try { res = await SK().open({ title: 'Новая зарисовка', width: 1200, height: 800, bg: 'white', strokes: [], ctx: sketchCtx() }); }
    finally { subDone(); }
    if (!res || res.unchanged || !B || B.taskId !== taskId) return;
    if (!res.strokes.length) return;
    try {
      const ids = await storeSketch(res);
      const s = fitBox(res.width, res.height, 360);
      const it = { id: rid(), type: 'sketch', x: 0, y: 0, w: s.w, h: s.h, z: 0, mediaId: ids.mediaId, strokesId: ids.strokesId, bg: res.bg, width: res.width, height: res.height, caption: '' };
      const p = spot(it.w, it.h, null); it.x = p.x; it.y = p.y;
      addItems([it]);
    } catch (e) { toast('Не удалось сохранить зарисовку: ' + ((e && e.message) || 'ошибка') + '.'); }
  }
  async function editSketch(it) {
    if (!M || !SK()) { toast('Зарисовки доступны в настольной версии приложения.'); return; }
    exitEdit();
    const taskId = B.taskId, id = it.id;
    subOpen('sketch', null);
    let res = null;
    try {
      const data = await readStrokes(it.strokesId);
      if (it.strokesId && !data) toast('Не удалось прочитать штрихи зарисовки — открываю пустой холст.');
      res = await SK().open({ title: 'Зарисовка', width: it.width, height: it.height, bg: it.bg, strokes: data ? data.strokes : [], ctx: sketchCtx() });
    } finally { subDone(); }
    if (!res || res.unchanged || !B || B.taskId !== taskId) return;
    try {
      const ids = await storeSketch(res);
      const cur = itemById(id); if (!cur) return;
      change(() => { cur.mediaId = ids.mediaId; cur.strokesId = ids.strokesId; cur.bg = res.bg; });
    } catch (e) { toast('Не удалось сохранить зарисовку: ' + ((e && e.message) || 'ошибка') + '.'); }
  }
  async function drawOver(it) {
    if (!M || !SK()) { toast('Рисование доступно в настольной версии приложения.'); return; }
    exitEdit();
    const taskId = B.taskId, id = it.id;
    let W = it.overlay && it.overlay.width, H = it.overlay && it.overlay.height;
    if (!W || !H) { const k = Math.min(1, 2000 / Math.max(it.width || 1200, it.height || 800)); W = Math.round((it.width || 1200) * k); H = Math.round((it.height || 800) * k); }
    subOpen('sketch', null);
    let res = null;
    try {
      const data = it.overlay ? await readStrokes(it.overlay.strokesId) : null;
      res = await SK().open({ title: 'Рисунок поверх изображения', width: W, height: H, bg: 'transparent', image: mediaUrl(it.mediaId), strokes: data ? data.strokes : [], ctx: sketchCtx() });
    } finally { subDone(); }
    if (!res || res.unchanged || !B || B.taskId !== taskId) return;
    try {
      const cur = itemById(id); if (!cur) return;
      if (!res.strokes.length) { change(() => { delete cur.overlay; }); return; }
      const ids = await storeSketch(res);
      change(() => { cur.overlay = { mediaId: ids.mediaId, strokesId: ids.strokesId, width: res.width, height: res.height }; });
    } catch (e) { toast('Не удалось сохранить рисунок: ' + ((e && e.message) || 'ошибка') + '.'); }
  }
  function sketchCtx() { return { h, icon, toast }; }

  /* ---------- экспорт картинок: PNG в файл / в буфер, JPEG для ассистента ---------- */
  async function composite(it, maxSide) {
    let W, H, base = null, over = null, inkK = 1;
    if (it.type === 'image') {
      base = await loadImg(mediaUrl(it.mediaId));
      W = base.naturalWidth || it.width || 800; H = base.naturalHeight || it.height || 600;
      if (it.overlay && it.overlay.mediaId) { try { over = await loadImg(mediaUrl(it.overlay.mediaId)); } catch (_) {} }
    } else if (it.type === 'sketch') {
      W = it.width; H = it.height;
      if (it.mediaId) over = await loadImg(mediaUrl(it.mediaId));
    } else if (it.type === 'ink') {
      inkK = Math.min(4, Math.max(1, 1600 / Math.max(it.vw, it.vh)));      // рисунок — векторы: рисуем в хорошем разрешении
      W = Math.round(it.vw * inkK); H = Math.round(it.vh * inkK);
    } else throw new Error('not an image');
    const k = Math.min(1, (maxSide || 8192) / Math.max(W, H));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
    const g = c.getContext('2d');
    if (it.type === 'sketch' && SK()) SK().drawBackground(g, it.bg, c.width, c.height, k);
    if (it.type === 'ink') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); drawInk(g, it, inkK * k); }
    if (base) g.drawImage(base, 0, 0, c.width, c.height);
    if (over) g.drawImage(over, 0, 0, c.width, c.height);
    return c;
  }
  function drawInk(g, it, scale) {
    g.save(); g.scale(scale, scale); g.lineCap = 'round'; g.lineJoin = 'round';
    for (const st of it.strokes) { g.globalAlpha = st.m ? 0.35 : 1; g.strokeStyle = INK_HEX[st.c] || INK_HEX.ink; g.lineWidth = st.w; g.stroke(new Path2D(inkPath(st.p))); }
    g.restore();
  }
  async function exportCard(it, how) {
    try {
      const c = await composite(it);
      const b = await toBlob(c, 'image/png');
      if (!b) throw new Error('png');
      const bytes = await blobBytes(b);
      if (how === 'copy') { const ok = await M.copyPng(bytes); toast(ok ? 'Изображение скопировано в буфер обмена' : 'Не удалось скопировать изображение.'); }
      else {
        const r = await M.savePng(it.type === 'sketch' ? 'Зарисовка' : it.type === 'ink' ? 'Рисунок' : (it.name || 'Изображение'), bytes);
        if (r && r.ok) toast('Сохранено: ' + r.path); else if (r && !r.canceled) toast(r.error || 'Не удалось сохранить файл.');
      }
    } catch (_) { toast('Не удалось подготовить изображение — возможно, файл повреждён или удалён.'); }
  }
  async function imageForAI(it) {
    const c = await composite(it, 1568);
    let g = c;
    if (it.type === 'sketch' && it.bg === 'transparent') {    // у JPEG нет прозрачности — подложим белый
      g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
      const x = g.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, g.width, g.height); x.drawImage(c, 0, 0);
    }
    const url = g.toDataURL('image/jpeg', 0.85);
    return { data: url.slice(url.indexOf(',') + 1), mediaType: 'image/jpeg', width: g.width, height: g.height };
  }

  /* ---------- просмотр изображения во весь экран ---------- */
  function openViewer(it) {
    if (!B) return;
    exitEdit();
    const list = B.doc.items.filter(x => x.type === 'image').sort((a, b) => (a.y - b.y) || (a.x - b.x));
    let idx = Math.max(0, list.findIndex(x => x.id === it.id));
    const st = { z: 1, x: 0, y: 0, fit: 1, w: 0, h: 0 };
    const img = h('img', { class: 'bd-lb-img', alt: '', draggable: 'false' });
    const ovl = h('img', { class: 'bd-lb-ovl', alt: '', draggable: 'false' });
    const frame = h('div', { class: 'bd-lb-frame' }, img, ovl);
    const stage = h('div', { class: 'bd-lb-stage' }, frame);
    const name = h('span', { class: 'bd-lb-name' });
    const pct = h('span', { class: 'bd-lb-pct' });
    const b = (ic, label, run) => h('button', { class: 'tool', type: 'button', 'aria-label': label, title: label, onclick: run }, icon(ic, 17));
    const lb = h('div', { class: 'bd-lb', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Просмотр изображения', tabindex: '-1' },
      stage,
      h('div', { class: 'bd-lb-bar' },
        list.length > 1 ? h('button', { class: 'tool flip', type: 'button', 'aria-label': 'Предыдущее (←)', title: 'Предыдущее (←)', onclick: () => go(-1) }, icon('chev', 17)) : null,
        list.length > 1 ? b('chev', 'Следующее (→)', () => go(1)) : null,
        name, h('span', { class: 'spacer' }),
        b('minus', 'Уменьшить', () => zoom(1 / 1.25)), pct, b('plus', 'Увеличить', () => zoom(1.25)),
        b('fit', 'Вписать (0)', () => fit()),
        b('brush', 'Нарисовать поверх', () => { const cur = list[idx]; closeLb(); drawOver(cur); }),
        M ? b('save', 'Сохранить как…', () => exportCard(list[idx], 'save')) : null,
        b('x', 'Закрыть (Esc)', () => closeLb())));
    const apply = () => { frame.style.transform = 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + st.z + ')'; pct.textContent = Math.round(st.z * 100) + '%'; };
    const fit = () => {
      const r = stage.getBoundingClientRect();
      st.fit = Math.min(1, (r.width - 48) / st.w, (r.height - 48) / st.h) || 1;
      st.z = st.fit; st.x = (r.width - st.w * st.z) / 2; st.y = (r.height - st.h * st.z) / 2; apply();
    };
    const zoomAt = (z, px, py) => { const z1 = clampN(z, 0.05, 16); st.x = px - (px - st.x) * (z1 / st.z); st.y = py - (py - st.y) * (z1 / st.z); st.z = z1; apply(); };
    const zoom = f => { const r = stage.getBoundingClientRect(); zoomAt(st.z * f, r.width / 2, r.height / 2); };
    const show = () => {
      const cur = list[idx];
      name.textContent = (cur.caption || cur.name || 'Изображение') + (list.length > 1 ? ' · ' + (idx + 1) + ' из ' + list.length : '');
      img.onload = () => { st.w = img.naturalWidth || cur.width || 800; st.h = img.naturalHeight || cur.height || 600; frame.style.width = st.w + 'px'; frame.style.height = st.h + 'px'; fit(); };
      img.onerror = () => { name.textContent = 'Файл не найден: ' + (cur.name || ''); };
      img.src = mediaUrl(cur.mediaId);
      if (cur.overlay && cur.overlay.mediaId) { ovl.hidden = false; ovl.src = mediaUrl(cur.overlay.mediaId); } else { ovl.hidden = true; ovl.removeAttribute('src'); }
    };
    const go = d => { idx = (idx + d + list.length) % list.length; show(); };
    stage.addEventListener('wheel', e => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(st.z * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      const sx = e.clientX, sy = e.clientY, x0 = st.x, y0 = st.y; let moved = false;
      stage.setPointerCapture(e.pointerId); stage.classList.add('grabbing');
      const mv = ev => { moved = moved || Math.hypot(ev.clientX - sx, ev.clientY - sy) > 3; st.x = x0 + ev.clientX - sx; st.y = y0 + ev.clientY - sy; apply(); };
      const up = () => { stage.removeEventListener('pointermove', mv); stage.classList.remove('grabbing'); if (!moved && e.target === stage) closeLb(); };
      stage.addEventListener('pointermove', mv); stage.addEventListener('pointerup', up, { once: true }); stage.addEventListener('pointercancel', up, { once: true });
    });
    stage.addEventListener('dblclick', e => { const r = stage.getBoundingClientRect(); if (Math.abs(st.z - st.fit) < 0.01) zoomAt(1, e.clientX - r.left, e.clientY - r.top); else fit(); });
    const onK = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLb(); }
      else if (e.key === 'ArrowRight' && list.length > 1) { e.preventDefault(); e.stopPropagation(); go(1); }
      else if (e.key === 'ArrowLeft' && list.length > 1) { e.preventDefault(); e.stopPropagation(); go(-1); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1.25); }
      else if (e.key === '-') { e.preventDefault(); zoom(1 / 1.25); }
      else if (e.key === '0') { e.preventDefault(); fit(); }
    };
    const ro = 'ResizeObserver' in window ? new ResizeObserver(() => { if (st.w) fit(); }) : null;
    function closeLb() { document.removeEventListener('keydown', onK, true); if (ro) ro.disconnect(); lb.remove(); subDone(); }
    subOpen('viewer', closeLb);
    document.addEventListener('keydown', onK, true);
    document.body.append(lb);
    if (ro) ro.observe(stage);
    lb.focus({ preventScroll: true });
    show();
  }

  /* ---------- API для ассистента ---------- */
  async function readBoard(taskId) {
    const doc = await loadDoc(taskId);
    return doc.items.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x)).map(it => {
      const o = { id: it.id, type: it.type, x: it.x, y: it.y, w: it.w, h: it.h };
      if (it.type === 'note') { o.text = it.text; if (it.color) o.color = it.color; }
      else if (it.type === 'checklist') { o.title = it.title; o.items = it.items.map(x => ({ text: x.text, done: x.done })); }
      else if (it.type === 'link') { o.url = it.url; if (it.title || it.ptitle) o.title = it.title || it.ptitle; if (it.desc) o.description = it.desc; if (it.site) o.site = it.site; }
      else if (it.type === 'ink') { o.drawing = 'нарисовано от руки на доске'; o.strokes = it.strokes.length; o.colors = [...new Set(it.strokes.map(s => INK_COLOR_NAMES[s.c]))]; }
      else {
        if (it.name) o.file = it.name;
        if (it.caption) o.caption = it.caption;
        if (it.type === 'image') { o.pixels = it.width && it.height ? it.width + '×' + it.height : undefined; if (it.overlay) o.hasDrawingOnTop = true; }
        if (it.type === 'video' && it.duration) o.duration = fmtDur(it.duration);
        if (it.type === 'sketch') o.hasDrawing = !!it.mediaId;
      }
      return o;
    });
  }
  async function addCard(taskId, type, text, x, y) {
    if (type !== 'note' && type !== 'checklist') throw new Error('type must be note or checklist');
    const doc = await loadDoc(taskId);
    text = String(text || '').replace(/\r\n/g, '\n').trim();
    let it;
    if (type === 'note') it = makeNote(text);
    else {
      const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
      const isRow = s => /^([-*•]\s+|\[( |x|X)?\]\s*|\d+[.)]\s+)/.test(s);
      const title = lines.length > 1 && !isRow(lines[0]) ? lines.shift() : '';
      it = makeChecklist(title, lines.map(s => { const m = s.match(TODO_RE); return m ? { text: m[3], done: !!m[2] && m[2] !== ' ' } : { text: s.replace(/^([-*•]\s+|\d+[.)]\s+)/, '') }; }));
    }
    const live = B && B.taskId === taskId;
    if (typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y)) { it.x = Math.round(x); it.y = Math.round(y); }
    else {
      const estH = type === 'note' ? 24 + 21 * Math.min(30, text.split('\n').length) : 70 + 28 * it.items.length;
      const c = live ? viewCenter() : (() => { const bb = bbox(doc.items); return bb ? { x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 } : { x: 0, y: 0 }; })();
      const p = findFree(doc, it.w, estH, c.x, c.y); it.x = p.x; it.y = p.y;
    }
    if (live) addItems([it], { reveal: true });
    else { it.z = doc.items.reduce((m, q) => Math.max(m, q.z), 0) + 1; doc.items.push(it); scheduleSave(taskId, 0); }
    return it;
  }
  async function findCard(cardId) {
    if (B) { const it = itemById(cardId); if (it) return { taskId: B.taskId, item: it }; }
    for (const [taskId, d] of docs) { const it = d.items.find(x => x.id === cardId); if (it) return { taskId, item: it }; }
    for (const taskId of ctx.allBoardTaskIds()) {
      if (docs.has(taskId)) continue;
      const d = await loadDoc(taskId); const it = d.items.find(x => x.id === cardId);
      if (it) return { taskId, item: it };
    }
    return null;
  }
  function onTaskText(taskId, text) { if (B && B.taskId === taskId && document.activeElement !== B.titleIn) B.titleIn.value = text; }
  function onTaskGone(taskId) { if (B && B.taskId === taskId) close(); }
  // Найденная поиском карточка: выделить и показать в центре экрана.
  function reveal(cardId) {
    const it = itemById(cardId); if (!B || !it) return false;
    exitEdit(); selectOnly(it.id);
    const r = B.vp.getBoundingClientRect(), rc = rectOf(it), v = B.doc.view;
    const z = clampN(Math.min(v.zoom, (r.width - 80) / Math.max(rc.w, 1), (r.height - 80) / Math.max(rc.h, 1)), 0.25, ZMAX);
    B.doc.view = { x: Math.round(r.width / 2 - (rc.x + rc.w / 2) * z), y: Math.round(r.height / 2 - (rc.y + rc.h / 2) * z), zoom: z };
    applyView();
    const el = B.els.get(it.id);
    if (el) { el.classList.remove('bd-flash'); void el.offsetWidth; el.classList.add('bd-flash'); el.focus({ preventScroll: true }); }
    return true;
  }
  // Забыть загруженную доску (после восстановления из копии): следующее открытие прочитает её заново.
  // Возвращает true, если доска была открыта (её закрыли без сохранения поверх восстановленной версии).
  function forget(taskId) {
    clearTimeout(saveTimers.get(taskId)); saveTimers.delete(taskId);
    docs.delete(taskId); loading.delete(taskId); histories.delete(taskId);
    ctx.pending('board-' + taskId, false);
    const wasOpen = !!B && B.taskId === taskId;
    if (wasOpen) close();                       // close() не сохранит: документа уже нет в кэше
    return wasOpen;
  }

  return { open, close, isOpen, openTaskId, flush, readBoard, addCard, findCard, imageForAI, onTaskText, onTaskGone, thumbUrl, mediaUrl, reveal, forget };
}
})();
