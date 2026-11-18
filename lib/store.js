// Хранилище документов: каждый документ (раздел планера, доска задачи) — отдельный файл docs/<имя>.json.
// Запись атомарная (временный файл + fsync + rename), с отложенной записью. Старый planner-data.json
// импортируется при первом запуске (перед этим делается копия в backups/).
'use strict';
const fs = require('fs');
const path = require('path');

const SCHEMA = 2;
const SEG = /^[A-Za-z0-9_-]{1,100}$/;

function sleepSync(ms) { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_) {} }
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function writeAtomic(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp';
  const fd = fs.openSync(tmp, 'w', mode || 0o666);
  try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) {
      // Windows: файл может быть ненадолго занят антивирусом или индексатором
      if (i < 5 && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES')) { sleepSync(40 * (i + 1)); continue; }
      try { fs.unlinkSync(tmp); } catch (_) {}
      throw e;
    }
  }
}

function humanFsError(e) {
  const c = e && e.code;
  if (c === 'ENOSPC') return 'на диске закончилось место';
  if (c === 'EACCES' || c === 'EPERM') return 'нет доступа к папке с данными';
  if (c === 'EROFS') return 'папка с данными доступна только для чтения';
  if (c === 'EBUSY') return 'файл занят другой программой';
  return (e && e.message) || 'ошибка записи';
}

