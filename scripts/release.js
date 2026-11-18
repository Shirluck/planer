// Выпуск версии Планера на GitHub одной командой.
//
//   npm run release                 — выпустить текущую версию из package.json (раздел в CHANGELOG.md уже есть)
//   npm run release -- patch        — 2.5.0 → 2.5.1 (исправления)
//   npm run release -- minor        — 2.5.0 → 2.6.0 (новые возможности)
//   npm run release -- major        — 2.5.0 → 3.0.0
//   npm run release -- 2.7.0        — конкретный номер
// Флаги: --draft — релиз-черновик (виден только вам, публикуется кнопкой на GitHub);
//        --dry-run — только проверки и план, ничего не меняет.
//
// Порядок: проверки (чистое рабочее дерево, ветка main, origin, вход в GitHub CLI, номер ещё не выпущен) →
// новая версия в package.json и CHANGELOG.md («Не выпущено» → «[X.Y.Z] — дата») → npm test → npm run dist →
// npm run test:packaged → SHA256SUMS.txt → коммит «chore(release): X.Y.Z», тег vX.Y.Z → git push →
// релиз на GitHub с установщиком, portable-версией и контрольными суммами.
// Если тесты или сборка не прошли — изменения версии откатываются, на GitHub ничего не уходит.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const args = process.argv.slice(2);
const draft = args.includes('--draft'), dry = args.includes('--dry-run');
const bump = args.find(a => !a.startsWith('--')) || null;

const fail = m => { console.error('\n✗ ' + m); process.exit(1); };
const step = m => console.log('\n▶ ' + m);
const ok = m => console.log('✓ ' + m);
const sh = (cmd, a, o = {}) => spawnSync(cmd, a, Object.assign({ cwd: ROOT, encoding: 'utf8', shell: false }, o));
const git = (...a) => { const r = sh('git', a); if (r.status !== 0) throw new Error('git ' + a.join(' ') + ': ' + (r.stderr || r.stdout)); return r.stdout.trim(); };
const tryGit = (...a) => { const r = sh('git', a); return r.status === 0 ? r.stdout.trim() : null; };
// npm на Windows — это npm.cmd, его запускает оболочка
const npm = (...a) => { const r = spawnSync(isWin ? 'npm.cmd' : 'npm', a, { cwd: ROOT, stdio: 'inherit', shell: isWin }); return r.status === 0; };

function findGh() {
  const tries = ['gh'];
  if (isWin) {
    const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    try { for (const d of fs.readdirSync(base)) if (/^GitHub\.cli_/.test(d)) tries.push(path.join(base, d, 'bin', 'gh.exe')); } catch (_) {}
    tries.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI', 'gh.exe'));
  }
  for (const t of tries) { const r = sh(t, ['--version']); if (r.status === 0) return t; }
  return null;
}

