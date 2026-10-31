import { readPcm, sampleAudioFrame, type AudioAnalysis, type AudioFrame } from '../../services/audioAnalysis';
import type { NoteEvent, PatternItem } from '../../services/api';
import { mix, paletteFor, withAlpha, type Palette } from './color';
import { envelope, hash, indexNotes, queryNotes, type NoteIndex, type VNote } from './noteIndex';

export type VisualBackground = 'nebula' | 'midnight' | 'void';

export interface VisualOptions {
  intensity?: number;
  background?: VisualBackground;
  particles?: boolean;
  /** Title printed by looks that show one (beat / project name). */
  title?: string;
}

export interface FrameMeta {
  /** Beat name, as typed by the user or taken from the project / audio file. */
  title: string;
  bpm: number;
  /** Key as text, e.g. "D", "C#m"; empty when unknown. */
  key: string;
  /** Timeline position and length in seconds (the audio clock when there is audio). */
  seconds: number;
  duration: number;
}

export interface FrameAudio {
  level: number;
  bass: number;
  mid: number;
  treble: number;
  transient: number;
  durationSeconds: number;
  spectrum: Float32Array;
  present: boolean;
  analysis: AudioAnalysis | null;
  seconds: number;
}

export interface TrackView {
  index: NoteIndex;
  color: string;
  slot: number;
  /** Channel / part name ("808", "Keys") and its tag ("Chords", "Hi-Hat", ...). */
  name: string;
  tag: string;
}

export interface Frame {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  u: number;
  thumb: boolean;
  tick: number;
  total: number;
  ppq: number;
  tempo: number;
  tps: number;
  beat: number;
  bar: number;
  response: number;
  I: number;
  glowGain: number;
  glowSize: number;
  particles: boolean;
  background: VisualBackground;
  pal: Palette;
  audio: FrameAudio;
  notes: NoteIndex;
  tracks: TrackView[];
  synthetic: boolean;
  active: VNote[];
  env: number;
  hit: number;
  onsetAge: number;
  onsetStrength: number;
  breath: number;
  meta: FrameMeta;
  lw: (width: number) => number;
}

export const TAU = Math.PI * 2;
export const CX = 270;
export const CY = 480;
export const SPECTRUM_SIZE = 32;
export { hash };

export const clamp = (value: number, low = 0, high = 1) => (value > low ? (value < high ? value : high) : low);
export const fract = (value: number) => value - Math.floor(value);
export const pitchClass = (pitch: number) => ((Math.round(pitch) % 12) + 12) % 12;
export const fifthsAngle = (pc: number) => -Math.PI / 2 + ((pc * 7) % 12) / 12 * TAU;
export const seedInt = (note: VNote) => Math.floor(note.seed * 1e7);

