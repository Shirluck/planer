# Планер (десктоп, Electron)

Личный планировщик: 4 колонки (Сегодня, Неделя-календарь, Основные планы, Идеи) + ИИ-ассистент + доска у каждой страницы планов и идей
(холст в стиле Milanote: заметки, чек-листы, фото, видео, зарисовки, ссылки, рисунки от руки). Плюс таймеры для фокусировки,
поиск `Ctrl+K`, мини-окно «Сегодня» из трея, темы, автозапуск, восстановление из копий. Интерфейс на русском.

## Файлы
- `index.html` — только разметка и порядок скриптов (встроенного JS нет: CSP `script-src 'self'`). Стили: `src/tokens.css`
  (цвета тем; тема = `<html data-theme="system|light|dark">`), `src/app.css`, `src/board.css`.
- `src/app/*.js` — код главного окна, **обычные скрипты** (не модули): верхнеуровневые `const`/`function` общие для всех файлов,
  порядок подключения важен, запуск — в последнем (`boot.js` → `main()`). По порядку:
  `base` (`h()`, `icon()`/`IC`, `autosize()`, модель `S`, `SECTIONS`, `normalize`, `findTask`, `findNode`; чистые функции берёт из `PlanerCore`),
  `store` (`touch(k)` помечает раздел изменённым и сохраняет с задержкой, `flush`, `flushEverything`, `extraStore` для досок, `pendingSave`,
  `toast`, `openMenu`/`placePopup`, `menuEl` — один открытый поповер), `columns` (`buildBoard`, списки задач `itemEl`, блоки времени),
  `drag` (`tdrag`; группа = выделенные задачи), `select` (`TSEL`, `tselClick`, `paintTsel` — панель действий, `moveTasks`/`bulkTasks`/`deleteTasks`
  — одна отмена на всё), `calendar` («Сегодня», «Неделя», окно дня `openDay`), `tree` (`buildTreeCol`, `openFile`, `findOwner`),
  `editor` (`openPage`; блочный редактор как в Notion, состояние `NE`, см. ниже),
  `ai` (`aiTools`, `buildPrompt`, `aiSend`; `log(…, undo)` — кнопка «Вернуть как было»), `timers` (`TM`, `openTimers`, `ringTimer`,
  звук Web Audio `playSound`), `tools` («Моушн»: `MT`, `openTools(tab)`, ссылки в документе `planner-tools`), `search` (`openSearch`,
  `revealTask`, `revealNode`), `settings` (`SET`, `setUi`, `openSettings`, `openRestore`, `applyRestored`), `mini-host` (ответы мини-окну, `miniNotify`),
  `boot` (`createBoards`, `runCommand` — команды меню/трея, `main()`).
  **Имена верхнего уровня во всех этих файлах общие и не должны повторяться** (иначе последняя функция молча заменит первую) —
  проверяет `tests/unit/globals.test.js`. Внутренние помощники редактора — с префиксом `ne` (`neBlockMenu`, `neDeleteBlock`).
- Редактор страниц (`editor.js`): один `contenteditable` `.ne` с блоками `.nb[data-id][data-t]`; модель — `blocks` из `core.normBlock`.
  Смещения курсора — в символах простого текста блока (`<br>` = 1, последний `<br>` блока — заглушка): `selInfo`/`setSel`.
  Ввод перехватывается в `beforeinput` (Enter, Backspace/Delete на краю блока, замена выделения через блоки), внутри блока
  правит браузер, затем `syncDom` переводит DOM в Markdown (`inlineToMd`). Своя история `NE.undo/redo`, изменения — через `commit(before, caret)`.
- `src/core.js` — чистая логика без DOM (UMD: `window.PlanerCore` и `require`): даты, `normCal`/`normNode`, `parseNewTask`, поиск
  (`search`, `matchRanges`, `snippet`; без учёта регистра и «ё»), таймеры (`parseDuration`, `fmtClock`, `normTimers`),
  блоки страниц (`BLOCK_TYPES`, `normBlock`) и Markdown (`parseInline`, `inlineToMd`, `mdPlain`, `blocksToMarkdown`, `markdownToBlocks`). Покрыт `tests/unit`.
