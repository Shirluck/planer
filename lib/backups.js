// Резервные копии и восстановление из них. Копия — папка backups/<имя>/ с файлами документов (как в docs/):
//   docs-ГГГГ-ММ-ДД     — ежедневная (lib/store.js → dailyBackup), хранятся последние 14;
//   manual-<время>      — сделана вручную кнопкой «Сделать копию сейчас»;
//   before-restore-<время> — текущие данные прямо перед восстановлением (чтобы восстановление можно было отменить).
// Восстановление ничего не удаляет: документы из копии записываются поверх текущих, остальные остаются как есть.
// @ts-check
'use strict';
const fs = require('fs');
const path = require('path');
const { renameWithRetry } = require('./store');

const ID_RE = /^(docs-\d{4}-\d{2}-\d{2}|(manual|before-restore)-\d{4}-\d{2}-\d{2}T[\d-]+Z)$/;
const KEEP = { manual: 20, 'before-restore': 20 };


/**
 * @param {{ dir:string, store:{ docsDir:string, validPath:(p:string)=>boolean, get:(p:string)=>any, set:(p:string, v:any)=>void, flush:()=>boolean } }} o
 */
function createBackups({ dir, store }) {
  const backupsDir = path.join(dir, 'backups');
  /** @param {string} f */
  const pathOfFile = f => { if (!f.endsWith('.json')) return null; const p = f.slice(0, -5).split('__').join('/'); return store.validPath(p) ? p : null; };
  /** @param {string} p */
  const fileOfPath = p => p.split('/').join('__') + '.json';
  /** @param {string} id */
  const kindOf = id => id.startsWith('docs-') ? 'daily' : id.startsWith('manual-') ? 'manual' : 'before-restore';
  /** @param {string} id */
  function timeOf(id, st) {
    const m = id.match(/-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
    if (m) return Date.parse(m[1] + 'T' + m[2] + ':' + m[3] + ':' + m[4] + '.' + m[5] + 'Z');
    return (st && (st.birthtimeMs || st.mtimeMs)) || 0;
  }

  /** Все копии, новые сверху: { id, kind, at, date?, docs:[{path, size}] }. */
  function list() {
    let names = [];
    try { names = fs.readdirSync(backupsDir); } catch (_) { return []; }
    const out = [];
    for (const id of names) {
      if (!ID_RE.test(id)) continue;
      const d = path.join(backupsDir, id);
      let st; try { st = fs.statSync(d); } catch (_) { continue; }
      if (!st.isDirectory()) continue;
      const docs = [];
      try {
        for (const f of fs.readdirSync(d)) {
          const p = pathOfFile(f); if (!p) continue;
          try { docs.push({ path: p, size: fs.statSync(path.join(d, f)).size }); } catch (_) {}
        }
      } catch (_) { continue; }
      out.push({ id, kind: kindOf(id), at: timeOf(id, st), date: id.startsWith('docs-') ? id.slice(5) : null, docs });
    }
    return out.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
  }
  /** @param {any} id @param {any} p */
  function check(id, p) {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('bad backup id');
    if (p !== undefined && !store.validPath(p)) throw new Error('bad path');
  }
  /** Документ из копии (null — нет в копии или не читается). @param {any} id @param {any} p */
  function read(id, p) {
    check(id, p);
    try { return JSON.parse(fs.readFileSync(path.join(backupsDir, id, fileOfPath(p)), 'utf8')); } catch (_) { return null; }
  }
  /** Копия всех текущих документов. @param {'manual'|'before-restore'} kind */
  function snapshot(kind) {
    if (!store.flush()) throw Error('Не удалось сохранить текущие документы перед созданием копии.');
    let ms = Date.now(), id;
    do {
      id = kind + '-' + new Date(ms++).toISOString().replace(/[:.]/g, '-');
    } while (fs.existsSync(path.join(backupsDir,id)) || fs.existsSync(path.join(backupsDir,id+'.partial')));
    const dst = path.join(backupsDir, id), tmp = dst + '.partial';
    fs.mkdirSync(tmp, { recursive: true });
    let n = 0;
    try { for (const f of fs.readdirSync(store.docsDir)) if (pathOfFile(f)) { fs.copyFileSync(path.join(store.docsDir, f), path.join(tmp, f)); n++; } } catch (e) { if (e.code !== 'ENOENT') throw e; }
    renameWithRetry(tmp, dst);
    prune(kind);
    return { id, count: n };
  }
  /** @param {string} kind */
  function prune(kind) {
    const keep = KEEP[kind] || 20;
    const mine = list().filter(b => b.kind === kind);
    mine.slice(keep).forEach(b => { try { fs.rmSync(path.join(backupsDir, b.id), { recursive: true, force: true }); } catch (_) {} });
  }
  /**
   * Восстановить документы из копии. Сначала читаются все нужные файлы (если что-то не читается — ничего не меняется),
   * затем текущие данные сохраняются в копию before-restore-…, и только после этого документы записываются.
   * @param {any} id @param {any} paths
   */
  function restore(id, paths) {
    check(id);
    const want = (Array.isArray(paths) ? paths : []).filter(p => typeof p === 'string');
    if (!want.length || want.length > 2000) return { ok: false, error: 'Не выбрано, что восстановить.' };
    want.forEach(p => check(id, p));
    const data = new Map();
    for (const p of want) {
      const v = read(id, p);
      if (v == null) return { ok: false, error: 'В копии нет документа или он повреждён: ' + p };
      data.set(p, v);
    }
    const undo = snapshot('before-restore');
    for (const [p, v] of data) store.set(p, v);
    if (!store.flush()) return { ok: false, error: 'Не удалось записать данные на диск.', undoId: undo.id };
    return { ok: true, undoId: undo.id, restored: want };
  }
  return { list, read, snapshot, restore, backupsDir, ID_RE };
}

module.exports = { createBackups };
