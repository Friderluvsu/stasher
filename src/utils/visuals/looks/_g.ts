import type { Frame, TrackView } from '../frame';
import { audioAt, clamp, hash, makeSurface, roundedRect, surfaceContext, TAU, windowNotes } from '../frame';
import { measure, text, trackRole, type TextStyle } from '../kit';
import type { VNote } from '../noteIndex';

// Private helpers of agent G: the dot-matrix "vertical piano roll" shared by trap-chrome and trap-phosphor,
// plus a few small utilities (squeezed text, dot lattice, cached static layers).

type Surface = HTMLCanvasElement | OffscreenCanvas;

/** Reference pixels (720 wide video) -> canvas units (540 wide). */
export const K = 0.75;

/** Draw text squeezed horizontally to `sx` (or to fit `maxWidth`); returns the drawn width. */
export function squeezed(F: Frame, value: string, x: number, y: number, style: TextStyle & { sx?: number; maxWidth?: number }): number {
  const { ctx } = F;
  const natural = measure(F, value, style);
  let sx = style.sx ?? 1;
  if (style.maxWidth && natural * sx > style.maxWidth) sx = style.maxWidth / Math.max(1, natural);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, 1);
  const { sx: _a, maxWidth: _b, ...rest } = style;
  text(F, value, 0, 0, rest);
  ctx.restore();
  return natural * sx;
}

