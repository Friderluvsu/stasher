# Запуск у себя и тесты

## Что нужно

- Node.js 20+ (в `README.md`), на этом Mac через nvm стоят 20.16.0, 20.19.4, 22.22.2 и 22.22.3; `.claude/launch.json` и CI используют 22. Файла `.nvmrc` нет.
- Python 3.10+ (CI гоняет 3.10); локальный venv — `backend/venv`, сейчас Python 3.14.6 (поэтому в `parser.py` есть заплатка для 3.14, см. [../architecture/flp-parsing.md](../architecture/flp-parsing.md)).
- Зависимости уже стоят (`node_modules`, `backend/venv`). Ставить новые без нужды не нужно: движок — `pyflp`, `mido`, `fastapi`, `uvicorn`, `pydantic`, `python-multipart`, `numpy` (`backend/requirements.txt`).

### Оболочка агента на этом Mac

В zsh агента `node`, `npm` и `npx` — сломанные функции nvm (`_load_nvm: command not found`, вызов зацикливается). Два способа:

- звать инструменты напрямую: `./node_modules/.bin/tsc`, `./node_modules/.bin/vite`, `./node_modules/.bin/electron` (проверено: `tsc` и `vite` работают);
- или перед командами: `unset -f node npm npx; export PATH=/Users/frider/.nvm/versions/node/v22.22.3/bin:$PATH`.

`start.sh` вызывает `npx`, поэтому из оболочки агента он не заработает.

## Запуск

**Приложением (Electron).** `./start.sh` (создаст venv, если нет; соберёт интерфейс; запустит Electron) или `npm run app` (то же без venv). Electron сам поднимает движок на порту 8765 из `backend/venv` и кладёт базу в свой каталог данных. Электрон загружает собранный `dist/`, поэтому после правок интерфейса нужен `vite build`. Если порт 8765 уже занят другим движком, второй не сможет занять порт, а Electron дождётся ответа от первого и будет работать с ним (с его базой): проверяйте, чей движок отвечает. Это вывод из кода, отдельно не проверялось.

**В браузере (быстрее для интерфейса и Визуализатора).** Два процесса:

```
source backend/venv/bin/activate && python -m backend.api.main     # движок, 127.0.0.1:8765  (или npm run dev:backend)
./node_modules/.bin/vite --port 5173 --strictPort                   # интерфейс (или npm run dev)
```

Откройте `http://localhost:5173`. Те же две команды описаны в `.claude/launch.json` (записи `backend` и `frontend`) для встроенного предпросмотра. В браузере нет Electron: перетаскивание карточек в DAW и запуск сканирования по путям недоступны (остаётся загрузка файлов), а Визуализатор работает целиком. Движок разрешает запросы только с `localhost:5173`/`127.0.0.1:5173`/`null`, другой порт Vite не заработает.

Без `STASHER_DB_PATH` движок пишет в `stasher_data/stasher.db` в корне репозитория (папка в `.gitignore`). Это ваша «боевая» база разработки.

**Сборка.** `npm run build:frontend`; пакеты — `npm run build:mac`, `npm run build:win`; движок — `npm run build:backend` (PyInstaller). Не запускайте `npm run release*`: они поднимают версию, пушат `main` с тегом, и тег запускает выпуск на GitHub Actions.

## Проверки

Все три нужно прогонять перед тем, как сказать «готово».

1. **Типы:** `./node_modules/.bin/tsc --noEmit` (около 3 секунд, ошибок быть не должно).
2. **Сборка:** `./node_modules/.bin/vite build --outDir <временная папка> --emptyOutDir`. Не собирайте в `dist/`: его читает Electron, и он нужен целым. Предупреждение про чанк больше 500 КБ — обычное.
3. **Тесты движка:**

```
cd /Users/frider/Documents/iamcoder/stasher
HOME=<временная папка> STASHER_DB_PATH=<временная папка>/t.db \
STASHER_TEST_FLP=/Users/frider/Documents/iamcoder/stasher/node_modules/.stasher-qa/skin164.flp \
backend/venv/bin/python -m unittest discover -s backend/tests -t .
```

Ожидаемо: `Ran 43 tests … OK`.

### Почему `HOME` и `STASHER_DB_PATH`

