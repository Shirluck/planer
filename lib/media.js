// Медиа-хранилище: файлы копируются в media/<sha256>.<ext> (одинаковые файлы хранятся один раз),
// миниатюры — media/thumbs/, векторные данные зарисовок — media/vectors/<sha256>.json.
// Страница получает файлы только через схему media://<id> (см. handleRequest) и никогда не передаёт пути.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { writeAtomic } = require('./store');

const ID_RE = /^[a-f0-9]{64}$/;
const DAY = 24 * 3600 * 1000;
const GC_AGE = 7 * DAY;

// Белый список форматов. serve — Content-Type, с которым файл отдаётся странице.
const TYPES = {
  png:  { kind: 'image', mime: 'image/png' },
  jpg:  { kind: 'image', mime: 'image/jpeg' },
  gif:  { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  avif: { kind: 'image', mime: 'image/avif' },
  svg:  { kind: 'image', mime: 'image/svg+xml' },
  mp4:  { kind: 'video', mime: 'video/mp4' },
  webm: { kind: 'video', mime: 'video/webm' },
  mov:  { kind: 'video', mime: 'video/quicktime', serve: 'video/mp4' },
  mkv:  { kind: 'video', mime: 'video/x-matroska', serve: 'video/webm' }
};
const ALIASES = { jpeg: 'jpg', jpe: 'jpg', jfif: 'jpg', m4v: 'mp4' };
const MIME_TO_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv' };
const THUMB_EXT = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const SUPPORTED_LIST = 'PNG, JPG, WEBP, GIF, AVIF, SVG, MP4, WEBM, MOV, MKV';

class MediaError extends Error { constructor(code, message) { super(message); this.code = code; } }

const mb = n => (n / 1048576 >= 1024 ? (n / 1073741824).toFixed(1).replace('.', ',') + ' ГБ' : Math.max(1, Math.round(n / 1048576)) + ' МБ');

// Определение формата по сигнатуре (магическим байтам).
function sniff(b) {
  if (!b || !b.length) return null;
  const s = (a, z) => b.toString('latin1', a, Math.min(z, b.length));
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504E47 && b.readUInt32BE(4) === 0x0D0A1A0A) return 'png';
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpg';
  if (b.length >= 6 && /^GIF8[79]a$/.test(s(0, 6))) return 'gif';
  if (b.length >= 12 && s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return 'webp';
  if (b.length >= 4 && b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return s(0, 64).includes('webm') ? 'webm' : 'mkv';
  if (b.length >= 12 && s(4, 8) === 'ftyp') {
    const major = s(8, 12);
    const boxEnd = Math.min(b.readUInt32BE(0) || 0, b.length, 256);
    const brands = [major];
    for (let i = 16; i + 4 <= boxEnd; i += 4) brands.push(s(i, i + 4));
    if (brands.includes('avif') || brands.includes('avis')) return 'avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(major)) return 'heic';
    if (major === 'qt  ') return 'mov';
    return 'mp4';
  }
  if (b.length >= 8 && ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(s(4, 8))) return 'mov';
  const text = b.toString('utf8', 0, Math.min(b.length, 4096)).replace(/^﻿/, '').trimStart();
  if (/^(<\?xml|<svg|<!--|<!DOCTYPE svg)/i.test(text) && /<svg[\s>]/i.test(text)) return 'svg';
  return null;
}

// Ориентация JPEG из EXIF (1 — без поворота). Нужна, потому что nativeImage её не учитывает.
function jpegOrientation(b) {
  try {
    let i = 2;
    while (i + 4 < b.length) {
      if (b[i] !== 0xFF) return 1;
      const marker = b[i + 1], len = b.readUInt16BE(i + 2);
      if (marker === 0xE1 && b.toString('latin1', i + 4, i + 8) === 'Exif') {
        const t = i + 10, le = b.toString('latin1', t, t + 2) === 'II';
        const u16 = o => le ? b.readUInt16LE(o) : b.readUInt16BE(o);
        const u32 = o => le ? b.readUInt32LE(o) : b.readUInt32BE(o);
        const ifd = t + u32(t + 4), n = u16(ifd);
        for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (u16(e) === 0x0112) return u16(e + 8) || 1; }
        return 1;
      }
      if (marker === 0xDA) return 1;
      i += 2 + len;
    }
  } catch (_) {}
  return 1;
}

function extOf(name, mime) {
  let ext = String(path.extname(String(name || '')) || '').slice(1).toLowerCase();
  ext = ALIASES[ext] || ext;
  if (!ext && mime) ext = MIME_TO_EXT[String(mime).toLowerCase()] || '';
  return ext;
}

function fsMessage(e, name) {
  const c = e && e.code;
  const f = name ? '«' + name + '»' : '';
  if (c === 'ENOSPC') return 'Недостаточно места на диске, чтобы добавить ' + (f || 'файл') + '.';
  if (c === 'ENOENT') return 'Файл ' + f + ' не найден — возможно, он перемещён или удалён.';
  if (c === 'EACCES' || c === 'EPERM') return 'Нет доступа к файлу ' + f + '.';
  if (c === 'EBUSY') return 'Файл ' + f + ' занят другой программой.';
  if (c === 'EISDIR') return f + ' — это папка, а не файл.';
  return 'Не удалось скопировать файл ' + f + '.';
}

function createMedia(dir, opts = {}) {
  const mediaDir = path.join(dir, 'media');
  const thumbsDir = path.join(mediaDir, 'thumbs');
  const vecDir = path.join(mediaDir, 'vectors');
  const indexFile = path.join(mediaDir, 'index.json');
  const MAX = Number(process.env.PLANER_MAX_MEDIA_BYTES) || 2 * 1024 * 1024 * 1024;
  const PROGRESS_MIN = Number(process.env.PLANER_PROGRESS_MIN_BYTES) || 200 * 1024 * 1024;
  const nativeImage = opts.nativeImage;
  let index = {};
  let indexTimer = null;

  fs.mkdirSync(thumbsDir, { recursive: true });
  fs.mkdirSync(vecDir, { recursive: true });
  try { index = JSON.parse(fs.readFileSync(indexFile, 'utf8')) || {}; if (typeof index !== 'object' || Array.isArray(index)) index = {}; } catch (_) { index = {}; }

  const saveIndexSoon = () => { clearTimeout(indexTimer); indexTimer = setTimeout(saveIndex, 1000); };
  function saveIndex() { clearTimeout(indexTimer); indexTimer = null; try { writeAtomic(indexFile, JSON.stringify(index)); } catch (_) {} }
  const inside = (base, f) => { const r = path.resolve(f); return r.startsWith(path.resolve(base) + path.sep); };

  function entry(id) { return index[id] || (index[id] = {}); }
  function originalPath(id) {
    if (!ID_RE.test(id)) return null;
    const e = index[id];
    if (e && e.ext && TYPES[e.ext]) { const f = path.join(mediaDir, id + '.' + e.ext); if (fs.existsSync(f)) return { file: f, ext: e.ext }; }
    for (const ext of Object.keys(TYPES)) {
      const f = path.join(mediaDir, id + '.' + ext);
      if (fs.existsSync(f)) { entry(id).ext = ext; saveIndexSoon(); return { file: f, ext }; }
    }
    return null;
  }
  function thumbPath(id) {
    if (!ID_RE.test(id)) return null;
    for (const ext of Object.keys(THUMB_EXT)) { const f = path.join(thumbsDir, id + '.' + ext); if (fs.existsSync(f)) return { file: f, ext }; }
    return null;
  }
  const touchRef = id => { entry(id).lastRef = Date.now(); saveIndexSoon(); };
  // Документ записан: все упомянутые в нём медиа считаем «используемыми сейчас».
  function touchRefsInText(text) {
    const m = String(text || '').match(/[a-f0-9]{64}/g);
    if (!m) return;
    const now = Date.now();
    for (const id of new Set(m)) if (index[id] || fs.existsSync(path.join(vecDir, id + '.json')) || originalPath(id)) entry(id).lastRef = now;
    saveIndexSoon();
  }

  function check(name, size, ext) {
    if (!TYPES[ext]) throw new MediaError('unsupported', 'Формат ' + (ext ? '«.' + ext + '»' : 'файла «' + name + '»') + ' не поддерживается. Можно добавлять: ' + SUPPORTED_LIST + '.');
    if (!size) throw new MediaError('empty', 'Файл «' + name + '» пустой.');
    if (size > MAX) throw new MediaError('too_big', 'Файл «' + name + '» слишком большой (' + mb(size) + '). Максимум — ' + mb(MAX) + ' на файл.');
  }
  function checkSignature(name, ext, head) {
    const real = sniff(head);
    if (real === 'heic') throw new MediaError('unsupported', 'Формат HEIC/HEIF не поддерживается. Сохраните фото как JPG или PNG.');
    if (!real || !TYPES[real] || TYPES[real].kind !== TYPES[ext].kind)
      throw new MediaError('mismatch', 'Файл «' + name + '» повреждён или не соответствует расширению .' + ext + '.');
    return real;          // храним с расширением настоящего формата
  }

  function describe(id, ext, name, size) {
    const t = TYPES[ext], e = entry(id);
    e.ext = ext; e.size = size; e.lastRef = Date.now();
    const meta = { id, ext, kind: t.kind, mime: t.mime, size, name: String(name || '').slice(0, 200) };
    if (t.kind === 'image' && (ext === 'png' || ext === 'jpg') && nativeImage) {
      try {
        const file = path.join(mediaDir, id + '.' + ext);
        let orient = 1;
        if (ext === 'jpg') { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(65536); const n = fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); orient = jpegOrientation(b.subarray(0, n)); }
        const img = nativeImage.createFromPath(file);
        if (!img.isEmpty()) {
          let { width, height } = img.getSize();
          if (orient >= 5 && orient <= 8) [width, height] = [height, width];
          meta.width = width; meta.height = height; e.w = width; e.h = height;
          if (orient !== 1) meta.needsThumb = Math.max(width, height) > 512;     // поворот по EXIF — миниатюру сделает страница
          else if (Math.max(width, height) > 512 && !thumbPath(id)) {
            const sz = img.getSize(), k = 512 / Math.max(sz.width, sz.height);
            const small = img.resize({ width: Math.round(sz.width * k), height: Math.round(sz.height * k), quality: 'good' });
            if (ext === 'png') writeAtomic(path.join(thumbsDir, id + '.png'), small.toPNG());
            else writeAtomic(path.join(thumbsDir, id + '.jpg'), small.toJPEG(85));
          }
        }
      } catch (_) {}
    }
    if (thumbPath(id)) meta.thumb = true;
    else if (t.kind === 'video' || ((ext === 'webp' || ext === 'avif') && meta.needsThumb !== false)) meta.needsThumb = true;
    saveIndexSoon();
    return meta;
  }

  // Импорт файла с диска: потоковое копирование с подсчётом SHA-256, без чтения файла целиком в память.
  async function importPath(src, name, onProgress) {
    name = String(name || path.basename(String(src)));
    try {
      if (typeof src !== 'string' || !path.isAbsolute(src)) throw new MediaError('bad_path', 'Не удалось прочитать файл «' + name + '».');
      const ext = extOf(name);
      const st = await fsp.stat(src);
      if (st.isDirectory()) throw new MediaError('dir', '«' + name + '» — это папка. Перетащите сами файлы.');
      check(name, st.size, ext);
      const fh = await fsp.open(src, 'r');
      const head = Buffer.alloc(4096);
      let n = 0;
      try { n = (await fh.read(head, 0, head.length, 0)).bytesRead; } finally { await fh.close(); }
      const real = checkSignature(name, ext, head.subarray(0, n));
      const tmp = path.join(mediaDir, '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex'));
      const hash = crypto.createHash('sha256');
      let done = 0, last = 0;
      const big = st.size >= PROGRESS_MIN;
      try {
        await new Promise(/** @param {(v?: any) => void} resolve @param {(e: any) => void} reject */ (resolve, reject) => {
          const rs = fs.createReadStream(src, { highWaterMark: 1 << 20 });
          const ws = fs.createWriteStream(tmp, { flags: 'wx' });
          rs.on('data', chunk => {
            hash.update(chunk); done += chunk.length;
            if (big && onProgress && Date.now() - last > 120) { last = Date.now(); onProgress(done, st.size, name); }
          });
          rs.on('error', reject); ws.on('error', reject); ws.on('finish', resolve);
          rs.pipe(ws);
        });
        if (big && onProgress) onProgress(st.size, st.size, name);
        const id = hash.digest('hex');
        const dst = path.join(mediaDir, id + '.' + real);
        if (fs.existsSync(dst)) await fsp.unlink(tmp);
        else await fsp.rename(tmp, dst);
        return { ok: true, meta: describe(id, real, name, st.size) };
      } catch (e) { try { await fsp.unlink(tmp); } catch (_) {} throw e; }
    } catch (e) {
      return { ok: false, code: e.code || 'io', error: e instanceof MediaError ? e.message : fsMessage(e, name) };
    }
  }

  // Импорт данных без пути (вставка из буфера, перетаскивание из браузера, готовые зарисовки).
  async function importBuffer(name, mime, data) {
    name = String(name || 'image').slice(0, 200);
    try {
      const buf = Buffer.isBuffer(data) ? data : data instanceof Uint8Array ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : data instanceof ArrayBuffer ? Buffer.from(data) : null;
      if (!buf) throw new MediaError('bad_data', 'Не удалось прочитать данные «' + name + '».');
      let ext = extOf(name, mime);
      if (!TYPES[ext]) { const real = sniff(buf.subarray(0, 4096)); if (real && TYPES[real] && !path.extname(name)) ext = real; }
      check(name, buf.length, ext);
      const real = checkSignature(name, ext, buf.subarray(0, 4096));
      const id = crypto.createHash('sha256').update(buf).digest('hex');
      const dst = path.join(mediaDir, id + '.' + real);
      if (!fs.existsSync(dst)) writeAtomic(dst, buf);
      return { ok: true, meta: describe(id, real, name, buf.length) };
    } catch (e) {
      return { ok: false, code: e.code || 'io', error: e instanceof MediaError ? e.message : fsMessage(e, name) };
    }
  }

  // Миниатюра, сделанная страницей (постер видео, WEBP/AVIF, JPEG с поворотом по EXIF).
  function putThumb(id, ext, data) {
    if (!ID_RE.test(id) || !THUMB_EXT[ext]) return false;
    if (!originalPath(id)) return false;
    const buf = Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data || []));
    if (!buf.length || buf.length > 4 * 1024 * 1024) return false;
    if (sniff(buf) !== ext) return false;
    for (const e of Object.keys(THUMB_EXT)) if (e !== ext) { try { fs.unlinkSync(path.join(thumbsDir, id + '.' + e)); } catch (_) {} }
    writeAtomic(path.join(thumbsDir, id + '.' + ext), buf);
    entry(id).thumb = ext; saveIndexSoon();
    return true;
  }

  // Векторные данные зарисовки (штрихи). Неизменяемые, по содержимому, как и медиа.
  function putVector(json) {
    if (typeof json !== 'string' || json.length > 30 * 1024 * 1024) throw new MediaError('too_big', 'Зарисовка слишком большая.');
    JSON.parse(json);
    const id = crypto.createHash('sha256').update(json, 'utf8').digest('hex');
    const f = path.join(vecDir, id + '.json');
    if (!fs.existsSync(f)) writeAtomic(f, json);
    touchRef(id);
    return id;
  }
  function getVector(id) {
    if (!ID_RE.test(id)) return null;
    try { return fs.readFileSync(path.join(vecDir, id + '.json'), 'utf8'); } catch (_) { return null; }
  }
  function info(id) {
    const o = originalPath(id); if (!o) return null;
    const e = index[id] || {};
    return { id, ext: o.ext, kind: TYPES[o.ext].kind, mime: TYPES[o.ext].mime, size: e.size, width: e.w, height: e.h, thumb: !!thumbPath(id) };
  }
  const filePathOf = id => { const o = originalPath(id); return o && inside(mediaDir, o.file) ? o.file : null; };

  // Обработчик схемы media://<id> и media://<id>/thumb. Поддерживает Range (перемотка видео).
  async function handleRequest(req) {
    const bad = (status, text) => new Response(text || String(status), { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' } });
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return bad(405);
      let u;
      try { u = new URL(req.url); } catch (_) { return bad(400); }
      const id = u.hostname.toLowerCase();
      const sub = u.pathname.replace(/\/+$/, '');
      if (!ID_RE.test(id) || u.search || (sub !== '' && sub !== '/thumb')) return bad(400, 'bad media id');
      const hit = sub === '/thumb' ? thumbPath(id) : originalPath(id);
      if (!hit) return bad(404, 'not found');
      if (!inside(mediaDir, hit.file)) return bad(403);
      const type = sub === '/thumb' ? THUMB_EXT[hit.ext] : (TYPES[hit.ext].serve || TYPES[hit.ext].mime);
      const st = await fsp.stat(hit.file);
      const size = st.size;
      const headers = {
        'content-type': type,
        'accept-ranges': 'bytes',
        'access-control-allow-origin': '*',
        'cache-control': sub === '/thumb' ? 'no-cache' : 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:"
      };
      let start = 0, end = size - 1, status = 200;
      const range = req.headers.get('range');
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (!m || (m[1] === '' && m[2] === '')) return new Response(null, { status: 416, headers: { ...headers, 'content-range': 'bytes */' + size } });
        if (m[1] === '') { start = Math.max(0, size - Number(m[2])); }
        else { start = Number(m[1]); if (m[2] !== '') end = Math.min(Number(m[2]), size - 1); }
        if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, 'content-range': 'bytes */' + size } });
        status = 206;
        headers['content-range'] = 'bytes ' + start + '-' + end + '/' + size;
      }
      headers['content-length'] = String(end - start + 1);
      if (req.method === 'HEAD' || size === 0) return new Response(null, { status, headers });
      const stream = fs.createReadStream(hit.file, { start, end, highWaterMark: 256 * 1024 });
      return new Response(Readable.toWeb(stream), { status, headers });
    } catch (e) {
      return bad(500, 'error');
    }
  }

  // Сборка мусора: удаляем файл, только если на него нет ссылок ни из одного документа (включая резервные
  // копии) и последнее использование было больше 7 дней назад. Работает асинхронно, интерфейс не блокирует.
  async function gc(allDocTexts) {
    const refs = new Set();
    for (const t of await allDocTexts()) { const m = String(t).match(/[a-f0-9]{64}/g); if (m) m.forEach(x => refs.add(x)); }
    const now = Date.now();
    let removed = 0;
    const consider = async (file, id) => {
      if (refs.has(id)) { entry(id).lastRef = now; return; }
      let last = index[id] && index[id].lastRef;
      if (!last) { try { last = (await fsp.stat(file)).mtimeMs; } catch (_) { return; } entry(id).lastRef = last; }
      if (now - last < GC_AGE) return;
      try { await fsp.unlink(file); removed++; } catch (_) { return; }
      for (const e of Object.keys(THUMB_EXT)) { try { await fsp.unlink(path.join(thumbsDir, id + '.' + e)); } catch (_) {} }
      if (!originalPath(id) && !fs.existsSync(path.join(vecDir, id + '.json'))) delete index[id];
    };
    for (const f of await fsp.readdir(mediaDir)) {
      const m = /^([a-f0-9]{64})\.([a-z0-9]+)$/.exec(f);
      if (m && TYPES[m[2]]) await consider(path.join(mediaDir, f), m[1]);
      else if (/^\.tmp-/.test(f)) {     // недокопированные файлы после сбоя
        try { const st = await fsp.stat(path.join(mediaDir, f)); if (now - st.mtimeMs > DAY) await fsp.unlink(path.join(mediaDir, f)); } catch (_) {}
      }
    }
    for (const f of await fsp.readdir(vecDir)) {
      const m = /^([a-f0-9]{64})\.json$/.exec(f);
      if (m) await consider(path.join(vecDir, f), m[1]);
    }
    for (const f of await fsp.readdir(thumbsDir)) {       // миниатюры без оригинала
      const m = /^([a-f0-9]{64})\.[a-z]+$/.exec(f);
      if (m && !originalPath(m[1])) { try { await fsp.unlink(path.join(thumbsDir, f)); } catch (_) {} }
    }
    saveIndex();
    return { removed, referenced: refs.size };
  }

  return { importPath, importBuffer, putThumb, putVector, getVector, info, filePathOf, handleRequest, gc, touchRefsInText, saveIndex, sniff, mediaDir, ID_RE, MAX };
}

module.exports = { createMedia, sniff, jpegOrientation, ID_RE };