const readPkg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const UNRELEASED = '## [Не выпущено]';
// Текст раздела версии (без заголовка) или null.
function section(md, v) {
  const at = md.indexOf('## [' + v + ']');
  if (at < 0) return null;
  const body = md.slice(md.indexOf('\n', at) + 1);
  const end = body.search(/^## \[|^\[[^\]]+\]: /m);
  return (end < 0 ? body : body.slice(0, end)).trim();
}
function nextVersion(cur, kind) {
  const [a, b, c] = cur.split('.').map(Number);
  if (kind === 'patch') return [a, b, c + 1].join('.');
  if (kind === 'minor') return [a, b + 1, 0].join('.');
  if (kind === 'major') return [a + 1, 0, 0].join('.');
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  fail('непонятный номер версии: ' + kind + ' (нужно patch, minor, major или X.Y.Z)');
}
const newer = (x, y) => { const p = x.split('.').map(Number), q = y.split('.').map(Number); for (let i = 0; i < 3; i++) if (p[i] !== q[i]) return p[i] > q[i]; return false; };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

(async () => {
  /* ---------- проверки ---------- */
  step('Проверки');
  if (git('status', '--porcelain')) fail('есть незакоммиченные изменения — сначала закоммитьте их (git status).');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') fail('выпуск делается из ветки main, сейчас ' + branch + '.');
  const origin = tryGit('remote', 'get-url', 'origin');
  if (!origin) fail('нет удалённого репозитория origin.');
  const repo = (origin.match(/github\.com[/:]([^/]+\/[^/.]+)/) || [])[1];
  if (!repo) fail('origin не на GitHub: ' + origin);
  const gh = findGh();
  if (!gh) fail('не найден GitHub CLI (gh). Установка: winget install --id GitHub.cli');
  if (sh(gh, ['auth', 'status']).status !== 0) fail('GitHub CLI не выполнил вход: gh auth login --web --scopes workflow');
  if (isWin) {   // сборка перезаписывает dist\win-unpacked — запущенный оттуда Планер держит файлы
    const ps = "(Get-Process -Name Planer -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '" + path.join(ROOT, 'dist').replace(/'/g, "''") + "\\*' } | Measure-Object).Count";
    const r = sh('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    if (Number(String(r.stdout).trim()) > 0) fail('Планер запущен из папки dist — закройте его (значок в трее → «Выйти из Планера»): сборка перезаписывает его файлы.');
  }
  git('fetch', 'origin', '--tags', '--quiet');
  const behind = tryGit('rev-list', '--count', 'HEAD..origin/main');
  if (behind && behind !== '0') fail('на GitHub есть коммиты, которых нет здесь (' + behind + '): git pull');

  const cur = readPkg().version;
  const version = bump ? nextVersion(cur, bump) : cur;
  if (bump && !newer(version, cur)) fail('новая версия ' + version + ' должна быть больше текущей ' + cur + '.');
  const tag = 'v' + version;
  if (tryGit('rev-parse', '-q', '--verify', 'refs/tags/' + tag)) fail('тег ' + tag + ' уже есть — эта версия уже выпускалась.');
  if (sh(gh, ['release', 'view', tag, '--repo', repo]).status === 0) fail('релиз ' + tag + ' уже есть на GitHub.');
  const prevTag = tryGit('describe', '--tags', '--abbrev=0', '--match', 'v*');

  let md = fs.readFileSync(CHANGELOG, 'utf8');
  if (!md.includes(UNRELEASED)) fail('в CHANGELOG.md нет раздела «' + UNRELEASED + '».');
  let notes = section(md, version);
  let newMd = md;
  if (bump) {
    if (notes) fail('в CHANGELOG.md уже есть раздел ' + version + '.');
    // «Не выпущено» → новая версия; пустой раздел заполняется темами коммитов с прошлого выпуска
    const head = md.indexOf(UNRELEASED), after = md.indexOf('\n', head) + 1;
    const rest = md.slice(after), end = rest.search(/^## \[|^\[[^\]]+\]: /m);
    let body = (end < 0 ? rest : rest.slice(0, end)).trim();
    if (!body) {
      const subjects = git('log', '--format=%s', (prevTag ? prevTag + '..' : '') + 'HEAD').split('\n').filter(s => s && !/^chore\(release\)/.test(s));
      if (!subjects.length) fail('с прошлого выпуска нет изменений.');
      body = '### Изменения\n' + subjects.map(s => '- ' + s).join('\n');
    }
    newMd = md.slice(0, after) + '\n## [' + version + '] — ' + today() + '\n\n' + body + '\n\n' + (end < 0 ? '' : rest.slice(end));
    newMd = newMd.replace(/^\[Не выпущено\]: .*$/m, '[Не выпущено]: https://github.com/' + repo + '/compare/' + tag + '...HEAD\n[' + version + ']: https://github.com/' + repo + '/' + (prevTag ? 'compare/' + prevTag + '...' + tag : 'releases/tag/' + tag));
    notes = body;
  }
  if (!notes) fail('в CHANGELOG.md нет раздела «## [' + version + ']» — опишите, что нового в этой версии.');
  ok('репозиторий ' + repo + ', ветка main, ' + (bump ? cur + ' → ' : '') + 'версия ' + version + (prevTag ? ' (прошлый выпуск ' + prevTag + ')' : ''));
  if (dry) { console.log('\nТекст релиза:\n\n' + notes + '\n\n(--dry-run: ничего не изменено)'); return; }

  /* ---------- новая версия, тесты, сборка ---------- */
  const restore = () => { if (bump) sh('git', ['checkout', '--', 'package.json', 'package-lock.json', 'CHANGELOG.md']); };
  if (bump) {
    step('Версия ' + version);
    if (!npm('version', version, '--no-git-tag-version', '--allow-same-version')) { restore(); fail('npm version не сработал.'); }
    fs.writeFileSync(CHANGELOG, newMd);
  }
  step('Тесты: типы, модульные, сквозные (≈2 мин)');
  if (!npm('test')) { restore(); fail('тесты не прошли — выпуск остановлен, версия не изменена.'); }
  step('Сборка установщика и portable-версии');
  if (!npm('run', 'dist')) { restore(); fail('сборка не удалась.'); }
  step('Проверка собранной программы');
  if (!npm('run', 'test:packaged')) { restore(); fail('собранная программа не прошла проверку.'); }
  const dist = path.join(ROOT, 'dist');
  const assets = ['Planer-Setup-' + version + '.exe', 'Planer-' + version + '-portable.exe'].map(f => path.join(dist, f));
  for (const f of assets) if (!fs.existsSync(f)) { restore(); fail('нет файла сборки ' + f); }
  const sums = path.join(dist, 'SHA256SUMS.txt');
  fs.writeFileSync(sums, assets.map(f => sha256(f) + '  ' + path.basename(f)).join('\n') + '\n');
  ok('сборка: ' + assets.map(f => path.basename(f) + ' (' + (fs.statSync(f).size / 1048576).toFixed(1) + ' МБ)').join(', '));

  /* ---------- коммит, тег, отправка, релиз ---------- */
  step('Коммит, тег ' + tag + ' и отправка на GitHub');
  if (bump) { git('add', 'package.json', 'package-lock.json', 'CHANGELOG.md'); git('commit', '-q', '-m', 'chore(release): ' + version); }
  git('tag', '-a', tag, '-m', 'Планер ' + version);
  const pushed = sh('git', ['push', '--quiet', 'origin', 'main', tag], { stdio: 'inherit' });
  if (pushed.status !== 0) fail('git push не удался (коммит и тег ' + tag + ' созданы локально). Исправьте причину, затем: git push origin main ' + tag +
    ' и gh release create ' + tag + ' dist/Planer-Setup-' + version + '.exe dist/Planer-' + version + '-portable.exe dist/SHA256SUMS.txt --notes-file dist/release-notes-' + version + '.md');
  const notesFile = path.join(dist, 'release-notes-' + version + '.md');
  fs.writeFileSync(notesFile, notes + '\n\n---\n\n' +
    '**Скачать для Windows 10/11 (x64):**\n' +
    '- `Planer-Setup-' + version + '.exe` — установщик (для текущего пользователя, права администратора не нужны)\n' +
    '- `Planer-' + version + '-portable.exe` — без установки, запускается двойным щелчком\n\n' +
    'Программа не подписана сертификатом: при первом запуске Windows SmartScreen может предупредить — «Подробнее» → «Выполнить в любом случае». ' +
    'Контрольные суммы — в `SHA256SUMS.txt`. Данные хранятся в `%APPDATA%\\Planer` и при обновлении не теряются.\n');
  step('Релиз ' + tag + ' на GitHub');
  const rel = sh(gh, ['release', 'create', tag, ...assets, sums, '--repo', repo, '--title', 'Планер ' + version, '--notes-file', notesFile, '--verify-tag', ...(draft ? ['--draft'] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
  if (rel.status !== 0) fail('gh release create не удался (тег уже на GitHub — можно повторить: gh release create ' + tag + ' …).');
  ok('готово: ' + String(rel.stdout).trim() + (draft ? ' (черновик — опубликуйте на GitHub)' : ''));
})().catch(e => fail(String((e && e.stack) || e)));
