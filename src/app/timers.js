/* Планер — таймеры для фокусировки: кнопка в левом углу шапки, панель с шаблонами, звук и сообщение в конце.
   Отсчёт идёт в основном процессе (lib/timers.js) — точный, даже когда окно в трее. Звук синтезируется здесь (Web Audio).
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

const { fmtClock, fmtDuration, parseDuration } = window.PlanerCore;
const SOUND_NAMES = { bell:'Колокольчик', soft:'Мягкий', alarm:'Будильник', beep:'Короткий сигнал' };
const REPEATS = [1, 2, 3, 5, 10];
const TM = { api:null, st:null, btn:null, pop:null, run:null, list:null, form:null, tick:0, ring:null, ringTimer:0, stopSound:null, editId:null, wasOpen:false, lastSound:null };
const tmLeft = r => r.paused ? r.left : Math.max(0, r.endsAt - Date.now());

function initTimers(){
  const ea = window.electronAPI; if (!ea || !ea.timers) return;
  TM.api = ea.timers;
  TM.btn = $('#timerBtn'); TM.btn.hidden = false;
  window.addEventListener('pointerdown', e => { if (TM.btn.contains(e.target)) TM.wasOpen = !!(TM.pop && TM.pop.isConnected); }, true);
  TM.btn.addEventListener('click', () => { if (TM.wasOpen) { TM.wasOpen = false; return; } openTimers(); });
  TM.api.onState(s => { TM.st = s; paintTimerBtn(); if (TM.pop && TM.pop.isConnected) renderTimerLists(); });
  TM.api.onDone(t => ringTimer(t));
  TM.api.state().then(s => { TM.st = s; paintTimerBtn(); });
}
const tmRunning = () => (TM.st && TM.st.running) || [];
// Кнопка в шапке: значок, а пока таймер идёт — оставшееся время ближайшего.
function paintTimerBtn(){
  if (!TM.btn) return;
  const run = tmRunning(), act = run.filter(r => !r.paused).sort((a, b) => a.endsAt - b.endsAt), r = act[0] || run[0];
  TM.btn.classList.toggle('running', !!r && !r.paused);
  TM.btn.classList.toggle('paused', !!r && r.paused);
  const lab = r ? 'Таймеры: «' + r.title + '», ' + (r.paused ? 'пауза, ' : '') + 'осталось ' + fmtClock(tmLeft(r)) + (run.length > 1 ? ', всего таймеров ' + run.length : '') : 'Таймеры для фокусировки';
  TM.btn.title = lab; TM.btn.setAttribute('aria-label', lab);
  TM.btn.replaceChildren(...[icon('timer', 17), r ? h('span', { class:'tm-btn-time' }, fmtClock(tmLeft(r))) : null,
    h('span', { class:'tm-btn-name' }, r ? r.title : 'Таймеры'),
    run.length > 1 ? h('b', { class:'tm-btn-n' }, String(run.length)) : null].filter(Boolean));
  const need = act.length > 0;
  if (need && !TM.tick) TM.tick = setInterval(tickTimers, 250);
  if (!need && TM.tick) { clearInterval(TM.tick); TM.tick = 0; }
}
function tickTimers(){
  paintTimerBtn();
  if (!TM.run || !TM.run.isConnected) return;
  tmRunning().forEach(r => {
    const row = TM.run.querySelector('.tm-run[data-tid="' + r.id + '"]'); if (!row) return;
    row.querySelector('.tm-time').textContent = fmtClock(tmLeft(r));
    paintRing(row.querySelector('.tm-ring-c'), r);
  });
}
function paintRing(c, r){ if (!c) return; const len = 2 * Math.PI * 15, part = r.ms ? tmLeft(r) / r.ms : 0; c.style.strokeDasharray = len.toFixed(2); c.style.strokeDashoffset = (len * (1 - part)).toFixed(2); }

/* ---------- панель таймеров ---------- */
function openTimers(){
  if (!TM.api) return;
  closeMenu();
  TM.run = h('div', { class:'tm-runs' });
  TM.list = h('div', { class:'tm-list', role:'list', 'aria-label':'Мои таймеры' });
  TM.form = h('div', { class:'tm-form-box' });
  TM.editId = null;
  const soundBox = h('div', { class:'tm-sound' });
  TM.pop = h('div', { class:'menu tm-pop', role:'dialog', 'aria-label':'Таймеры' },
    h('div', { class:'tm-head' }, icon('timer', 17), h('b', {}, 'Таймеры'), h('span', { class:'tm-sub' }, 'для фокусировки и перерывов')),
    TM.run, h('div', { class:'tm-cap' }, 'Мои таймеры'), TM.list, TM.form, soundBox);
  TM.pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); (TM.btn.offsetWidth ? TM.btn : headerMore).focus(); } });
  renderTimerLists(); renderTimerForm(); renderSoundBox(soundBox);
  menuEl = TM.pop; placePopup(TM.btn.offsetWidth ? TM.btn : headerMore, TM.pop);
  const first = TM.pop.querySelector('.tm-start'); if (first) first.focus();
}
function renderTimerLists(){
  const st = TM.st || { presets:[], running:[] };
  TM.run.replaceChildren(...st.running.map(r => {
    return h('div', { class:'tm-run' + (r.paused ? ' paused' : ''), 'data-tid':r.id },
      ringSvg(r),
      h('div', { class:'tm-run-t' }, h('b', {}, r.title), h('span', {}, (r.paused ? 'пауза · ' : '') + 'из ' + fmtDuration(r.ms))),
      h('span', { class:'tm-time' }, fmtClock(tmLeft(r))),
      h('button', { class:'tool tm-pp', type:'button', 'aria-label':r.paused ? 'Продолжить «' + r.title + '»' : 'Пауза «' + r.title + '»', title:r.paused ? 'Продолжить' : 'Пауза',
        onclick:() => r.paused ? TM.api.resume(r.id) : TM.api.pause(r.id) }, icon(r.paused ? 'play' : 'pause', 15)),
      h('button', { class:'tm-plus', type:'button', title:'Добавить минуту', 'aria-label':'Добавить минуту к «' + r.title + '»', onclick:() => TM.api.add(r.id, 60000) }, '+1'),
      h('button', { class:'tool tm-stop', type:'button', 'aria-label':'Остановить «' + r.title + '»', title:'Остановить', onclick:() => TM.api.stop(r.id) }, icon('stop', 14)));
  }));
  TM.list.replaceChildren(...(st.presets.length ? st.presets.map(p => h('div', { class:'tm-pre', role:'listitem', 'data-pid':p.id },
      h('button', { class:'tm-start', type:'button', 'aria-label':'Запустить «' + p.title + '» на ' + fmtDuration(p.ms), title:'Запустить',
        onclick:async () => { const r = await TM.api.start({ presetId:p.id }); if (!r.ok) toast(r.error); } }, icon('play', 13)),
      h('span', { class:'tm-pre-t' }, p.title),
      h('span', { class:'tm-pre-d' }, fmtDuration(p.ms)),
      h('button', { class:'tool tm-edit', type:'button', 'aria-label':'Изменить «' + p.title + '»', title:'Изменить', onclick:() => { TM.editId = p.id; renderTimerForm(); } }, icon('pencil', 14)),
      h('button', { class:'tool tm-del', type:'button', 'aria-label':'Удалить «' + p.title + '»', title:'Удалить', onclick:() => deletePreset(p.id) }, icon('trash', 14))))
    : [h('div', { class:'tm-empty' }, 'Шаблонов нет — добавьте таймер ниже.')]));
}
function ringSvg(r){
  const ns = 'http://www.w3.org/2000/svg', sv = document.createElementNS(ns, 'svg');
  sv.setAttribute('viewBox', '0 0 36 36'); sv.setAttribute('class', 'tm-ring-svg'); sv.setAttribute('aria-hidden', 'true');
  const bg = document.createElementNS(ns, 'circle'), fg = document.createElementNS(ns, 'circle');
  [bg, fg].forEach(c => { c.setAttribute('cx', '18'); c.setAttribute('cy', '18'); c.setAttribute('r', '15'); });
  bg.setAttribute('class', 'tm-ring-bg'); fg.setAttribute('class', 'tm-ring-c');
  sv.append(bg, fg); paintRing(fg, r);
  return sv;
}
// Форма: новый таймер или правка выбранного. Строки разбирает parseDuration: «25», «1:30», «1ч 30м», «45 сек».
function renderTimerForm(){
  const st = TM.st || { presets:[] };
  const edit = TM.editId ? st.presets.find(p => p.id === TM.editId) : null;
  if (TM.editId && !edit) TM.editId = null;
  const name = h('input', { class:'tm-in tm-name', type:'text', maxlength:'60', placeholder:'Название, например «Чтение»', 'aria-label':'Название таймера' });
  const dur = h('input', { class:'tm-in tm-dur', type:'text', maxlength:'20', placeholder:'25 мин', 'aria-label':'Длительность: минуты, 1:30 или 1ч 30м', title:'Минуты (25), 1:30, 1ч 30м или 45 сек' });
  if (edit) { name.value = edit.title; dur.value = fmtDuration(edit.ms); }
  const err = h('div', { class:'tm-err', role:'alert' });
  const read = () => {
    const ms = parseDuration(dur.value);
    if (!ms) { err.textContent = 'Длительность: например 25, 1:30, 1ч 30м или 45 сек (до 24 часов).'; dur.focus(); return null; }
    return { title:name.value.trim() || 'Таймер', ms };
  };
  const save = async startToo => {
    const v = read(); if (!v) return;
    const list = st.presets.map(p => ({ ...p }));
    let id;
    if (edit) { const p = list.find(x => x.id === edit.id); Object.assign(p, v); id = p.id; }
    else { id = newId(); list.push(Object.assign({ id }, v)); }
    await TM.api.setPresets(list);
    if (startToo) { const r = await TM.api.start({ presetId:id }); if (!r.ok) toast(r.error); }
    TM.editId = null; renderTimerForm();
  };
  const form = h('form', { class:'tm-form', onsubmit:e => { e.preventDefault(); save(false); } },
    h('div', { class:'tm-cap' }, edit ? 'Изменить «' + edit.title + '»' : 'Новый таймер'),
    h('div', { class:'tm-row' }, name, dur),
    err,
    h('div', { class:'tm-acts' },
      edit ? h('button', { type:'button', class:'tb-btn', onclick:() => { TM.editId = null; renderTimerForm(); } }, 'Отмена') : null,
      edit ? null : h('button', { type:'button', class:'tb-btn', onclick:() => save(true) }, 'Добавить и запустить'),
      h('button', { type:'submit', class:'tb-btn primary' }, edit ? 'Сохранить' : 'Добавить')));
  TM.form.replaceChildren(form);
  if (edit) dur.focus();
}
async function deletePreset(id){
  const st = TM.st || { presets:[] };
  const prev = st.presets.map(p => ({ ...p })), p = prev.find(x => x.id === id); if (!p) return;
  await TM.api.setPresets(prev.filter(x => x.id !== id));
  if (TM.editId === id) { TM.editId = null; renderTimerForm(); }
  toast('Таймер «' + p.title + '» удалён', () => TM.api.setPresets(prev));
}
function renderSoundBox(box){
  const st = TM.st || { sound:'bell', volume:0.7, repeat:3 };
  const sel = h('select', { class:'tm-sel', 'aria-label':'Звук окончания' }, Object.entries(SOUND_NAMES).map(([k, n]) => h('option', { value:k }, n)));
  sel.value = st.sound;
  const vol = h('input', { class:'tm-vol', type:'range', min:'0', max:'100', step:'5', 'aria-label':'Громкость' });
  vol.value = String(Math.round(st.volume * 100));
  const rep = h('select', { class:'tm-sel', 'aria-label':'Сколько раз повторить звук' }, REPEATS.map(n => h('option', { value:String(n) }, n + ' ' + plural(n, 'раз', 'раза', 'раз'))));
  rep.value = String(REPEATS.includes(st.repeat) ? st.repeat : 3);
  const set = patch => TM.api.setSound(patch).then(s => { TM.st = s; });
  sel.addEventListener('change', () => { set({ sound:sel.value }); previewSound(sel.value, Number(vol.value) / 100); });
  vol.addEventListener('change', () => { set({ volume:Number(vol.value) / 100 }); previewSound(sel.value, Number(vol.value) / 100); });
  rep.addEventListener('change', () => set({ repeat:Number(rep.value) }));
  box.replaceChildren(
    h('div', { class:'tm-cap' }, 'Звук в конце'),
    h('div', { class:'tm-row' }, sel,
      h('button', { class:'tool tm-try', type:'button', 'aria-label':'Прослушать звук', title:'Прослушать', onclick:() => previewSound(sel.value, Number(vol.value) / 100) }, icon('volume', 16)),
      vol, rep));
}
function previewSound(kind, volume){ if (TM.stopSound) TM.stopSound(); TM.stopSound = playSound(kind, volume, 1); }