const finite = (value: unknown, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

export function patternTicks(pattern: PatternItem | null | undefined, index = indexNotes(pattern?.notes)): number {
  const loop = finite((pattern as (PatternItem & { loop_ticks?: number }) | null | undefined)?.loop_ticks, 0);
  if (loop > 0) return loop;
  return Math.max(1, index.lastEnd);
}

// FL drum channels usually all sit on C5, so in multi-track scenes every drum would pile onto one
// pitch. Drum tracks (recognised by tag or channel name, at most a few distinct pitches) get a
// display register inside the melodic range instead: kick low, snare mid, hats high.
const DRUM_REGISTERS: [RegExp, number][] = [
  [/\b(open[\s-]?hat|oh)\b/i, .93], [/\b(kick|kck|bd|bassdrum)\b|бочка|кик/i, .04], [/\btoms?\b/i, .3], [/\b(snare|snr|sd)\b|снейр/i, .5],
  [/\b(clap|snap)\b|клэп|клап/i, .56], [/\b(rim|rimshot)\b/i, .6], [/\b(perc|shaker|conga|bongo|tamb\w*|cowbell)\b|перк/i, .68],
  [/hi[\s-]?hat|\bhh\b|\bhats?\b|хэт/i, .86], [/\b(crash|cymbal|ride|splash)\b/i, 1],
];
const sceneIndexes = new WeakMap<object, { parts: unknown[]; index: NoteIndex }>();

function drumRegister(track: PatternItem): number | null {
  const text = [track.tag, track.channel_name].filter(value => typeof value === 'string').join(' ');
  for (const [pattern, register] of DRUM_REGISTERS) if (pattern.test(text)) return register;
  return null;
}

function remapDrums(notes: NoteEvent[], tracks: PatternItem[]): NoteIndex | null {
  const drums: { notes: NoteEvent[]; register: number; low: number }[] = [];
  let melodic = 0, low = Infinity, high = -Infinity;
  for (const track of tracks) {
    if (!Array.isArray(track?.notes) || !track.notes.length) continue;
    const pitches = new Set<number>();
    for (const note of track.notes) if (Number.isFinite(note?.pitch)) pitches.add(Math.round(note.pitch));
    if (!pitches.size) continue;
    const register = pitches.size <= 4 ? drumRegister(track) : null;
    if (register !== null) drums.push({ notes: track.notes, register, low: Math.min(...pitches) });
    else {
      melodic++;
      for (const pitch of pitches) { if (pitch < low) low = pitch; if (pitch > high) high = pitch; }
    }
  }
  if (!drums.length || drums.length + melodic < 2) return null;
  if (!melodic) { low = 36; high = 96; }
  high = Math.max(high, low + 24);
  const byNote = new Map<NoteEvent, number>(), byKey = new Map<string, number>();
  for (const drum of drums) {
    const at = Math.round(low + drum.register * (high - low));
    for (const note of drum.notes) {
      const pitch = Math.min(127, Math.max(0, at + Math.round(note.pitch) - drum.low));
      byNote.set(note, pitch);
      byKey.set(`${Math.round(note.pos)}|${Math.round(note.pitch)}`, pitch);
    }
  }
  let matched = 0;
  const mapped = notes.map(note => {
    const pitch = byNote.get(note);
    if (pitch === undefined) return note;
    matched++;
    return { ...note, pitch };
  });
  const result = matched ? mapped : notes.map(note => {
    const pitch = note ? byKey.get(`${Math.round(note.pos)}|${Math.round(note.pitch)}`) : undefined;
    return pitch === undefined ? note : { ...note, pitch };
  });
  return indexNotes(result, false);
}

// Keyed by the scene notes and compared by the tracks' note arrays, so a caller that rebuilds the
// tracks array every frame still hits the cache.
function sceneIndex(pattern: PatternItem | null | undefined, tracks: PatternItem[] | null | undefined): NoteIndex {
  const notes = pattern?.notes;
  const base = indexNotes(notes);
  if (!base.n || !Array.isArray(notes) || !Array.isArray(tracks) || tracks.length < 2) return base;
  const parts = tracks.map(track => track?.notes);
  const known = sceneIndexes.get(notes);
  if (known && known.parts.length === parts.length && known.parts.every((part, i) => part === parts[i])) return known.index;
  const index = remapDrums(notes, tracks) || base;
  sceneIndexes.set(notes, { parts, index });
  return index;
}

function readAudio(input: AudioFrame | null | undefined): FrameAudio {
  const raw = (input || {}) as Partial<AudioFrame> & { spectrum?: ArrayLike<number> };
  const level = clamp(finite(raw.level, 0)), bass = clamp(finite(raw.bass, 0)), mid = clamp(finite(raw.mid, 0));
  const treble = clamp(finite(raw.treble, 0)), transient = clamp(finite(raw.transient, 0));
  const durationSeconds = Math.max(0, finite(raw.durationSeconds, 0));
  const spectrum = new Float32Array(SPECTRUM_SIZE);
  const source = raw.spectrum;
  const length = source && typeof source.length === 'number' ? source.length : 0;
  let energy = 0;
  if (source && length > 0) {
    for (let i = 0; i < SPECTRUM_SIZE; i++) {
      const at = length === 1 ? 0 : i / (SPECTRUM_SIZE - 1) * (length - 1);
      const low = Math.floor(at), high = Math.min(length - 1, low + 1), t = at - low;
      spectrum[i] = clamp(finite(source[low], 0) * (1 - t) + finite(source[high], 0) * t);
      energy += spectrum[i];
    }
  }
  if (!energy && bass + mid + treble > 0) {
    for (let i = 0; i < SPECTRUM_SIZE; i++) {
      const x = i / (SPECTRUM_SIZE - 1);
      const bump = (center: number, width: number) => Math.exp(-(((x - center) / width) ** 2));
      spectrum[i] = clamp((bass * bump(.08, .16) + mid * bump(.45, .22) + treble * bump(.82, .2)) * (.86 + .14 * Math.sin(i * 2.1)));
    }
  }
  const analysis = raw.analysis && raw.analysis.durationSeconds > 0 ? raw.analysis : null;
  const seconds = Math.max(0, finite(raw.seconds, 0));
  return { level, bass, mid, treble, transient, durationSeconds, spectrum, present: durationSeconds > 0 || level > 0 || energy > 0, analysis, seconds };
}

// Audio-only scenes have no MIDI. A deterministic procedural stream (seeded by the beat grid, so
// seeking and export match the preview) gives time-based looks something to move; every note's
// loudness follows the current low/mid/high energy, so whatever sounds right now reacts to the audio.
// The stream is periodic with the clip length (`total` ticks): queryNotes repeats the pattern at +/- total, so a stream
// that is not one period wide would stack several independent copies on short clips and jump at the loop seam.
function syntheticNotes(audio: FrameAudio, tick: number, ppq: number, total: number): { all: NoteEvent[]; parts: NoteEvent[][] } {
  const all: NoteEvent[] = [];
  const parts: NoteEvent[][] = [[], [], []];
  if (!audio.present) return { all, parts: [] };
  const energy = [0, 0, 0];
  for (let band = 0; band < SPECTRUM_SIZE; band++) {
    const voice = band < 7 ? 0 : band < 20 ? 1 : 2;
    energy[voice] = Math.max(energy[voice], audio.spectrum[band]);
  }
  const unit = ppq / 2;
  const steps = Math.max(1, Math.round(total / unit)), step = total / steps;
  let first = Math.floor((tick - ppq * 32) / step), last = Math.ceil((tick + ppq * 26) / step);
  // Never generate more than one period; the repeats from queryNotes fill the rest without duplicates.
  if (last - first >= steps) {
    first = Math.floor(tick / step - steps / 2);
    last = first + steps - 1;
  }
  const chance = [.4, .32, .52], spans = [3, 4, 1], bases = [33, 57, 79], ranges = [12, 17, 14];
  for (let k = first; k <= last; k++) {
    const h = ((k % steps) + steps) % steps;
    for (let voice = 0; voice < 3; voice++) {
      if (hash(h, 101 + voice) > chance[voice]) continue;
      const length = spans[voice] * (1 + Math.floor(hash(h, 111 + voice) * 2));
      const velocity = Math.round(10 + 117 * (.35 + .65 * hash(h, 131 + voice)) * (.12 + .88 * energy[voice]));
      const note = { pitch: bases[voice] + Math.floor(hash(h, 121 + voice) * ranges[voice]), pos: k * step, duration: unit * length * .85, velocity };
      all.push(note);
      parts[voice].push(note);
    }
  }
  return { all, parts: parts.filter(part => part.length) };
}

export function buildFrame(ctx: CanvasRenderingContext2D, pattern: PatternItem, progress: number, accent: unknown, tracks: PatternItem[] | null | undefined, audioInput: AudioFrame | null | undefined, options: VisualOptions | null | undefined): Frame {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const tempoRaw = finite(pattern?.tempo, 0), ppqRaw = finite(pattern?.ppq, 0);
  const tempo = tempoRaw > 0 ? Math.min(999, tempoRaw) : 120;
  const ppq = ppqRaw > 0 ? ppqRaw : 96;
  const tps = tempo / 60 * ppq;
  const audio = readAudio(audioInput);
  const scene = sceneIndex(pattern, tracks);
  const synthetic = !scene.n;
  const total = synthetic
    ? (audio.durationSeconds > 0 ? Math.max(1, audio.durationSeconds * tps) : ppq * 16)
    : patternTicks(pattern, scene);
  const tick = clamp(finite(progress, 0)) * total;
  const response = Math.max(1, tps * .32);
  const pal = paletteFor(accent);
  let notes = scene;
  let views: TrackView[];
  if (synthetic) {
    const virtual = syntheticNotes(audio, tick, ppq, total);
    notes = indexNotes(virtual.all, false);
    const names = ['Low', 'Mid', 'High'];
    views = virtual.parts.map((part, slot) => ({ index: indexNotes(part, false), color: pal.track[slot], slot, name: names[slot] || `Band ${slot + 1}`, tag: '' }));
  } else {
    const list = Array.isArray(tracks) && tracks.length ? tracks : [pattern];
    views = list.map((track, slot) => ({
      index: indexNotes(track?.notes), color: pal.track[slot % pal.track.length], slot,
      name: String(track?.channel_name || track?.pattern_name || `Part ${slot + 1}`).trim(), tag: String(track?.tag || '').trim(),
    })).filter(view => view.index.n);
    if (!views.length) views = [{ index: scene, color: pal.track[0], slot: 0, name: String(pattern?.channel_name || 'Part'), tag: String(pattern?.tag || '') }];
  }
  const intensityRaw = finite(options?.intensity, 1);
  const I = Math.min(1.5, Math.max(.5, intensityRaw));
  const background: VisualBackground = options?.background === 'midnight' || options?.background === 'void' ? options.background : 'nebula';
  const u = 540 / Math.max(1, W);

  const active: VNote[] = [];
  let mass = 0;
  for (const note of queryNotes(notes, tick, tick + 1e-3, total, response)) {
    note.env = envelope(note.pos, note.dur, tick, response);
    if (note.env > .002) { active.push(note); mass += note.env * (.35 + .65 * note.vel); }
  }

  let hit = 0, onsetAge = Infinity, onsetStrength = 0;
  if (!synthetic) {
    const lookBack = tps * .9, gap = Math.max(1, ppq / 12);
    const recent = queryNotes(notes, tick - lookBack, tick + 1e-3, total);
    for (let i = 0; i < recent.length;) {
      const start = recent[i].pos;
      if (start > tick || start <= tick - lookBack) { i++; continue; }
      let sum = 0, j = i;
      while (j < recent.length && recent[j].pos - start <= gap) { if (recent[j].pos <= tick) sum += recent[j].vel; j++; }
      const strength = 1 - Math.exp(-sum * .85);
      const age = (tick - start) / tps;
      if (age < .26) hit = Math.max(hit, strength * (1 - age / .26) ** 2);
      if (strength > .5 && age < onsetAge) { onsetAge = age; onsetStrength = strength; }
      i = j;
    }
  }
  hit = Math.max(hit, audio.transient * .85);

  return {
    ctx, W, H, u, thumb: W < 320,
    tick, total, ppq, tempo, tps, beat: ppq, bar: ppq * 4, response,
    I, glowGain: .55 + .45 * I, glowSize: .8 + .2 * I,
    particles: options?.particles !== false, background,
    pal, audio, notes, tracks: views, synthetic, active,
    env: 1 - Math.exp(-mass / 2.2), hit, onsetAge, onsetStrength,
    breath: synthetic ? audio.bass * audio.bass : (1 - fract(tick / ppq)) ** 3,
    meta: {
      title: titleOf(options?.title, pattern),
      bpm: Math.round(tempo * 10) / 10,
      key: typeof pattern?.key_root === 'string' && pattern.key_root !== '—' ? pattern.key_root.trim() : '',
      seconds: audio.analysis ? audio.seconds : tick / tps,
      duration: audio.analysis ? audio.durationSeconds : total / tps,
    },
    lw: width => (width > u * .85 ? width : u * .85),
  };
}

function titleOf(option: unknown, pattern: PatternItem | null | undefined): string {
  const pick = [option, pattern?.project_title, pattern?.pattern_name].find(value => typeof value === 'string' && value.trim());
  return typeof pick === 'string' ? pick.trim() : 'untitled';
}

// --- audio history and raw signal. Without an audio file both are synthesised from the notes,
// so audio looks still move (and stay deterministic for seeking and export) on MIDI alone.

const WAVE_HARMONICS = [1, .42, .2, .1];

/** Audio features `offset` seconds from now (negative = the past): coarse bands, transient and 32-band spectrum. */
export function audioAt(F: Frame, offset: number): FrameAudio {
  if (!offset) return F.audio;
  const analysis = F.audio.analysis;
  if (analysis) return readAudio(sampleAudioFrame(analysis, F.audio.seconds + offset));
  const tick = F.tick + offset * F.tps;
  let bass = 0, mid = 0, treble = 0;
  const spectrum = new Float32Array(SPECTRUM_SIZE);
  let transient = 0;
  for (const note of queryNotes(F.notes, tick, tick + 1e-3, F.total, F.response)) {
    const env = envelope(note.pos, note.dur, tick, F.response);
    if (env < .002) continue;
    const value = env * (.35 + .65 * note.vel);
    if (note.pitch < 48) bass += value; else if (note.pitch < 72) mid += value; else treble += value;
    const age = (tick - note.pos) / F.tps;
    if (age >= 0 && age < .18) transient = Math.max(transient, note.vel * (1 - age / .18));
    for (const [step, gain] of HARMONICS) {
      const at = clamp((note.pitch + step - 24) / 96) * (SPECTRUM_SIZE - 1);
      for (let i = Math.max(0, Math.floor(at - 2)); i <= Math.min(SPECTRUM_SIZE - 1, Math.ceil(at + 2)); i++) spectrum[i] += value * gain * Math.exp(-((i - at) ** 2));
    }
  }
  for (let i = 0; i < SPECTRUM_SIZE; i++) spectrum[i] = 1 - Math.exp(-spectrum[i] * .95);
  const soft = (value: number) => 1 - Math.exp(-value * 1.1);
  bass = soft(bass); mid = soft(mid); treble = soft(treble);
  return { level: Math.max(bass, mid, treble), bass, mid, treble, transient, durationSeconds: 0, spectrum, present: false, analysis: null, seconds: 0 };
}

/**
 * `count` signal samples (-1..1) at `rate` Hz starting `offset` seconds from now. With audio this is the
 * real (low-rate) PCM of one channel; without, a sum of decaying partials of the sounding notes, with a
 * little stereo spread per note so a goniometer has width.
 */
export function signal(F: Frame, channel: 'left' | 'right' | 'mid' | 'side', offset: number, count: number, rate = 11025): Float32Array {
  const analysis = F.audio.analysis;
  if (analysis) {
    if (Math.abs(rate - analysis.pcmRate) < 1) return readPcm(analysis, channel, F.audio.seconds + offset, count);
    const raw = readPcm(analysis, channel, F.audio.seconds + offset, Math.ceil(count * analysis.pcmRate / rate) + 1);
    const out = new Float32Array(count), ratio = analysis.pcmRate / rate;
    for (let i = 0; i < count; i++) {
      const at = i * ratio, low = Math.floor(at), t = at - low;
      out[i] = raw[low] * (1 - t) + (raw[low + 1] ?? raw[low]) * t;
    }
    return out;
  }
  const out = new Float32Array(Math.max(0, count));
  const start = F.meta.seconds + offset;
  const notes = queryNotes(F.notes, F.tick + offset * F.tps, F.tick + (offset + count / rate) * F.tps + 1e-3, F.total, F.response);
  for (const note of notes) {
    const hz = 440 * 2 ** ((note.pitch - 69) / 12);
    const pan = channel === 'mid' ? 1 : channel === 'side' ? (note.seed - .5) * .9 : channel === 'left' ? 1 - Math.max(0, note.seed - .5) : 1 - Math.max(0, .5 - note.seed);
    const gain = .22 * (.35 + .65 * note.vel) * pan;
    const phase0 = note.seed * TAU;
    for (let i = 0; i < out.length; i++) {
      const tick = F.tick + (offset + i / rate) * F.tps;
      const env = envelope(note.pos, note.dur, tick, F.response);
      if (env < .002) continue;
      const time = start + i / rate;
      let value = 0;
      for (let h = 0; h < WAVE_HARMONICS.length; h++) value += Math.sin(time * hz * (h + 1) * TAU + phase0 * (h + 1)) * WAVE_HARMONICS[h];
      out[i] += value * env * gain;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 1.4);
  return out;
}

// --- timing helpers: every periodic motion completes whole cycles per loop, so loops are seamless.

export function loopCycles(F: Frame, beatsPerCycle: number, symmetry = 1): number {
  const cycles = F.total / F.beat / Math.max(1e-6, beatsPerCycle);
  return Math.max(1 / symmetry, Math.round(cycles * symmetry) / symmetry);
}

export const loopT = (F: Frame, beatsPerCycle: number, symmetry = 1) => fract(F.tick / F.total * loopCycles(F, beatsPerCycle, symmetry));
export const loopPhase = (F: Frame, beatsPerCycle: number) => loopT(F, beatsPerCycle) * TAU;

// A gentle oscillation; short loops get a proportionally smaller swing instead of a frantic one.
export function swing(F: Frame, beatsPerCycle: number, amplitude: number): number {
  const cycles = loopCycles(F, beatsPerCycle);
  const period = F.total / F.beat / cycles;
  return Math.sin(F.tick / F.total * cycles * TAU) * amplitude * Math.min(1, period / beatsPerCycle);
}

// A tick length close to `beats` beats that divides the loop exactly.
export function loopUnit(F: Frame, beats: number): number {
  return F.total / Math.max(1, Math.round(F.total / (beats * F.beat)));
}

// --- note helpers

function nearest(list: VNote[], cap: number, tick: number): VNote[] {
  if (list.length <= cap) return list;
  const distance = (note: VNote) => (note.pos > tick ? note.pos - tick : Math.max(0, tick - note.end));
  return list.slice().sort((a, b) => distance(a) - distance(b)).slice(0, cap).sort((a, b) => a.pos - b.pos);
}

export function windowNotes(F: Frame, index: NoteIndex, before: number, after: number, cap = 400, pad = 0): VNote[] {
  const list = queryNotes(index, F.tick - Math.max(0, before), F.tick + Math.max(1e-3, after), F.total, pad);
  for (const note of list) note.env = envelope(note.pos, note.dur, F.tick, F.response);
  return cap > 0 ? nearest(list, cap, F.tick) : list;
}

export function activeNotes(F: Frame, index: NoteIndex): VNote[] {
  if (index === F.notes) return F.active;
  const out: VNote[] = [];
  for (const note of queryNotes(index, F.tick, F.tick + 1e-3, F.total, F.response)) {
    note.env = envelope(note.pos, note.dur, F.tick, F.response);
    if (note.env > .002) out.push(note);
  }
  return out;
}

export function energyOf(notes: VNote[], scale = 1.4): number {
  let mass = 0;
  for (const note of notes) mass += note.env * (.35 + .65 * note.vel);
  return 1 - Math.exp(-mass / scale);
}

export function pitchNorm(index: NoteIndex, pitch: number, minSpan = 12): number {
  let low = index.n ? index.minPitch : 48, high = index.n ? index.maxPitch : 72;
  if (high - low < minSpan) { const middle = (low + high) / 2; low = middle - minSpan / 2; high = middle + minSpan / 2; }
  return clamp((pitch - low) / (high - low));
}

export function pickTracks(F: Frame, max: number): TrackView[] {
  if (F.tracks.length <= max) return F.tracks;
  const keep = new Set(F.tracks.slice().sort((a, b) => b.index.n - a.index.n).slice(0, max));
  return F.tracks.filter(track => keep.has(track));
}

const HARMONICS: [number, number][] = [[0, 1], [12, .5], [19, .32], [24, .22], [28, .14]];

// Combined audio spectrum + a pseudo-spectrum of the sounding notes (fundamental + harmonics,
// short percussive notes add high-frequency "air"), resampled to `count` bands (0..1).
export function blendBands(F: Frame, count: number): Float32Array {
  const out = new Float32Array(count);
  const notes = new Float32Array(count);
  if (!F.synthetic) {
    const sigma = Math.max(.7, count / 30), reach = Math.ceil(sigma * 2.4), short = F.beat / 3;
    for (const note of F.active) {
      const value = note.env * (.4 + .6 * note.vel);
      for (const [offset, gain] of HARMONICS) {
        const at = clamp((note.pitch + offset - 24) / 96) * (count - 1), center = Math.round(at);
        for (let i = Math.max(0, center - reach); i <= Math.min(count - 1, center + reach); i++) {
          const d = (i - at) / sigma;
          notes[i] += value * gain * Math.exp(-d * d);
        }
      }
      if (note.dur <= short) for (let i = 0; i < count; i++) notes[i] += value * .16 * (i / Math.max(1, count - 1)) ** 1.6;
    }
  }
  const spectrum = F.audio.spectrum;
  const idle = !F.audio.present && !F.active.length;
  const phase = loopPhase(F, 4);
  for (let i = 0; i < count; i++) {
    const at = i / Math.max(1, count - 1) * (SPECTRUM_SIZE - 1), low = Math.floor(at), high = Math.min(SPECTRUM_SIZE - 1, low + 1), t = at - low;
    const audio = spectrum[low] * (1 - t) + spectrum[high] * t;
    const midi = 1 - Math.exp(-notes[i] * .95);
    out[i] = idle ? .05 + .035 * (.5 + .5 * Math.sin(phase + i * .5)) : 1 - (1 - audio) * (1 - midi);
  }
  return out;
}

// --- painting

type Surface = HTMLCanvasElement | OffscreenCanvas;

export function makeSurface(width: number, height: number): Surface | null {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  try {
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      return canvas;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  } catch { /* no canvas backend available */ }
  return null;
}

export const surfaceContext = (surface: Surface) => surface.getContext('2d') as unknown as CanvasRenderingContext2D | null;

const SPRITE = 128;
const sprites = new Map<string, Surface | null>();

function cachedSprite(key: string, width: number, height: number, paint: (g: CanvasRenderingContext2D) => void): Surface | null {
  const known = sprites.get(key);
  if (known !== undefined) return known;
  let sprite = makeSurface(width, height);
  const g = sprite && surfaceContext(sprite);
  if (sprite && g) paint(g); else sprite = null;
  if (sprites.size > 220) sprites.delete(sprites.keys().next().value as string);
  sprites.set(key, sprite);
  return sprite;
}

// Pre-rendered additive glow per colour: drawImage + 'lighter' gives bloom for a fraction of shadowBlur's cost.
function glowSprite(color: string): Surface | null {
  return cachedSprite(`g${color}`, SPRITE, SPRITE, g => {
    const half = SPRITE / 2;
    const gradient = g.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, withAlpha(mix(color, '#ffffff', .55), 1));
    gradient.addColorStop(.08, withAlpha(mix(color, '#ffffff', .25), .8));
    gradient.addColorStop(.2, withAlpha(color, .46));
    gradient.addColorStop(.38, withAlpha(color, .19));
    gradient.addColorStop(.6, withAlpha(color, .065));
    gradient.addColorStop(.8, withAlpha(color, .016));
    gradient.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = gradient;
    g.fillRect(0, 0, SPRITE, SPRITE);
  });
}

// A soft vertical light ray (bright foot, fading top) used for aurora curtains and light pillars.
function raySprite(color: string): Surface | null {
  return cachedSprite(`r${color}`, 32, 256, g => {
    const vertical = g.createLinearGradient(0, 256, 0, 0);
    vertical.addColorStop(0, withAlpha(mix(color, '#ffffff', .5), 0));
    vertical.addColorStop(.035, withAlpha(mix(color, '#ffffff', .45), 1));
    vertical.addColorStop(.16, withAlpha(mix(color, '#ffffff', .1), .7));
    vertical.addColorStop(.45, withAlpha(color, .28));
    vertical.addColorStop(.75, withAlpha(color, .09));
    vertical.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = vertical;
    g.fillRect(0, 0, 32, 256);
    g.globalCompositeOperation = 'destination-in';
    const across = g.createLinearGradient(0, 0, 32, 0);
    across.addColorStop(0, 'rgba(0,0,0,0)');
    across.addColorStop(.3, 'rgba(0,0,0,0.65)');
    across.addColorStop(.5, 'rgba(0,0,0,1)');
    across.addColorStop(.7, 'rgba(0,0,0,0.65)');
    across.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = across;
    g.fillRect(0, 0, 32, 256);
  });
}

export function ray(F: Frame, color: string, x: number, bottom: number, width: number, height: number, alpha: number) {
  const a = alpha * F.glowGain;
  if (!(width > .3) || !(height > .5) || !(a > .004)) return;
  const sprite = raySprite(color);
  if (!sprite) return;
  F.ctx.globalAlpha = a < 1 ? a : 1;
  F.ctx.drawImage(sprite, x - width / 2, bottom - height, width, height);
}

export function glow(F: Frame, color: string, x: number, y: number, radius: number, alpha: number) {
  glowOval(F, color, x, y, radius, radius, alpha);
}

export function glowOval(F: Frame, color: string, x: number, y: number, rx: number, ry: number, alpha: number) {
  const w = rx * F.glowSize, h = ry * F.glowSize, a = alpha * F.glowGain;
  if (!(w > .3) || !(h > .3) || !(a > .004)) return;
  const sprite = glowSprite(color);
  if (!sprite) return;
  F.ctx.globalAlpha = a < 1 ? a : 1;
  F.ctx.drawImage(sprite, x - w, y - h, w * 2, h * 2);
}

// Stroke the current path (or `path`) with a cheap two-pass bloom: wide faint + crisp core.
export function bloomStroke(F: Frame, color: string | CanvasGradient, width: number, alpha: number, spread = 4, path?: Path2D) {
  const { ctx } = F;
  const a = clamp(alpha);
  if (a < .004) return;
  ctx.strokeStyle = color;
  const bloom = a * .17 * F.glowGain;
  if (spread > 1 && bloom > .004) {
    ctx.globalAlpha = Math.min(1, bloom);
    ctx.lineWidth = F.lw(width * spread);
    if (path) ctx.stroke(path); else ctx.stroke();
  }
  ctx.globalAlpha = a;
  ctx.lineWidth = F.lw(width);
  if (path) ctx.stroke(path); else ctx.stroke();
}

export function roundedRect(path: CanvasPath, x: number, y: number, w: number, h: number, radius: number) {
  if (!(w > 0) || !(h > 0) || !Number.isFinite(x + y)) return;
  const r = radius > 0 ? Math.min(radius, w / 2, h / 2) : 0;
  path.moveTo(x + r, y);
  path.arcTo(x + w, y, x + w, y + h, r);
  path.arcTo(x + w, y + h, x, y + h, r);
  path.arcTo(x, y + h, x, y, r);
  path.arcTo(x, y, x + w, y, r);
  path.closePath();
}

export function fillRounded(F: Frame, x: number, y: number, w: number, h: number, radius: number, fill: string | CanvasGradient, alpha = 1) {
  if (!(w > 0) || !(h > 0) || !(alpha > .003)) return;
  const { ctx } = F;
  ctx.beginPath();
  roundedRect(ctx, x, y, w, h, radius);
  ctx.globalAlpha = clamp(alpha);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function dot(F: Frame, x: number, y: number, radius: number, fill: string, alpha = 1) {
  if (!(radius > 0) || !(alpha > .003)) return;
  const { ctx } = F;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.globalAlpha = clamp(alpha);
  ctx.fillStyle = fill;
  ctx.fill();
}