- `src/motion.js` — чистая логика «Моушн» (UMD: `window.PlanerMotion`): `EXPRESSIONS` + `buildExpression(id, params)`, кадры/таймкод,
  `beatFrames`, `parseColor`/`colorFormats`, `FORMATS`, `aspect`. Покрыт `tests/unit/motion.test.js`.
- `src/board.js` — доска: `PlanerBoard.create(ctx)` → `{ open, close, flush, readBoard, addCard, addLink, findCard, imageForAI, reveal, forget,
  moveCards, arrangeCards, updateCard, removeCards, … }`.
  Холст = DOM + CSS transform (`.bd-world`), карточки — абсолютные элементы; отрисовка ключевая (`renderAll` сравнивает подпись карточки).
  История отмены — снимки JSON массива `items` (100 шагов, на доску, живёт сессию). `change(fn)` = изменение с записью в историю.
  Правки от ассистента — `editBoard(key, fn)`: `fn` возвращает `{result, revert}`, наружу `{result, undo}`; `undo` откатывает только
  это действие (по id карточек), а не весь снимок. Инструменты `navTool` 'select'|'hand' (V/H), рамка по пустому месту,
  `alignSel`/`distributeSel`/`tidySel`, притяжение `snapMove` (порог `SNAP`, Alt — без него) с направляющими `.bd-guides`.
  Рисование от руки: режим `B.draw` (`toggleDraw`, `startInk`, `commitInk`, `startErase`), живой слой `B.inkLive`, панель `B.inkBar`.
- `src/sketch.js` — редактор зарисовок `PlanerSketch.open(opts)` → Promise; общие `drawStrokes`, `drawBackground`.
- `mini.html`, `src/mini.js`, `src/mini.css` — мини-окно «Сегодня»: своих данных нет, всё через `electronAPI.mini.call` → основной процесс → главное окно.
- `shim.js` — `window.claude.use('db' | 'user' | 'sample' | 'assistant')` поверх Electron; инструмент может вернуть `{ __content: [блоки] }` (картинка для модели).
  `sample` в режиме `claude-code` (`sampleClaudeCode`): каждый шаг — новый запуск Claude Code, весь ход работы одним сообщением,
  ответ модели — JSON `{reply, tool_calls}`; в режиме `api` — обычный tool use через `anthropic` IPC. Здесь же окно «Ассистент: подключение».
