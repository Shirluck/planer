/* Редактор зарисовок: <canvas>, Pointer Events (мышь, касание, перо с нажимом), сглаживание квадратичными кривыми,
   векторное хранение штрихов. Открывается поверх доски: PlanerSketch.open(opts) -> Promise<результат | null>. */
(function () {
'use strict';

const PALETTE = ['#25221e', '#7a746b', '#d93a40', '#e8890c', '#e2b714', '#2fa36b', '#2f6fe0', '#8a4fd8'];
const TOOLS = [
  { id: 'pen', label: 'Перо', key: 'KeyP', hint: 'P' },
  { id: 'marker', label: 'Маркер', key: 'KeyM', hint: 'M' },
  { id: 'eraser', label: 'Ластик', key: 'KeyE', hint: 'E' },
  { id: 'line', label: 'Линия', key: 'KeyL', hint: 'L' },
  { id: 'arrow', label: 'Стрелка', key: 'KeyA', hint: 'A' },
  { id: 'rect', label: 'Прямоугольник', key: 'KeyR', hint: 'R' },
  { id: 'ellipse', label: 'Эллипс', key: 'KeyO', hint: 'O' },
  { id: 'text', label: 'Текст', key: 'KeyT', hint: 'T' },
  { id: 'pick', label: 'Пипетка', key: 'KeyI', hint: 'I' }
];
const GROUP = { pen: 'pen', marker: 'marker', eraser: 'eraser', line: 'shape', arrow: 'shape', rect: 'shape', ellipse: 'shape', text: 'text', pick: 'pen' };
const DEF_SIZES = { pen: 4, marker: 18, eraser: 24, shape: 4, text: 6 };
const BGS = [['transparent', 'Прозрачный фон'], ['white', 'Белый фон'], ['grid', 'Клетка'], ['lines', 'Линейка']];
const STROKE_T = ['pen', 'marker', 'erase', 'line', 'arrow', 'rect', 'ellipse', 'text'];
const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MARKER_ALPHA = 0.38;

const ICONS = {
  skpen: '<path d="M4 20l1.4-4.6L16.2 4.6a2.1 2.1 0 013 3L8.4 18.4z"/><path d="M14.3 6.5l3.2 3.2"/>',
  skmarker: '<path d="M14.5 4l5.5 5.5-7.5 7.5H7V11.5z"/><path d="M7 17l-3 3h7"/>',
  skeraser: '<path d="M4.5 15.5l9-9a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8L13 19H8z"/><path d="M8 19h12M9.5 10.5l5 5"/>',
  skline: '<path d="M5 19L19 5"/>',
  skarrow: '<path d="M5 19L19 5M10 5h9v9"/>',
  skrect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  skellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  sktext: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
  skpick: '<path d="M13.5 6.5l4 4M15.6 4.4a2.2 2.2 0 013.1 0l.9.9a2.2 2.2 0 010 3.1L17.5 10.5l-4-4z"/><path d="M13.5 6.5L5 15v4h4l8.5-8.5"/>'
};

const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isHex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
const finite = a => Array.isArray(a) && a.every(v => typeof v === 'number' && isFinite(v));

function validStroke(s) {
  if (!s || typeof s !== 'object' || !STROKE_T.includes(s.t)) return null;
  const w = clamp(Number(s.w) || 2, 0.5, 400), c = isHex(s.c) ? s.c : '#25221e';
  if (s.t === 'text') {
    if (typeof s.s !== 'string' || !s.s || !isFinite(s.x) || !isFinite(s.y)) return null;
    return { t: 'text', x: s.x, y: s.y, c, w, s: s.s.slice(0, 2000) };
  }
  if (!finite(s.pts)) return null;
  if (s.t === 'pen' || s.t === 'marker' || s.t === 'erase') {
    if (!s.pts.length || s.pts.length % 3) return null;
    return { t: s.t, c, w, pr: s.pr ? 1 : 0, pts: s.pts.slice(0, 3 * 20000) };
  }
  if (s.pts.length !== 4) return null;
  return { t: s.t, c, w, pts: s.pts.slice() };
}

/* ---------- отрисовка (общая: редактор, экспорт) ---------- */
function smoothPath(g, pts) {
  const n = pts.length / 3;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  if (n === 2) { g.lineTo(pts[3], pts[4]); return; }
  for (let i = 1; i < n - 1; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1];
    g.quadraticCurveTo(x, y, (x + pts[i * 3 + 3]) / 2, (y + pts[i * 3 + 4]) / 2);
  }
  g.lineTo(pts[(n - 1) * 3], pts[(n - 1) * 3 + 1]);
}
const pw = (s, p) => s.w * (0.18 + 1.05 * clamp(p, 0, 1));
function drawFree(g, s) {
  const pts = s.pts, n = pts.length / 3;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = s.c; g.fillStyle = s.c;
  if (n === 1) { g.beginPath(); g.arc(pts[0], pts[1], (s.pr ? pw(s, pts[2]) : s.w) / 2, 0, Math.PI * 2); g.fill(); return; }
  if (!s.pr || s.t === 'marker') { g.lineWidth = s.w; smoothPath(g, pts); g.stroke(); return; }
  // переменная толщина (нажим пера): отрезки кривой между серединами с толщиной по нажиму
  let px = pts[0], py = pts[1];
  for (let i = 1; i < n; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], last = i === n - 1;
    const ex = last ? x : (x + pts[i * 3 + 3]) / 2, ey = last ? y : (y + pts[i * 3 + 4]) / 2;
    g.lineWidth = pw(s, (pts[i * 3 - 1] + pts[i * 3 + 2]) / 2);
    g.beginPath(); g.moveTo(px, py); g.quadraticCurveTo(x, y, ex, ey); g.stroke();
    px = ex; py = ey;
  }
}
function drawStroke(g, s) {
  g.save();
  if (s.t === 'erase') { g.globalCompositeOperation = 'destination-out'; drawFree(g, Object.assign({}, s, { c: '#000000', pr: 0 })); g.restore(); return; }
  if (s.t === 'marker') {
    // маркер: полупрозрачный, без потемнения на самопересечениях — рисуем непрозрачно во временный слой
    g.globalAlpha = MARKER_ALPHA;
  }
  if (s.t === 'pen' || s.t === 'marker') drawFree(g, s);
  else if (s.t === 'text') {
    g.fillStyle = s.c; g.font = '500 ' + s.w + 'px ' + FONT; g.textBaseline = 'top';
    String(s.s).split('\n').forEach((ln, i) => g.fillText(ln, s.x, s.y + i * s.w * 1.25));
  } else {
    const [x1, y1, x2, y2] = s.pts;
    g.strokeStyle = s.c; g.lineWidth = s.w; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath();
    if (s.t === 'line' || s.t === 'arrow') {
      g.moveTo(x1, y1); g.lineTo(x2, y2);
      if (s.t === 'arrow') {
        const a = Math.atan2(y2 - y1, x2 - x1), L = Math.min(Math.max(12, s.w * 3.4), Math.hypot(x2 - x1, y2 - y1) * 0.6 + s.w);
        g.moveTo(x2 - L * Math.cos(a - 0.45), y2 - L * Math.sin(a - 0.45)); g.lineTo(x2, y2);
        g.lineTo(x2 - L * Math.cos(a + 0.45), y2 - L * Math.sin(a + 0.45));
      }
    } else if (s.t === 'rect') {
      g.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (s.t === 'ellipse') {
      g.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
    }
    g.stroke();
  }
  g.restore();
}
// Маркеры рисуются через промежуточный слой, чтобы перекрытия внутри одного штриха не темнели.
let tmpLayer = null;
function drawStrokes(g, strokes) {
  let tmp = null;
  for (const s of strokes) {
    if (s.t === 'marker') {
      const c = g.canvas;
      if (!tmp) {
        if (!tmpLayer) tmpLayer = document.createElement('canvas');
        tmp = tmpLayer;
        if (tmp.width !== c.width || tmp.height !== c.height) { tmp.width = c.width; tmp.height = c.height; }
      }
      const t = tmp.getContext('2d');
      t.setTransform(1, 0, 0, 1, 0, 0); t.clearRect(0, 0, tmp.width, tmp.height);
      t.setTransform(g.getTransform());
      drawFree(t, s);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = MARKER_ALPHA; g.drawImage(tmp, 0, 0); g.restore();
    } else drawStroke(g, s);
  }
}
// Фон зарисовки (в координатах холста; k — масштаб для толщины линий).
function drawBackground(g, bg, W, H, k) {
  k = k || 1;
  if (bg === 'transparent') return;
  g.save();
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  const step = 40 * k;
  g.lineWidth = Math.max(1, k);
  if (bg === 'grid') {
    g.strokeStyle = '#dde2ea'; g.beginPath();
    for (let x = step; x < W; x += step) { g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, H); }
    for (let y = step; y < H; y += step) { g.moveTo(0, Math.round(y) + 0.5); g.lineTo(W, Math.round(y) + 0.5); }
    g.stroke();
  } else if (bg === 'lines') {
    g.strokeStyle = '#d3ddec'; g.beginPath();
    for (let y = step * 1.5; y < H; y += step) { g.moveTo(0, Math.round(y) + 0.5); g.lineTo(W, Math.round(y) + 0.5); }
    g.stroke();
    g.strokeStyle = '#efb3b6'; g.beginPath(); g.moveTo(Math.round(64 * k) + 0.5, 0); g.lineTo(Math.round(64 * k) + 0.5, H); g.stroke();
  }
  g.restore();
}

