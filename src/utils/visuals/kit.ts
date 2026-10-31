import type { Frame, TrackView } from './frame';
import { clamp, TAU } from './frame';
import { hash } from './noteIndex';
import type { VNote } from './noteIndex';

// Shared toolkit for the looks in ./looks. Canvas space is always 540 x 960 (9:16).
export const W = 540;
export const H = 960;

export const SANS = '"Hoves", "Inter", -apple-system, "Helvetica Neue", Arial, sans-serif';
export const MONO = '"SF Mono", "JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, monospace';
export const SERIF = '"Iowan Old Style", "Times New Roman", Georgia, serif';
export const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive';

// Default part colours (bass / chords / lead / drums ...) used by the looks and the part legend.
export const TRACK_COLORS = ['#7b5cff', '#1fb59a', '#f0524f', '#f4a83a', '#3f8cff', '#7fc94f', '#e255b4', '#25b6d8'];
export const trackColorAt = (slot: number) => TRACK_COLORS[((Math.round(slot) % TRACK_COLORS.length) + TRACK_COLORS.length) % TRACK_COLORS.length];

export interface TextStyle {
  size?: number;
  weight?: number | string;
  font?: string;
  color?: string;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  alpha?: number;
  /** Extra space between letters in px (canvas letterSpacing where supported). */
  spacing?: number;
  italic?: boolean;
  maxWidth?: number;
}

export function setFont(F: Frame, style: TextStyle = {}) {
  const { ctx } = F;
  ctx.font = `${style.italic ? 'italic ' : ''}${style.weight ?? 400} ${style.size ?? 12}px ${style.font ?? SANS}`;
  ctx.textAlign = style.align ?? 'left';
  ctx.textBaseline = style.baseline ?? 'alphabetic';
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in spaced) spaced.letterSpacing = `${style.spacing ?? 0}px`;
}

/** Draw text and return its width. */
export function text(F: Frame, value: string, x: number, y: number, style: TextStyle = {}): number {
  const { ctx } = F;
  setFont(F, style);
  ctx.globalAlpha = clamp(style.alpha ?? 1);
  ctx.fillStyle = style.color ?? '#ffffff';
  if (style.maxWidth) ctx.fillText(value, x, y, style.maxWidth); else ctx.fillText(value, x, y);
  const width = ctx.measureText(value).width;
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in spaced) spaced.letterSpacing = '0px';
  ctx.globalAlpha = 1;
  return width;
}

export function measure(F: Frame, value: string, style: TextStyle = {}): number {
  setFont(F, style);
  const width = F.ctx.measureText(value).width;
  const spaced = F.ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in spaced) spaced.letterSpacing = '0px';
  return width;
}

