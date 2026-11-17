# Планер (десктоп, Electron)

Личный планировщик: 4 колонки (Сегодня, Неделя, Основные планы, Идеи) + ИИ-ассистент. Интерфейс на русском.

## Файлы
- `index.html` — всё приложение (CSS + JS в одном файле, без фреймворков). Внутри один IIFE, блоки по порядку:
  helpers (`h()` строит DOM, `icon()`, `autosize()`), модель (`S` = состояние, `SECTIONS`, `normalize*`),
  хранение (`touch(k)` помечает раздел изменённым и сохраняет с задержкой, `flush`, `onRemote`),
  `toast`/`openMenu`, колонки задач (`buildTaskCol`, `itemEl`, drag & drop), деревья (`buildTreeCol`, `renderNode`),
  редактор страниц (блоки p/h/todo/ul), ИИ (`aiTools`, `buildPrompt`, `aiSend`), запуск (`main()`).
- `shim.js` — подставляет `window.claude.use('db' | 'user' | 'sample')`. Страница ходит за данными и ИИ только через него.
  `db` = JSON-документы по путям (`data/users/local/planner-day|week|plans|ideas`), `sample` = цикл вызова инструментов Anthropic API.
- `preload.js` — `window.electronAPI` (contextBridge). `main.js` — окно, меню, файл данных, ключ API, запросы к api.anthropic.com.

## Данные
- Разделы `day`/`week`: `{ items: [{id, text, done, pri 0..3, note}], hideDone }`.
- Разделы `plans`/`ideas`: `{ nodes: [папка {id,type:'folder',title,open,children} | страница {id,type:'page',title,blocks:[{id,t,text,done}]}] }`.
- На диске: `%APPDATA%\Planer\planner-data.json` (карта «путь документа → объект»), ключ API `api-key.bin` (шифруется `safeStorage`), копии в `backups/`.
- Любое изменение состояния: изменить `S[k]`, вызвать `touch(k)`, затем `refreshSection(k)`. Не обновляй DOM вручную мимо этого, кроме точечных правок вроде `paintItem`.

## Правила
- Данные пользователя не терять: запись атомарная (tmp + rename), перед миграциями копия. Удаления в интерфейсе с отменой (`undoer`).
- Безопасность: `contextIsolation: true`, `sandbox: true`, строгая CSP в `index.html` (сеть из страницы запрещена), ключ API живёт только в основном процессе.
- Без внешних шрифтов, CDN и телеметрии. Тёмная тема через `prefers-color-scheme`, цвета только через CSS-переменные.
- Приоритеты: цвета `--p1..--p3`, цвета колонок `--c-day|week|plans|ideas`. Новые элементы должны соответствовать этим токенам.
- Тексты интерфейса на русском; в UI нет `alert/confirm/prompt` (в песочнице они отключены, используй встроенные диалоги и `toast`).

## Команды
- `npm install`, `npm start` — запуск; `npm run dist` — установщик.
- Проверка логики без Electron: страницу можно открыть в Playwright, подставив поддельный `window.electronAPI` (так проверялись хранение, ключ и цикл инструментов ИИ).
