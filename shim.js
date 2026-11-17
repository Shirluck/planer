/* Прослойка для десктопной версии.
   Страница общается с «рантаймом» через window.claude.use('db' | 'user' | 'sample').
   Здесь те же три возможности реализованы поверх Electron:
   - db     -> JSON-файл на вашем компьютере (через main.js)
   - user   -> один локальный пользователь
   - sample -> ИИ через API Anthropic с вашим ключом (цикл вызова инструментов здесь) */
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
    '.pk-err{color:#d93a40;font-size:12.5px;margin-top:6px;min-height:16px}';
  document.head.appendChild(css);

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
        '<div class="pk-row"><button type="button" class="pk-cancel">Отмена</button><button type="submit" class="pk-ok">Сохранить</button></div></form>';
      ov.querySelector('.pk-why').textContent = reason || 'Чтобы ассистент мог работать, вставьте ваш ключ API.';
      const inp = ov.querySelector('.pk-in'), err = ov.querySelector('.pk-err');
      const close = ok => { ov.remove(); keyDialog = null; resolve(ok); };
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

  /* ---------- sample: ИИ + цикл инструментов ---------- */
  const MODELS = { quick: 'claude-haiku-5-5', default: 'claude-sonnet-5-5', complex: 'claude-opus-5-5' };
  const MAX_STEPS = 10;
  const fail = (code, message, text) => Object.assign(new Error(message), { code, message, text });

  async function sample(input, opts) {
    opts = opts || {};
    const convo = (typeof input === 'string' ? [{ role: 'user', content: input }] : input).map(m => ({ role: m.role, content: m.content }));
    const tools = opts.tools || [];
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
          const tool = tools.find(t => t.name === u.name);
          try {
            if (!tool) throw new Error('Unknown tool: ' + u.name);
            const out = await tool.execute(u.input || {});
            if (out && Array.isArray(out.__content)) {          // готовые блоки (например, картинка для look_at_image)
              results.push({ type: 'tool_result', tool_use_id: u.id, content: out.__content });
              continue;
            }
            let s = typeof out === 'string' ? out : JSON.stringify(out === undefined ? { ok: true } : out);
            if (s.length > 12000) s = s.slice(0, 12000) + '…[обрезано]';
            results.push({ type: 'tool_result', tool_use_id: u.id, content: s });
          } catch (e) {
            results.push({ type: 'tool_result', tool_use_id: u.id, content: String((e && e.message) || e), is_error: true });
          }
        }
        convo.push({ role: 'user', content: results });
      }
      return { text: acc, truncated: true };
    } finally {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    }
  }

  const caps = { db, user, sample };
  window.claude = { use: async name => caps[name] || null };
})();
