# Stasher — rules for agents

Stasher is an offline desktop app (Electron + React 19 + Vite + TypeScript, with a local Python FastAPI engine) for FL Studio producers. It scans `.flp` projects into a SQLite vault of MIDI patterns and samples, lets users drag them into a DAW, builds sound kits, and has a **Visualizer** tab that turns FLP / MIDI / audio into an animated 9:16 canvas and records it to MP4/WebM.

The owner writes in Russian: talk to them in Russian, briefly, without jargon.

Details live in `knowledge-base/` (Russian; start with `knowledge-base/README.md`). This file is only what you must remember every time. If the code and the docs disagree, the code wins and the doc must be fixed.

## Product model

- Tabs: **MIDI Patterns** (vault of note parts), **StashSound** (samples), **Visualizer**, **Kit Builder** (`activeTab` in `src/state/vaultStore.ts`).
- **Part** = one channel inside one pattern, with notes `{pitch, pos, duration, velocity}` in ticks (type `PatternItem`).
- **Source** = a file or vault project that owns parts (`flp` | `midi` | `vault`).
- **Scene** = parts merged into a `loop` (selected parts play together in a circle) or a `song` (one FLP, parts placed by the FL playlist). **Track** = one instrument of a scene.
- **Look** = one of 41 canvas styles in 2 groups (`midi`, `audio`), one file each in `src/utils/visuals/looks/`.
- Visualizer data flow:
  - FLP -> `POST /api/visualizer/parse-flp` (never saves to the vault); MIDI and audio are read in the renderer process (`@tonejs/midi`, own FFT).
  - Then `visualizerScene.ts` -> `renderMidiVisual` -> preview (rAF) or `recordMidiVideo` (MediaRecorder, real time).

## Repository map

- `electron/main.cjs`, `preload.cjs` — shell; starts the engine, drag-to-DAW.
- `backend/api/main.py` — all routes (127.0.0.1:8765). `backend/core/`:
  - `parser.py` (pyflp + patches), `flp_playlist.py` (raw events: tempo, playlist), `database.py`;
  - `midi_generator.py`, `classifier.py`, `sample_resolver.py`, `audio_analyzer.py`. Tests: `backend/tests/`.
- `src/App.tsx`, `src/components/Topbar.tsx`, `src/state/*` (zustand), `src/services/api.ts` (hard-coded `http://127.0.0.1:8765/api`).
- Visualizer UI: `src/components/MidiVisualizer.tsx` (state, paint loop, import, keys) and `src/components/visualizer/*` (panels; `shared.ts` holds prefs, `PlaybackClock`, error texts). Styles: `src/styles/midi-visualizer.css` (prefix `vz-`).
- Visualizer logic:
  - `src/utils/visualizerScene.ts` (scene model), `src/utils/midiVisuals.ts` (renderer entry, look list);
  - `src/utils/visuals/*` (frame, note index, palette, `kit.ts` drawing helpers, `looks/*.ts`);
  - `src/services/audioAnalysis.ts`, `src/services/midiVideoExport.ts`.

## Runtime and commands

- Browser dev: engine `source backend/venv/bin/activate && python -m backend.api.main`, UI `./node_modules/.bin/vite --port 5173 --strictPort`, then open `http://localhost:5173`. Desktop: `npm run app` (`vite build && electron .`).
- Checks:
  - `./node_modules/.bin/tsc --noEmit` must be clean;
  - `./node_modules/.bin/vite build --outDir <scratch> --emptyOutDir` (never build into `dist/`, Electron loads it).
- Shell caveat on this Mac: `node`, `npm`, `npx` are broken nvm functions in the agent shell. Call `./node_modules/.bin/<tool>`, or first run `unset -f node npm npx; export PATH=/Users/frider/.nvm/versions/node/v22.22.3/bin:$PATH`. `start.sh` uses `npx`, so it fails there.
- Backend tests (env vars matter, see invariant 9):
  `HOME=<scratch> STASHER_DB_PATH=<scratch>/t.db STASHER_TEST_FLP=<repo>/node_modules/.stasher-qa/skin164.flp backend/venv/bin/python -m unittest discover -s backend/tests -t .` run from the repo root -> `Ran 43 tests ... OK`.
- Never run `npm run release*` (it bumps the version, pushes `main` and a `v*` tag, and the tag triggers the release build).
- Commit/push only when the owner asks. Do not install packages (`npm i`, `pip install`) without the owner's OK: dependencies are minimal on purpose (`@tonejs/midi` is the only runtime dependency).

## Invariants to keep

1. **The renderer is stateless and deterministic.**
   - `renderMidiVisual(ctx, scene, mode, progress, accent, tracks, audioFrame, options)` draws a frame from its inputs only. No `Math.random`, `Date`, `performance.now`, or state carried between frames in `src/utils/visuals/*`.
   - Derive randomness with `hash(...)` from note position/pitch, and time from `F.tick` / `loopT` / `loopPhase`. Caches (sprites, backdrop layers, palettes, note indexes) are fine if keyed by their inputs.
   - Preview, thumbnails, seek and export all go through this one function. Do not add a second drawing path.
2. **Loops must be seamless.** Periodic motion completes a whole number of cycles per loop (`loopCycles`, `loopT`, `loopPhase`, `swing`, `loopUnit`); note queries wrap around the loop (`queryNotes`).
3. **One timeline rule for preview and export.**
   - `visualSeconds` = scene length; `timelineSeconds = max(visualSeconds, audioSeconds)` when there are notes, else `audioSeconds`.
   - The clock wraps at the timeline; `progress = (t mod visualSeconds) / visualSeconds`; the audio frame is `sampleAudioFrame(analysis, t)`.
   - It exists in two places, `paint()` in `MidiVisualizer.tsx` and `draw()` in `midiVideoExport.ts`: change both together.
