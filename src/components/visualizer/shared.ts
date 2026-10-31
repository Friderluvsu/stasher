import { useEffect, useState } from 'react';
import { VisualizerApiError, type NoteEvent, type PatternItem } from '../../services/api';
import { getAudioOverview, type AudioAnalysis } from '../../services/audioAnalysis';
import type { VideoResolution } from '../../services/midiVideoExport';
import { getPatternTicks, getTrackColor, MIDI_VISUAL_MODES, type MidiVisualGroup, type MidiVisualMode, type VisualBackground } from '../../utils/midiVisuals';
import { buildLoopScene, type VisualizerScene, type VisualizerSource } from '../../utils/visualizerScene';

export interface SourceGroup { source: VisualizerSource; parts: PatternItem[] }
export type LookFilter = MidiVisualGroup | 'all';
export type ExportPreset = '15' | '30' | '60' | 'full' | 'audio' | 'custom';
export type Arrangement = 'loop' | 'song';

export const ACCENTS = ['#a99aff', '#70d4ff', '#46e6cc', '#a9e991', '#f5db7f', '#ffbf61', '#ff784f', '#ff8ca6', '#f44176', '#df87ff', '#447dff', '#f4f4ff'];
export const BACKGROUNDS: VisualBackground[] = ['nebula', 'midnight', 'void'];
export const LOOK_FILTERS: LookFilter[] = ['all', 'midi', 'audio'];
export const MAX_EXPORT_SECONDS = 600;

export interface VisualizerPrefs {
  mode: MidiVisualMode;
  lookFilter: LookFilter;
  accent: string;
  background: VisualBackground;
  intensity: number;
  particles: boolean;
  exportPreset: ExportPreset;
  customSeconds: number;
  resolution: VideoResolution;
  fps: 30 | 60;
  fromPlayhead: boolean;
  /** Beat name printed by the looks; empty = taken from the audio file or project. */
  title: string;
}

export const DEFAULT_PREFS: VisualizerPrefs = {
  mode: 'oracle', lookFilter: 'all', accent: ACCENTS[0], background: 'nebula', intensity: 1, particles: true,
  exportPreset: '30', customSeconds: 20, resolution: '1080x1920', fps: 60, fromPlayhead: false, title: '',
};

const PREFS_KEY = 'stasher-visualizer-prefs';
const pick = <T>(value: unknown, valid: readonly T[], fallback: T): T => valid.includes(value as T) ? value as T : fallback;
const numberIn = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function loadPrefs(): VisualizerPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null') as Partial<Record<keyof VisualizerPrefs, unknown>> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
    return {
      mode: pick(raw.mode, MIDI_VISUAL_MODES.map(item => item.id), DEFAULT_PREFS.mode),
      lookFilter: pick(raw.lookFilter, LOOK_FILTERS, DEFAULT_PREFS.lookFilter),
      accent: typeof raw.accent === 'string' && /^#[0-9a-f]{6}$/i.test(raw.accent) ? raw.accent.toLowerCase() : DEFAULT_PREFS.accent,
      background: pick(raw.background, BACKGROUNDS, DEFAULT_PREFS.background),
      intensity: numberIn(raw.intensity, .5, 1.5, DEFAULT_PREFS.intensity),
      particles: typeof raw.particles === 'boolean' ? raw.particles : DEFAULT_PREFS.particles,
      exportPreset: pick(raw.exportPreset, ['15', '30', '60', 'full', 'audio', 'custom'] as ExportPreset[], DEFAULT_PREFS.exportPreset),
      customSeconds: numberIn(raw.customSeconds, 1, MAX_EXPORT_SECONDS, DEFAULT_PREFS.customSeconds),
      resolution: pick(raw.resolution, ['1080x1920', '720x1280'] as VideoResolution[], DEFAULT_PREFS.resolution),
      fps: pick(raw.fps, [30, 60] as const, DEFAULT_PREFS.fps),
      fromPlayhead: typeof raw.fromPlayhead === 'boolean' ? raw.fromPlayhead : DEFAULT_PREFS.fromPlayhead,
      title: typeof raw.title === 'string' ? raw.title.slice(0, 48) : DEFAULT_PREFS.title,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: VisualizerPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage can be unavailable */ }
}