`backend/tests/test_full_pipeline.py` вызывает `init_db()` и `save_project()`, то есть пишет в базу по пути `DB_PATH` (из `STASHER_DB_PATH`; без неё — в `stasher_data/stasher.db`, настоящую базу разработки). Кроме того, он запускает индекс семплов, который обходит `~/Documents`, `~/Music`, `~/Downloads`, `~/Desktop` и `~/Library/CloudStorage`. Поэтому `STASHER_DB_PATH` и `HOME` в тестах всегда указывают на пустую временную папку (тогда индекс видит 0 файлов). `HOME` читается при импорте модуля, ставить нужно перед запуском процесса.

`STASHER_TEST_FLP` — путь к настоящему `.flp`; без него два теста класса `RealProjectTest` пропускаются (`OK (skipped=2)`). Тестовый проект лежит в `node_modules/.stasher-qa/` (папка вне git, у чужой копии репозитория её нет): `skin164.flp` — FL Studio 25.2.5, 164 BPM, C#m, `beat.wav` — 8 секунд звука, `skin164.mp3` — готовый бит этого проекта (171.7 с, 3.9 МБ; длиннее «Песни», поэтому шкала 2:51, а не 2:43). Можно взять любой другой FLP, только числа из этого документа будут другими.

### Что не запускается локально

`backend/tests/test_audio_analyzer.py` написан в стиле pytest (8 функций `test_…`), а `unittest discover` их не видит. `pytest` указан в `backend/requirements-dev.txt` и стоит в CI (`python -m pytest backend/tests -q`, Python 3.10), в локальном venv его нет. Чтобы прогнать их локально, нужен `pytest` в venv; ставить его только с согласия владельца.

CI (`.github/workflows/ci.yml`): `npm run typecheck`, `npm run build:frontend`, `py_compile` для движка и `pytest`. Тестов интерфейса нет: каталог `src/services/__tests__` пустой.

## Ручная проверка Визуализатора

1. Поднимите движок и Vite (см. выше), откройте `http://localhost:5173`, перейдите на вкладку «Визуализатор».
2. Файлы без диалога выбора: в консоли страницы создайте `File` из запросов и отправьте синтетическое событие `drop` на `window`. Слушатели Визуализатора висят именно на `window` в фазе захвата и проверяют только, что в `dataTransfer.types` есть `Files`, поэтому это работает:

```js
// Vite отдаёт файлы внутри проекта по /@fs/<абсолютный путь>
const base = '/@fs/Users/frider/Documents/iamcoder/stasher/node_modules/.stasher-qa/';
const get = async name => new File([await (await fetch(base + name)).arrayBuffer()], name);
const dt = new DataTransfer();
dt.items.add(await get('skin164.flp'));
dt.items.add(await get('beat.wav'));
window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
```

3. Что должно получиться с `skin164.flp`: уведомление «skin164: 14 партий, в сцене 10 · дубли сняты: 4 · найден плейлист — режим «Песня»», вторая плашка «Аудио готово · beat.wav · 0:08», на сцене «Песня», «112 тактов», время `0:00 / 2:43`, 164 BPM.
4. Движок отдельно: `curl -s -F "file=@путь/к/проекту.flp" http://127.0.0.1:8765/api/visualizer/parse-flp`. Ответ: `title`, `tempo`, `ppq`, `patterns` (только партии с нотами), `song` (`ticks` и `clips`) или `null`. Для `skin164.flp`: 14 партий, 164 BPM, ppq 96, `song.ticks` = 43008, 35 клипов. База при этом не меняется.
5. Скорость рендерера можно замерить, не открывая вкладки: из консоли `await import('/src/utils/midiVisuals.ts')` отдаёт `renderMidiVisual` и `MIDI_VISUAL_MODES`, а `await import('/src/utils/visualizerScene.ts')` — сборку сцены; холст создаётся через `document.createElement('canvas')` нужного размера. Так получены цифры в [../architecture/visualizer.md](../architecture/visualizer.md).
6. **Прогон всех стилей** (ошибки, пустые кадры, детерминизм, скорость) — из консоли страницы, без вкладки:

