/* Планер — инструменты моушн-дизайнера рядом с таймером: свои ссылки на сайты, экспрешены After Effects по шаблонам
   (и по описанию — через ассистента), кадры ↔ секунды ↔ таймкод и темп музыки, цвет для экспрешенов, форматы кадра.
   Логика — src/motion.js (PlanerMotion), ссылки хранятся в документе planner-tools (входит в резервные копии).
   Классический скрипт: общие объявления видны остальным файлам src/app/*.js (порядок подключения — в index.html). */
'use strict';

const PM = window.PlanerMotion;
const MT = { btn:null, pop:null, body:null, tab:'links', links:null, editLinks:false, expr:'wiggle', params:{}, fps:25, frames:50, color:'#3AA0FF', bpm:120, wasOpen:false };
const MT_TABS = [['links', 'Ссылки', 'globe'], ['expr', 'Экспрешены AE', 'code'], ['time', 'Тайминг', 'film'], ['color', 'Цвет', 'palette'], ['formats', 'Форматы', 'frame']];
const DEFAULT_LINKS = [
  ['aescripts + aeplugins', 'https://aescripts.com'], ['School of Motion', 'https://www.schoolofmotion.com'],
  ['Motionographer', 'https://motionographer.com'], ['Behance — Motion', 'https://www.behance.net/galleries/motion'],
  ['Dribbble', 'https://dribbble.com'], ['LottieFiles', 'https://lottiefiles.com'], ['Adobe Color', 'https://color.adobe.com'],
  ['Google Fonts', 'https://fonts.google.com'], ['Envato Elements', 'https://elements.envato.com'], ['Pinterest', 'https://www.pinterest.com']
].map(([title, url]) => ({ id:newId(), title, url }));
const mtPrefs = () => { try { return JSON.parse(localStorage.getItem('planer-motion') || '{}') || {}; } catch (e) { return {}; } };
const mtSavePrefs = () => { try { localStorage.setItem('planer-motion', JSON.stringify({ tab:MT.tab, expr:MT.expr, params:MT.params, fps:MT.fps, color:MT.color, bpm:MT.bpm })); } catch (e) {} };

async function initTools(){
  MT.btn = $('#toolsBtn'); if (!MT.btn || !window.PlanerMotion) return;
  Object.assign(MT, (({ tab, expr, params, fps, color, bpm }) => ({ tab, expr, params, fps, color, bpm }))(Object.assign({ tab:MT.tab, expr:MT.expr, params:{}, fps:MT.fps, color:MT.color, bpm:MT.bpm }, mtPrefs())));
  MT.btn.hidden = false;
  MT.btn.append(icon('film', 17), h('span', { class:'tm-btn-name' }, 'Моушн'));
  MT.btn.title = 'Инструменты моушн-дизайнера: ссылки, экспрешены After Effects, тайминг, цвет, форматы';
  MT.btn.setAttribute('aria-label', 'Инструменты моушн-дизайнера');
  window.addEventListener('pointerdown', e => { if (MT.btn.contains(e.target)) MT.wasOpen = !!(MT.pop && MT.pop.isConnected); }, true);
  MT.btn.addEventListener('click', () => { if (MT.wasOpen) { MT.wasOpen = false; return; } openTools(); });
  try { const d = await extraStore.get('planner-tools'); MT.links = d && Array.isArray(d.links) ? d.links.map(normLink).filter(Boolean) : null; } catch (e) { MT.links = null; }
  if (!MT.links) MT.links = DEFAULT_LINKS;
}
function normLink(l){ const url = linkUrl(l && l.url); return url ? { id:String((l && l.id) || newId()).slice(0, 40), title:String((l && l.title) || '').trim().slice(0, 80) || hostOf(url), url } : null; }
function linkUrl(u){ let s = String(u || '').trim(); if (!s) return null; if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s; try { const x = new URL(s); return (x.protocol === 'https:' || x.protocol === 'http:') && x.hostname.includes('.') ? x.href : null; } catch (e) { return null; } }
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
function saveLinks(){
  pendingSave('planner-tools', true);
  extraStore.set('planner-tools', { v:1, links:MT.links }).catch(e => { setStatus('error'); showBanner('Не удалось сохранить ссылки: ' + ((e && e.message) || 'ошибка')); }).finally(() => pendingSave('planner-tools', false));
}
async function copyText(text, what){
  const ea = window.electronAPI;
  const ok = ea && ea.clipWriteText ? await ea.clipWriteText(text) : false;
  toast(ok ? (what || 'Скопировано') + ' — вставьте в After Effects (Ctrl+V)' : 'Не удалось скопировать.');
}