export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setReduced(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return reduced;
}

export interface PlaybackTicker {
  subscribe(listener: (seconds: number) => void): () => void;
  now(): number;
}

// One preview clock (contract [D]: t = timeline seconds). Without audio it follows performance.now().
// With audio the element is the master: t = start of the current audio loop + currentTime. The clock
// re-anchors on every read, so the free-running estimate only has to bridge the gap since the last
// frame to count element loops, and the picture holds while the audio is starting, seeking or buffering
// (for at most AUDIO_HOLD_MS; if the element stays stuck the picture runs on and the audio is re-synced later).
const AUDIO_HOLD_MS = 1500;

export class PlaybackClock {
  playing = false;
  private length = 1;
  private anchorT = 0;
  private anchorPerf = 0;
  private audioBase = 0;
  private audio: HTMLAudioElement | null = null;
  private audioSeconds = 0;
  private holdSince = 0;

  get duration() { return this.length; }

  now(): number {
    if (!this.playing) return this.anchorT;
    const perf = performance.now();
    let t = this.anchorT + (perf - this.anchorPerf) / 1000;
    const audio = this.audio, period = this.audioSeconds;
    if (audio && period > 0) {
      if (audio.paused || audio.seeking || audio.readyState < 2) {
        if (!this.holdSince) this.holdSince = perf;
        if (perf - this.holdSince < AUDIO_HOLD_MS) t = this.anchorT;
      } else if (this.holdSince && perf - this.holdSince >= AUDIO_HOLD_MS) {
        this.place(t % this.length);
        return this.anchorT;
      } else if (period >= .5) {
        this.holdSince = 0;
        const current = audio.currentTime;
        const loops = Math.max(0, Math.round((t - this.audioBase - current) / period));
        this.audioBase += loops * period;
        t = this.audioBase + current;
      } else this.holdSince = 0;
      this.anchorT = t;
      this.anchorPerf = perf;
    }
    if (t < this.length) return Math.max(0, t);
    const wrapped = t % this.length;
    if (audio && period > 0 && Math.abs(this.length - period) < 1e-3) {
      // The timeline is exactly one audio loop: the element wraps by itself, only the bookkeeping moves.
      this.audioBase -= this.length;
      this.anchorT = wrapped;
      this.anchorPerf = perf;
    } else this.place(wrapped);
    return wrapped;
  }

  setLength(seconds: number) {
    const length = Number.isFinite(seconds) && seconds > .05 ? seconds : 1;
    if (Math.abs(length - this.length) < 1e-6) return;
    const t = this.now();
    this.length = length;
    if (t >= length) this.place(t % length);
  }

  setAudio(audio: HTMLAudioElement | null, seconds: number) {
    const t = this.now();
    if (this.audio && this.audio !== audio) this.audio.pause();
    this.audio = audio;
    this.audioSeconds = audio && Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
    this.place(t);
    if (this.playing && audio) void audio.play().catch(() => undefined);
  }

  seek(seconds: number) {
    this.place(Math.min(Math.max(0, Number.isFinite(seconds) ? seconds : 0), Math.max(0, this.length - 1e-3)));
  }

  async play(): Promise<void> {
    if (this.playing) return;
    this.playing = true;
    // A paused element reports a position slightly past what was heard, so resuming always re-seeks to the picture.
    this.place(this.anchorT >= this.length - 1e-3 ? 0 : this.anchorT, .005);
    if (this.audio) await this.audio.play();
  }

  pause() {
    if (!this.playing) return;
    const t = this.now();
    this.playing = false;
    this.anchorT = t;
    this.audio?.pause();
  }