/* ---------- окончание: звук и сообщение ---------- */
function ringTimer(t){
  const st = TM.st || { sound:'bell', volume:0.7, repeat:3 };
  if (TM.stopSound) TM.stopSound();
  TM.stopSound = playSound(st.sound, st.volume, st.repeat);
  TM.lastSound = { kind:st.sound, title:t.title, at:Date.now() };
  if (TM.ring) TM.ring.remove();
  clearTimeout(TM.ringTimer);
  const done = () => { if (TM.stopSound) { TM.stopSound(); TM.stopSound = null; } if (TM.ring) { TM.ring.remove(); TM.ring = null; } clearTimeout(TM.ringTimer); };
  const again = async ms => { done(); const r = await TM.api.start(ms ? { title:t.title, ms } : (t.presetId ? { presetId:t.presetId } : { title:t.title, ms:t.ms })); if (!r.ok) toast(r.error); };
  TM.ring = h('div', { class:'tm-done', role:'alert' },
    h('span', { class:'tm-done-ico' }, icon('bell', 20)),
    h('div', { class:'tm-done-t' }, h('b', {}, '«' + t.title + '» — время вышло'), h('span', {}, fmtDuration(t.ms))),
    h('button', { type:'button', class:'tm-done-b', onclick:() => again(5 * 60000) }, 'Ещё 5 мин'),
    h('button', { type:'button', class:'tm-done-b', onclick:() => again(0) }, 'Повторить'),
    h('button', { type:'button', class:'tm-done-b primary', onclick:done }, 'Готово'));
  document.body.append(TM.ring);
  TM.ringTimer = setTimeout(done, 3 * 60000);
}