/* ---------- панель ---------- */
function openTools(tab){
  closeMenu();
  if (tab) MT.tab = tab;
  MT.body = h('div', { class:'mt-body' });
  const tabs = h('div', { class:'mt-tabs', role:'tablist' }, MT_TABS.map(([id, label, ic]) => h('button', { type:'button', role:'tab', class:'mt-tab', 'data-tab':id, 'aria-selected':String(MT.tab === id),
    onclick:() => { MT.tab = id; mtSavePrefs(); tabs.querySelectorAll('.mt-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === id))); renderToolsTab(); } }, icon(ic, 15), label)));
  MT.pop = h('div', { class:'menu mt-pop', role:'dialog', 'aria-label':'Инструменты моушн-дизайнера' },
    h('div', { class:'tm-head' }, icon('film', 17), h('b', {}, 'Моушн'), h('span', { class:'tm-sub' }, 'инструменты для работы')), tabs, MT.body);
  MT.pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); MT.btn.focus(); } });
  renderToolsTab();
  menuEl = MT.pop; placePopup(MT.btn, MT.pop);
}
function renderToolsTab(){
  const t = MT.tab;
  MT.body.replaceChildren(t === 'expr' ? exprTab() : t === 'time' ? timeTab() : t === 'color' ? colorTab() : t === 'formats' ? formatsTab() : linksTab());
}
const field = (label, input, note) => h('label', { class:'mt-field' }, h('span', {}, label), input, note ? h('small', {}, note) : null);
const copyBtn = (text, what) => h('button', { type:'button', class:'tool mt-copy', title:'Копировать', 'aria-label':'Копировать', onclick:() => copyText(typeof text === 'function' ? text() : text, what) }, icon('copy', 15));

/* ---------- ссылки ---------- */
function linksTab(){
  const grid = h('div', { class:'mt-links' }, MT.links.map(l => {
    const tile = h('div', { class:'mt-link', 'data-id':l.id },
      h('button', { type:'button', class:'mt-link-go', title:l.url + ' — открыть в браузере', onclick:() => { if (!MT.editLinks && window.electronAPI) window.electronAPI.openUrl(l.url); } },
        h('span', { class:'mt-fav', style:'--h:' + hueOf(hostOf(l.url)) }, hostOf(l.url).charAt(0).toUpperCase()),
        h('span', { class:'mt-link-t' }, h('b', {}, l.title), h('small', {}, hostOf(l.url)))),
      MT.editLinks ? h('button', { type:'button', class:'tool mt-del', title:'Убрать', 'aria-label':'Убрать ' + l.title, onclick:() => removeLink(l.id) }, icon('x', 14)) : null);
    return tile;
  }));
  if (!MT.links.length) grid.append(h('div', { class:'tm-empty' }, 'Ссылок нет — добавьте нужные сайты ниже.'));
  const name = h('input', { class:'tm-in', type:'text', placeholder:'Название (необязательно)', maxlength:'80', 'aria-label':'Название ссылки' });
  const url = h('input', { class:'tm-in', type:'text', placeholder:'Адрес, например motionarray.com', 'aria-label':'Адрес сайта' });
  const err = h('div', { class:'tm-err', role:'alert' });
  const form = h('form', { class:'mt-add', onsubmit:e => {
    e.preventDefault();
    const l = normLink({ title:name.value, url:url.value });
    if (!l) { err.textContent = 'Нужен адрес сайта, например https://aescripts.com'; url.focus(); return; }
    MT.links.push(l); saveLinks(); renderToolsTab();
    const inp = MT.body.querySelector('.mt-add .tm-in'); if (inp) inp.focus();
  } }, name, url, h('button', { type:'submit', class:'tb-btn primary' }, 'Добавить'));
  return h('div', {},
    h('div', { class:'mt-row-head' }, h('span', { class:'tm-cap' }, 'Мои сайты'), h('button', { type:'button', class:'mt-linkbtn', onclick:() => { MT.editLinks = !MT.editLinks; renderToolsTab(); } }, MT.editLinks ? 'Готово' : 'Изменить')),
    grid, h('div', { class:'tm-cap' }, 'Добавить сайт'), form, err);
}
function hueOf(s){ let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }
function removeLink(id){
  const prev = MT.links.slice(), l = prev.find(x => x.id === id); if (!l) return;
  MT.links = MT.links.filter(x => x.id !== id); saveLinks(); renderToolsTab();
  toast('Ссылка «' + l.title + '» убрана', () => { MT.links = prev; saveLinks(); if (MT.pop && MT.pop.isConnected) renderToolsTab(); });
}

/* ---------- экспрешены After Effects ---------- */
function exprTab(){
  const t = PM.EXPRESSIONS.find(x => x.id === MT.expr) || PM.EXPRESSIONS[0];
  const p = MT.params[t.id] = Object.assign({}, Object.fromEntries(t.params.map(d => [d.id, d.def])), MT.params[t.id] || {});
  const code = h('pre', { class:'mt-code', tabindex:'0', 'aria-label':'Экспрешен' });
  const paint = () => { code.textContent = PM.buildExpression(t.id, p); mtSavePrefs(); };
  const inputs = t.params.map(d => {
    let el;
    if (d.type === 'select') { el = h('select', { class:'tm-sel' }, d.options.map(([v, n]) => h('option', { value:v }, n))); el.value = String(p[d.id]); el.addEventListener('change', () => { p[d.id] = el.value; paint(); }); }
    else if (d.type === 'bool') { el = h('input', { type:'checkbox' }); el.checked = !!p[d.id]; el.addEventListener('change', () => { p[d.id] = el.checked; paint(); }); return h('label', { class:'mt-check' }, el, h('span', {}, d.label)); }
    else { el = h('input', { class:'tm-in', type:'text', inputmode:d.type === 'number' ? 'decimal' : 'text' }); el.value = String(p[d.id]); el.addEventListener('input', () => { p[d.id] = el.value; paint(); }); }
    return field(d.label, el);
  });
  paint();
  const ask = h('textarea', { class:'tm-in mt-ask', rows:'2', placeholder:'Опишите своими словами: «слой качается как маятник и затухает за 3 секунды»', 'aria-label':'Описание экспрешена' });
  const askBtn = h('button', { type:'button', class:'tb-btn', onclick:() => askAiExpression(ask.value) }, icon('spark', 14), 'Попросить ассистента');
  return h('div', { class:'mt-expr' },
    h('div', { class:'mt-list', role:'listbox', 'aria-label':'Шаблоны' }, PM.EXPRESSIONS.map(x => h('button', { type:'button', role:'option', class:'mt-li', 'aria-selected':String(x.id === t.id),
      onclick:() => { MT.expr = x.id; mtSavePrefs(); renderToolsTab(); } }, x.title))),
    h('div', { class:'mt-main' },
      h('b', { class:'mt-title' }, t.title),
      h('div', { class:'mt-where' }, 'Куда: ', h('b', {}, t.where), ' — Alt+щелчок по секундомеру свойства, вставьте код.'),
      h('p', { class:'mt-hint' }, t.hint),
      inputs.length ? h('div', { class:'mt-params' }, inputs) : null,
      h('div', { class:'mt-code-wrap' }, code, h('button', { type:'button', class:'tb-btn primary mt-copy-main', onclick:() => copyText(code.textContent, 'Экспрешен скопирован') }, icon('copy', 14), 'Копировать')),
      sample ? h('div', { class:'mt-ai' }, h('span', { class:'tm-cap' }, 'Нет нужного шаблона?'), ask, askBtn) : null));
}
function askAiExpression(text){
  const d = String(text || '').trim();
  if (!d) { toast('Опишите, что должен делать экспрешен.'); return; }
  if (!sample) { toast('Ассистент недоступен.'); return; }
  closeMenu(); openAi();
  aiSend('Напиши экспрешн для After Effects: ' + d + '. Дай готовый код одним блоком ``` и одной-двумя фразами скажи, к какому свойству его применить и какие числа можно поменять.');
}

/* ---------- тайминг: кадры, секунды, таймкод, темп музыки ---------- */
function timeTab(){
  const fpsSel = h('select', { class:'tm-sel', 'aria-label':'Кадров в секунду' }, PM.FPS.map(f => h('option', { value:String(f) }, f + ' fps')));
  fpsSel.value = String(MT.fps);
  const fr = h('input', { class:'tm-in', type:'text', inputmode:'numeric', 'aria-label':'Кадры' });
  const sec = h('input', { class:'tm-in', type:'text', inputmode:'decimal', 'aria-label':'Секунды' });
  const tc = h('input', { class:'tm-in mono', type:'text', 'aria-label':'Таймкод', placeholder:'ЧЧ:ММ:СС:КК' });
  const paint = src => {
    const f = MT.frames;
    if (src !== fr) fr.value = String(f);
    if (src !== sec) sec.value = String(Math.round(PM.framesToSec(f, MT.fps) * 1000) / 1000);
    if (src !== tc) tc.value = PM.framesToTC(f, MT.fps);
    mtSavePrefs();
  };
  fpsSel.addEventListener('change', () => { const s = PM.framesToSec(MT.frames, MT.fps); MT.fps = Number(fpsSel.value); MT.frames = PM.secToFrames(s, MT.fps); paint(); paintBeat(); });
  fr.addEventListener('input', () => { const v = Math.round(Number(fr.value.replace(',', '.'))); if (isFinite(v) && v >= 0) { MT.frames = v; paint(fr); } });
  sec.addEventListener('input', () => { const v = Number(sec.value.replace(',', '.')); if (isFinite(v) && v >= 0) { MT.frames = PM.secToFrames(v, MT.fps); paint(sec); } });
  tc.addEventListener('input', () => { const v = PM.tcToFrames(tc.value, MT.fps); if (v != null) { MT.frames = v; paint(tc); } });
  const bpm = h('input', { class:'tm-in', type:'text', inputmode:'decimal', 'aria-label':'Темп, ударов в минуту' }); bpm.value = String(MT.bpm);
  const beatOut = h('div', { class:'mt-beat' });
  const paintBeat = () => {
    const b = PM.beatFrames(Number(String(bpm.value).replace(',', '.')), MT.fps);
    beatOut.replaceChildren(...(b ? [
      h('div', {}, h('b', {}, (Math.round(b.perBeat * 100) / 100) + ' кадр.'), h('span', {}, 'на долю (' + (Math.round(b.secBeat * 1000) / 1000) + ' с)')),
      h('div', {}, h('b', {}, (Math.round(b.perBar * 100) / 100) + ' кадр.'), h('span', {}, 'на такт 4/4')),
      h('div', {}, h('b', {}, (Math.round(b.perBeat / 2 * 100) / 100) + ' кадр.'), h('span', {}, 'на восьмую'))
    ] : [h('span', { class:'tm-empty' }, 'Введите темп, например 120')]));
    if (b) { MT.bpm = Number(String(bpm.value).replace(',', '.')); mtSavePrefs(); }
  };
  bpm.addEventListener('input', paintBeat);
  paint(); paintBeat();
  return h('div', { class:'mt-time' },
    h('div', { class:'mt-row' }, field('Частота кадров', fpsSel)),
    h('div', { class:'tm-cap' }, 'Перевод: введите любое значение'),
    h('div', { class:'mt-grid3' }, field('Кадры', fr), field('Секунды', sec), field('Таймкод', tc, '23.976 и 29.97 — без drop-frame')),
    h('div', { class:'tm-cap' }, 'Под музыку: монтаж в такт'),
    h('div', { class:'mt-row' }, field('Темп, BPM', bpm), beatOut));
}

/* ---------- цвет ---------- */
function colorTab(){
  const pick = h('input', { type:'color', class:'mt-picker', 'aria-label':'Выбрать цвет' });
  const inp = h('input', { class:'tm-in mono', type:'text', placeholder:'#3AA0FF, rgb(58,160,255) или [0.2, 0.6, 1, 1]', 'aria-label':'Цвет' });
  const out = h('div', { class:'mt-colors' });
  const err = h('div', { class:'tm-err' });
  const paint = (src) => {
    const c = PM.parseColor(src === pick ? pick.value : inp.value);
    if (!c) { err.textContent = inp.value.trim() ? 'Не понимаю запись цвета.' : ''; return; }
    err.textContent = '';
    const f = PM.colorFormats(c);
    MT.color = f.hex; mtSavePrefs();
    if (src !== pick) pick.value = f.hex.toLowerCase();
    if (src === pick) inp.value = f.hex;
    out.replaceChildren(h('div', { class:'mt-swatch', style:'background:' + f.hex }),
      ...[['HEX', f.hex], ['RGB', f.rgb], ['After Effects (экспрешен)', f.ae], ['HSL', f.hsl]].map(([k, v]) => h('div', { class:'mt-cv' }, h('span', {}, k), h('code', {}, v), copyBtn(v, k + ' скопирован'))));
  };
  pick.addEventListener('input', () => paint(pick));
  inp.addEventListener('input', () => paint(inp));
  inp.value = MT.color; paint(inp);
  return h('div', { class:'mt-color' }, h('div', { class:'mt-row' }, pick, inp), err, out,
    h('p', { class:'mt-hint' }, 'Массив для After Effects — значения 0…1: вставьте его в экспрешен свойства Color, например в эффект Fill.'));
}

/* ---------- форматы кадра ---------- */
function formatsTab(){
  const w = h('input', { class:'tm-in', type:'text', inputmode:'numeric', 'aria-label':'Ширина' }), hh = h('input', { class:'tm-in', type:'text', inputmode:'numeric', 'aria-label':'Высота' });
  const ar = h('b', { class:'mt-ar' });
  const calc = () => { ar.textContent = PM.aspect(Number(w.value), Number(hh.value)) || '—'; };
  w.addEventListener('input', calc); hh.addEventListener('input', calc);
  w.value = '1920'; hh.value = '1080'; calc();
  return h('div', {},
    h('div', { class:'mt-formats' }, PM.FORMATS.map(f => h('div', { class:'mt-fmt' },
      h('span', { class:'mt-fmt-box', style:'aspect-ratio:' + f.w + '/' + f.h }),
      h('div', { class:'mt-fmt-t' }, h('b', {}, f.title), h('small', {}, f.use)),
      h('code', {}, f.w + '×' + f.h), copyBtn(f.w + 'x' + f.h, 'Размер ' + f.w + '×' + f.h + ' скопирован')))),
    h('div', { class:'tm-cap' }, 'Соотношение сторон'),
    h('div', { class:'mt-row' }, field('Ширина', w), field('Высота', hh), h('div', { class:'mt-ar-box' }, h('span', {}, 'Соотношение'), ar)));
}