  private place(t: number, tolerance = .04) {
    this.anchorT = t;
    this.anchorPerf = performance.now();
    this.holdSince = 0;
    if (this.audio && this.audioSeconds > 0) {
      const at = t % this.audioSeconds;
      this.audioBase = t - at;
      if (Math.abs(this.audio.currentTime - at) > tolerance) {
        try { this.audio.currentTime = at; } catch { /* not seekable before metadata; play() starts from 0 */ }
      }
    }
  }
}

const PART_FILE = /\.(mid|midi|kar|flp)$/i;
const AUDIO_FILE = /\.(mp3|wav|wave|m4a|aac|mp4|ogg|oga|opus|flac|webm)$/i;
export const PART_ACCEPT = '.mid,.midi,.kar,.flp,audio/midi,audio/x-midi';
export const AUDIO_ACCEPT = '.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac,.webm,audio/*';
export const isPartFile = (file: File) => PART_FILE.test(file.name);
export const isAudioFile = (file: File) => !isPartFile(file) && (AUDIO_FILE.test(file.name) || file.type.startsWith('audio/'));
export const fileStem = (name: string) => name.replace(/\.[^.]+$/, '') || name;

// "cedania 102bpm Dmin_master" -> "cedania": tempo, key and mix tags are printed separately by the looks.
export function beatTitle(name: string): string {
  const cleaned = fileStem(name)
    .replace(/[_]+/g, ' ')
    .replace(/\b\d{2,3}\s?bpm\b/gi, ' ')
    .replace(/\b(master(ed)?|mix(down)?|final|v\d+|prod\.?.*$)\b/gi, ' ')
    .replace(/\b[A-G](#|b)?\s?(maj(or)?|min(or)?|m)\b/g, ' ')
    .replace(/[\s\-–—@]+$/g, '').replace(/^[\s\-–—]+/g, '').replace(/\s{2,}/g, ' ').trim();
  return cleaned || fileStem(name);
}
export const fileExtension = (name: string) => (/\.([^.]+)$/.exec(name)?.[1] || '').toUpperCase();

// File-name stem: letters, digits and '#' survive ('#' is legal on macOS and Windows and keeps "C#m" readable);
// everything else, including the characters Windows forbids (< > : " / \ | ? *) and control characters, becomes a dash.
export function slugify(text: string, fallback = 'visual'): string {
  const slug = text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}#]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return /[\p{L}\p{N}]/u.test(slug) ? slug : fallback;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'].includes(target.type);
}

// A keyboard user who tabbed to a control expects Space to press it; after a mouse click Space plays.
export function wantsNativeSpace(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement) || target === document.body) return false;
  try {
    return target.matches('button, a[href], summary, [role="checkbox"], [role="switch"], [role="radio"], input[type="checkbox"], input[type="radio"]') && target.matches(':focus-visible');
  } catch {
    return false;
  }
}

export function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError';
}

export class EmptyImportError extends Error {
  constructor() {
    super('No note events');
    this.name = 'EmptyImportError';
  }
}

export interface ReadableError { title: string; detail?: string; offline?: boolean; retry?: File[] }

// The engine answers in English. Known 422 texts are mapped; in Russian mode nothing English is shown.
function parseDetail(message: string, isRu: boolean): string | undefined {
  if (!isRu) return message || undefined;
  if (/is empty/i.test(message)) return 'Файл пустой.';
  if (/not an FL Studio project/i.test(message)) return 'Это не проект FL Studio.';
  if (/no notes were found/i.test(message)) return 'В паттернах проекта не найдено нот.';
  return 'Проект повреждён или сохранён в неподдерживаемом формате.';
}