/* ---------- геометрия ---------- */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
// Прореживание точек (Рамер — Дуглас — Пекер): меньше данных, та же форма.
function simplify(pts, eps) {
  const n = pts.length / 3; if (n < 3) return pts.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    const ax = pts[a * 3], ay = pts[a * 3 + 1], bx = pts[b * 3], by = pts[b * 3 + 1];
    for (let i = a + 1; i < b; i++) {
      let d = segDist(pts[i * 3], pts[i * 3 + 1], ax, ay, bx, by);
      const pi = pts[i * 3 + 2], pa = pts[a * 3 + 2], pb = pts[b * 3 + 2];
      if (Math.abs(pi - (pa + pb) / 2) > 0.12) d = Math.max(d, eps * 1.01);    // сохраняем перепады нажима
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
  return out;
}
function hitStroke(s, x, y, r) {
  if (s.t === 'erase') return false;
  if (s.t === 'text') {
    const lines = String(s.s).split('\n'), w = Math.max(...lines.map(l => l.length)) * s.w * 0.56, hh = lines.length * s.w * 1.25;
    return x > s.x - r && x < s.x + w + r && y > s.y - r && y < s.y + hh + r;
  }
  const tol = r + s.w / 2;
  if (s.t === 'pen' || s.t === 'marker') {
    const p = s.pts, n = p.length / 3;
    if (n === 1) return Math.hypot(x - p[0], y - p[1]) <= tol;
    for (let i = 0; i < n - 1; i++) if (segDist(x, y, p[i * 3], p[i * 3 + 1], p[i * 3 + 3], p[i * 3 + 4]) <= tol) return true;
    return false;
  }
  const [x1, y1, x2, y2] = s.pts;
  if (s.t === 'line' || s.t === 'arrow') return segDist(x, y, x1, y1, x2, y2) <= tol;
  if (s.t === 'rect') {
    const L = Math.min(x1, x2), R = Math.max(x1, x2), T = Math.min(y1, y2), Bm = Math.max(y1, y2);
    return segDist(x, y, L, T, R, T) <= tol || segDist(x, y, R, T, R, Bm) <= tol || segDist(x, y, R, Bm, L, Bm) <= tol || segDist(x, y, L, Bm, L, T) <= tol;
  }
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
  let px = cx + rx, py = cy;
  for (let i = 1; i <= 48; i++) {
    const a = i / 48 * Math.PI * 2, qx = cx + rx * Math.cos(a), qy = cy + ry * Math.sin(a);
    if (segDist(x, y, px, py, qx, qy) <= tol) return true;
    px = qx; py = qy;
  }
  return false;
}

function loadPrefs() { try { return JSON.parse(localStorage.getItem('planer-sketch-prefs') || '{}') || {}; } catch (_) { return {}; } }
function savePrefs(p) { try { localStorage.setItem('planer-sketch-prefs', JSON.stringify(p)); } catch (_) {} }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; }); }