- `lib/claudecode.js` — поиск `claude.exe` (настройка → PATH → `~/.local/bin` → `%LOCALAPPDATA%\Claude-Data\*\claude-code\<версия>\*\`),
  `status()` (`auth status`), `run()` (`-p`, stream-json, `--tools ""`, `--setting-sources ""`, `--json-schema`), `openLogin()`.
  Дочернему процессу не передаются переменные `ANTHROPIC_*`/`CLAUDE*` (кроме `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_GIT_BASH_PATH`).
  Тесты подменяют его через `PLANER_CLAUDE_CMD` на `tests/fake-claude.js`.
- `lib/timers.js` — таймеры в основном процессе (точно и в трее): шаблоны в документе `planner-timers`, запущенные — только в памяти.
- `lib/backups.js` — список копий (`docs-ГГГГ-ММ-ДД`, `manual-…`, `before-restore-…`), чтение, `snapshot`, `restore` (сначала копия текущего).
- `preload.js` — `window.electronAPI` (contextBridge); пути файлов извлекаются здесь (`webUtils.getPathForFile`), страница путей не видит.
- `main.js` — главное окно и мини-окно, меню, трей (щелчок → мини-окно, двойной → главное; крестик/свернуть → трей, выход из меню трея),
  IPC, ключ API, запросы к api.anthropic.com, режим ассистента (`ai:get|set`, `cc:*`), превью ссылок, оформление (`ui:*`: `nativeTheme`,
  zoom), автозапуск (`autostart:*`, `--hidden`), таймеры (`timer:*`), копии (`backup:*`), пересылка мини-окна (`mini:*`);
  перед скрытием и закрытием — `app:flush`. `PLANER_SMOKE=1` — проверка собранного exe (`smoke.json` и выход).
- `lib/store.js` — документы `docs/<путь с __>.json`, атомарная запись, миграция `planner-data.json` (schema 2), ежедневные копии (раз в час проверка).
- `lib/media.js` — медиа `media/<sha256>.<ext>`, проверка сигнатур, миниатюры, векторы зарисовок, схема `media://<id>[/thumb]` с Range, сборка мусора.

## Данные
- Колонки `day` («Сегодня») и `week` («Неделя»-календарь) — это виды одного документа `cal` (`planner-cal`):
  `{ v:1, days:{ 'ГГГГ-ММ-ДД': { items:[{id, text, done, pri 0..3, note}] } }, undated:[…], hideDone, urgentOnly, showCal }`.
  Срочно = `pri 3` (`URGENT`): только такие задачи видны в обзоре недели. Пустые дни удаляются (`pruneDays`).
  Блоки времени дня: `days[k].blocks = [{id, from:"10:00", to:"12:00", title, color}]`, у задачи `block` = id блока своего дня
  (`normCal` снимает ссылки на несуществующие блоки; при переносе на другой день блок снимается). Группировка — `renderTaskGroups`.
  Перетаскивание задач — свои pointer-события (`tdrag`), цели: `.tz[data-date][data-block]` ("*" — не менять блок), `.wk-day`, `.mc-day`.
  Задачу ищет `findTask(id)` → `{date, arr, i, t}` (`date` null = «Без даты»); изменения → `touch('cal')` + `refreshCal()`.
  Старые `planner-day`/`planner-week` переносит `migrateLegacy()` (один раз, если `planner-cal` ещё нет): day → сегодня, week → undated.
- Разделы `plans`/`ideas`: `{ nodes: [папка {id,type:'folder',title,open,children} | файл {id,type:'page',kind:'text'|'board',title,blocks:[…], boardCount?, boardId?}] }`.
  `kind` определяет, что открывает двойной щелчок (`openFile`): текст — редактор страницы, доска — `openNodeBoard`. Содержимое обоих видов хранится независимо.
  Карточка-ссылка на доске хранит превью: `ptitle, desc, site, kind, image` (mediaId), `pv` ('ok'|'fail'), `pvUrl`, `pvAt`.
- Доска принадлежит странице: документ `board-<boardId || id страницы>` = `{ v:1, view:{x,y,zoom}, items:[{id,type,x,y,w,h,z,…}] }`;
  типы `note|checklist|image|video|sketch|link|ink`. В board.js «taskId» — это ключ доски (см. `ownerKey`, `findOwner`).
  Медиа только ссылкой (`mediaId` = sha256), никакого base64. Зарисовка: `mediaId` (PNG) + `strokesId` (векторы); рисунок поверх фото — `overlay`.
  Рисунок от руки `ink`: `vw, vh` (система координат штрихов, карточка растягивает её на `w×h` без искажения),
  `strokes:[{c: 'ink'|'red'|'orange'|'green'|'blue'|'purple', w, m?:1 (маркер), p:[x,y,…]}]` — числа прямо в JSON (это векторы, не медиа).
- Блок страницы: `{id, t, text, done?, ind?, emoji?}`, `t` ∈ `p|h1|h2|h3|ul|ol|todo|quote|callout|code|hr`; `text` — строчный Markdown
  (`**ж**`, `*к*`, `++п++`, `~~з~~`, `` `код` ``, `[т](https://…)`, `\` — экранирование; в `code` — как есть); `ind` 0..6 только у `p|ul|ol|todo`;
  `done` только у `todo`; `emoji` только у `callout`. Старые блоки без форматирования читаются как есть.
- Таймеры: документ `planner-timers` = `{ v:1, presets:[{id,title,ms}], sound:'bell'|'soft'|'alarm'|'beep', volume 0..1, repeat 1..10 }`.
- «Моушн»: документ `planner-tools` = `{ v:1, links:[{id,title,url}] }` (через `extraStore`); вкладка, fps и параметры — `localStorage` `planer-motion`.
- На диске: `%APPDATA%\Planer\` (`docs/`, `media/`, `backups/`, `planer-meta.json`, `api-key.bin`, `claude-work/`,
  `settings.json` = `{aiMode:'claude-code'|'api', ccModel, claudePath?, theme:'system'|'light'|'dark', zoom 0.8…1.5, compact, autostart}`).
  `PLANER_DATA_DIR` — другая папка (тесты). Без `aiMode`: есть ключ → `api`, иначе `claude-code`.
- Любое изменение раздела: изменить `S[k]`, вызвать `touch(k)`, затем `refreshSection(k)`. На доске — через `change()` или `scheduleSave()`.

## Правила
- Данные пользователя не терять: запись атомарная, перед миграциями копия, повреждённые файлы откладываются в `.corrupt-*`.
  Удаления в интерфейсе с отменой. Восстановление из копии сначала сохраняет текущее в `before-restore-…`.
  Медиа удаляет только сборка мусора (нет ссылок нигде, включая backups, и прошло 7 дней).
- Безопасность: `contextIsolation: true`, `sandbox: true`, строгая CSP (`script-src 'self'` — встроенных скриптов нет; добавлены только
  `img-src media:` и `media-src media:`), id медиа проверяется `^[a-f0-9]{64}$`, белый список форматов + сигнатуры, ключ API только
  в основном процессе. IPC проверяет входные данные; запросы `mini:*` принимаются только от мини-окна.
  Сборка: Electron fuses (`package.json` → `build.electronFuses`): без RunAsNode, NODE_OPTIONS и `--inspect`, только `app.asar` с проверкой
  целостности. `GrantFileProtocolExtraPrivileges` оставлен включённым — без него страница не грузится из asar по `file://`.
- Без внешних шрифтов, CDN и телеметрии. Сеть — только ассистент (api.anthropic.com из основного процесса или сам Claude Code
  по подписке пользователя) и превью ссылок, которые пользователь сам добавил на доску
  (`lib/linkpreview.js`: http/https, без адресов локальной сети, лимиты времени и размера, картинка — в медиа-хранилище).
- Тема: `nativeTheme.themeSource` в основном процессе + `data-theme` на странице; новые цвета — только токенами из `src/tokens.css`.
- Клавиши проверяй по `e.code` (раскладка может быть русской). Тексты интерфейса на русском; без `alert/confirm/prompt`
  (подтверждение — второе нажатие кнопки, см. `confirmBtn`).
- Electron 45: `clipboard` асинхронный (W3C-стиль, `ClipboardItem`), `writeImage` нет. Событие `console-message` — один объект `{level, message}`.

## Команды
- `npm install`, `npm start` — запуск.
- `npm test` = `typecheck` (tsc по JSDoc: main, preload, lib, src/core.js) + `test:unit` (`node --test tests/unit`) + `test:e2e`
  (Playwright `_electron`, временные папки данных; `PLANER_MINI_KEEP=1` — мини-окно не прячется при потере фокуса).
- `npm run dist` — установщик и portable в `dist/`; `npm run dist:dir` + `npm run test:packaged` — `scripts/packaged-check.js`
  (fuses, запуск настоящего exe, `ELECTRON_RUN_AS_NODE`, подмена asar) и сквозной тест на копии `dist/win-unpacked-e2e` с разрешённым `--inspect`.
- Выпуск: `npm run release -- patch|minor|major` (`scripts/release.js`): версия в package.json и CHANGELOG.md («Не выпущено» → «[X.Y.Z] — дата»),
  все тесты, сборка, тег `vX.Y.Z`, push и релиз на GitHub (Shirluck/planer) с exe и SHA256SUMS. Ветка — `main`.
  CI на GitHub (`.github/workflows/ci.yml`): typecheck + test:unit. Изменения для пользователя записывать в CHANGELOG.md («Не выпущено»).