export function describeImportError(error: unknown, fileName: string, isRu: boolean): ReadableError {
  if (error instanceof EmptyImportError) return { title: isRu ? `В «${fileName}» нет нот` : `“${fileName}” has no notes`, detail: isRu ? 'Добавьте файл с MIDI-партиями или аудио.' : 'Use a file with MIDI parts, or add audio instead.' };
  if (error instanceof VisualizerApiError) {
    if (error.kind === 'offline') return { offline: true, title: isRu ? 'Движок Stasher не отвечает' : 'Stasher engine is offline', detail: isRu ? 'FLP читается локальным сервером. Перезапустите Stasher и попробуйте ещё раз — MIDI и аудио работают и без него.' : 'FLP files are read by the local engine. Restart Stasher and try again — MIDI and audio still work without it.' };
    if (error.kind === 'unsupported') return { title: isRu ? `«${fileName}» не поддерживается` : `“${fileName}” is not supported`, detail: isRu ? 'Нужен проект FL Studio (.flp).' : 'An FL Studio project (.flp) is required.' };
    if (error.kind === 'too-large') return { title: isRu ? `«${fileName}» слишком большой` : `“${fileName}” is too large`, detail: isRu ? 'Сохраните проект без встроенных семплов и попробуйте снова.' : 'Save the project without embedded samples and try again.' };
    if (error.kind === 'parse') return { title: isRu ? `Не удалось разобрать «${fileName}»` : `Could not read “${fileName}”`, detail: parseDetail(error.message, isRu) };
    return { title: isRu ? `Ошибка при чтении «${fileName}»` : `Failed to read “${fileName}”`, detail: isRu ? 'Неожиданный ответ движка. Перезапустите Stasher и попробуйте снова.' : error.message };
  }
  if (/\.flp$/i.test(fileName)) return { title: isRu ? `Не удалось прочитать «${fileName}»` : `Could not read “${fileName}”`, detail: isRu ? 'Файл повреждён или это не проект FL Studio.' : error instanceof Error ? error.message : undefined };
  return { title: isRu ? `«${fileName}» — не похоже на MIDI` : `“${fileName}” does not look like MIDI`, detail: isRu ? 'Файл повреждён или это не Standard MIDI File.' : 'The file is damaged or is not a Standard MIDI File.' };
}