/** "m:ss" */
export function clock(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

/** "mm:ss" */
export function clock2(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export const bpmText = (F: Frame) => `${Math.round(F.meta.bpm)} BPM`;

/** "title · 102 BPM · D" (key omitted when unknown). */
export function infoLine(F: Frame, separator = ' · ', withTitle = true): string {
  return [withTitle ? F.meta.title : '', bpmText(F), F.meta.key].filter(Boolean).join(separator);
}

/** "0:04 / 0:18" */
export const timeLine = (F: Frame) => `${clock(F.meta.seconds)} / ${clock(F.meta.duration)}`;

/** 0..1 position in the timeline. */
export const timeProgress = (F: Frame) => (F.meta.duration > 0 ? clamp(F.meta.seconds / F.meta.duration) : 0);

/** Bar (0-based) and beat inside the bar (0-based) at the current tick. */
export function barBeat(F: Frame): { bar: number; beat: number; barProgress: number; beatProgress: number } {
  const bars = F.tick / F.bar;
  const beats = F.tick / F.beat;
  return { bar: Math.floor(bars), beat: Math.floor(beats) % 4, barProgress: bars - Math.floor(bars), beatProgress: beats - Math.floor(beats) };
}

export const totalBars = (F: Frame) => Math.max(1, Math.round(F.total / F.bar));

// --- deterministic randomness: never Math.random in a look (seeking, thumbnails and export must match).
export const rand = (a: number, b = 0) => hash(Math.floor(a), Math.floor(b));
export const randRange = (low: number, high: number, a: number, b = 0) => low + (high - low) * rand(a, b);

/** Smooth 1-D value noise in -1..1. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return (rand(i, seed) * (1 - u) + rand(i + 1, seed) * u) * 2 - 1;
}

/** Smooth 2-D value noise in -1..1. */
export function noise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const corner = (dx: number, dy: number) => hash(ix + dx + seed * 7919, iy + dy - seed * 104729);
  const top = corner(0, 0) * (1 - ux) + corner(1, 0) * ux;
  const bottom = corner(0, 1) * (1 - ux) + corner(1, 1) * ux;
  return (top * (1 - uy) + bottom * uy) * 2 - 1;
}

export const ease = {
  outCubic: (t: number) => 1 - (1 - clamp(t)) ** 3,
  inOutCubic: (t: number) => { const x = clamp(t); return x < .5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2; },
  outBack: (t: number) => { const x = clamp(t), c = 1.70158; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; },
  outElastic: (t: number) => { const x = clamp(t); return x === 0 || x === 1 ? x : 2 ** (-10 * x) * Math.sin((x * 10 - .75) * TAU / 3) + 1; },
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// --- music helpers

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (pitch: number) => NOTE_NAMES[((Math.round(pitch) % 12) + 12) % 12];
export const noteLabel = (pitch: number) => `${noteName(pitch)}${Math.floor(Math.round(pitch) / 12) - 1}`;
export const isBlackKey = (pitch: number) => [1, 3, 6, 8, 10].includes(((Math.round(pitch) % 12) + 12) % 12);

const CHORD_SHAPES: [string, number[]][] = [
  ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]], ['7', [0, 4, 7, 10]], ['m7b5', [0, 3, 6, 10]], ['dim7', [0, 3, 6, 9]], ['mMaj7', [0, 3, 7, 11]],
  ['add9', [0, 2, 4, 7]], ['madd9', [0, 2, 3, 7]], ['6', [0, 4, 7, 9]], ['m6', [0, 3, 7, 9]],
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]], ['5', [0, 7]],
];

/** Best chord name ("Dmaj7", "Bm7", "A") for a set of pitches, or '' when nothing fits. */
export function chordName(pitches: number[]): string {
  const classes = [...new Set(pitches.map(pitch => ((Math.round(pitch) % 12) + 12) % 12))];
  if (classes.length < 2) return '';
  const bass = ((Math.round(Math.min(...pitches)) % 12) + 12) % 12;
  let best = '', score = -Infinity;
  for (const root of classes) {
    const intervals = new Set(classes.map(pc => (pc - root + 12) % 12));
    for (const [suffix, shape] of CHORD_SHAPES) {
      const hits = shape.filter(step => intervals.has(step)).length;
      if (hits < Math.min(shape.length, 2) || !intervals.has(0)) continue;
      const missing = shape.length - hits, extra = intervals.size - hits;
      const value = hits * 2 - missing * 3 - extra * 1.5 + (root === bass ? .8 : 0) + shape.length * .1;
      if (value > score) { score = value; best = `${NOTE_NAMES[root]}${suffix}`; }
    }
  }
  return score > 2 ? best : '';
}

/** Pitches sounding at `tick` (a cheap chord read from the scene). */
export function pitchesAt(F: Frame, tick = F.tick): number[] {
  const out: number[] = [];
  const { notes } = F;
  if (!notes.n) return out;
  const wrapped = ((tick % F.total) + F.total) % F.total;
  for (let i = 0; i < notes.n; i++) if (notes.pos[i] <= wrapped + 1e-6 && notes.end[i] > wrapped) out.push(notes.pitch[i]);
  return out;
}

