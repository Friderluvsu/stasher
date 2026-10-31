import type { NoteEvent } from '../../services/api';

export interface NoteIndex {
  n: number;
  pitch: Float32Array;
  pos: Float64Array;
  dur: Float64Array;
  end: Float64Array;
  vel: Float32Array;
  seed: Float32Array;
  long: Uint8Array;
  longList: number[];
  span: number;
  minPitch: number;
  maxPitch: number;
  firstPos: number;
  lastEnd: number;
}

// A note as seen in the current time window; pos/end are shifted for loop repeats.
export interface VNote {
  i: number;
  pitch: number;
  pos: number;
  dur: number;
  end: number;
  vel: number;
  seed: number;
  env: number;
}

export const EMPTY_INDEX: NoteIndex = {
  n: 0, pitch: new Float32Array(0), pos: new Float64Array(0), dur: new Float64Array(0), end: new Float64Array(0),
  vel: new Float32Array(0), seed: new Float32Array(0), long: new Uint8Array(0), longList: [], span: 1,
  minPitch: 60, maxPitch: 60, firstPos: 0, lastEnd: 0,
};

const cache = new WeakMap<object, NoteIndex>();
const smooth = (value: number) => { const t = value < 0 ? 0 : value > 1 ? 1 : value; return t * t * (3 - 2 * t); };

export function hash(a: number, b = 0): number {
  let h = Math.imul((a | 0) ^ 0x27d4eb2d, 0x9e3779b1) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Stateless envelopes give seeking, thumbnails and video the same smooth frame.
export function envelope(pos: number, duration: number, tick: number, response: number): number {
  const age = tick - pos;
  if (!(age >= 0)) return 0;
  const length = duration > 1 ? duration : 1;
  const release = response > .001 ? response : .001;
  if (age >= length + release) return 0;
  const attack = Math.max(.001, Math.min(release * .22, length * .35));
  return smooth(age / attack) * (1 - smooth((age - length) / release));
}

export function noteEnvelope(note: NoteEvent, tick: number, responseTicks: number): number {
  if (!note) return 0;
  const duration = Number(note.duration);
  const response = Number(responseTicks);
  return envelope(Number(note.pos), Number.isFinite(duration) ? duration : 0, Number(tick), Number.isFinite(response) && response > 0 ? response : 1);
}

export function indexNotes(notes: readonly NoteEvent[] | null | undefined, cacheable = true): NoteIndex {
  if (!Array.isArray(notes) || !notes.length) return EMPTY_INDEX;
  if (cacheable) {
    const known = cache.get(notes);
    if (known) return known;
  }
  const rows: { pitch: number; pos: number; dur: number; vel: number }[] = [];
  for (const note of notes) {
    if (!note) continue;
    const pitch = Number(note.pitch), pos = Number(note.pos);
    if (!Number.isFinite(pitch) || !Number.isFinite(pos)) continue;
    const duration = Number(note.duration), velocity = Number(note.velocity);
    rows.push({
      pitch: Math.min(127, Math.max(0, pitch)),
      pos,
      dur: Number.isFinite(duration) && duration > 1 ? duration : 1,
      vel: Number.isFinite(velocity) ? Math.min(127, Math.max(1, velocity)) / 127 : 100 / 127,
    });
  }
  rows.sort((a, b) => a.pos - b.pos || a.pitch - b.pitch);
  const n = rows.length;
  if (!n) {
    if (cacheable) cache.set(notes, EMPTY_INDEX);
    return EMPTY_INDEX;
  }
  const index: NoteIndex = {
    n, pitch: new Float32Array(n), pos: new Float64Array(n), dur: new Float64Array(n), end: new Float64Array(n),
    vel: new Float32Array(n), seed: new Float32Array(n), long: new Uint8Array(n), longList: [], span: 1,
    minPitch: 127, maxPitch: 0, firstPos: rows[0].pos, lastEnd: -Infinity,
  };
  const lengths = Float64Array.from(rows, row => row.dur).sort();
  // Very long notes are kept aside so window queries stay O(log n + visible).
  const longThreshold = Math.max(1, lengths[Math.floor((n - 1) * .9)] * 2);
  // Seeds drive every look's layout and jitter, so they must not depend on anything that changes between frames of the
  // same note (audio-only scenes derive velocity from the live spectrum). Exact duplicates get a rank to stay distinct.
  let twin = 0;
  rows.forEach((row, i) => {
    twin = i && row.pos === rows[i - 1].pos && row.pitch === rows[i - 1].pitch ? twin + 1 : 0;
    index.pitch[i] = row.pitch;
    index.pos[i] = row.pos;
    index.dur[i] = row.dur;
    index.end[i] = row.pos + row.dur;
    index.vel[i] = row.vel;
    index.seed[i] = hash(Math.round(row.pos * 8), Math.round(row.pitch) * 977 + twin * 131071);
    if (row.dur > longThreshold) { index.long[i] = 1; index.longList.push(i); } else if (row.dur > index.span) index.span = row.dur;
    if (row.pitch < index.minPitch) index.minPitch = row.pitch;
    if (row.pitch > index.maxPitch) index.maxPitch = row.pitch;
    if (index.end[i] > index.lastEnd) index.lastEnd = index.end[i];
  });
  if (cacheable) cache.set(notes, index);
  return index;
}

function lowerBound(values: Float64Array, count: number, target: number): number {
  let low = 0, high = count;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target) low = middle + 1; else high = middle;
  }
  return low;
}

interface ScanState { last: number; sorted: boolean }

function push(index: NoteIndex, out: VNote[], i: number, shift: number, state: ScanState) {
  const pos = index.pos[i] + shift;
  if (pos < state.last) state.sorted = false;
  state.last = pos;
  out.push({ i, pitch: index.pitch[i], pos, dur: index.dur[i], end: index.end[i] + shift, vel: index.vel[i], seed: index.seed[i], env: 0 });
}

function scan(index: NoteIndex, out: VNote[], from: number, to: number, pad: number, shift: number, state: ScanState) {
  const a = from - shift, b = to - shift;
  const { pos, end, long, n } = index;
  for (let i = lowerBound(pos, n, a - pad - index.span); i < n && pos[i] < b; i++) {
    if (!long[i] && end[i] + pad > a) push(index, out, i, shift, state);
  }
  for (const i of index.longList) if (pos[i] < b && end[i] + pad > a) push(index, out, i, shift, state);
}

// Notes whose [pos, end + pad) overlaps [from, to). With a loop length the pattern repeats,
// so windows that cross the loop seam see the previous/next repetition and loops stay seamless.
export function queryNotes(index: NoteIndex, from: number, to: number, total: number, pad = 0, wrap = true): VNote[] {
  const out: VNote[] = [];
  if (!index.n || !(to > from)) return out;
  const state: ScanState = { last: -Infinity, sorted: true };
  if (!wrap || !(total > 0) || !Number.isFinite(total)) scan(index, out, from, to, pad, 0, state);
  else {
    const last = Math.ceil((to - index.firstPos) / total) - 1;
    const first = Math.max(Math.floor((from - pad - index.lastEnd) / total), last - 31);
    for (let k = first; k <= last; k++) scan(index, out, from, to, pad, k * total, state);
  }
  if (!state.sorted) out.sort((a, b) => a.pos - b.pos || a.pitch - b.pitch);
  return out;
}