// Звуки без файлов: короткие мелодии из синусоид и прямоугольных волн.
let audioCtx = null;
const PATTERNS = {
  bell:  { len:2.1, notes:[[880, 0, 1.7, 'sine', 1], [1760, 0, 0.7, 'sine', 0.25], [1174.66, 0.45, 1.5, 'sine', 0.9], [2349.32, 0.45, 0.5, 'sine', 0.2]] },
  soft:  { len:1.5, notes:[[523.25, 0, 0.9, 'sine', 0.8], [659.25, 0.18, 0.9, 'sine', 0.8], [783.99, 0.36, 1.1, 'sine', 0.9]] },
  alarm: { len:1.0, notes:[[988, 0, 0.12, 'square', 0.35], [988, 0.18, 0.12, 'square', 0.35], [988, 0.36, 0.12, 'square', 0.35], [988, 0.54, 0.12, 'square', 0.35]] },
  beep:  { len:0.9, notes:[[880, 0, 0.18, 'sine', 0.9], [880, 0.3, 0.18, 'sine', 0.9], [880, 0.6, 0.18, 'sine', 0.9]] }
};
function playSound(kind, volume, repeat){
  let ctx;
  try { ctx = audioCtx = audioCtx || new AudioContext(); } catch (e) { return () => {}; }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const pat = PATTERNS[kind] || PATTERNS.bell;
  const master = ctx.createGain();
  master.gain.value = Math.max(0, Math.min(1, Number(volume) || 0)) * 0.8;
  master.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.05, n = Math.max(1, Math.min(10, repeat | 0));
  for (let i = 0; i < n; i++) {
    const base = t0 + i * (pat.len + 0.6);
    for (const [f, at, len, type, peak] of pat.notes) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, base + at);
      g.gain.exponentialRampToValueAtTime(peak, base + at + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, base + at + len);
      o.connect(g); g.connect(master);
      o.start(base + at); o.stop(base + at + len + 0.05);
    }
  }
  let stopped = false;
  const total = n * (pat.len + 0.6);
  const cleanup = setTimeout(() => { try { master.disconnect(); } catch (e) {} }, total * 1000 + 500);
  return () => {
    if (stopped) return; stopped = true; clearTimeout(cleanup);
    try { const now = ctx.currentTime; master.gain.cancelScheduledValues(now); master.gain.setValueAtTime(master.gain.value, now); master.gain.linearRampToValueAtTime(0, now + 0.08); setTimeout(() => { try { master.disconnect(); } catch (e) {} }, 150); } catch (e) {}
  };
}