const errorText = (error: unknown) => error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}` : String(error ?? '');

export function describeAudioError(error: unknown, fileName: string, isRu: boolean): string {
  const text = errorText(error);
  if (/empty|no audio/i.test(text)) return isRu ? `В «${fileName}» нет звука.` : `“${fileName}” contains no audio.`;
  if (/decoding is not available/i.test(text)) return isRu ? 'Аудиодвижок недоступен. Перезапустите Stasher и попробуйте снова.' : 'The audio engine is unavailable. Restart Stasher and try again.';
  return isRu ? `Не удалось прочитать «${fileName}». Подойдут MP3, WAV, M4A, OGG или FLAC.` : `Could not decode “${fileName}”. Use MP3, WAV, M4A, OGG or FLAC.`;
}

export function describeExportError(error: unknown, isRu: boolean): string {
  const text = errorText(error);
  if (/damaged audio|has no audio/i.test(text)) return isRu ? 'Аудиофайл не читается при записи. Замените его или уберите звук.' : 'The audio file could not be read for the video. Replace it or remove the audio.';
  if (/audio engine did not start|audio output is not available/i.test(text)) return isRu ? 'Не запустился аудиодвижок. Закройте другие программы со звуком и попробуйте снова.' : 'The audio engine did not start. Close other audio apps and try again.';
  if (/no supported video format|not supported in this browser|canvas is unavailable/i.test(text)) return isRu ? 'Запись видео недоступна на этой системе: нет кодека H.264 или VP9.' : 'Video recording is not available on this system: no H.264 or VP9 encoder.';
  if (/frame render failed/i.test(text)) return isRu ? 'Стиль не смог отрисовать кадр. Выберите другой стиль и повторите.' : 'The look failed to render a frame. Pick another look and try again.';
  if (/encoding failed|empty video/i.test(text)) return isRu ? 'Видеокодер не справился. Попробуйте 720×1280 или 30 fps.' : 'The video encoder failed. Try 720×1280 or 30 fps.';
  return isRu ? 'Не удалось записать видео. Попробуйте 720×1280 или 30 fps.' : 'Could not record the video. Try 720×1280 or 30 fps.';
}

const pluralRu = (count: number, one: string, few: string, many: string) => {
  const tail = count % 10, tens = count % 100;
  return tail === 1 && tens !== 11 ? one : tail >= 2 && tail <= 4 && (tens < 12 || tens > 14) ? few : many;
};
export const notesWord = (count: number, isRu: boolean) => isRu ? pluralRu(count, 'нота', 'ноты', 'нот') : count === 1 ? 'note' : 'notes';
export const partsWord = (count: number, isRu: boolean) => isRu ? pluralRu(count, 'партия', 'партии', 'партий') : count === 1 ? 'part' : 'parts';
export const barsWord = (count: number, isRu: boolean) => isRu ? pluralRu(count, 'такт', 'такта', 'тактов') : count === 1 ? 'bar' : 'bars';
export const looksWord = (count: number, isRu: boolean) => isRu ? pluralRu(count, 'стиль', 'стиля', 'стилей') : count === 1 ? 'look' : 'looks';

export function shortPatternName(part: PatternItem): string {
  const name = (part.pattern_name || '').trim();
  const head = name.split(' • ')[0].trim();
  if (!head || head === part.channel_name) return '';
  return head;
}

// getTrackColor(accent, slot) is the colour the renderer gives scene.tracks[slot]; the part list uses the same ones.
export const trackColor = (slot: number, accent: string): string => getTrackColor(accent, slot) || accent;

// 0..1 activity across the whole preview timeline for the seek bar: the audio envelope when there is
// audio (it is what you hear), otherwise note density of the scene, repeated like the visual loop.
export function timelineOverview(pattern: PatternItem | null, visualSeconds: number, timelineSeconds: number, analysis: AudioAnalysis | null, points = 140): Float32Array | null {
  if (!(timelineSeconds > 0) || points < 1) return null;
  const out = new Float32Array(points);
  // Stretch the range so song sections (intro, drop, break) read at a glance.
  const stretch = () => {
    let low = Infinity, high = 0;
    for (const value of out) { low = Math.min(low, value); high = Math.max(high, value); }
    low *= .75;
    if (high - low > 1e-6) for (let index = 0; index < points; index++) out[index] = (out[index] - low) / (high - low);
    return out;
  };
  const sample = (source: Float32Array, period: number) => {
    const size = source.length;
    for (let index = 0; index < points; index++) {
      let peak = 0;
      for (let step = 0; step < 4; step++) {
        const t = (index + (step + .5) / 4) / points * timelineSeconds;
        peak = Math.max(peak, source[Math.min(size - 1, Math.floor((t % period) / period * size))] || 0);
      }
      out[index] = peak;
    }
  };
  const audioSeconds = analysis?.durationSeconds || 0;
  if (analysis && audioSeconds > 0) {
    let envelope: Float32Array | null = null;
    try { envelope = getAudioOverview(analysis, 720); } catch { envelope = null; }
    if (envelope?.length) {
      sample(envelope, audioSeconds);
      return stretch();
    }
  }
  const notes = pattern?.notes;
  if (!notes?.length || !(visualSeconds > 0)) return null;
  const ticks = Math.max(1, getPatternTicks(pattern!));
  const density = new Float32Array(720);
  for (const note of notes) {
    const start = Math.min(719, Math.max(0, Math.floor(note.pos / ticks * 720)));
    const end = Math.min(719, Math.floor((note.pos + Math.max(1, note.duration)) / ticks * 720));
    const weight = .3 + note.velocity / 127;
    density[start] += weight;
    for (let bin = start + 1; bin <= end; bin++) density[bin] += weight * .2;
  }
  sample(density, visualSeconds);
  return stretch();
}

// A progress where the music is dense, so a static thumbnail shows the look at its best.
export function representativeProgress(pattern: PatternItem): number {
  const notes = pattern.notes || [];
  if (!notes.length) return .38;
  const ticks = Math.max(1, getPatternTicks(pattern));
  const bins = new Float32Array(48);
  for (const note of notes) bins[Math.min(47, Math.max(0, Math.floor(note.pos / ticks * 48)))] += .4 + note.velocity / 127;
  let best = -1, bestIndex = 17;
  for (let index = 7; index < 41; index++) {
    const score = bins[index - 1] * .6 + bins[index] + bins[index + 1] * .6;
    if (score > best) { best = score; bestIndex = index; }
  }
  const from = bestIndex / 48 * ticks, to = (bestIndex + 1) / 48 * ticks;
  let anchor: NoteEvent | null = null;
  for (const note of notes) if (note.pos >= from && note.pos < to && (!anchor || note.velocity > anchor.velocity)) anchor = note;
  const ppq = Math.max(1, pattern.ppq || 96);
  const tick = anchor ? anchor.pos + Math.min(anchor.duration * .5, ppq / 4) : (from + to) / 2;
  return Math.min(.999, Math.max(0, tick / ticks));
}

const demoPart = (id: number, channel: number, name: string, tag: string, notes: NoteEvent[]): PatternItem => ({
  id, project_id: -1, pattern_index: 0, pattern_name: name, channel_index: channel, channel_name: name, sample_path: null, tag,
  bars: 4, key_root: 'C#', note_count: notes.length, tempo: 140, ppq: 96, notes, project_title: 'Stasher demo', project_file_name: 'stasher-demo', project_file_path: '', loop_ticks: 1536,
});

const CHORDS = [[61, 64, 68], [57, 61, 64], [64, 68, 71], [59, 63, 66]];
const DEMO_PARTS: PatternItem[] = [
  demoPart(-11, 0, 'Keys', 'Chords', CHORDS.flatMap((chord, bar) => chord.map(pitch => ({ pitch, pos: bar * 384, duration: 360, velocity: 84 })))),
  demoPart(-12, 1, 'Bell', 'Melody', CHORDS.flatMap((chord, bar) => [0, 1, 2, 1, 2, 0, 1, 2].map((step, index) => ({ pitch: chord[step] + 12, pos: bar * 384 + index * 48, duration: index % 4 === 0 ? 72 : 40, velocity: 70 + (index * 17) % 50 })))),
  demoPart(-13, 2, '808', '808', [37, 33, 40, 35].flatMap((pitch, bar) => [{ pitch, pos: bar * 384, duration: 160, velocity: 120 }, { pitch, pos: bar * 384 + 216, duration: 96, velocity: 104 }])),
  demoPart(-14, 3, 'Hi-hat', 'Hi-Hat', Array.from({ length: 4 }, (_, bar) => [...Array.from({ length: 8 }, (_, step) => bar * 384 + step * 48), ...(bar % 2 ? [bar * 384 + 300, bar * 384 + 312, bar * 384 + 324] : [])]).flat().map((pos, index) => ({ pitch: 42, pos, duration: 20, velocity: 60 + (index * 23) % 50 }))),
  demoPart(-15, 4, 'Snare', 'Snare', Array.from({ length: 4 }, (_, bar) => ({ pitch: 38, pos: bar * 384 + 192, duration: 40, velocity: 116 }))),
];

export const AUDIO_ONLY_PATTERN: PatternItem = {
  id: -20, project_id: -1, pattern_index: 0, pattern_name: 'Audio', channel_index: 0, channel_name: 'Audio', sample_path: null, tag: 'Other',
  bars: 1, key_root: '—', note_count: 0, tempo: 120, ppq: 96, notes: [], project_title: 'Audio', project_file_name: '', project_file_path: '',
};

export function buildDemoScene(): VisualizerScene | null {
  try {
    return buildLoopScene(DEMO_PARTS);
  } catch (error) {
    console.error('Visualizer demo scene failed:', error);
    return null;
  }
}