4. **Draw in the logical 540x960 space** (the renderer scales to the real canvas) and **put no text on the canvas** (no `fillText`): exported videos must not leak project, pattern or file names. **Currently not true:** the 41 looks draw the beat title, BPM, key and some draw channel names (`kit.ts` `text()`); the owner has not decided yet whether to restore the rule (see `known-gaps.md`). Do not add more text meanwhile.
5. **Pitch convention: FL octaves.**
   - The parser stores FL naming, so FL's default C5 is 72 (one octave above standard MIDI C4 = 60).
   - `midi_generator` subtracts 12 when writing `.mid`; the Visualizer adds 12 (`FL_PITCH_OFFSET`) to `.mid` files it reads. Change both sides together or neither.
6. **`pattern_index` is not the FL pattern number.** `pattern_index` is the position in pyflp's pattern list (0-based); playlist clips reference FL's 1-based number (`item_index - 20480`). Always map through `pattern_iids` (built in `parse_flp_project`), never assume `iid - 1`.
7. **FLP reading must not raise to the user or touch their file.**
   - `extract_song_timeline` returns `None` on any failure (the UI then offers only "Loop").
   - Event 172 is 3 bytes in FL 25+ (FL 26 writes it twice); such files are parsed from a padded temp copy that is deleted at once. Playlist item size (32/60/80 bytes) is detected from content.
   - Muted clips and channels are NOT read yet (see `knowledge-base/development/known-gaps.md`).
8. **The Visualizer never writes the vault.**
   - `/api/visualizer/parse-flp` must not call `save_project`, must use `resolve_samples=False`, and must not return MIDI bytes or sample paths (covered by `test_visualizer_flp.py`).
   - Dropped files go to the Visualizer, not to the vault scanner (window-level capture listeners).
9. **Never write the real vault DB or scan real home folders in tests.** `test_full_pipeline.py` writes to `DB_PATH`, and `sample_resolver` walks `~/Documents`, `~/Music`, `~/Downloads`, `~/Desktop`. Always point `HOME` and `STASHER_DB_PATH` at a scratch dir. Do not touch `stasher_data/`, `*.db` or `~/Downloads`.
10. **Strings are bilingual.** Every user-visible string is written inline as `isRu ? 'ru' : 'en'` (the default language is Russian). Engine error texts are English and mapped to Russian in `visualizer/shared.ts`.
11. **Keep the export safe.**
    - While exporting, new files/audio are refused and the preview is paused.
    - Recording uses canvas `captureStream(0)` + `requestFrame`, a throwaway encoder warm-up, and the audio output clock. The warm-up and the output clock fix measured A/V offsets: do not replace them casually.
    - Export length is capped at 600 s in the UI (`MAX_EXPORT_SECONDS`).
12. **The Visualizer stays mounted once opened** (`App.tsx` hides it with `SectionTransitionView hidden`, constant key `visualizer`); remounting drops imports, audio and a running export. While `active` is false it must pause playback and ignore window-level keys and drops.
13. **New backend modules need `--hidden-import` in `package.json` -> `build:backend`** (PyInstaller), as done for `backend.core.flp_playlist`.
14. **The engine listens on 127.0.0.1 only** and its CORS allows only `null`, `localhost:5173`, `127.0.0.1:5173`. Do not widen this.
15. `tsconfig.json` is not strict, but write the code as if it were; keep `tsc --noEmit` clean.

## Testing

- Backend: 28 of the 43 tests are in `backend/tests/test_visualizer_flp.py` (synthetic FL 25/26 files, 32/60/80-byte playlists, API shaping; 2 tests on a real FLP when `STASHER_TEST_FLP` is set). `test_tag_editing.py` (5) guards tag routes and rename storage on a throwaway DB; `test_library_queries.py` (4) guards list paging and search with punctuation.
- Browser checks of the library: `.claude/launch.json` has `backend-qa` (engine on a scratch `HOME`/`STASHER_DB_PATH`), so editing tags in the preview never touches `stasher_data/`.
- `test_audio_analyzer.py` is pytest-style: only CI runs it (pytest is not in the local venv).
- The frontend has no automated tests. Verify in the browser by dropping files with a synthetic `drop` event (recipe in `knowledge-base/development/setup-and-testing.md`).
- Real test project: `node_modules/.stasher-qa/skin164.flp` (FL 25.2.5, 164 BPM, C#m): 14 parts, 35 playlist clips, 112 bars = 2:43.9; 10 parts remain after 4 duplicates are dropped.
- Video export can only be verified in a live window (target: Electron 33). Fullscreen, media keys, Windows and minimised-window recording are unverified.

## Before saying "done"

- `tsc --noEmit` is clean, `vite build` passes, backend tests are green (with the scratch env).
- New behaviour has a test where one is possible (backend) or a documented manual check (UI).
- In the report to the owner, say separately what was **not** verified live.
- Record a non-obvious decision in `knowledge-base/development/decisions.md`. Update `known-gaps.md` and the relevant `knowledge-base/` page when behaviour changes (including numbers such as "41 looks").

## Style

- TypeScript ESM, React function components, no new dependencies unless needed. Python: follow the surrounding style (type hints, `logging`).
- Comments explain *why* (in English in the Visualizer code); user-facing text is bilingual.
- Prefer small pure functions for scene and note logic; keep canvas code free of side effects between frames.