function createStore(dir, hooks = {}) {
  const docsDir = path.join(dir, 'docs');
  const backupsDir = path.join(dir, 'backups');
  const legacyFile = path.join(dir, 'planner-data.json');
  const metaFile = path.join(dir, 'planer-meta.json');
  const cache = new Map();      // путь документа -> значение (null = нет документа)
  const dirty = new Set();
  const notices = [];
  let timer = null;

  const validPath = p => typeof p === 'string' && p.length <= 400 && p.split('/').every(s => SEG.test(s)) && !p.includes('__');
  const fileOf = p => path.join(docsDir, p.split('/').join('__') + '.json');
  const notice = m => { notices.push(m); if (hooks.onNotice) hooks.onNotice(m); };

  function quarantine(file, label) {
    const dst = file + '.corrupt-' + stamp();
    try { fs.renameSync(file, dst); } catch (_) { try { fs.copyFileSync(file, dst); } catch (_) {} }
    notice('Файл «' + label + '» был повреждён и не прочитан. Его копия сохранена рядом: ' + path.basename(dst) + '.');
  }

  function readMeta() { try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (_) { return null; } }

  // Миграция: один planner-data.json -> отдельные файлы документов. Старый файл не удаляется.
  function migrate() {
    const meta = readMeta();
    if (meta && meta.schema >= SCHEMA) return;
    fs.mkdirSync(docsDir, { recursive: true });
    let from = null;
    if (fs.existsSync(legacyFile)) {
      fs.mkdirSync(backupsDir, { recursive: true });
      try { fs.copyFileSync(legacyFile, path.join(backupsDir, 'planner-data-before-schema-' + SCHEMA + '-' + stamp() + '.json')); } catch (_) {}
      let legacy = null;
      try {
        const raw = fs.readFileSync(legacyFile, 'utf8');
        legacy = raw.trim() ? JSON.parse(raw) : {};
      } catch (e) { quarantine(legacyFile, 'planner-data.json'); }
      if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
        for (const [p, v] of Object.entries(legacy)) {
          if (!validPath(p)) continue;
          const f = fileOf(p);
          if (!fs.existsSync(f)) writeAtomic(f, JSON.stringify(v));
        }
        from = 'planner-data.json';
      }
    }
    writeAtomic(metaFile, JSON.stringify({ schema: SCHEMA, migratedAt: new Date().toISOString(), from }, null, 2));
  }

  function get(p) {
    if (!validPath(p)) throw new Error('bad path');
    if (cache.has(p)) return cache.get(p);
    const f = fileOf(p);
    let v = null;
    try {
      const raw = fs.readFileSync(f, 'utf8');
      v = JSON.parse(raw);
    } catch (e) {
      if (e.code !== 'ENOENT') quarantine(f, path.basename(f));
      v = null;
    }
    cache.set(p, v);
    return v;
  }
  function set(p, v) {
    if (!validPath(p)) throw new Error('bad path');
    cache.set(p, v === undefined ? null : v);
    dirty.add(p); schedule();
  }
  // Удаление документа: файл не стирается, а переносится в backups/deleted/.
  function remove(p) {
    if (!validPath(p)) throw new Error('bad path');
    cache.set(p, null); dirty.delete(p);
    const f = fileOf(p);
    if (fs.existsSync(f)) {
      const d = path.join(backupsDir, 'deleted');
      fs.mkdirSync(d, { recursive: true });
      try { fs.renameSync(f, path.join(d, path.basename(f, '.json') + '-' + stamp() + '.json')); } catch (_) {}
    }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(flush, 250); }
  function flush() {
    clearTimeout(timer); timer = null;
    let error = null;
    for (const p of [...dirty]) {
      const v = cache.get(p);
      try {
        const json = JSON.stringify(v);
        writeAtomic(fileOf(p), json);
        dirty.delete(p);
        if (hooks.onWrite) hooks.onWrite(p, json);
      } catch (e) { error = e; }
    }
    if (error) {
      if (hooks.onError) hooks.onError('Не удалось сохранить данные на диск: ' + humanFsError(error) + '. Изменения пока хранятся в памяти; освободите место или проверьте доступ, и они запишутся.');
      timer = setTimeout(flush, 5000);
    }
    return !error;
  }

  // Ежедневная копия всех документов: backups/docs-ГГГГ-ММ-ДД/, хранятся последние 14.
  function dailyBackup() {
    try {
      if (!fs.existsSync(docsDir)) return;
      fs.mkdirSync(backupsDir, { recursive: true });
      const day = path.join(backupsDir, 'docs-' + new Date().toISOString().slice(0, 10));
      const hasDocs = d => { try { return fs.readdirSync(d).some(f => f.endsWith('.json')); } catch (_) { return false; } };
      // копия, сделанная при самом первом запуске (данных ещё не было), пересоздаётся, когда данные появятся
      if (fs.existsSync(day) && !hasDocs(day) && hasDocs(docsDir)) fs.rmSync(day, { recursive: true, force: true });
      if (!fs.existsSync(day)) {
        const tmp = day + '.partial';
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.mkdirSync(tmp, { recursive: true });
        for (const f of fs.readdirSync(docsDir)) if (f.endsWith('.json')) fs.copyFileSync(path.join(docsDir, f), path.join(tmp, f));
        fs.renameSync(tmp, day);
      }
      const all = fs.readdirSync(backupsDir).filter(f => /^docs-\d{4}-\d{2}-\d{2}$/.test(f)).sort();
      all.slice(0, Math.max(0, all.length - 14)).forEach(f => { try { fs.rmSync(path.join(backupsDir, f), { recursive: true, force: true }); } catch (_) {} });
    } catch (e) { console.error('backup:', e); }
  }

  // Все тексты документов (включая копии и повреждённые файлы) — для поиска ссылок на медиа при сборке мусора.
  async function allDocTexts() {
    const out = [];
    const walk = async (d, depth) => {
      let ents = [];
      try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch (_) { return; }
      for (const e of ents) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) { if (depth < 3) await walk(f, depth + 1); }
        else if (/\.json($|\.corrupt)/.test(e.name)) { try { out.push(await fs.promises.readFile(f, 'utf8')); } catch (_) {} }
      }
    };
    await walk(docsDir, 0);
    await walk(backupsDir, 0);
    for (const v of cache.values()) out.push(JSON.stringify(v));
    return out;
  }

  return { migrate, get, set, remove, flush, dailyBackup, allDocTexts, notices, validPath, docsDir, metaFile, readMeta, SCHEMA };
}

module.exports = { createStore, writeAtomic, humanFsError };
