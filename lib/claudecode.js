// Ассистент через подписку Claude: запуск локального Claude Code (`claude -p`) без его встроенных инструментов.
// Ответ модели — структурированный JSON {reply, tool_calls}; инструменты Планера выполняет страница (см. shim.js).
// Запросы идут в счёт лимитов подписки, под которой выполнен вход в Claude Code (`claude auth login`).
// Ключи API из окружения дочернему процессу не передаются — иначе Claude Code тратил бы платный API.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

const isWin = process.platform === 'win32';
const EXE = isWin ? 'claude.exe' : 'claude';
const STEP_TIMEOUT = 4 * 60 * 1000;

const verKey = v => String(v).split(/[.-]/).map(x => String(Number(x) || 0).padStart(6, '0')).join('.');

// Где искать Claude Code: путь из настроек → PATH → обычная установка → копия внутри приложения Claude.
function candidates(custom) {
  const out = [];
  if (custom) out.push(custom);
  try {
    const r = spawnSync(isWin ? 'where' : 'which', [isWin ? 'claude.exe' : 'claude'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    (r.stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(p => out.push(p));
  } catch (_) {}
  const home = os.homedir();
  out.push(path.join(home, '.local', 'bin', EXE));
  if (!isWin) out.push('/usr/local/bin/claude', '/opt/homebrew/bin/claude');
  if (isWin && process.env.LOCALAPPDATA) {
    // копии Claude Code, которые ставит приложение Claude: Claude-Data\<пакет>\claude-code\<версия>\<хеш>\claude.exe
    const base = path.join(process.env.LOCALAPPDATA, 'Claude-Data');
    const found = [];
    try {
      for (const pkg of fs.readdirSync(base)) {
        const cc = path.join(base, pkg, 'claude-code');
        let vers = []; try { vers = fs.readdirSync(cc); } catch (_) { continue; }
        for (const v of vers) {
          let hashes = []; try { hashes = fs.readdirSync(path.join(cc, v)); } catch (_) { continue; }
          for (const hsh of hashes) { const f = path.join(cc, v, hsh, EXE); if (fs.existsSync(f)) found.push({ f, v }); }
        }
      }
    } catch (_) {}
    found.sort((a, b) => verKey(b.v).localeCompare(verKey(a.v))).forEach(x => out.push(x.f));
  }
  return [...new Set(out)];
}

function createClaudeCode({ workDir, getCustomPath }) {
  const running = new Map();
  const killedByUser = new WeakSet();   // процессы, остановленные кнопкой «Стоп»
  // Для автотестов: PLANER_CLAUDE_CMD='["node","fake-claude.js"]' вместо настоящего Claude Code.
  const testCmd = (() => { try { const v = JSON.parse(process.env.PLANER_CLAUDE_CMD || 'null'); return Array.isArray(v) && v.length ? v : null; } catch (_) { return null; } })();

  function resolve() {
    if (testCmd) return { cmd: testCmd[0], pre: testCmd.slice(1), path: testCmd.join(' ') };
    for (const p of candidates(getCustomPath && getCustomPath())) {
      try { if (p && fs.statSync(p).isFile() && /\.exe$|claude$/i.test(p)) return { cmd: p, pre: [], path: p }; } catch (_) {}
    }
    return null;
  }
  // Окружение без ключей API и без переменных чужого сеанса Claude Code (иначе запрос ушёл бы не через подписку
  // или Claude Code решил бы, что работает внутри другого сеанса). Оставляем только настройки самого пользователя.
  const KEEP = new Set(['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_GIT_BASH_PATH']);
  function childEnv() {
    /** @type {NodeJS.ProcessEnv} */
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (/^(ANTHROPIC_|CLAUDE)/i.test(k) && !KEEP.has(k.toUpperCase())) continue;
      if (/^ELECTRON_/i.test(k)) continue;
      env[k] = v;
    }
    return env;
  }
  const ensureDir = () => { try { fs.mkdirSync(workDir, { recursive: true }); } catch (_) {} };
  function runSimple(r, args, timeout) {
    ensureDir();
    return new Promise(res => {
      let out = '', err = '';
      let p;
      try { p = spawn(r.cmd, [...r.pre, ...args], { cwd: workDir, env: childEnv(), windowsHide: true }); }
      catch (e) { res({ code: -1, out: '', err: String(e.message || e) }); return; }
      const t = setTimeout(() => { try { p.kill(); } catch (_) {} }, timeout || 20000);
      p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
      p.on('error', e => { clearTimeout(t); res({ code: -1, out, err: String(e.message || e) }); });
      p.on('close', code => { clearTimeout(t); res({ code, out, err }); });
    });
  }

  // Найден ли Claude Code и выполнен ли вход (и каким способом: подписка claude.ai или ключ).
  async function status() {
    const r = resolve();
    if (!r) return { found: false };
    const v = await runSimple(r, ['--version'], 20000);
    const version = (v.out.match(/\d+\.\d+\.\d+/) || [''])[0];
    const s = await runSimple(r, ['auth', 'status'], 20000);
    let st = {};
    try { st = JSON.parse(s.out.slice(s.out.indexOf('{'))); } catch (_) {}
    const method = String(st.authMethod || 'none');
    return { found: true, path: r.path, version, loggedIn: !!st.loggedIn, method, subscription: !!st.loggedIn && !/api.?key|console/i.test(method),
      plan: String(st.subscriptionType || ''), email: String(st.email || (st.account && st.account.email) || ''), bundled: /Claude-Data/i.test(r.path) };
  }

  // Открыть окно входа (`claude auth login`): вход в аккаунт пользователь выполняет сам в браузере.
  function openLogin() {
    const r = resolve();
    if (!r) return { ok: false, error: 'Claude Code не найден.' };
    ensureDir();
    const command = [r.cmd, ...r.pre].map(s => '"' + s + '"').join(' ') + ' auth login --claudeai';
    if (testCmd) {   // автотесты: без отдельного окна
      try { const p = spawn(r.cmd, [...r.pre, 'auth', 'login', '--claudeai'], { cwd: workDir, env: childEnv(), detached: true, stdio: 'ignore', windowsHide: true }); p.unref(); return { ok: true, command }; }
      catch (e) { return { ok: false, error: String(e.message || e), command }; }
    }
    if (!isWin) return { ok: false, manual: true, command };
    try {
      // Отдельное окно консоли: Claude Code откроет браузер для входа и покажет подсказки.
      const p = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"start "Вход в Claude" ' + command + '"'],
        { cwd: workDir, env: childEnv(), detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
      p.unref();
      return { ok: true, command };
    } catch (e) { return { ok: false, error: String(e.message || e), command }; }
  }

  // Ответ модели на каждом шаге: текст для пользователя + вызовы инструментов Планера (имена — только из списка).
  function replySchema(toolNames) {
    return {
      type: 'object',
      properties: {
        reply: { type: 'string', description: 'Ответ пользователю по-русски. Пустая строка, пока ждёшь результатов инструментов.' },
        tool_calls: { type: 'array', maxItems: 16, description: 'Вызовы инструментов Планера по порядку. Пустой массив — работа закончена.',
          items: { type: 'object', properties: { name: { type: 'string', enum: toolNames.length ? toolNames : ['none'] }, input: { type: 'object' } }, required: ['name', 'input'] } }
      },
      required: ['reply', 'tool_calls']
    };
  }

  // Один шаг: системный промпт + одно сообщение пользователя (блоки text/image) → {ok, structured, text}.
  function run(rid, { system, content, model, toolNames }) {
    const schema = replySchema(toolNames || []);
    return new Promise(res => {
      const r = resolve();
      if (!r) { res({ ok: false, code: 'not_found', error: 'Claude Code не найден на этом компьютере.' }); return; }
      fs.mkdirSync(workDir, { recursive: true });
      const sysFile = path.join(workDir, 'system-' + process.pid + '-' + rid.replace(/[^\w-]/g, '').slice(0, 40) + '.txt');
      fs.writeFileSync(sysFile, String(system || ''), 'utf8');
      const args = [...r.pre, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--setting-sources', '',
        '--system-prompt-file', sysFile, '--json-schema', JSON.stringify(schema)];
      if (model) args.push('--model', String(model));
      let p;
      try { p = spawn(r.cmd, args, { cwd: workDir, env: childEnv(), windowsHide: true }); }
      catch (e) { try { fs.unlinkSync(sysFile); } catch (_) {} res({ ok: false, code: 'spawn', error: String(e.message || e) }); return; }
      running.set(rid, p);
      let buf = '', err = '', result = null, lastText = '', done = false;
      const finish = out => {
        if (done) return; done = true; clearTimeout(timer); running.delete(rid);
        try { fs.unlinkSync(sysFile); } catch (_) {}
        res(out);
      };
      const timer = setTimeout(() => { try { p.kill(); } catch (_) {} finish({ ok: false, code: 'timeout', error: 'Claude Code не ответил за 4 минуты.' }); }, STEP_TIMEOUT);
      const onLine = line => {
        let m; try { m = JSON.parse(line); } catch (_) { return; }
        if (m.type === 'result') result = m;
        else if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
          const t = m.message.content.filter(b => b.type === 'text').map(b => b.text).join('');
          if (t) lastText = t;
        }
      };
      p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onLine(line); } });
      p.stderr.on('data', d => { if (err.length < 4000) err += d; });
      p.on('error', e => finish({ ok: false, code: 'spawn', error: String(e.message || e) }));
      p.on('close', () => {
        if (buf.trim()) onLine(buf.trim());
        if (killedByUser.has(p)) { finish({ ok: false, code: 'aborted', error: 'Остановлено.' }); return; }
        if (!result) { finish({ ok: false, code: 'unavailable', error: (err || 'Claude Code завершился без ответа.').trim().slice(0, 500) }); return; }
        const msg = String(result.result || '');
        if (result.is_error) {
          const code = /log ?in|\/login|not logged|authenticat|unauthori/i.test(msg) ? 'not_logged_in'
            : /limit|rate|quota|exceeded|usage/i.test(msg) ? 'rate_limited' : 'unavailable';
          finish({ ok: false, code, error: msg.slice(0, 500) });
          return;
        }
        finish({ ok: true, structured: result.structured_output || null, text: msg || lastText, model: result.model || '' });
      });
      const message = { type: 'user', message: { role: 'user', content } };
      p.stdin.on('error', () => {});
      p.stdin.end(JSON.stringify(message) + '\n');
    });
  }
  function cancel(rid) { const p = running.get(rid); if (p) { killedByUser.add(p); try { p.kill(); } catch (_) {} } return true; }
  function cancelAll() { for (const rid of [...running.keys()]) cancel(rid); }

  return { status, run, cancel, cancelAll, openLogin, resolve, replySchema };
}

module.exports = { createClaudeCode, candidates };