/** Chord name per bar of the loop (cached per scene). */
const chordCache = new WeakMap<object, string[]>();
export function chordsByBar(F: Frame): string[] {
  const known = chordCache.get(F.notes);
  if (known) return known;
  const bars = totalBars(F);
  const out: string[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const weights = new Map<number, number>();
    const from = bar * F.bar, to = from + F.bar;
    for (let i = 0; i < F.notes.n; i++) {
      const overlap = Math.min(to, F.notes.end[i]) - Math.max(from, F.notes.pos[i]);
      if (overlap > 0) weights.set(F.notes.pitch[i], (weights.get(F.notes.pitch[i]) || 0) + overlap);
    }
    const pitches = [...weights.entries()].filter(([, weight]) => weight > F.beat * .4).map(([pitch]) => pitch);
    out.push(chordName(pitches) || out[out.length - 1] || '');
  }
  chordCache.set(F.notes, out);
  return out;
}

/** Track role guessed from tag/name: used to label parts like the reference ("BASS", "CHORDS", "LEAD", "DRUMS"). */
export function trackRole(track: TrackView): 'drums' | 'bass' | 'chords' | 'lead' {
  const text = `${track.tag} ${track.name}`.toLowerCase();
  if (/kick|snare|clap|hat|hh|perc|drum|cymbal|crash|ride|rim|tom|бочк|снейр|хэт/.test(text)) return 'drums';
  if (/808|bass|sub|бас/.test(text)) return 'bass';
  if (/chord|pad|keys|piano|rhodes|organ|аккорд|клав/.test(text)) return 'chords';
  const { index } = track;
  if (index.n && index.maxPitch < 52) return 'bass';
  return 'lead';
}

export const roleLabel = (track: TrackView) => trackRole(track).toUpperCase();

/** Short label for a part: its name, upper-cased and trimmed. */
export const partLabel = (track: TrackView, max = 12) => (track.name || trackRole(track)).toUpperCase().slice(0, max);

/** Notes of one track in [tick - before, tick + after], each with its envelope. */
export type { VNote };

/** Paint the whole canvas. */
export function fill(F: Frame, color: string | CanvasGradient) {
  F.ctx.globalAlpha = 1;
  F.ctx.fillStyle = color;
  F.ctx.fillRect(-2, -2, W + 4, H + 4);
}

/** Soft blurred colour blobs on a light background (the "glass" looks: pastel corners). */
export function pastelBlobs(F: Frame, blobs: [number, number, number, string, number][]) {
  const { ctx } = F;
  for (const [x, y, radius, color, alpha] of blobs) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, color.length === 7 ? `${color}00` : 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.globalAlpha = 1;
}

/** Film grain / paper noise: cheap deterministic speckle, `amount` 0..1. */
export function grain(F: Frame, amount: number, color = '#000000', seed = Math.floor(F.meta.seconds * 24)) {
  if (F.thumb || amount <= 0) return;
  const { ctx } = F;
  ctx.fillStyle = color;
  const count = Math.round(1400 * amount);
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = .04 + .08 * rand(i, seed + 3);
    ctx.fillRect(rand(i, seed) * W, rand(i, seed + 1) * H, 1, 1);
  }
  ctx.globalAlpha = 1;
}

export function line(F: Frame, x1: number, y1: number, x2: number, y2: number, color: string, width = 1, alpha = 1) {
  const { ctx } = F;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.globalAlpha = clamp(alpha);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export function rect(F: Frame, x: number, y: number, w: number, h: number, color: string, alpha = 1) {
  if (!(w > 0) || !(h > 0)) return;
  F.ctx.globalAlpha = clamp(alpha);
  F.ctx.fillStyle = color;
  F.ctx.fillRect(x, y, w, h);
  F.ctx.globalAlpha = 1;
}

export function strokeRect(F: Frame, x: number, y: number, w: number, h: number, color: string, width = 1, alpha = 1) {
  F.ctx.globalAlpha = clamp(alpha);
  F.ctx.strokeStyle = color;
  F.ctx.lineWidth = width;
  F.ctx.strokeRect(x, y, w, h);
  F.ctx.globalAlpha = 1;
}

export function circle(F: Frame, x: number, y: number, radius: number, fillColor: string | null, alpha = 1, stroke?: string, strokeWidth = 1) {
  if (!(radius > 0)) return;
  const { ctx } = F;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.globalAlpha = clamp(alpha);
  if (fillColor) { ctx.fillStyle = fillColor; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeWidth; ctx.stroke(); }
  ctx.globalAlpha = 1;
}