/** A lattice of thin gap lines (the dot-matrix mask): cells of `cell` units, gaps of `gap` units. */
export function lattice(F: Frame, x: number, y: number, w: number, h: number, cell: number, gap: number, color: string, alpha: number) {
  const { ctx } = F;
  if (!(alpha > .004)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.beginPath();
  for (let px = x + cell - gap / 2; px < x + w; px += cell) { ctx.moveTo(px, y); ctx.lineTo(px, y + h); }
  for (let py = y + cell - gap / 2; py < y + h; py += cell) { ctx.moveTo(x, py); ctx.lineTo(x + w, py); }
  ctx.globalAlpha = clamp(alpha);
  ctx.strokeStyle = color;
  ctx.lineWidth = gap;
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

const layers = new Map<string, Surface | null>();

/**
 * A static layer painted once per output size (cache key = look + pixel size) and blitted 1:1.
 * `paint` receives a context already scaled to the 540 x 960 canvas space.
 */
export function staticLayer(F: Frame, key: string, paint: (g: CanvasRenderingContext2D) => void): boolean {
  const width = Math.round(F.ctx.canvas.width), height = Math.round(F.ctx.canvas.height);
  const id = `${key}|${width}x${height}`;
  let layer = layers.get(id);
  if (layer === undefined) {
    layer = makeSurface(width, height);
    const g = layer && surfaceContext(layer);
    if (layer && g) {
      g.scale(width / 540, height / 960);
      paint(g);
    } else layer = null;
    if (layers.size > 24) layers.delete(layers.keys().next().value as string);
    layers.set(id, layer);
  }
  if (!layer) return false;
  F.ctx.globalAlpha = 1;
  F.ctx.drawImage(layer as CanvasImageSource, 0, 0, 540, 960);
  return true;
}

/** Pitch range used to lay notes out across the roll (padded, never narrower than `minSpan`). */
export function pitchRange(F: Frame, minSpan = 24): { lo: number; hi: number } {
  const index = F.notes;
  let lo = index.n ? index.minPitch : 48, hi = index.n ? index.maxPitch : 72;
  lo -= 1; hi += 1;
  if (hi - lo < minSpan) { const mid = (lo + hi) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  return { lo, hi };
}

/** Parts shown in a roll: everything but drums when there is something melodic (drums drive the hit pulse instead). */
export function rollTracks(F: Frame): TrackView[] {
  const melodic = F.tracks.filter(track => trackRole(track) !== 'drums');
  return melodic.length ? melodic : F.tracks;
}

export interface RollGeo {
  x: number; y: number; w: number; h: number;
  /** Absolute y of the playhead (time flows downward: the future is above, the past below). */
  headY: number;
  /** Canvas units per beat. */
  beatPx: number;
  /** Cell size used to snap notes to the dot grid (0 = no snapping). */
  cell: number;
  /** Horizontal padding inside the roll. */
  pad: number;
}

export interface RollNote {
  track: TrackView;
  slot: number;
  note: VNote;
  x: number;
  top: number;
  bottom: number;
  /** Seconds since the note started (negative while it is still to come). */
  age: number;
}

export const rollX = (geo: RollGeo, range: { lo: number; hi: number }, pitch: number) => geo.x + geo.pad + clamp((pitch - range.lo) / (range.hi - range.lo)) * (geo.w - geo.pad * 2);

/** Calls `visit` for every note of `tracks` inside the roll's time window, back to front. */
export function rollNotes(F: Frame, geo: RollGeo, tracks: TrackView[], visit: (item: RollNote) => void) {
  const range = pitchRange(F);
  const pastTicks = (geo.y + geo.h - geo.headY) / geo.beatPx * F.beat;
  const futureTicks = (geo.headY - geo.y) / geo.beatPx * F.beat;
  const perTick = geo.beatPx / F.beat;
  for (let ti = 0; ti < tracks.length; ti++) {
    const track = tracks[ti];
    for (const note of windowNotes(F, track.index, pastTicks, futureTicks, 260)) {
      let x = rollX(geo, range, note.pitch);
      if (geo.cell > 0) x = geo.x + Math.round((x - geo.x) / geo.cell) * geo.cell;
      let top = geo.headY - (note.end - F.tick) * perTick;
      let bottom = geo.headY - (note.pos - F.tick) * perTick;
      if (geo.cell > 0) {
        top = geo.headY + Math.round((top - geo.headY) / geo.cell) * geo.cell;
        bottom = geo.headY + Math.round((bottom - geo.headY) / geo.cell) * geo.cell;
      }
      visit({ track, slot: ti, note, x, top, bottom, age: (F.tick - note.pos) / F.tps });
    }
  }
}

/** Faint vertical lanes on the black-key columns plus beat / bar lines of the roll. */
export function rollGrid(F: Frame, geo: RollGeo, laneColor: string, laneAlpha: number, beatColor: string, beatAlpha: number, barAlpha: number, laneWidth = 1) {
  const { ctx } = F;
  const range = pitchRange(F);
  ctx.save();
  ctx.beginPath();
  ctx.rect(geo.x, geo.y, geo.w, geo.h);
  ctx.clip();
  if (laneAlpha > 0) {
    ctx.fillStyle = laneColor;
    ctx.globalAlpha = laneAlpha;
    for (let p = Math.ceil(range.lo); p <= range.hi; p++) {
      const pc = ((p % 12) + 12) % 12;
      if (pc !== 1 && pc !== 3 && pc !== 6 && pc !== 8 && pc !== 10) continue;
      const x = rollX(geo, range, p);
      ctx.fillRect(x - laneWidth / 2, geo.y, laneWidth, geo.h);
    }
  }
  // time lines: every beat, stronger on bars; they scroll with the clock
  const perBeat = geo.beatPx;
  const first = Math.floor((F.tick - (geo.y + geo.h - geo.headY) / perBeat * F.beat) / F.beat) - 1;
  const last = Math.ceil((F.tick + (geo.headY - geo.y) / perBeat * F.beat) / F.beat) + 1;
  ctx.strokeStyle = beatColor;
  for (let b = first; b <= last; b++) {
    const y = geo.headY - (b * F.beat - F.tick) / F.beat * perBeat;
    if (y < geo.y || y > geo.y + geo.h) continue;
    const bar = ((b % 4) + 4) % 4 === 0;
    ctx.globalAlpha = bar ? barAlpha : beatAlpha;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(geo.x, Math.round(y) + .5);
    ctx.lineTo(geo.x + geo.w, Math.round(y) + .5);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// --- horizontal rolls (time flows leftwards, playhead at a fixed x), used by the "window" looks.

export interface HRollGeo {
  x: number; y: number; w: number; h: number;
  headX: number;
  beatPx: number;
}

export interface HRollNote {
  track: TrackView;
  slot: number;
  note: VNote;
  left: number;
  right: number;
  /** Row centre. */
  y: number;
  rowH: number;
  age: number;
}

/** Whole-pitch range (inclusive) of the scene, at least `minRows` rows tall. */
export function pitchRows(F: Frame, minRows = 12): { lo: number; hi: number; rows: number } {
  const index = F.notes;
  let lo = index.n ? Math.round(index.minPitch) : 48, hi = index.n ? Math.round(index.maxPitch) : 72;
  if (hi - lo + 1 < minRows) {
    const extra = minRows - (hi - lo + 1);
    lo -= Math.floor(extra / 2); hi += Math.ceil(extra / 2);
  }
  return { lo, hi, rows: hi - lo + 1 };
}

export const rowCentre = (geo: { y: number; h: number }, range: { lo: number; rows: number }, pitch: number) => geo.y + geo.h - (pitch - range.lo + .5) * (geo.h / range.rows);

export function hRollNotes(F: Frame, geo: HRollGeo, tracks: TrackView[], range: { lo: number; hi: number; rows: number }, visit: (item: HRollNote) => void) {
  const perTick = geo.beatPx / F.beat;
  const pastTicks = (geo.headX - geo.x) / perTick;
  const futureTicks = (geo.x + geo.w - geo.headX) / perTick;
  const rowH = geo.h / range.rows;
  for (let ti = 0; ti < tracks.length; ti++) {
    const track = tracks[ti];
    for (const note of windowNotes(F, track.index, pastTicks, futureTicks, 420)) {
      visit({
        track, slot: ti, note,
        left: geo.headX + (note.pos - F.tick) * perTick,
        right: geo.headX + (note.end - F.tick) * perTick,
        y: rowCentre(geo, range, Math.round(note.pitch)), rowH, age: (F.tick - note.pos) / F.tps,
      });
    }
  }
}

// --- a whole-clip loudness overview (waveform bars), cached per audio analysis / scene.

const overviews = new WeakMap<object, { key: string; data: Float32Array }>();

export function waveformOverview(F: Frame, count: number): Float32Array {
  const analysis = F.audio.analysis;
  const owner: object = analysis || F.notes;
  const key = `${count}|${F.total}|${F.tps}|${analysis ? 'a' : 'm'}`;
  const known = overviews.get(owner);
  if (known && known.key === key) return known.data;
  const out = new Float32Array(count);
  if (analysis && analysis.peaks.length) {
    const n = analysis.peaks.length;
    for (let i = 0; i < count; i++) {
      const a = Math.floor(i / count * n), b = Math.max(a + 1, Math.floor((i + 1) / count * n));
      let m = 0;
      for (let j = a; j < b && j < n; j++) if (analysis.peaks[j] > m) m = analysis.peaks[j];
      out[i] = m;
    }
  } else {
    const seconds = F.total / F.tps;
    for (let i = 0; i < count; i++) {
      const frame = audioAt(F, (i + .5) / count * seconds - F.meta.seconds + 1e-6);
      // notes alone give a plateau; transients and a deterministic ripple make it read like a waveform
      out[i] = (frame.level * .5 + frame.transient * .55 + frame.bass * .25) * (.82 + .36 * hash(i, 77));
    }
  }
  let peak = 0;
  for (let i = 0; i < count; i++) if (out[i] > peak) peak = out[i];
  for (let i = 0; i < count; i++) out[i] = peak > 1e-4 ? (out[i] / peak) ** (analysis ? .8 : 1.15) : 0;
  if (owner) overviews.set(owner, { key, data: out });
  return out;
}

/** Traffic-light window chrome (static layer helper). Coordinates in whatever space `g` is scaled to. */
export interface WindowTheme {
  bar: string; body: string; line: string; title: string;
  shadow: string;
}

export function macWindow(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, barH: number, title: string, theme: WindowTheme, px: number, font: string, radius = 14, titleSize = 15) {
  const path = () => { g.beginPath(); roundedRect(g, x, y, w, h, radius); };
  for (const [blur, offset, alpha] of [[34, 14, 1], [9, 3, .8]]) {
    g.save();
    g.shadowColor = theme.shadow.replace(/[\d.]+\)$/, `${(parseFloat(theme.shadow.slice(theme.shadow.lastIndexOf(',') + 1)) * alpha).toFixed(3)})`);
    g.shadowBlur = blur * px;
    g.shadowOffsetY = offset * px;
    path();
    g.fillStyle = theme.body;
    g.fill();
    g.restore();
  }
  g.save();
  path();
  g.clip();
  g.fillStyle = theme.body;
  g.fillRect(x, y, w, h);
  g.fillStyle = theme.bar;
  g.fillRect(x, y, w, barH);
  g.fillStyle = theme.line;
  g.fillRect(x, y + barH, w, 1);
  g.restore();
  path();
  g.strokeStyle = theme.line;
  g.lineWidth = 1;
  g.stroke();
  const cy = y + barH / 2 + (barH > 38 ? -.5 : -1);
  ['#fb5f56', '#f9bc2c', '#33c748'].forEach((color, i) => {
    g.beginPath();
    g.arc(x + 26 + i * 20, cy, 6.5, 0, TAU);
    g.fillStyle = color;
    g.fill();
  });
  g.fillStyle = theme.title;
  g.font = `400 ${titleSize}px ${font}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(title, x + 94, cy + 1);
}