```js
const base = '/@fs/Users/frider/Documents/iamcoder/stasher/node_modules/.stasher-qa/';
const file = async (n, as) => new File([await (await fetch(base + n)).arrayBuffer()], as || n);
const { api } = await import('/src/services/api.ts');
const S = await import('/src/utils/visualizerScene.ts');
const A = await import('/src/services/audioAnalysis.ts');
const V = await import('/src/utils/midiVisuals.ts');
const group = S.partsFromFlp(await api.parseFlpForVisualizer(await file('skin164.flp')));
const dup = S.findDuplicateParts(group.parts);
const song = S.buildSongScene(group.source, group.parts.filter(p => !dup.has(p.id)));
const analysis = await A.analyzeAudioFile(await file('skin164.mp3'));
const ctx = Object.assign(document.createElement('canvas'), { width: 540, height: 960 }).getContext('2d', { willReadFrequently: true });
for (const m of V.MIDI_VISUAL_MODES) {
  const t = performance.now();
  for (const p of [.1, .3, .5, .7, .9]) V.renderMidiVisual(ctx, song.scene, m.id, p, undefined, song.tracks, A.sampleAudioFrame(analysis, p * song.durationSeconds), { intensity: 1, title: 'test' });
  console.log(m.id, ((performance.now() - t) / 5).toFixed(1), 'ms');
}
```

   Детерминизм: отрисовать один и тот же кадр в два холста и сравнить `getImageData`. Ошибки стиля `renderMidiVisual` ловит сам и пишет в `console.error` один раз.
7. **Короткий экспорт без скачивания.** Поставить «Своя» = 3 с, перехватить `HTMLAnchorElement.prototype.click` (если у ссылки есть `download`, запомнить имя и не кликать) и `URL.createObjectURL` (запомнить `Blob`), нажать «Экспортировать видео». 31 октября в скрытой панели браузера получился MP4 1080×1920, H.264 + AAC, 3.2 с, 0.45 МБ; частоту кадров и синхронизацию в скрытой панели мерить нельзя.
8. Запись видео по-настоящему проверяется только в живом окне: кнопка «Экспортировать видео», файл скачивается. Целевая среда — Electron 33 (там проверялась задержка H.264 при первой записи); в других браузерах набор кодеков другой.

## Проверка в Electron (как после `npm start`), без реальной базы

1. Поднять `backend-qa` из `.claude/launch.json` (движок на временных `HOME` и `STASHER_DB_PATH`). Electron-овский движок тогда не сможет занять порт 8765 (`errno 48` в логе) и окно будет ходить в тестовый.
2. Собрать интерфейс так же, как `npm start`: `./node_modules/.bin/vite build` (в `dist/` — его и грузит Electron).
3. Запустить окно с отладкой и отдельным профилем: `./node_modules/.bin/electron --inspect=9230 . --remote-debugging-port=9447 --user-data-dir=<scratch>/electron-ud`. Порт 9333 на этом Mac занят другим приложением.
4. Страница — через CDP на 9447 (`Runtime.evaluate`, `Page.captureScreenshot`, `DOM.setFileInputFiles` на `input[type=file][multiple]` — так открываются настоящие FLP и MP3). Окно — через инспектор главного процесса на 9230: `Runtime.evaluate` с `includeCommandLineAPI: true`, внутри `require('electron').BrowserWindow.getAllWindows()[0]`, затем `win.setBounds({ width, height })` для настоящих размеров окна.
5. Если страница пишет `document.visibilityState === 'hidden'`, снимки зависают и rAF стоит: окно на другом рабочем столе или закрыто. Помогает `win.setVisibleOnAllWorkspaces(true); win.showInactive()` (фокус не отбирается). Окно поверх всех мешает владельцу — держать такие прогоны короткими.
6. Размеры, которые проверялись 31 октября: 900×600 (минимум), 1024×700, 1200×800, 1440×900, 1710×1050, 900×1000, 1600×620 на всех четырёх вкладках. Проверка: нет горизонтальной прокрутки, нет элементов за правым краем, у кнопок текст не вылезает (`scrollWidth > clientWidth` без `text-overflow: ellipsis`), сцена 9:16 целиком в окне при прокрутке 0.
7. Нагрузку смотреть по процессам (`ps -o time` по строкам с `electron-ud`: renderer и GPU отдельно) и в пересчёте на кадр: сырые кадры в секунду на macOS зависят от того, видно ли окно и чем занят компьютер.

Что вручную **не** проверялось, перечислено в [known-gaps.md](known-gaps.md).

## Файлы, которые нельзя трогать при проверках

- `stasher_data/` и любые `*.db` в корне — настоящая база разработки.
- `~/Downloads`, `~/Documents` и другие домашние папки: по ним ходит индекс семплов при сканировании хранилища.
- Файлы пользователя: предпросмотр FLP ничего не пишет рядом с ними, и проверки тоже не должны.
