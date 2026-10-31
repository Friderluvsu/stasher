import { blendBands, clamp, TAU, type Frame, type TrackView } from '../frame';
import { audioAt } from '../frame';
import type { AudioAnalysis } from '../../../services/audioAnalysis';
import { ease, fill, lerp, MONO, noteLabel, rand, text, trackRole } from '../kit';
import type { Look } from './types';

// A wireframe box (time left to right, pitch up, brightness into the depth) with every note of the parts that have
// started as a ringed point; consecutive notes of a part are joined into a polyline. Played notes are lit, notes still to
// come are dim; the live spectrum is a string of dots on the diagonal of the current time slice. A spectrogram strip
// with the playhead sits underneath. Drawn in the reference's 720 x 1280 space.

const K = .75;
const BG = '#040506';
const BOX_X0 = 75, BOX_W = 476, BOX_Y1 = 1112, BOX_H = 722, DEPTH_X = 117, DEPTH_Y = 233;
const STRIP = { x: 40, y: 1138, w: 640, h: 54, cols: 32, rows: 6 };
const COLORS = ['#f0a52e', '#2cc4b4', '#e86a4a', '#9a8cf2', '#82c95a', '#e068b0', '#4fa6f0', '#d6c34a'];
const GRID = '#2b3031';
const LABEL = '#5f6465';

const P = (x: number, y: number, z = 0): [number, number] => [BOX_X0 + BOX_W * x + DEPTH_X * z, BOX_Y1 - BOX_H * y - DEPTH_Y * z];

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function mixHex(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const c = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

interface Joined { track: TrackView; weight: number; color: string }

function joinedTracks(F: Frame): Joined[] {
  const list: Joined[] = [];
  for (const track of F.tracks) {
    const first = track.index.firstPos;
    if (!track.index.n || F.tick < first) continue;
    list.push({ track, weight: ease.outCubic((F.tick - first) / (F.beat * 1.2)), color: COLORS[track.slot % COLORS.length] });
  }
  // melodic parts only (at most three); drums only when there is nothing else
  const melodic = list.filter(item => trackRole(item.track) !== 'drums');
  const pool = melodic.length ? melodic : list;
  const keep = new Set(pool.slice().sort((a, b) => b.track.index.n - a.track.index.n).slice(0, 3));
  return pool.filter(item => keep.has(item)).sort((a, b) => a.track.index.firstPos - b.track.index.firstPos);
}

function rangeOf(list: Joined[]): [number, number] {
  let lo = 48, hi = 72, started = false;
  for (const { track, weight } of list) {
    const tl = track.index.minPitch, th = track.index.maxPitch;
    if (!started) { lo = tl; hi = th; started = true; continue; }
    lo = lerp(lo, Math.min(lo, tl), weight);
    hi = lerp(hi, Math.max(hi, th), weight);
  }
  if (hi - lo < 12) { const m = (hi + lo) / 2; lo = m - 6; hi = m + 6; }
  return [lo, hi];
}

// --- spectrogram strip (whole clip), cached per analysis / note set

const stripCache = new WeakMap<object, Float32Array>();

function stripGrid(F: Frame): Float32Array {
  const source: object = F.audio.analysis ?? F.notes;
  const known = stripCache.get(source);
  if (known) return known;
  const { cols, rows } = STRIP;
  const grid = new Float32Array(cols * rows);
  const analysis = F.audio.analysis;
  const groups = [[0, 3], [3, 7], [7, 12], [12, 18], [18, 25], [25, 32]];
  const duration = Math.max(.01, F.meta.duration);
  for (let c = 0; c < cols; c++) {
    let bands: Float32Array;
    if (analysis) {
      bands = new Float32Array(32);
      const frames = analysis.spectrum.length / 32, from = Math.floor(c / cols * frames), to = Math.max(from + 1, Math.floor((c + 1) / cols * frames));
      for (let f = from; f < to && f < frames; f++) for (let b = 0; b < 32; b++) bands[b] += analysis.spectrum[f * 32 + b] / (to - from);
    } else bands = audioAt(F, (c + .5) / cols * duration - F.meta.seconds).spectrum;
    groups.forEach(([a, b], r) => {
      let peak = 0, sum = 0;
      for (let i = a; i < b; i++) { peak = Math.max(peak, bands[i]); sum += bands[i]; }
      grid[(rows - 1 - r) * cols + c] = clamp(peak * .6 + sum / (b - a) * .6);
    });
  }
  stripCache.set(source, grid);
  return grid;
}

const loudCache = new WeakMap<AudioAnalysis, number>();
function lufs(analysis: AudioAnalysis): number {
  const known = loudCache.get(analysis);
  if (known !== undefined) return known;
  let sum = 0;
  const n = Math.min(analysis.left.length, analysis.right.length);
  for (let i = 0; i < n; i++) { const l = analysis.left[i] / 32768, r = analysis.right[i] / 32768; sum += l * l + r * r; }
  const value = n ? -.691 + 10 * Math.log10(Math.max(1e-9, sum / n)) : -70;
  loudCache.set(analysis, value);
  return value;
}

function ring(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, alpha: number, dim: boolean) {
  g.globalAlpha = alpha;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = dim ? mixHex(color, '#000000', .55) : mixHex(color, '#101010', .35);
  g.fill();
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.6, r * .42);
  g.stroke();
  if (!dim) {
    g.beginPath();
    g.arc(x, y, Math.max(1, r * .32), 0, TAU);
    g.fillStyle = '#ffffff';
    g.fill();
  }
  g.globalAlpha = 1;
}

