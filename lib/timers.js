// Таймеры для фокусировки (не привязаны к задачам). Живут в основном процессе: окно может быть скрыто в трей,
// а страница в фоне замедляет свои таймеры — здесь отсчёт точный. Шаблоны и настройки звука хранятся в документе
// planner-timers (как и остальные данные: копии, восстановление); запущенные таймеры — только в памяти.
// @ts-check
'use strict';
const { normTimers, normPreset, TIMER_MIN, TIMER_MAX, SOUNDS } = require('../src/core.js');

const MAX_RUNNING = 10;

/**
 * @typedef {{id:string, presetId:string|null, title:string, ms:number, endsAt:number, left:number, paused:boolean, startedAt:number}} Running
 * @param {{ load:() => any, save:(doc:any) => void, onChange?:(state:any) => void, onDone?:(t:Running) => void,
 *   now?:() => number, setTimer?:(fn:() => void, ms:number) => any, clearTimer?:(t:any) => void }} o
 */
function createTimers(o) {
  const now = o.now || Date.now;
  const setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer || (t => clearTimeout(t));
  let cfg = normTimers(o.load());
  /** @type {Running[]} */
  let running = [];
  let timer = null, seq = 0;

  const leftOf = /** @param {Running} r */ r => r.paused ? r.left : Math.max(0, r.endsAt - now());
  function state() {
    const t = now();
    return {
      presets: cfg.presets.map(p => ({ ...p })), sound: cfg.sound, volume: cfg.volume, repeat: cfg.repeat, now: t,
      running: running.map(r => ({ id: r.id, presetId: r.presetId, title: r.title, ms: r.ms, left: leftOf(r), endsAt: r.paused ? null : r.endsAt, paused: r.paused }))
    };
  }
  const changed = () => { schedule(); if (o.onChange) o.onChange(state()); };
  const persist = () => { try { o.save({ v: 1, presets: cfg.presets, sound: cfg.sound, volume: cfg.volume, repeat: cfg.repeat }); } catch (_) {} };

  // Ближайшее окончание — точным setTimeout; при пробуждении компьютера проверку можно вызвать снаружи (check()).
  function schedule() {
    if (timer) { clearTimer(timer); timer = null; }
    const act = running.filter(r => !r.paused);
    if (!act.length) return;
    const next = Math.min(...act.map(r => r.endsAt));
    timer = setTimer(check, Math.max(0, Math.min(next - now(), 2 ** 31 - 1)));
  }
  function check() {
    timer = null;
    const t = now(), done = running.filter(r => !r.paused && r.endsAt <= t + 30);
    if (done.length) {
      running = running.filter(r => !done.includes(r));
      done.forEach(r => { if (o.onDone) { try { o.onDone(r); } catch (_) {} } });
      changed();
    } else schedule();
  }
  const find = /** @param {any} id */ id => running.find(r => r.id === String(id));

  /** Запустить шаблон ({presetId}) или разовый таймер ({title, ms}). @param {any} a */
  function start(a) {
    a = a || {};
    let title, ms, presetId = null;
    if (a.presetId != null) {
      const p = cfg.presets.find(x => x.id === String(a.presetId));
      if (!p) return { ok: false, error: 'Таймер не найден.' };
      title = p.title; ms = p.ms; presetId = p.id;
    } else {
      const p = normPreset({ id: 'once', title: a.title, ms: a.ms });
      if (!p) return { ok: false, error: 'Длительность — от 1 секунды до 24 часов.' };
      title = p.title; ms = p.ms;
    }
    if (running.length >= MAX_RUNNING) return { ok: false, error: 'Одновременно можно запустить не больше ' + MAX_RUNNING + ' таймеров.' };
    const t = now();
    const r = { id: 't' + t.toString(36) + (++seq), presetId, title, ms, endsAt: t + ms, left: ms, paused: false, startedAt: t };
    running.push(r);
    changed();
    return { ok: true, id: r.id };
  }
  /** @param {any} id */
  function pause(id) { const r = find(id); if (!r || r.paused) return false; r.left = leftOf(r); r.paused = true; changed(); return true; }
  /** @param {any} id */
  function resume(id) { const r = find(id); if (!r || !r.paused) return false; r.endsAt = now() + r.left; r.paused = false; changed(); return true; }
  /** @param {any} id */
  function stop(id) { const r = find(id); if (!r) return false; running = running.filter(x => x !== r); changed(); return true; }
  function stopAll() { if (!running.length) return false; running = []; changed(); return true; }
  /** Добавить (или убавить) время. @param {any} id @param {any} ms */
  function add(id, ms) {
    const r = find(id), d = Math.round(Number(ms) / 1000) * 1000;
    if (!r || !isFinite(d) || !d) return false;
    const left = Math.min(TIMER_MAX, Math.max(TIMER_MIN, leftOf(r) + d));
    r.ms = Math.max(r.ms, left);
    if (r.paused) r.left = left; else r.endsAt = now() + left;
    changed();
    return true;
  }
  /** Шаблоны таймеров целиком (порядок как в списке). @param {any} list */
  function setPresets(list) {
    const seen = new Set();
    cfg.presets = (Array.isArray(list) ? list : []).map(normPreset).filter(p => p && !seen.has(p.id) && seen.add(p.id)).slice(0, 30);
    persist(); changed();
    return state().presets;
  }
  /** Звук окончания: вид, громкость 0..1, сколько раз повторить. @param {any} s */
  function setSound(s) {
    s = s || {};
    const n = normTimers({ presets: cfg.presets, sound: s.sound !== undefined ? s.sound : cfg.sound,
      volume: s.volume !== undefined ? s.volume : cfg.volume, repeat: s.repeat !== undefined ? s.repeat : cfg.repeat });
    if (s.sound !== undefined && !SOUNDS.includes(s.sound)) n.sound = cfg.sound;
    cfg = n; persist(); changed();
    return state();
  }
  /** Перечитать настройки (после восстановления из копии). */
  function reload() { cfg = normTimers(o.load()); changed(); }
  /** Ближайший к окончанию запущенный таймер — для значка в трее. */
  function nearest() {
    const act = running.filter(r => !r.paused).sort((a, b) => a.endsAt - b.endsAt);
    const r = act[0] || running[0];
    return r ? { title: r.title, left: leftOf(r), paused: r.paused, count: running.length } : null;
  }
  function dispose() { if (timer) clearTimer(timer); timer = null; }

  return { state, start, pause, resume, stop, stopAll, add, setPresets, setSound, reload, nearest, check, dispose };
}

module.exports = { createTimers, MAX_RUNNING };
