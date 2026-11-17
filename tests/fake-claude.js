// Поддельный Claude Code для автотестов (подключается через PLANER_CLAUDE_CMD).
// Понимает: --version, auth status, auth login, -p со stream-json на входе и выходе.
// FAKE_CC_DIR — папка сценария: script.json (ответы по порядку), log.jsonl (что пришло), logged-in (флаг входа).
// Без FAKE_CC_DIR вход «выполнен», ответ один: «(тестовый ответ)».
'use strict';
const fs = require('fs');
const path = require('path');
const dir = process.env.FAKE_CC_DIR || '';
const args = process.argv.slice(2);
const f = n => path.join(dir, n);
const loggedIn = () => !dir || fs.existsSync(f('logged-in'));
const out = o => process.stdout.write(JSON.stringify(o) + '\n');

if (args[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') {
  console.log(JSON.stringify(loggedIn() ? { loggedIn: true, authMethod: 'claude.ai', email: 'tester@example.com', subscriptionType: 'max' } : { loggedIn: false, authMethod: 'none' }, null, 2));
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'login') {
  if (dir) { fs.appendFileSync(f('log.jsonl'), JSON.stringify({ login: args.slice(2) }) + '\n'); setTimeout(() => { fs.writeFileSync(f('logged-in'), '1'); process.exit(0); }, 300); }
  else process.exit(0);
  return;
}
if (args[0] !== '-p') { console.error('unknown command'); process.exit(2); }

let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const arg = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const msg = JSON.parse(input.trim().split('\n')[0]);
  const sysFile = arg('--system-prompt-file');
  const entry = {
    args, system: sysFile ? fs.readFileSync(sysFile, 'utf8') : '', content: msg.message.content,
    env: Object.keys(process.env).filter(k => /^(ANTHROPIC_|CLAUDE)/i.test(k)), cwd: process.cwd()
  };
  let n = 0;
  if (dir) { try { n = fs.readFileSync(f('log.jsonl'), 'utf8').split('\n').filter(l => l && !l.startsWith('{"login"')).length; } catch (_) {} fs.appendFileSync(f('log.jsonl'), JSON.stringify(entry) + '\n'); }
  out({ type: 'system', subtype: 'init', tools: ['StructuredOutput'], model: 'claude-sonnet-5-5', apiKeySource: 'none' });
  if (!loggedIn()) {
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } });
    out({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login' });
    process.exit(1);
  }
  let script = [];
  if (dir) { try { script = JSON.parse(fs.readFileSync(f('script.json'), 'utf8')); } catch (_) {} }
  const step = script[n] || { reply: '(тестовый ответ)', tool_calls: [] };
  const delay = Number(step.delayMs) || 0;
  setTimeout(() => {
    if (step.error) { out({ type: 'result', subtype: 'success', is_error: true, result: step.error }); process.exit(1); }
    out({ type: 'result', subtype: 'success', is_error: false, result: '', structured_output: { reply: step.reply || '', tool_calls: step.tool_calls || [] } });
    process.exit(0);
  }, delay);
});