export const trajectory: Look = {
  id: 'trajectory',
  group: 'midi',
  nameRu: 'Траектория',
  nameEn: 'Trajectory',
  descriptionRu: 'Каркас-куб: ноты партий как точки с ломаными, сыгранные горят, а внизу спектрограмма',
  descriptionEn: 'A wireframe box with each part\'s notes as joined points: played ones light up, with a spectrogram below',
  draw(F) {
    const g = F.ctx;
    fill(F, BG);
    g.save();
    g.scale(K, K);

    const list = joinedTracks(F);
    const [lo, hi] = rangeOf(list);
    const yOf = (pitch: number) => clamp((pitch - lo) / (hi - lo)) * .94 + .03;
    const xNow = F.tick / F.total;

    // box
    g.strokeStyle = GRID;
    g.lineWidth = 1.3;
    g.beginPath();
    const poly = (pts: [number, number][]) => { g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); };
    poly([P(0, 0), P(1, 0), P(1, 1), P(0, 1), P(0, 0)]);
    poly([P(0, 1, 1), P(1, 1, 1), P(1, 0, 1), P(0, 0, 1), P(0, 1, 1)]);
    poly([P(0, 1), P(0, 1, 1)]);
    poly([P(1, 1), P(1, 1, 1)]);
    poly([P(1, 0), P(1, 0, 1)]);
    poly([P(0, 0), P(0, 0, 1)]);
    g.stroke();
    g.globalAlpha = .6;
    g.beginPath();
    for (const y of [.25, .5, .75]) poly([P(0, y), P(1, y)]);
    for (const x of [.25, .5, .75]) poly([P(x, 0), P(x, 0, 1)]);
    g.stroke();
    g.globalAlpha = 1;

    // scattered faint dots in the volume
    if (!F.thumb) {
      for (let i = 0; i < 46; i++) {
        const u = rand(i, 7) ** 1.4, x = rand(i, 8);
        const [px, py] = P(x, u * .96, u * .96);
        g.fillStyle = rgba('#27a597', .1 + .16 * rand(i, 9));
        g.beginPath();
        g.arc(px + (rand(i, 10) - .5) * 40, py + (rand(i, 11) - .5) * 40, 1.6 + 1.4 * rand(i, 12), 0, TAU);
        g.fill();
      }
    }

    // live spectrum on the diagonal of the current time slice
    {
      const [x0, y0] = P(xNow, 0, 0), [x1, y1] = P(xNow, 1, 1);
      g.strokeStyle = rgba('#2a8f86', .26);
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      const bands = blendBands(F, 16);
      for (let b = 0; b < 16; b++) {
        const u = (b + .5) / 16 * .96 + .02, level = bands[b];
        const [x, y] = P(xNow, u, u);
        const r = (1.6 + 8.2 * level ** .85) * (1 - u * .3);
        g.fillStyle = rgba('#25a79a', .22 + .55 * level);
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      }
    }

    // notes
    let counted = 0, played: { x: number; y: number; t: number } | null = null, upcoming: { x: number; y: number; t: number } | null = null;
    const playing: { x: number; y: number; env: number; color: string }[] = [];
    for (const { track, weight, color } of list) {
      const { index } = track;
      counted += index.n;
      const step = Math.max(1, Math.ceil(index.n / 260));
      const pts: { x: number; y: number; on: boolean; i: number }[] = [];
      for (let i = 0; i < index.n; i += step) {
        const [x, y] = P(index.pos[i] / F.total, yOf(index.pitch[i]));
        pts.push({ x, y, on: index.pos[i] <= F.tick, i });
      }
      // lines
      g.lineWidth = 2;
      g.lineJoin = 'round';
      for (let k = 1; k < pts.length; k++) {
        const bright = pts[k].on;
        g.globalAlpha = weight * (bright ? .85 : .42);
        g.strokeStyle = bright ? mixHex(color, '#000000', .38) : mixHex(color, '#000000', .6);
        g.beginPath();
        g.moveTo(pts[k - 1].x, pts[k - 1].y);
        g.lineTo(pts[k].x, pts[k].y);
        g.stroke();
      }
      g.globalAlpha = 1;
      for (const p of pts) {
        const i = p.i;
        const vel = index.vel[i];
        if (p.on) {
          ring(g, p.x, p.y, 3.3 + 1.4 * vel, color, weight, false);
          if (F.tick < index.end[i]) playing.push({ x: p.x, y: p.y, env: weight, color });
          if (!played || index.pos[i] > played.t) played = { x: p.x, y: p.y, t: index.pos[i] };
        } else {
          ring(g, p.x, p.y, 2.6 + 1 * vel, color, weight * .55, true);
          if (!upcoming || index.pos[i] < upcoming.t) upcoming = { x: p.x, y: p.y, t: index.pos[i] };
        }
      }
    }
    for (const p of playing) {
      const pulse = 1 + .08 * Math.sin(F.tick / F.beat * TAU);
      g.strokeStyle = '#ffffff';
      g.globalAlpha = .85 * p.env;
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(p.x, p.y, 11 * pulse, 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;
    const next = upcoming as { x: number; y: number; t: number } | null, last = played as { x: number; y: number; t: number } | null;
    if (next && last && next.t - F.tick < F.beat * 2.5) {
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 1.3;
      g.setLineDash([2.5, 3.5]);
      g.beginPath();
      g.moveTo(last.x, last.y);
      g.lineTo(next.x, next.y);
      g.stroke();
      g.setLineDash([]);
      g.beginPath();
      g.arc(next.x, next.y, 5.4, 0, TAU);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1.5;
      g.stroke();
    }

    // axis labels
    const label = { size: 12.5, font: MONO, color: LABEL, spacing: 1.8 };
    text(F, noteLabel(hi), 49, P(0, 1)[1] + 4, label);
    text(F, noteLabel(lo), 55, BOX_Y1 + 4, label);
    text(F, 'PITCH', 78, P(0, .5)[1] + 4, { ...label, size: 13.5, spacing: 2.4 });
    text(F, 'TIME', 296, 1138, { ...label, size: 13.5, spacing: 2.4 });
    text(F, 'BRIGHTNESS', 596, 997, { ...label, size: 13.5, spacing: 2.4 });

    // spectrogram strip
    {
      const grid = stripGrid(F), { x, y, w, h, cols, rows } = STRIP;
      const cw = w / cols, rh = h / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const v = grid[r * cols + c];
        g.fillStyle = mixHex('#0e0b1c', '#7258c8', clamp(v * .85) ** 1.9);
        g.fillRect(x + c * cw, y + r * rh, cw + .5, rh + .5);
      }
      g.fillStyle = '#ffffff';
      g.fillRect(x + w * xNow - 1.5, y - 1, 3, h + 2);
    }

    // header and footer
    const centroid = (() => {
      const bands = blendBands(F, 32);
      let a = 0, b = 0;
      for (let i = 0; i < 32; i++) { a += bands[i] * i; b += bands[i]; }
      return b > 1e-3 ? Math.round(a / b / 31 * 100) : 0;
    })();
    const minP = list.length ? Math.min(...list.map(item => item.track.index.minPitch)) : lo, maxP = list.length ? Math.max(...list.map(item => item.track.index.maxPitch)) : hi;
    text(F, `${F.meta.seconds.toFixed(1)} s  ·  RANGE ${noteLabel(minP)}–${noteLabel(maxP)}  ·  ${counted} NOTES  ·  BRIGHT ${centroid}`, 40, 104, { size: 14.5, font: MONO, color: '#74797a', spacing: 1.7, maxWidth: 640 });
    const foot = [F.meta.title.toUpperCase(), `${Math.round(F.meta.bpm)} BPM`, F.meta.key, F.audio.analysis ? `${lufs(F.audio.analysis).toFixed(1)} LUFS` : ''].filter(Boolean).join(' · ');
    text(F, foot, 40, 1225, { size: 13.5, font: MONO, color: '#6a6f70', spacing: 1.7, maxWidth: 640 });
    g.restore();
  },
};
