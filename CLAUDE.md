# Планер (десктоп, Electron)

Личный планировщик: 4 колонки (Сегодня, Неделя-календарь, Основные планы, Идеи) + ИИ-ассистент + доска у каждой страницы планов и идей
(холст в стиле Milanote: заметки, чек-листы, фото, видео, зарисовки, ссылки). Интерфейс на русском.

## Файлы
- `index.html` — основное приложение (CSS + JS, без фреймворков). Внутри один IIFE, блоки по порядку:
  helpers (`h()` строит DOM, `icon()`/`IC`, `autosize()`), модель (`S` = состояние, `SECTIONS`, `normalize*`),
  хранение (`touch(k)` помечает раздел изменённым и сохраняет с задержкой, `flush`, `flushEverything`, `extraStore` для досок,
  `pendingSave` для индикатора), `toast`/`openMenu` (поддерживает пункт `{swatches}`), колонки задач (`buildTaskCol`, `itemEl`,
  кнопка `.board-btn`), деревья (`buildTreeCol`), редактор страниц, ИИ (`aiTools`, `buildPrompt`, `aiSend`), `createBoards()`, запуск (`main()`).
- `src/board.js` — доска задачи: `PlanerBoard.create(ctx)` → `{ open, close, flush, readBoard, addCard, findCard, imageForAI, … }`.
  Холст = DOM + CSS transform (`.bd-world`), карточки — абсолютные элементы; отрисовка ключевая (`renderAll` сравнивает подпись карточки).
  История отмены — снимки JSON массива `items` (100 шагов, на задачу, живёт сессию). `change(fn)` = изменение с записью в историю.
- `src/sketch.js` — редактор зарисовок `PlanerSketch.open(opts)` → Promise; общие `drawStrokes`, `drawBackground`.
- `src/board.css` — стили доски и редактора (только токены из `index.html`).
- `shim.js` — `window.claude.use('db' | 'user' | 'sample')` поверх Electron; инструмент может вернуть `{ __content: [блоки] }` (картинка для модели).
- `preload.js` — `window.electronAPI` (contextBridge); пути файлов извлекаются здесь (`webUtils.getPathForFile`), страница путей не видит.
- `main.js` — окно, меню, трей (крестик/свернуть → трей, выход из меню трея), IPC, ключ API, запросы к api.anthropic.com, превью ссылок; перед скрытием и закрытием — `app:flush`.
- `lib/store.js` — документы `docs/<путь с __>.json`, атомарная запись, миграция `planner-data.json` (schema 2), ежедневные копии.
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
  типы `note|checklist|image|video|sketch|link`. В board.js «taskId» — это ключ доски (см. `ownerKey`, `findOwner` в index.html).
  Медиа только ссылкой (`mediaId` = sha256), никакого base64. Зарисовка: `mediaId` (PNG) + `strokesId` (векторы); рисунок поверх фото — `overlay`.
- На диске: `%APPDATA%\Planer\` (`docs/`, `media/`, `backups/`, `planer-meta.json`, `api-key.bin`). `PLANER_DATA_DIR` — другая папка (тесты).
- Любое изменение раздела: изменить `S[k]`, вызвать `touch(k)`, затем `refreshSection(k)`. На доске — через `change()` или `scheduleSave()`.

## Правила
- Данные пользователя не терять: запись атомарная, перед миграциями копия, повреждённые файлы откладываются в `.corrupt-*`.
  Удаления в интерфейсе с отменой. Медиа удаляет только сборка мусора (нет ссылок нигде, включая backups, и прошло 7 дней).
- Безопасность: `contextIsolation: true`, `sandbox: true`, строгая CSP (добавлены только `img-src media:` и `media-src media:`),
  id медиа проверяется `^[a-f0-9]{64}$`, белый список форматов + сигнатуры, ключ API только в основном процессе.
- Без внешних шрифтов, CDN и телеметрии. Сеть — только ассистент и превью ссылок, которые пользователь сам добавил на доску
  (`lib/linkpreview.js`: http/https, без адресов локальной сети, лимиты времени и размера, картинка — в медиа-хранилище). Тёмная тема через `prefers-color-scheme`.
- Клавиши проверяй по `e.code` (раскладка может быть русской). Тексты интерфейса на русском; без `alert/confirm/prompt`.
- Electron 45: `clipboard` асинхронный (W3C-стиль, `ClipboardItem`), `writeImage` нет.

## Команды
- `npm install`, `npm start` — запуск; `npm test` — автотесты (Playwright `_electron`, временные папки данных);
- `npm run dist` — установщик и portable в `dist/`; `npm run dist:dir` + `npm run test:packaged` — проверка собранного приложения.
