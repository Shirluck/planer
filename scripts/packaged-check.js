// Проверка собранного приложения перед сквозным тестом (npm run test:packaged, после npm run dist:dir):
//  1. в Planer.exe включена защита (Electron fuses): нельзя запустить как Node, нельзя подключить отладчик,
//     код загружается только из проверенного app.asar;
//  2. настоящий exe запускается и показывает приложение (PLANER_SMOKE=1: итог в smoke.json и выход);
//  3. ELECTRON_RUN_AS_NODE не превращает программу в Node.js;
//  4. для Playwright готовится копия dist/win-unpacked-e2e, где разрешён только отладчик (Playwright управляет
//     приложением через --inspect). Настоящая сборка в dist/win-unpacked не меняется.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { getCurrentFuseWire, flipFuses, FuseV1Options, FuseVersion } = require('@electron/fuses');
const { FuseState } = require('@electron/fuses/dist/constants');     // ENABLE / DISABLE (в корне пакета не экспортируется)

const ROOT = path.resolve(__dirname, '..');
const exeName = process.platform === 'win32' ? 'Planer.exe' : 'planer';
const SRC = path.join(ROOT, 'dist', 'win-unpacked');
const E2E = path.join(ROOT, 'dist', 'win-unpacked-e2e');
const exe = path.join(SRC, exeName);
const fail = m => { console.error('✗ ' + m); process.exit(1); };
const ok = m => console.log('✓ ' + m);

(async () => {
  if (!fs.existsSync(exe)) fail('нет сборки ' + exe + ' — сначала npm run dist:dir');

  // 1. защита exe
  const wire = await getCurrentFuseWire(exe);
  const want = {
    RunAsNode: false, EnableCookieEncryption: true, EnableNodeOptionsEnvironmentVariable: false, EnableNodeCliInspectArguments: false,
    EnableEmbeddedAsarIntegrityValidation: true, OnlyLoadAppFromAsar: true,
    GrantFileProtocolExtraPrivileges: true      // нужно, чтобы страница загружалась из app.asar по file://
  };
  for (const [name, on] of Object.entries(want)) {
    const st = wire[FuseV1Options[name]];
    if (st !== (on ? FuseState.ENABLE : FuseState.DISABLE)) fail('fuse ' + name + ' должен быть ' + (on ? 'включён' : 'выключен') + ', сейчас ' + st);
  }
  ok('защита exe (fuses): ' + Object.keys(want).join(', '));

  // 2–3. настоящий exe запускается; ELECTRON_RUN_AS_NODE игнорируется
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'planer-smoke-'));
  try {
    const env = { ...process.env, PLANER_DATA_DIR: dataDir, PLANER_SMOKE: '1', PLANER_TEST: '1', ELECTRON_RUN_AS_NODE: '1' };
    const r = spawnSync(exe, ['-e', "process.stdout.write('NODE-MODE')"], { env, timeout: 60000, encoding: 'utf8', windowsHide: true });
    if ((r.stdout || '').includes('NODE-MODE')) fail('ELECTRON_RUN_AS_NODE выполнил чужой код');
    const f = path.join(dataDir, 'smoke.json');
    if (!fs.existsSync(f)) fail('приложение не записало smoke.json (код выхода ' + r.status + ', ' + (r.error ? r.error.message : '') + ')\n' + (r.stderr || '').slice(-2000));
    const s = JSON.parse(fs.readFileSync(f, 'utf8'));
    const v = require(path.join(ROOT, 'package.json')).version;
    if (!s.packaged || s.version !== v) fail('неожиданная версия/сборка: ' + JSON.stringify(s));
    if (!s.page || s.page.cols !== 4 || s.page.loading || !s.page.core || !s.page.board || !s.page.api || s.page.node !== 'undefined') fail('окно загрузилось не полностью: ' + JSON.stringify(s.page) + ' ' + s.errors.join(' | '));
    if (s.errors.length) fail('ошибки на странице: ' + s.errors.join(' | '));
    ok('собранный exe ' + v + ' запускается: 4 колонки, без ошибок; ELECTRON_RUN_AS_NODE не работает');
  } finally { fs.rmSync(dataDir, { recursive: true, force: true }); }

  // 4. копия для Playwright: тот же app.asar, разрешён только --inspect.
  //    Сначала на этой копии проверяется целостность: изменённый app.asar программа запускать отказывается.
  fs.rmSync(E2E, { recursive: true, force: true });
  fs.cpSync(SRC, E2E, { recursive: true });
  const asar = path.join(E2E, 'resources', 'app.asar'), orig = fs.readFileSync(asar);
  const bad = Buffer.from(orig), at = orig.indexOf(Buffer.from('Планер — сегодня'));
  if (at < 0) fail('не нашёл, что изменить в app.asar для проверки целостности');
  bad[at + 2] ^= 1;
  fs.writeFileSync(asar, bad);
  const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'planer-tamper-'));
  try {
    spawnSync(path.join(E2E, exeName), [], { env: { ...process.env, PLANER_DATA_DIR: tdir, PLANER_SMOKE: '1', PLANER_TEST: '1' }, timeout: 30000, windowsHide: true });
    if (fs.existsSync(path.join(tdir, 'smoke.json'))) fail('программа запустилась с изменённым app.asar');
  } finally { fs.rmSync(tdir, { recursive: true, force: true }); }
  fs.writeFileSync(asar, orig);
  ok('изменённый app.asar не запускается (проверка целостности работает)');
  await flipFuses(path.join(E2E, exeName), { version: FuseVersion.V1, [FuseV1Options.EnableNodeCliInspectArguments]: true });
  ok('копия для сквозного теста: ' + path.relative(ROOT, E2E));
})().catch(e => fail(String((e && e.stack) || e)));
