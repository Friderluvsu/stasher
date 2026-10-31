import { audioAt, clamp, makeSurface, surfaceContext } from '../frame';
import type { Frame } from '../frame';

// Private helpers shared by agent C's looks (rack, monitor, ...).

export type AnySurface = NonNullable<ReturnType<typeof makeSurface>>;

/** audioAt, but never the live frame: with offset 0 `audioAt` returns the (possibly empty) analysed frame. */
export const audioAround = (F: Frame, offset: number) => audioAt(F, offset || 1e-4);

/** Overall level 0..1 of an audio frame; for note-only scenes (synthetic signal) it is rescaled to the range of real audio. */
export function levelOf(F: Frame, a: ReturnType<typeof audioAt>): number {
  if (F.audio.analysis) return a.level;
  let sum = 0;
  for (let i = 0; i < a.spectrum.length; i++) sum += a.spectrum[i] * a.spectrum[i];
  return clamp(Math.sqrt(sum / a.spectrum.length) * .85 + a.transient * .1);
}

/** Owner of immutable per-scene data: the audio analysis when there is one, otherwise the note index. */
export const sceneOwner = (F: Frame): object => F.audio.analysis || F.notes;

export function newSurface(width: number, height: number): { surface: AnySurface; g: CanvasRenderingContext2D } | null {
  const surface = makeSurface(width, height);
  const g = surface && surfaceContext(surface);
  return surface && g ? { surface, g } : null;
}

// ---- loudness model of the whole clip (cached per scene): momentary (400 ms) and short-term (3 s) LUFS-like curves
export interface LoudnessModel {
  dt: number;
  n: number;
  duration: number;
  level: Float32Array;
  momentary: Float32Array;
  short: Float32Array;
  integrated: number;
  truePeak: number;
  range: number;
}

const loudnessCache = new WeakMap<object, { key: string; model: LoudnessModel }>();
export const toLufs = (level: number) => 20 * Math.log10(level * .26 + 1e-4);

function circularMean(level: Float32Array, i: number, count: number): number {
  const n = level.length;
  let sum = 0;
  for (let k = 0; k < count; k++) sum += level[((i - k) % n + n) % n];
  return sum / count;
}

export function loudnessModel(F: Frame): LoudnessModel {
  const owner = sceneOwner(F);
  const duration = Math.max(.1, F.meta.duration);
  const key = `${duration.toFixed(2)}|${F.total}`;
  const known = loudnessCache.get(owner);
  if (known && known.key === key) return known.model;
  const n = Math.max(8, Math.round(duration / Math.max(.08, duration / 3000)));
  const level = new Float32Array(n);
  let maxLevel = 0;
  for (let i = 0; i < n; i++) {
    const a = audioAround(F, (i + .5) / n * duration - F.meta.seconds);
    const v = levelOf(F, a);
    level[i] = v;
    if (v > maxLevel) maxLevel = v;
  }
  const mCount = Math.max(1, Math.round(.4 / (duration / n))), sCount = Math.max(mCount, Math.round(3 / (duration / n)));
  const momentary = new Float32Array(n), short = new Float32Array(n);
  let power = 0;
  for (let i = 0; i < n; i++) {
    momentary[i] = toLufs(circularMean(level, i, mCount));
    short[i] = toLufs(circularMean(level, i, sCount));
    power += 10 ** (short[i] / 10);
  }
  const sorted = Array.from(short).sort((a, b) => a - b);
  const model: LoudnessModel = {
    dt: duration / n, n, duration, level, momentary, short,
    integrated: 10 * Math.log10(power / n),
    truePeak: 20 * Math.log10(Math.max(.02, maxLevel) * .55),
    range: Math.max(.5, sorted[Math.floor(n * .95)] - sorted[Math.floor(n * .1)]),
  };
  loudnessCache.set(owner, { key, model });
  return model;
}

/** Linear lookup in a per-step array at absolute time `seconds`, wrapping around the clip. */
export function lookup(model: LoudnessModel, values: Float32Array, seconds: number): number {
  const pos = ((seconds / model.duration) % 1 + 1) % 1 * model.n - .5;
  const a = Math.floor(pos), t = pos - a;
  const n = model.n;
  return values[((a % n) + n) % n] * (1 - t) + values[(((a + 1) % n) + n) % n] * t;
}

export const fmtLufs = (value: number) => (!Number.isFinite(value) || value < -70 ? '-inf' : value.toFixed(1));
