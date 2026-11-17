/* Прослойка для десктопной версии.
   Страница общается с «рантаймом» через window.claude.use('db' | 'user' | 'sample').
   Здесь те же три возможности реализованы поверх Electron:
   - db     -> JSON-файл на вашем компьютере (через main.js)
   - user   -> один локальный пользователь
   - sample -> ИИ с циклом вызова инструментов здесь. Два способа подключения (меню «Ассистент»):
               подписка Claude — через локальный Claude Code (main.js → lib/claudecode.js), ответы в виде JSON {reply, tool_calls};
               ключ API Anthropic — запросы к api.anthropic.com через основной процесс. */
(function () {
  'use strict';
  const api = window.electronAPI;
  if (!api || window.claude) return;   // в обычном браузере ничего не делаем

  /* ---------- db ---------- */
  const snap = (id, d) => ({ id, exists: !!d, data: () => d || undefined, metadata: { fromCache: false, hasPendingWrites: false } });
  function docRef(path) {
    const id = path.split('/').pop();
    return {
      id, path,
      async get() { return snap(id, await api.dbGet(path)); },
      async set(data) { await api.dbSet(path, data); },
      async delete() { await api.dbDelete(path); },
      onSnapshot(next, error) {
        let alive = true;
        api.dbGet(path).then(d => { if (alive) next(snap(id, d)); },
                             e => { if (alive && error) error({ code: 'unavailable', message: String(e) }); });
        return () => { alive = false; };
      },
      collection(p) { return colRef(path + '/' + p); }
    };
  }
  const colRef = p => ({ path: p, doc: id => docRef(p + '/' + (id || Math.random().toString(36).slice(2))) });
  const db = { doc: docRef, collection: colRef };

  /* ---------- user ---------- */
  const me = { id: 'local', name: '', avatarUrl: '', color: '#888', email: null, isOwner: true, canEdit: true };
  const user = {
    id: async () => 'local', me: async () => me,
    isOwner: async () => true, canEdit: async () => true, can: async () => true
  };

  /* ---------- диалог ключа ---------- */
  const css = document.createElement('style');
  css.textContent =
    '.pk-ov{position:fixed;inset:0;z-index:300;background:rgba(20,18,14,.5);display:grid;place-items:center;padding:16px}' +
    '.pk-box{width:min(460px,100%);background:var(--panel,#fff);color:var(--text,#222);border:1px solid var(--line,#ddd);border-radius:16px;padding:20px 22px;box-shadow:0 24px 70px rgba(0,0,0,.35)}' +
    '.pk-box h3{margin:0 0 6px;font-size:17px}.pk-box p{margin:0 0 12px;color:var(--muted,#666);font-size:13.5px;line-height:1.5}' +
    '.pk-box input{width:100%;padding:10px 12px;border:1px solid var(--line-2,#ccc);border-radius:10px;background:var(--panel-2,#f7f7f7);color:inherit;font:inherit;outline:none}' +
    '.pk-box input:focus{border-color:var(--ink,#222)}' +
    '.pk-row{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}' +
    '.pk-row button{padding:8px 16px;border-radius:10px;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--line-2,#ccc);background:transparent;color:inherit}' +
    '.pk-row button.pk-ok{background:var(--ink,#222);color:var(--ink-text,#fff);border-color:transparent}' +
    '.pk-err{color:#d93a40;font-size:12.5px;margin-top:6px;min-height:16px}' +
    '.pk-alt{margin:10px 0 0;font-size:12.5px;color:var(--muted,#666)}.pk-alt button{border:0;background:none;padding:0;color:inherit;text-decoration:underline;cursor:pointer;font:inherit}' +
    '.as-box{width:min(540px,100%)}' +
    '.as-opt{display:flex;gap:10px;align-items:flex-start;padding:11px 12px;border:1px solid var(--line,#ddd);border-radius:12px;margin-top:10px;cursor:pointer;font-size:13.5px;line-height:1.45}' +
    '.pk-box .as-opt input{width:auto;padding:0;flex:none;margin:3px 0 0;accent-color:var(--ink,#222)}.as-opt b{display:block;font-size:14px;margin-bottom:2px}' +
    '.as-opt.on{border-color:var(--ink,#222);background:var(--panel-2,#f7f7f7)}.as-opt span{color:var(--muted,#666)}' +
    '.as-cc{margin:8px 0 0 34px;font-size:13px;line-height:1.5}' +
    '.as-st{padding:8px 10px;border-radius:10px;background:var(--panel-2,#f5f5f5);border:1px solid var(--line,#ddd)}' +
    '.as-st.ok{border-color:rgba(46,160,90,.5)}.as-st.warn{border-color:rgba(214,140,30,.6)}.as-st.bad{border-color:rgba(217,58,64,.55)}' +
    '.as-st code{font-size:11.5px;word-break:break-all}' +
    '.as-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center}' +
    '.as-btns button,.as-btns select{padding:6px 12px;border-radius:9px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;border:1px solid var(--line-2,#ccc);background:transparent;color:inherit}' +
    '.as-btns button.as-pri{background:var(--ink,#222);color:var(--ink-text,#fff);border-color:transparent}' +
    '.as-btns label{font-size:12.5px;color:var(--muted,#666);margin-left:auto;display:flex;gap:6px;align-items:center}' +
    '.as-btns select{font-weight:400;padding:5px 8px;background:var(--panel-2,#f7f7f7)}';
  document.head.appendChild(css);
  const ai = api.ai || null;

  let keyDialog = null;
  function askKey(reason) {
    if (keyDialog) return keyDialog;
    keyDialog = new Promise(resolve => {
      const ov = document.createElement('div'); ov.className = 'pk-ov';
      ov.innerHTML =
        '<form class="pk-box" role="dialog" aria-modal="true" aria-label="Ключ API Anthropic">' +
        '<h3>Ключ API Anthropic</h3>' +
        '<p class="pk-why"></p>' +
        '<p>Ключ хранится только на этом компьютере (в зашифрованном виде, если система это поддерживает) и отправляется только на api.anthropic.com. ' +
        'Создать ключ: <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. ' +
        'Использование ИИ оплачивается по тарифам API.</p>' +
        '<input type="password" class="pk-in" placeholder="sk-ant-…" autocomplete="off" spellcheck="false" aria-label="Ключ API">' +
        '<div class="pk-err" role="alert"></div>' +
        (ai ? '<p class="pk-alt">Не хотите платить за API? <button type="button" class="pk-sub">Использовать подписку Claude</button> — через Claude Code, в счёт лимитов вашей подписки.</p>' : '') +
        '<div class="pk-row"><button type="button" class="pk-cancel">Отмена</button><button type="submit" class="pk-ok">Сохранить</button></div></form>';
      ov.querySelector('.pk-why').textContent = reason || 'Чтобы ассистент мог работать, вставьте ваш ключ API.';
      const inp = ov.querySelector('.pk-in'), err = ov.querySelector('.pk-err');
      const close = ok => { ov.remove(); keyDialog = null; resolve(ok); };
      const sub = ov.querySelector('.pk-sub');
      if (sub) sub.addEventListener('click', async () => { await ai.set({ mode: 'claude-code' }); close(false); openSettings(); });
      ov.querySelector('.pk-cancel').addEventListener('click', () => close(false));
      ov.addEventListener('mousedown', e => { if (e.target === ov) close(false); });
      ov.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(false); } });
      ov.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        const v = inp.value.trim();
        if (v.length < 20) { err.textContent = 'Похоже, ключ неполный.'; return; }
        try { await api.setKey(v); close(true); } catch (x) { err.textContent = 'Не удалось сохранить ключ.'; }
      });
      document.body.appendChild(ov); inp.focus();
    });
    return keyDialog;
  }
  if (api.onAskKey) api.onAskKey(() => askKey('Введите новый ключ API — он заменит сохранённый.'));

  /* ---------- диалог «Ассистент: подключение» ---------- */
  const stateListeners = [];
  if (ai && ai.onState) ai.onState(s => stateListeners.forEach(f => { try { f(s); } catch (_) {} }));
  let settingsOv = null;
  async function openSettings() {
    if (!ai) return;
    if (settingsOv) { settingsOv.querySelector('.pk-ok').focus(); return; }
    const ov = settingsOv = document.createElement('div'); ov.className = 'pk-ov';
    ov.innerHTML =
      '<div class="pk-box as-box" role="dialog" aria-modal="true" aria-label="Подключение ассистента">' +
      '<h3>Ассистент: подключение</h3>' +
      '<label class="as-opt" data-mode="claude-code"><input type="radio" name="as-mode" value="claude-code"><div><b>Подписка Claude</b>' +
      '<span>Через Claude Code на этом компьютере. Запросы идут в счёт лимитов вашей подписки Claude (Pro или Max) — платить за API не нужно.</span></div></label>' +
      '<div class="as-cc"><div class="as-st" role="status">Проверяю Claude Code…</div>' +
      '<div class="as-btns"><button type="button" class="as-login as-pri" hidden>Войти в Claude</button><button type="button" class="as-check">Проверить</button>' +
      '<button type="button" class="as-pick" hidden>Указать claude.exe…</button>' +
      '<label>Модель <select class="as-model"><option value="sonnet">Sonnet — быстрее</option><option value="opus">Opus — умнее, тратит больше лимита</option><option value="haiku">Haiku — самая быстрая</option></select></label></div></div>' +
      '<label class="as-opt" data-mode="api"><input type="radio" name="as-mode" value="api"><div><b>Ключ API Anthropic</b>' +
      '<span>Запросы к api.anthropic.com с вашим ключом, оплата по тарифам API.</span></div></label>' +
      '<div class="as-btns as-api" style="margin-left:34px"><button type="button" class="as-key">Ввести ключ…</button></div>' +
      '<div class="pk-row"><button type="button" class="pk-ok">Готово</button></div></div>';
    const $ = s => ov.querySelector(s);
    const st = $('.as-st'), loginBtn = $('.as-login'), pickBtn = $('.as-pick'), modelSel = $('.as-model');
    let alive = true, poll = null, checking = false;
    const close = () => { alive = false; clearInterval(poll); ov.remove(); settingsOv = null; };
    const say = (cls, html) => { st.className = 'as-st ' + cls; st.innerHTML = html; };
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function showMode(s) {
      ov.querySelectorAll('.as-opt').forEach(l => { const on = l.dataset.mode === s.mode; l.classList.toggle('on', on); l.querySelector('input').checked = on; });
      modelSel.value = s.model;
    }
    async function check(quiet) {
      if (checking) return; checking = true;
      if (!quiet) say('', 'Проверяю Claude Code…');
      let s; try { s = await ai.ccStatus(); } catch (e) { s = { found: false, error: String(e) }; }
      checking = false;
      if (!alive) return s;
      loginBtn.hidden = !s.found || (s.loggedIn && s.subscription);
      pickBtn.hidden = !!s.found && !s.error;
      if (!s.found) say('bad', 'Claude Code не найден. Он входит в приложение Claude для компьютера (claude.ai/download) или ставится отдельно. Если он установлен в другом месте, укажите файл claude.exe.');
      else if (s.loggedIn && s.subscription) { say('ok', '<b>Готово.</b> Вход выполнен' + (s.email ? ': ' + esc(s.email) : '') + (s.plan ? ', подписка ' + esc(s.plan) : '') + '. Claude Code ' + esc(s.version || '') + '.'); clearInterval(poll); }
      else if (s.loggedIn) say('warn', 'Claude Code вошёл через ключ API или Console — такие запросы оплачиваются по тарифам API. Чтобы тратить лимиты подписки, нажмите «Войти в Claude» и войдите в аккаунт с подпиской.');
      else say('warn', 'Claude Code ' + esc(s.version || '') + ' найден, но вход не выполнен. Нажмите «Войти в Claude»: откроется окно входа и браузер — войдите в свой аккаунт Claude с подпиской, затем вернитесь сюда.');
      return s;
    }
    ov.querySelectorAll('.as-opt input').forEach(r => r.addEventListener('change', async () => { showMode(await ai.set({ mode: r.value })); }));
    modelSel.addEventListener('change', async () => { showMode(await ai.set({ model: modelSel.value })); });
    $('.as-check').addEventListener('click', () => check(false));
    $('.as-key').addEventListener('click', () => { close(); askKey('Ключ хранится только на этом компьютере.').then(async ok => { if (ok) await ai.set({ mode: 'api' }); }); });
    pickBtn.addEventListener('click', async () => { const r = await ai.ccPickPath(); if (r && r.error) say('bad', esc(r.error)); else if (r && r.ok) check(false); });
    loginBtn.addEventListener('click', async () => {
      const r = await ai.ccLogin();
      if (r && r.ok) {
        say('', 'Открыто окно входа. Завершите вход в браузере (аккаунт с подпиской Claude) — статус обновится сам.');
        clearInterval(poll); let n = 0;
        poll = setInterval(async () => { if (++n > 100 || !alive) { clearInterval(poll); return; } const s = await check(true); if (s && s.loggedIn && s.subscription) clearInterval(poll); }, 3000);
      } else if (r && r.manual) say('warn', 'Выполните в терминале и войдите в аккаунт: <code>' + esc(r.command) + '</code>, затем нажмите «Проверить».');
      else say('bad', 'Не удалось открыть окно входа' + (r && r.error ? ': ' + esc(r.error) : '') + '.');
    });
    $('.pk-ok').addEventListener('click', close);
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    document.body.appendChild(ov);
    showMode(await ai.get());
    $('.pk-ok').focus();
    check(false);
  }
  if (ai && ai.onSettings) ai.onSettings(() => openSettings());

  /* ---------- sample: ИИ + цикл инструментов ---------- */
  const MODELS = { quick: 'claude-haiku-5-5', default: 'claude-sonnet-5-5', complex: 'claude-opus-5-5' };
  const MAX_STEPS = 10;
  const fail = (code, message, text) => Object.assign(new Error(message), { code, message, text });

  // Выполнить инструмент: строка-результат (обрезанная) или готовые блоки (__content, например картинка).
  async function runTool(tools, name, input) {
    const tool = tools.find(t => t.name === name);
    try {
      if (!tool) throw new Error('Unknown tool: ' + name);
      const out = await tool.execute(input || {});
      if (out && Array.isArray(out.__content)) return { blocks: out.__content };
      let s = typeof out === 'string' ? out : JSON.stringify(out === undefined ? { ok: true } : out);
      if (s.length > 12000) s = s.slice(0, 12000) + '…[обрезано]';
      return { text: s };
    } catch (e) { return { text: String((e && e.message) || e), error: true }; }
  }

  /* --- подписка Claude: каждый шаг — отдельный запуск Claude Code без его инструментов.
     Модель получает весь ход работы одним сообщением и отвечает JSON {reply, tool_calls}. --- */
  const flat = c => typeof c === 'string' ? c : (Array.isArray(c) ? c.filter(b => b && b.type === 'text').map(b => b.text).join('\n') : '');
  function ccSystem(tools) {
    return 'Ты — ассистент внутри десктопного приложения «Планер» (личный планировщик). Ты работаешь не в терминале: ' +
      'у тебя нет доступа к файлам, командам и интернету — только к инструментам Планера из списка ниже. Их выполняет само приложение.\n\n' +
      'Каждый твой ответ — структурированный JSON по заданной схеме:\n' +
      '- "reply": текст для пользователя по-русски (можно простой Markdown: **жирный**, списки «- »);\n' +
      '- "tool_calls": вызовы инструментов [{"name": "...", "input": {...}}], они выполняются по порядку.\n' +
      'Если нужно что-то сделать или прочитать — перечисли вызовы в "tool_calls" (можно несколько сразу), а "reply" оставь пустым. ' +
      'Результаты придут следующим сообщением, и ты продолжишь. Когда всё сделано или действия не нужны — верни "tool_calls": [] и итоговый ответ в "reply".\n' +
      'Не придумывай результаты и id: используй только то, что видишь в состоянии планировщика и в результатах инструментов. Не повторяй уже выполненные вызовы.\n\n' +
      'Инструменты Планера:\n' +
      tools.map(t => '- ' + t.name + ': ' + t.description + '\n  input (JSON Schema): ' + JSON.stringify(t.inputSchema || { type: 'object', properties: {} })).join('\n');
  }
  async function sampleClaudeCode(convo, tools, opts) {
    const system = ccSystem(tools), names = tools.map(t => t.name);
    const last = convo[convo.length - 1];
    const earlier = convo.slice(0, -1).map(m => (m.role === 'assistant' ? 'Ассистент: ' : 'Пользователь: ') + flat(m.content)).join('\n\n');
    const head = (earlier ? '<предыдущий разговор>\n' + earlier + '\n</предыдущий разговор>\n\n' : '') + flat(last && last.content);
    const steps = [];
    let rid = null, acc = '';
    const aborted = () => opts.signal && opts.signal.aborted;
    const onAbort = () => { if (rid) ai.ccCancel(rid); };
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (aborted()) throw fail('aborted', 'aborted', acc);
        rid = 'cc' + Math.random().toString(36).slice(2) + step;
        const content = [{ type: 'text', text: head }].concat(steps,
          step ? [{ type: 'text', text: 'Продолжай по результатам выше: верни JSON — следующие вызовы в "tool_calls" или итоговый ответ в "reply" с пустым "tool_calls".' }] : []);
        const res = await ai.ccRun(rid, { system, content, toolNames: names });
        if (aborted() || (res && res.code === 'aborted')) throw fail('aborted', 'aborted', acc);
        if (!res || !res.ok) {
          const code = res && res.code, msg = (res && res.error) || 'Claude Code недоступен';
          if (code === 'not_found') throw fail('cc_missing', msg, acc);
          if (code === 'not_logged_in') throw fail('cc_login', msg, acc);
          if (code === 'rate_limited') throw fail('rate_limited', msg, acc);
          throw fail('unavailable', msg, acc);
        }
        let out = res.structured;
        if (!out && res.text) { try { out = JSON.parse(String(res.text).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '')); } catch (_) { out = { reply: res.text, tool_calls: [] }; } }
        const reply = String((out && out.reply) || '').trim();
        const calls = (out && Array.isArray(out.tool_calls) ? out.tool_calls : []).filter(c => c && typeof c.name === 'string').slice(0, 16);
        if (reply) { const delta = (acc ? '\n\n' : '') + reply; acc += delta; if (opts.onText) opts.onText({ text: acc, delta }); }
        if (!calls.length) return { text: acc, truncated: false };
        const parts = [{ type: 'text', text: '<шаг ' + (step + 1) + '>\nТвой ответ: ' + JSON.stringify({ reply, tool_calls: calls }) + '\nРезультаты инструментов:' }];
        for (let i = 0; i < calls.length; i++) {
          if (aborted()) throw fail('aborted', 'aborted', acc);
          const c = calls[i], r = await runTool(tools, c.name, c.input && typeof c.input === 'object' ? c.input : {});
          if (r.blocks) {
            parts.push({ type: 'text', text: (i + 1) + '. ' + c.name + ' → (вложение ниже)' });
            r.blocks.forEach(b => { if (b && (b.type === 'image' || b.type === 'text')) parts.push(b); });
          } else parts.push({ type: 'text', text: (i + 1) + '. ' + c.name + (r.error ? ' → ОШИБКА: ' : ' → ') + r.text });
        }
        parts.push({ type: 'text', text: '</шаг ' + (step + 1) + '>' });
        steps.push(...parts);
      }
      return { text: acc, truncated: true };
    } finally {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    }
  }

  async function sample(input, opts) {
    opts = opts || {};
    const convo = (typeof input === 'string' ? [{ role: 'user', content: input }] : input).map(m => ({ role: m.role, content: m.content }));
    const tools = opts.tools || [];
    if (ai && (await ai.get()).mode === 'claude-code') return sampleClaudeCode(convo, tools, opts);
    const toolDefs = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema || { type: 'object', properties: {} } }));
    const model = opts.model || MODELS[opts.modelTier] || MODELS.default;

    if (!(await api.hasKey())) {
      if (!(await askKey())) throw fail('not_granted', 'API key required');
    }
    let rid = null, acc = '';
    const onAbort = () => { if (rid) api.anthropicCancel(rid); };
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true });

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (opts.signal && opts.signal.aborted) throw fail('aborted', 'aborted', acc);
        rid = Math.random().toString(36).slice(2) + step;
        const body = { model, max_tokens: 4096, messages: convo };
        if (toolDefs.length) body.tools = toolDefs;
        const res = await api.anthropic(rid, body);
        if (res.aborted || (opts.signal && opts.signal.aborted)) throw fail('aborted', 'aborted', acc);
        if (!res.ok) {
          const msg = (res.data && res.data.error && res.data.error.message) || ('HTTP ' + res.status);
          if (res.status === 401 || res.status === 403) { await api.clearKey(); throw fail('not_granted', msg, acc); }
          if (res.status === 429) throw fail('rate_limited', msg, acc);
          throw fail('unavailable', msg, acc);
        }
        const content = (res.data && res.data.content) || [];
        const texts = content.filter(b => b.type === 'text').map(b => b.text).join('');
        if (texts) {
          const delta = (acc ? '\n\n' : '') + texts; acc += delta;
          if (opts.onText) opts.onText({ text: acc, delta });
        }
        const uses = content.filter(b => b.type === 'tool_use');
        if (!uses.length || res.data.stop_reason !== 'tool_use') {
          return { text: acc, truncated: res.data.stop_reason === 'max_tokens' };
        }
        convo.push({ role: 'assistant', content });
        const results = [];
        for (const u of uses) {
          const r = await runTool(tools, u.name, u.input);
          // готовые блоки (например, картинка для look_at_image) передаются как есть
          results.push(r.blocks ? { type: 'tool_result', tool_use_id: u.id, content: r.blocks }
            : Object.assign({ type: 'tool_result', tool_use_id: u.id, content: r.text }, r.error ? { is_error: true } : {}));
        }
        convo.push({ role: 'user', content: results });
      }
      return { text: acc, truncated: true };
    } finally {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    }
  }

  // assistant — режим подключения (для подписи в панели ассистента) и диалог «Подключение»
  const assistant = ai ? {
    get: () => ai.get(),
    openSettings,
    onState: cb => { if (typeof cb === 'function') stateListeners.push(cb); }
  } : null;
  const caps = { db, user, sample, assistant };
  window.claude = { use: async name => caps[name] || null };
})();
