# Устройство

## Стек

- **Оболочка:** Electron 33 (`electron/main.cjs`, `electron/preload.cjs`). Окно с интерфейсом плюс дочерний процесс с движком.
- **Интерфейс:** React 19, TypeScript 5.7, Vite 6, Tailwind 4, zustand 5 для состояния, иконки Tabler (шрифт). Стили — в `src/styles/*.css`. Для чтения MIDI-файлов — `@tonejs/midi`: это единственная запись в `dependencies` (добавлена Визуализатором), остальные пакеты лежат в `devDependencies`, интерфейс собирает Vite.
- **Движок:** Python 3.10+ (локально в venv сейчас 3.14.6), FastAPI + uvicorn, SQLite, `pyflp` 2.2.1 (чтение `.flp`), `mido` (запись `.mid`), `numpy`.
- **Сборка:** `electron-builder` (macOS DMG/ZIP, Windows NSIS), движок упаковывается PyInstaller в один файл `stasher-backend`; CI и выпуск — GitHub Actions (`.github/workflows/`).

В `tsconfig.json` `strict: false` — типы помогают, но не ловят `null`/`undefined` сами. Код визуализатора написан так, будто строгий режим включён.

## Три слоя

```
Electron (main.cjs)  ──запускает──▶  Движок FastAPI  127.0.0.1:8765  ──▶  SQLite stasher.db
       │                                   ▲
       ▼                                   │ fetch http://127.0.0.1:8765/api/...
 Окно: React-интерфейс (dist/index.html) ──┘
```

**Electron.** При старте создаёт каталог данных, запускает движок и ждёт, пока `/api/health` ответит (до 40 попыток по 250 мс; если не дождался, окно всё равно открывается). В режиме разработки движок — это `backend/venv/bin/python3 -m backend.api.main` из корня репозитория; в собранном приложении — бинарник `stasher-backend` из `resources/backend`. Переменная `STASHER_DB_PATH` указывает на `stasher.db` внутри каталога данных Electron (`app.getPath('userData')`). Окно грузит `dist/index.html` (или адрес из `VITE_DEV_SERVER_URL`, или `http://localhost:5173`, если `dist` нет). При закрытии главного окна приложение выходит и убивает группу процессов движка. Ещё в `main.cjs`: перетаскивание карточек в DAW (`ipcMain.on('ondragstart')`: кладёт `.mid` или `.wav` во временную папку `stasher_drag_cache` и вызывает `startDrag`, файлы старше суток чистятся). В `webPreferences` — `contextIsolation`, `sandbox`, `webSecurity`; отдельных настроек фоновой работы (`backgroundThrottling`) нет.

**Интерфейс.** Одно окно, четыре вкладки в `Topbar` (`midi`, `sounds`, `visualizer`, `kit`; активная вкладка — `activeTab` в `src/state/vaultStore.ts`). Хранилища состояния: `vaultStore` (паттерны, семплы, проекты, киты, выбор), `interfaceStore` (язык ru/en, хранится между запусками), `toastStore` (уведомления). Строки интерфейса пишутся прямо в компонентах парами `isRu ? '…' : '…'`; отдельных файлов перевода нет.

**Движок.** `backend/api/main.py` — все маршруты. Остальное в `backend/core/`:

| Файл | За что отвечает |
|---|---|
| `parser.py` | разбор `.flp` через pyflp и заплатки к нему, ноты, ключ, тег, длина в тактах |
| `flp_playlist.py` | чтение событий `.flp` напрямую: темп, плейлист (песня), «добивка» события FL 25 |
| `classifier.py` | тег по названию канала, пути к семплу и нотам (на русском и английском) |
| `midi_generator.py` | байты `.mid` из нот (переводит октаву FL в стандарт MIDI) |
| `sample_resolver.py` | поиск файла семпла на диске по имени (индекс по `~/Documents`, `~/Music`, `~/Downloads`, `~/Desktop` и др.) |
| `audio_analyzer.py` | тип звука и основная нота семпла (WAV) |
| `database.py` | схема SQLite, запросы, поиск FTS5, киты, экспорт ZIP |

## Как интерфейс говорит с движком

`src/services/api.ts`: `API_BASE = 'http://127.0.0.1:8765/api'` — адрес зашит, прокси Vite для `/api` в коде не используется. Движок разрешает запросы только с `null` (так выглядит `file://` в собранном Electron), `http://localhost:5173` и `http://127.0.0.1:5173` (CORS в `main.py`). Слушает движок только `127.0.0.1`.

Маршруты (коротко):

- сканирование: `POST /api/scan` (пути папок и файлов; Electron знает пути перетащенных файлов), `POST /api/upload-and-scan` (запасной вариант: файлы грузятся, разбираются во временной папке), `GET /api/scan/progress`;
- паттерны и семплы: `GET /api/patterns`, `GET /api/patterns/{id}/midi`, `GET /api/sounds`, `GET /api/sounds/{id}/audio`, `PATCH`/`DELETE` по одному и пачками;
- проекты: `GET /api/projects`, `DELETE /api/projects/{id}`;
- киты: `GET/POST /api/kits`, `DELETE /api/kits/{id}`, `POST /api/kits/active`, `POST /api/kits/export` (ZIP);
- `GET /api/preview-samples/{name}` — встроенные образцы для прослушивания, `GET /api/health`;
- **`POST /api/visualizer/parse-flp`** — единственный маршрут Визуализатора: принимает `.flp`, возвращает ноты партий и плейлист, ничего не сохраняет (см. [flp-parsing.md](flp-parsing.md)).

Всё остальное в Визуализаторе (MIDI-файлы, аудио, рендер, запись видео) выполняет сам интерфейс — движок для этого не нужен.

## Где лежат данные

| Что | Где |
|---|---|
| База хранилища в приложении | `stasher.db` в каталоге данных Electron (на macOS это `~/Library/Application Support/<имя приложения>/`) |
| База при ручном запуске движка | `stasher_data/stasher.db` в корне репозитория, если не задана `STASHER_DB_PATH` (папка в `.gitignore`) |
| Таблицы | `projects`, `patterns` (ноты в `notes_json`, готовый `.mid` в `midi_bytes`), `sounds`, `stacks`, `kits`, `app_settings`, виртуальные `fts_patterns` и `fts_sounds` |
| Временные файлы перетаскивания | `<temp>/stasher_drag_cache`, чистится при старте (старше суток) |
| Настройки Визуализатора | `localStorage`, ключ `stasher-visualizer-prefs` |
| Загруженный для предпросмотра FLP | временная папка `stasher_visualizer_*`, удаляется сразу после разбора |

В базе нет колонок под длину паттерна (`loop_ticks`) и под плейлист, поэтому партии из хранилища всегда играют как «Луп» (см. [../development/known-gaps.md](../development/known-gaps.md)).

## Как собирается и выходит

`npm run app` = `vite build && electron .`. Выпуск: `npm run release*` поднимает версию, пушит `main` с тегом `v*`, и по тегу GitHub Actions собирает установщики (Windows x64, macOS arm64 и Intel). Движок для упаковки собирает `npm run build:backend` (PyInstaller): каждый новый модуль движка нужно добавить в `--hidden-import` в `package.json` — для `flp_playlist` это уже сделано.