/* ---------- редактор ---------- */
function open(opts) {
  return new Promise(resolve => {
    const { h, icon, toast } = opts.ctx;
    const W = Math.round(clamp(Number(opts.width) || 1200, 50, 4000)), H = Math.round(clamp(Number(opts.height) || 800, 50, 4000));
    const prefs = loadPrefs();
    const st = {
      strokes: (opts.strokes || []).map(validStroke).filter(Boolean),
      bg: opts.image ? 'transparent' : (BGS.some(b => b[0] === opts.bg) ? opts.bg : 'white'),
      tool: TOOLS.some(t => t.id === prefs.tool) && prefs.tool !== 'pick' ? prefs.tool : 'pen',
      color: isHex(prefs.color) ? prefs.color : PALETTE[0],
      sizes: Object.assign({}, DEF_SIZES, prefs.sizes || {}),
      eraserMode: prefs.eraserMode === 'pixel' ? 'pixel' : 'stroke',
      view: { x: 0, y: 0, z: 1 }, undo: [], redo: [], cur: null, img: null, spaceDown: false, prevTool: 'pen', hover: null
    };
    const initial = JSON.stringify({ s: st.strokes, bg: st.bg });
    let active = null, textBox = null, closing = false, fitted = false, raf = 0, lastPen = 0;
    const pointers = new Map(); let pinch = null;

    /* --- разметка --- */
    const cBg = h('canvas', { class: 'sk-c' }), cInk = h('canvas', { class: 'sk-c' }), cLive = h('canvas', { class: 'sk-c' });
    const stage = h('div', { class: 'sk-stage', 'aria-label': 'Холст для рисования', role: 'img' }, cBg, cInk, cLive);
    const toolBtns = TOOLS.map(t => h('button', { class: 'sk-tool', type: 'button', 'data-tool': t.id, 'aria-label': t.label + ' (' + t.hint + ')', title: t.label + ' (' + t.hint + ')', 'aria-pressed': 'false', onclick: () => setTool(t.id) }, icon('sk' + (t.id === 'pick' ? 'pick' : t.id), 19)));
    const eraseMode = h('div', { class: 'sk-seg', role: 'radiogroup', 'aria-label': 'Режим ластика' },
      h('button', { type: 'button', 'data-m': 'stroke', role: 'radio', title: 'Стирать штрихи целиком', onclick: () => setEraser('stroke') }, 'Штрихи'),
      h('button', { type: 'button', 'data-m': 'pixel', role: 'radio', title: 'Стирать как резинкой', onclick: () => setEraser('pixel') }, 'Пиксели'));
    const colorBtns = PALETTE.map(c => h('button', { class: 'sk-col', type: 'button', style: '--c:' + c, 'data-c': c, 'aria-label': 'Цвет ' + c, title: c, onclick: () => setColor(c) }));
    const anyColor = h('input', { class: 'sk-any', type: 'color', 'aria-label': 'Любой цвет', title: 'Любой цвет' });
    anyColor.addEventListener('input', () => setColor(anyColor.value));
    const sizeIn = h('input', { class: 'sk-size', type: 'range', min: '1', max: '80', step: '1', 'aria-label': 'Толщина' });
    const sizeDot = h('span', { class: 'sk-dot', 'aria-hidden': 'true' });
    const sizeLbl = h('span', { class: 'sk-size-n' });
    sizeIn.addEventListener('input', () => { st.sizes[GROUP[st.tool]] = Number(sizeIn.value); paintSize(); });
    const bgBtns = BGS.map(([id, label]) => h('button', { class: 'sk-bg', type: 'button', 'data-bg': id, role: 'radio', 'aria-label': label, title: label, onclick: () => setBg(id) }));
    const zoomLbl = h('button', { class: 'sk-zl', type: 'button', title: 'Вписать', onclick: () => fit() }, '100%');
    const tb = (ic, label, run) => h('button', { class: 'tool', type: 'button', 'aria-label': label, title: label, onclick: run }, icon(ic, 17));
    const undoB = tb('undo', 'Отменить (Ctrl+Z)', () => undo()), redoB = tb('redo', 'Повторить (Ctrl+Shift+Z)', () => redo());
    const clearB = tb('trash', 'Очистить холст', () => clearAll());
    const ov = h('div', { class: 'sk-ov', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || 'Редактор зарисовки' },
      h('div', { class: 'sk-head' },
        h('div', { class: 'sk-title' }, icon('brush', 17), h('span', {}, opts.title || 'Зарисовка')),
        h('div', { class: 'sk-acts' }, undoB, redoB, clearB, h('span', { class: 'bd-tsep' }),
          h('button', { class: 'sk-btn', type: 'button', onclick: () => finish(false) }, 'Отмена'),
          h('button', { class: 'sk-btn primary', type: 'button', onclick: () => finish(true) }, 'Готово'))),
      h('div', { class: 'sk-bar', role: 'toolbar', 'aria-label': 'Инструменты' },
        h('div', { class: 'sk-group' }, toolBtns),
        eraseMode,
        h('span', { class: 'sk-sep' }),
        h('div', { class: 'sk-group sk-colors' }, colorBtns, h('label', { class: 'sk-anywrap', title: 'Любой цвет' }, anyColor)),
        h('span', { class: 'sk-sep' }),
        h('div', { class: 'sk-group sk-sizebox' }, sizeDot, sizeIn, sizeLbl),
        opts.image ? null : h('span', { class: 'sk-sep' }),
        opts.image ? null : h('div', { class: 'sk-group sk-bgs', role: 'radiogroup', 'aria-label': 'Фон' }, bgBtns),
        h('span', { class: 'spacer' }),
        h('div', { class: 'sk-group' }, tb('minus', 'Уменьшить', () => zoomStep(1 / 1.25)), zoomLbl, tb('plus', 'Увеличить', () => zoomStep(1.25)), tb('fit', 'Вписать', () => fit()))),
      stage,
      h('div', { class: 'sk-foot' }, h('span', {}, h('kbd', {}, 'Esc'), ' — сохранить и закрыть · ', h('kbd', {}, 'Пробел'), ' или средняя кнопка — перемещение · ', h('kbd', {}, 'Ctrl'), '+колесо — масштаб · ', h('kbd', {}, '['), ' ', h('kbd', {}, ']'), ' — толщина'),
        h('span', {}, 'Shift — ровные линии и фигуры')));

    /* --- состояние панели --- */
    const size = grp => st.sizes[grp] || DEF_SIZES[grp];
    const textSize = () => Math.max(12, size('text') * 4);
    function paintTools() {
      toolBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === st.tool)));
      eraseMode.hidden = st.tool !== 'eraser';
      eraseMode.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.m === st.eraserMode)));
      stage.dataset.tool = st.tool;
      paintSize();
    }
    function paintSize() {
      const grp = GROUP[st.tool], v = size(grp);
      sizeIn.value = String(v);
      const px = grp === 'text' ? Math.min(28, textSize() / 3) : Math.min(30, Math.max(2, v));
      sizeDot.style.width = sizeDot.style.height = px + 'px';
      sizeDot.style.background = st.tool === 'eraser' ? 'transparent' : st.color;
      sizeDot.style.opacity = st.tool === 'marker' ? MARKER_ALPHA + 0.15 : 1;
      sizeLbl.textContent = grp === 'text' ? textSize() + ' пт' : v + ' px';
      sizeIn.setAttribute('aria-valuetext', sizeLbl.textContent);
      scheduleLive();
    }
    function paintColors() {
      colorBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.c.toLowerCase() === st.color.toLowerCase())));
      anyColor.value = st.color;
      paintSize();
    }
    function paintBg() { bgBtns.forEach(b => b.setAttribute('aria-checked', String(b.dataset.bg === st.bg))); }
    function paintHistory() { undoB.disabled = !st.undo.length; redoB.disabled = !st.redo.length; clearB.disabled = !st.strokes.length; }
    function setTool(t) { if (textBox) commitText(); if (t === 'pick' && st.tool !== 'pick') st.prevTool = st.tool; st.tool = t; paintTools(); }
    function setEraser(m) { st.eraserMode = m; paintTools(); }
    function setColor(c) { if (!isHex(c)) return; st.color = c.toLowerCase(); if (textBox) { textBox.color = st.color; textBox.ta.style.color = st.color; } paintColors(); }
    function setBg(bg) { if (bg === st.bg) return; pushUndo(st.strokes, st.bg); st.bg = bg; paintBg(); renderBg(); }

    /* --- история --- */
    function pushUndo(strokes, bg) { st.undo.push({ s: strokes, bg }); if (st.undo.length > 300) st.undo.shift(); st.redo = []; paintHistory(); }
    function undo() { if (textBox) commitText(); const u = st.undo.pop(); if (!u) return; st.redo.push({ s: st.strokes, bg: st.bg }); st.strokes = u.s; st.bg = u.bg; paintBg(); paintHistory(); renderAll(); }
    function redo() { const r = st.redo.pop(); if (!r) return; st.undo.push({ s: st.strokes, bg: st.bg }); st.strokes = r.s; st.bg = r.bg; paintBg(); paintHistory(); renderAll(); }
    function clearAll() { if (!st.strokes.length) return; pushUndo(st.strokes, st.bg); st.strokes = []; renderInk(); paintHistory(); }

    /* --- холст и вид --- */
    let dpr = window.devicePixelRatio || 1, cw = 1, ch = 1;
    function resize() {
      const r = stage.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1; cw = Math.max(1, Math.round(r.width)); ch = Math.max(1, Math.round(r.height));
      for (const c of [cBg, cInk, cLive]) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); c.style.width = cw + 'px'; c.style.height = ch + 'px'; }
      if (!fitted) { fitted = true; fit(); } else renderAll();
    }
    const setT = g => { const v = st.view; g.setTransform(dpr * v.z, 0, 0, dpr * v.z, dpr * v.x, dpr * v.y); };
    const clear = g => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, g.canvas.width, g.canvas.height); };
    let checker = null;
    function renderBg() {
      const g = cBg.getContext('2d'); clear(g); setT(g);
      g.save();
      g.shadowColor = 'rgba(0,0,0,.22)'; g.shadowBlur = 24 * dpr; g.shadowOffsetY = 4 * dpr;
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
      g.restore();
      if (st.bg === 'transparent' || st.img) {
        if (!checker) {
          const t = document.createElement('canvas'); t.width = t.height = 32; const x = t.getContext('2d');
          x.fillStyle = '#ffffff'; x.fillRect(0, 0, 32, 32); x.fillStyle = '#eceae6'; x.fillRect(0, 0, 16, 16); x.fillRect(16, 16, 16, 16);
          checker = g.createPattern(t, 'repeat');
        }
        g.fillStyle = checker; g.fillRect(0, 0, W, H);
        if (st.img) { g.imageSmoothingQuality = 'high'; g.drawImage(st.img, 0, 0, W, H); }
      } else drawBackground(g, st.bg, W, H, 1);
    }
    function renderInk(extra) {
      const g = cInk.getContext('2d'); clear(g); setT(g);
      g.save(); g.beginPath(); g.rect(0, 0, W, H); g.clip();
      drawStrokes(g, extra ? st.strokes.concat([extra]) : st.strokes);
      g.restore();
    }
    function renderLive() {
      raf = 0;
      const g = cLive.getContext('2d'); clear(g); setT(g);
      const c = st.cur;
      if (c && c.t !== 'erase') { g.save(); g.beginPath(); g.rect(0, 0, W, H); g.clip(); drawStrokes(g, [c]); g.restore(); }
      // кружок-курсор с размером кисти
      if (st.hover && !pinch && ['pen', 'marker', 'eraser'].includes(st.tool) && !st.spaceDown) {
        const p = toDoc(st.hover.x, st.hover.y), rr = size(GROUP[st.tool]) / 2;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        const sx = p.x * st.view.z + st.view.x, sy = p.y * st.view.z + st.view.y, sr = Math.max(1.5, rr * st.view.z);
        g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(sx, sy, sr + 1, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = 'rgba(30,28,25,.75)'; g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.stroke();
      }
    }
    const scheduleLive = () => { if (!raf) raf = requestAnimationFrame(renderLive); };
    function renderAll() { renderBg(); renderInk(); renderLive(); zoomLbl.textContent = Math.round(st.view.z * 100) + '%'; positionText(); paintHistory(); }
    function fit() {
      const z = clamp(Math.min((cw - 48) / W, (ch - 48) / H), 0.05, 8);
      st.view = { z, x: Math.round((cw - W * z) / 2), y: Math.round((ch - H * z) / 2) };
      renderAll();
    }
    function zoomAt(z, px, py) { const v = st.view, z1 = clamp(z, 0.05, 12); v.x = px - (px - v.x) * (z1 / v.z); v.y = py - (py - v.y) * (z1 / v.z); v.z = z1; renderAll(); }
    function zoomStep(f) { zoomAt(st.view.z * f, cw / 2, ch / 2); }
    function toDoc(cx, cy) { const r = stage.getBoundingClientRect(), v = st.view; return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z }; }

    /* --- рисование --- */
    function eraseAt(p) {
      const r = size('eraser') / 2;
      const keep = st.strokes.filter(s => !hitStroke(s, p.x, p.y, r));
      if (keep.length !== st.strokes.length) { st.strokes = keep; renderInk(); }
    }
    function addPoint(ev, shift) {
      const p = toDoc(ev.clientX, ev.clientY), c = st.cur;
      if (active.tool === 'eraser' && st.eraserMode === 'stroke') { eraseAt(p); return; }
      if (!c) return;
      if (c.t === 'pen' || c.t === 'marker' || c.t === 'erase') {
        const n = c.pts.length, lx = c.pts[n - 3], ly = c.pts[n - 2];
        let x = p.x, y = p.y;
        if (ev.pointerType !== 'mouse') { x = lx + (x - lx) * 0.6; y = ly + (y - ly) * 0.6; }   // гасим дрожание пера и пальца
        if (Math.hypot(x - lx, y - ly) < 0.75 / st.view.z) return;
        c.pts.push(r1(x), r1(y), c.pr ? r2(clamp(ev.pressure || 0.5, 0.05, 1)) : 0.5);
      } else {
        const s = active.start; let x = p.x, y = p.y;
        if (shift) {
          const dx = x - s.x, dy = y - s.y;
          if (c.t === 'line' || c.t === 'arrow') { const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), L = Math.hypot(dx, dy); x = s.x + L * Math.cos(a); y = s.y + L * Math.sin(a); }
          else { const m = Math.max(Math.abs(dx), Math.abs(dy)); x = s.x + Math.sign(dx || 1) * m; y = s.y + Math.sign(dy || 1) * m; }
        }
        c.pts = [r1(s.x), r1(s.y), r1(x), r1(y)];
      }
    }
    function onDown(e) {
      if (closing) return;
      if (textBox && e.target !== textBox.ta) { commitText(); if (st.tool === 'text') return; }
      if (e.pointerType === 'touch') {
        if (Date.now() - lastPen < 1200) return;                    // ладонь при рисовании пером
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) { cancelStroke(); startPinch(); return; }
        if (pointers.size > 2) return;
      }
      if (e.pointerType === 'pen') lastPen = Date.now();
      if (e.button === 1 || st.spaceDown) { e.preventDefault(); startPan(e); return; }
      const penEraser = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32));
      if (e.button !== 0 && !penEraser) return;
      e.preventDefault();
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      const p = toDoc(e.clientX, e.clientY);
      const tool = penEraser ? 'eraser' : st.tool;
      active = { id: e.pointerId, tool, before: st.strokes, bg: st.bg, start: p };
      if (tool === 'pick') { active = null; pick(e); return; }
      if (tool === 'text') { active = null; startText(p); return; }
      if (tool === 'eraser') {
        if (st.eraserMode === 'stroke') { eraseAt(p); return; }
        st.cur = { t: 'erase', c: '#000000', w: size('eraser'), pr: 0, pts: [r1(p.x), r1(p.y), 0.5] }; renderInk(st.cur); return;
      }
      if (tool === 'pen' || tool === 'marker') {
        const pr = e.pointerType === 'pen' && tool === 'pen';
        st.cur = { t: tool, c: st.color, w: size(tool), pr: pr ? 1 : 0, pts: [r1(p.x), r1(p.y), pr ? r2(clamp(e.pressure || 0.5, 0.05, 1)) : 0.5] };
      } else st.cur = { t: tool, c: st.color, w: size('shape'), pts: [r1(p.x), r1(p.y), r1(p.x), r1(p.y)] };
      scheduleLive();
    }
    function onMove(e) {
      if (e.pointerType !== 'touch') st.hover = { x: e.clientX, y: e.clientY };
      if (pinch && pointers.has(e.pointerId)) { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); movePinch(); return; }
      if (!active || e.pointerId !== active.id) { scheduleLive(); return; }
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      (evs.length ? evs : [e]).forEach(ev => addPoint(ev, e.shiftKey));
      if (st.cur && st.cur.t === 'erase') renderInk(st.cur);
      scheduleLive();
    }
    function onUp(e) {
      if (pointers.has(e.pointerId)) { pointers.delete(e.pointerId); if (pinch && pointers.size < 2) pinch = null; }
      if (!active || e.pointerId !== active.id) return;
      if (e.type === 'pointerup' && st.cur && (st.cur.t === 'pen' || st.cur.t === 'marker' || st.cur.t === 'erase')) {
        const p = toDoc(e.clientX, e.clientY), c = st.cur, n = c.pts.length;
        if (Math.hypot(p.x - c.pts[n - 3], p.y - c.pts[n - 2]) > 0.3) c.pts.push(r1(p.x), r1(p.y), c.pts[n - 1]);
      }
      finishStroke();
    }
    function finishStroke() {
      const a = active, c = st.cur; active = null; st.cur = null;
      if (!a) return;
      if (a.tool === 'eraser' && st.eraserMode === 'stroke') { if (st.strokes !== a.before && st.strokes.length !== a.before.length) pushUndo(a.before, a.bg); renderLive(); return; }
      if (!c) { renderLive(); return; }
      if (c.pts.length === 4) {
        const [x1, y1, x2, y2] = c.pts, tiny = 2 / st.view.z;
        if ((c.t === 'line' || c.t === 'arrow') ? Math.hypot(x2 - x1, y2 - y1) < tiny : (Math.abs(x2 - x1) < tiny || Math.abs(y2 - y1) < tiny)) { renderLive(); return; }
      } else {
        c.pts = simplify(c.pts, c.pr ? 0.18 : 0.3);
        if (c.pts.length > 3 * 6000) { const step = Math.ceil(c.pts.length / 3 / 6000); const out = []; for (let i = 0; i < c.pts.length / 3; i += step) out.push(c.pts[i * 3], c.pts[i * 3 + 1], c.pts[i * 3 + 2]); c.pts = out; }
      }
      st.strokes = st.strokes.concat([c]);
      pushUndo(a.before, a.bg);
      renderInk(); renderLive();
    }
    function cancelStroke() { if (active) { if (st.strokes !== active.before) st.strokes = active.before; active = null; st.cur = null; renderInk(); renderLive(); } }
    function startPan(e) {
      const sx = e.clientX, sy = e.clientY, vx = st.view.x, vy = st.view.y;
      try { stage.setPointerCapture(e.pointerId); } catch (_) {}
      stage.classList.add('panning');
      const mv = ev => { if (ev.pointerId !== e.pointerId) return; st.view.x = vx + ev.clientX - sx; st.view.y = vy + ev.clientY - sy; renderAll(); };
      const up = ev => { if (ev.pointerId !== e.pointerId) return; stage.removeEventListener('pointermove', mv); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up); stage.classList.remove('panning'); };
      stage.addEventListener('pointermove', mv); stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    }
    function startPinch() {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, v: Object.assign({}, st.view) };
    }
    function movePinch() {
      const [a, b] = [...pointers.values()]; if (!a || !b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, r = stage.getBoundingClientRect();
      const z = clamp(pinch.v.z * d / pinch.d, 0.05, 12), px = pinch.cx - r.left, py = pinch.cy - r.top;
      st.view = { z, x: px - (px - pinch.v.x) * (z / pinch.v.z) + (cx - pinch.cx), y: py - (py - pinch.v.y) * (z / pinch.v.z) + (cy - pinch.cy) };
      renderAll();
    }
    function pick(e) {
      const r = stage.getBoundingClientRect();
      const x = Math.round((e.clientX - r.left) * dpr), y = Math.round((e.clientY - r.top) * dpr);
      const t = document.createElement('canvas'); t.width = t.height = 1;
      const g = t.getContext('2d', { willReadFrequently: true });
      try {
        g.drawImage(cBg, x, y, 1, 1, 0, 0, 1, 1); g.drawImage(cInk, x, y, 1, 1, 0, 0, 1, 1);
        const d = g.getImageData(0, 0, 1, 1).data;
        if (d[3] < 8) return;
        setColor('#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''));
        setTool(st.prevTool && st.prevTool !== 'pick' && st.prevTool !== 'eraser' ? st.prevTool : 'pen');
      } catch (_) { toast('Не удалось взять цвет с изображения.'); }
    }

    /* --- текст --- */
    function startText(p) {
      const ta = h('textarea', { class: 'sk-textin', rows: '1', spellcheck: 'false', 'aria-label': 'Текст подписи', placeholder: 'Текст' });
      textBox = { ta, p, fs: textSize(), color: st.color };
      ta.style.color = st.color;
      stage.append(ta); positionText();
      ta.addEventListener('input', positionText);
      ta.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); textBox = null; ta.remove(); }
        else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); commitText(); }
      });
      ta.addEventListener('blur', () => setTimeout(() => { if (textBox && textBox.ta === ta) commitText(); }, 0));
      setTimeout(() => ta.focus(), 0);
    }
    function positionText() {
      if (!textBox) return;
      const { ta, p, fs } = textBox, v = st.view;
      ta.style.left = (p.x * v.z + v.x) + 'px'; ta.style.top = (p.y * v.z + v.y) + 'px';
      ta.style.fontSize = (fs * v.z) + 'px'; ta.style.fontFamily = FONT;
      ta.style.height = 'auto'; ta.style.width = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
      ta.style.width = Math.max(40, ta.scrollWidth + 8) + 'px';
    }
    function commitText() {
      const tbx = textBox; if (!tbx) return; textBox = null;
      const s = tbx.ta.value.replace(/\s+$/, ''); tbx.ta.remove();
      if (!s) return;
      const before = st.strokes;
      st.strokes = st.strokes.concat([{ t: 'text', x: r1(tbx.p.x), y: r1(tbx.p.y), c: tbx.color, w: tbx.fs, s: s.slice(0, 2000) }]);
      pushUndo(before, st.bg); renderInk();
    }

    /* --- клавиатура, колесо --- */
    function onKey(e) {
      if (closing) return;
      const mod = e.ctrlKey || e.metaKey;
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === 'Escape') { stop(); finish(true); return; }
      if (mod && e.code === 'KeyZ') { stop(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.code === 'KeyY') { stop(); redo(); return; }
      if (mod && e.code === 'KeyS') { stop(); finish(true); return; }
      e.stopPropagation();
      if (mod || e.altKey) return;
      if (e.target && e.target.closest && e.target.closest('input,textarea')) return;
      const t = TOOLS.find(x => x.key === e.code);
      if (t && !e.shiftKey) { e.preventDefault(); setTool(t.id); return; }
      if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
        e.preventDefault(); const g = GROUP[st.tool], v = size(g);
        st.sizes[g] = clamp(Math.round(e.code === 'BracketLeft' ? v / 1.2 : v * 1.2 + 0.5), 1, 80); paintSize(); return;
      }
      if (e.code === 'Space') { e.preventDefault(); if (!st.spaceDown) { st.spaceDown = true; stage.classList.add('space'); scheduleLive(); } return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomStep(1.25); return; }
      if (e.key === '-') { e.preventDefault(); zoomStep(1 / 1.25); return; }
      if (e.key === '0') { e.preventDefault(); fit(); }
    }
    function onKeyUp(e) { if (e.code === 'Space') { st.spaceDown = false; stage.classList.remove('space'); } }
    function onWheel(e) {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 18 : 1, r = stage.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(st.view.z * Math.exp(-e.deltaY * unit * 0.0022), e.clientX - r.left, e.clientY - r.top);
      else { st.view.x -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit; st.view.y -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * unit; renderAll(); }
    }

    /* --- завершение --- */
    async function exportPng() {
      if (!st.strokes.length) return null;
      const k = Math.min(2, 2400 / Math.max(W, H));
      const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
      const g = c.getContext('2d'); g.setTransform(k, 0, 0, k, 0, 0);
      drawStrokes(g, st.strokes);
      const b = await new Promise(res => c.toBlob(res, 'image/png'));
      return b ? await b.arrayBuffer() : null;
    }
    async function finish(save) {
      if (closing) return; closing = true;
      if (textBox) commitText();
      if (active) finishStroke();
      savePrefs({ tool: st.tool === 'pick' ? st.prevTool : st.tool, color: st.color, sizes: st.sizes, eraserMode: st.eraserMode });
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onKeyUp, true);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', resize);
      const changed = JSON.stringify({ s: st.strokes, bg: st.bg }) !== initial;
      let png = null;
      if (save && changed) { try { png = await exportPng(); } catch (_) { png = null; } }
      ov.remove();
      if (!save) { resolve(null); return; }
      if (!changed) { resolve({ unchanged: true }); return; }
      resolve({ strokes: st.strokes, bg: st.bg, width: W, height: H, png });
    }

    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', e => { if (active && e.pointerId === active.id) cancelStroke(); onUp(e); });
    stage.addEventListener('pointerleave', () => { st.hover = null; scheduleLive(); });
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKeyUp, true);
    const ro = 'ResizeObserver' in window ? new ResizeObserver(() => resize()) : null;
    if (!ro) window.addEventListener('resize', resize);
    document.body.append(ov);
    if (ro) ro.observe(stage);
    paintTools(); paintColors(); paintBg(); paintHistory();
    resize();
    ov.querySelector('.sk-btn.primary').focus({ preventScroll: true });
    if (opts.image) loadImg(opts.image).then(img => { st.img = img; renderBg(); }, () => toast('Не удалось загрузить изображение-основу.'));
  });
}

window.PlanerSketch = { open, drawBackground, drawStrokes, validStroke, simplify, ICONS };
})();
