import { clamp } from '../frame';
import type { Frame } from '../frame';
import { fill, grain, rand } from '../kit';
import { audioAround, levelOf, newSurface, sceneOwner } from './_c';
import type { AnySurface } from './_c';
import type { Look } from './types';

// A photograph of a DAW window on an old LCD: an overview waveform and a blocky spectrogram of the whole clip
// (static, drawn on a coarse "cell" grid, blurred, seen through a dot lattice with colour fringes, slightly
// keystoned) with a playhead sweeping across it.

// content grid, 1 cell = one LCD dot
const CW = 197, CH = 169;
const WAVE_L = 5, WAVE_R = 197, WAVE_TOP = 17, WAVE_BOTTOM = 93, WAVE_MID = 55.6;
const SPEC_TOP = 98, SPEC_ROWS = 15, SPEC_ROW_H = 4, SPEC_COLS = 27, SPEC_COL_W = 7;
const BARS = WAVE_R - WAVE_L;

// screen quad in canvas space (540 x 960)
const QL = 11, QR = 527, QT_L = 257, QT_R = 241.5, QB_L = 694, QB_R = 690;

interface Data { top: Float32Array; bottom: Float32Array; spec: Float32Array }
const dataCache = new WeakMap<object, { key: string; data: Data }>();

function sceneData(F: Frame): Data {
  const owner = sceneOwner(F);
  const duration = Math.max(.1, F.meta.duration);
  const key = `${duration.toFixed(2)}|${F.total}`;
  const known = dataCache.get(owner);
  if (known && known.key === key) return known.data;
  const top = new Float32Array(BARS), bottom = new Float32Array(BARS);
  const peak = (i: number, side: number) => {
    // occasional tall spikes, as in a peak-hold waveform
    const r = rand(i * 7 + side, 31);
    return r > .78 ? (r - .78) / .22 : 0;
  };
  for (let i = 0; i < BARS; i++) {
    const t = (i + .5) / BARS * duration - F.meta.seconds;
    const a = audioAround(F, t);
    const level = levelOf(F, a);
    const base = level ** .85 * 21;
    const shape = 1 + .5 * (rand(i, 5) - .5);
    top[i] = Math.min(36, base * shape + a.transient * 9 + level * 9 * peak(i, 0) + 1);
    bottom[i] = Math.min(36, base * (1 + .5 * (rand(i, 6) - .5)) + a.transient * 6 + level * 9 * peak(i, 1) + 1);
  }
  const spec = new Float32Array(SPEC_COLS * SPEC_ROWS);
  for (let c = 0; c < SPEC_COLS; c++) {
    const t0 = c / SPEC_COLS * duration, t1 = (c + 1) / SPEC_COLS * duration;
    const sample = [audioAround(F, t0 + (t1 - t0) * .25 - F.meta.seconds), audioAround(F, t0 + (t1 - t0) * .75 - F.meta.seconds)];
    for (let r = 0; r < SPEC_ROWS; r++) {
      const from = Math.floor((r / SPEC_ROWS) ** 1.25 * 31), to = Math.max(from + 1, Math.floor(((r + 1) / SPEC_ROWS) ** 1.25 * 31) + 1);
      let v = 0;
      for (const a of sample) for (let b = from; b < Math.min(32, to); b++) v = Math.max(v, a.spectrum[b]);
      spec[c * SPEC_ROWS + r] = v;
    }
  }
  const data = { top, bottom, spec };
  dataCache.set(owner, { key, data });
  return data;
}

const STOPS: [number, number, number, number][] = [
  [0, 30, 43, 56], [.3, 42, 62, 82], [.55, 58, 92, 118], [.75, 82, 128, 148], [.9, 120, 160, 160], [.96, 185, 185, 140], [1, 236, 228, 172],
];
function ramp(v: number): string {
  const x = clamp(v);
  let k = 1;
  while (k < STOPS.length - 1 && STOPS[k][0] < x) k++;
  const a = STOPS[k - 1], b = STOPS[k], t = (x - a[0]) / (b[0] - a[0] || 1);
  return `rgb(${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)},${Math.round(a[3] + (b[3] - a[3]) * t)})`;
}

// ---- content layers, painted on the cell grid
function paintBase(g: CanvasRenderingContext2D, data: Data) {
  g.fillStyle = '#1b1e22';
  g.fillRect(0, 0, CW, CH);
  // window
  g.fillStyle = '#40434a';
  g.fillRect(2, 2, 193, 7); // title bar
  g.fillStyle = '#393c45';
  g.fillRect(2, 9, 193, 8.5); // toolbar
  const wave = g.createLinearGradient(0, 17, 0, 96);
  wave.addColorStop(0, '#33363d');
  wave.addColorStop(1, '#282b31');
  g.fillStyle = wave;
  g.fillRect(2, 17.5, 193, 79);
  g.fillStyle = '#1a212a';
  g.fillRect(2, 96.5, 193, 63);
  g.fillStyle = '#2c2f35';
  g.fillRect(2, 159.5, 193, 8);
  // traffic lights
  for (const [x, color] of [[6.7, '#c05a55'], [10.4, '#c79a3a'], [14.2, '#57a95f']] as [number, string][]) {
    g.fillStyle = color;
    g.beginPath(); g.arc(x, 6, 1.6, 0, Math.PI * 2); g.fill();
  }
  // menu entries
  g.fillStyle = '#8c9098';
  for (const [x0, x1] of [[23, 30], [40, 49.6], [57, 69.6], [74.5, 86], [92, 100.6], [109.6, 122.3], [127.5, 138]]) g.fillRect(x0, 5.2, x1 - x0, 1.6);
  // toolbar buttons
  g.fillStyle = '#5b5e68';
  for (let i = 0; i < 7; i++) g.fillRect(6 + i * 8.5, 12, 5.4, 4);
  // bottom buttons
  g.fillStyle = '#5f626b';
  for (const x of [6, 13.3, 20.3, 27.5, 34.8, 42]) g.fillRect(x, 162, 4.4, 4);
  // spectrogram blocks
  for (let c = 0; c < SPEC_COLS; c++) {
    for (let r = 0; r < SPEC_ROWS; r++) {
      const raw = data.spec[c * SPEC_ROWS + r];
      const glow = .15 + .08 * (r / SPEC_ROWS) * 2 + .12 * (rand(c, r + 40) - .3);
      const v = clamp(Math.max(glow, raw ** 2.4 * .97));
      g.fillStyle = ramp(v);
      g.fillRect(WAVE_L + c * SPEC_COL_W, SPEC_TOP + (SPEC_ROWS - 1 - r) * SPEC_ROW_H, SPEC_COL_W, SPEC_ROW_H);
    }
  }
}

// Bars are thin lines inside their cell, so this layer is painted three times wider than the cell grid.
const BAR_X = 3;
function paintBars(g: CanvasRenderingContext2D, data: Data, color: string) {
  g.fillStyle = color;
  for (let i = 0; i < BARS; i++) {
    const t = data.top[i], b = data.bottom[i];
    g.fillRect((WAVE_L + i) * BAR_X + 1.1, WAVE_MID - t, .8, t + b);
  }
}

// ---- lattice, quad mapping
function drawQuad(g: CanvasRenderingContext2D, source: AnySurface, slices: number, xs = 1) {
  const sw = CW * xs / slices;
  for (let i = 0; i < slices; i++) {
    const u = (i + .5) / slices;
    const x = QL + (QR - QL) * (i / slices), w = (QR - QL) / slices;
    const top = QT_L + (QT_R - QT_L) * u, bottom = QB_L + (QB_R - QB_L) * u;
    g.drawImage(source as unknown as CanvasImageSource, i * sw, 0, sw, CH, x, top, w + .7, bottom - top);
  }
}

function soften(g: CanvasRenderingContext2D, source: AnySurface, radius: number, width: number, height: number, alpha = 1) {
  // cheap blur: five offset copies averaged with running alpha
  const offsets: [number, number][] = [[0, 0], [radius, 0], [-radius, 0], [0, radius], [-radius, 0 - radius]];
  offsets.forEach(([dx, dy], k) => {
    g.globalAlpha = alpha / (k + 1);
    g.drawImage(source as unknown as CanvasImageSource, 0, 0, width, height, dx, dy, width, height);
  });
  g.globalAlpha = 1;
}

function latticeTile(pitch: number): AnySurface | null {
  const n = Math.max(2, Math.round(pitch * 4));
  const made = newSurface(n, n);
  if (!made) return null;
  const { surface, g } = made;
  const cell = n / 4;
  g.fillStyle = '#5a5a5a';
  g.fillRect(0, 0, n, n);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const cx = (x + .5) * cell, cy = (y + .5) * cell;
      const gradient = g.createRadialGradient(cx, cy, 0, cx, cy, cell * .72);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(.55, '#f2f2f2');
      gradient.addColorStop(1, '#6a6a6a');
      g.fillStyle = gradient;
      g.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  return surface;
}

const screens = new WeakMap<object, Map<string, AnySurface | null>>();

function screenFor(F: Frame, data: Data): AnySurface | null {
  const owner = sceneOwner(F);
  const width = F.ctx.canvas.width, height = F.ctx.canvas.height;
  const key = `${width}x${height}|${F.meta.duration.toFixed(2)}|${F.total}`;
  let perOwner = screens.get(owner);
  if (!perOwner) { perOwner = new Map(); screens.set(owner, perOwner); }
  if (perOwner.has(key)) return perOwner.get(key) || null;
  const out = renderScreen(width, height, data);
  if (perOwner.size > 4) perOwner.clear();
  perOwner.set(key, out);
  return out;
}

function renderScreen(width: number, height: number, data: Data): AnySurface | null {
  const final = newSurface(width, height);
  const cells = newSurface(CW, CH), bars = newSurface(CW * BAR_X, CH), temp = newSurface(width, height);
  if (!final || !cells || !bars || !temp) return null;
  const sx = width / 540, sy = height / 960;
  const g = final.g, t = temp.g;
  g.setTransform(sx, 0, 0, sy, 0, 0);
  t.setTransform(sx, 0, 0, sy, 0, 0);
  g.imageSmoothingEnabled = true;
  t.imageSmoothingEnabled = true;
  const blur = Math.max(.5, .8 * sx);
  const slices = Math.min(CW, Math.max(60, Math.round(width / 3.5)));

  // 1. base content -> quad -> softened
  paintBase(cells.g, data);
  cells.g.imageSmoothingEnabled = false;
  t.setTransform(sx, 0, 0, sy, 0, 0);
  t.clearRect(-2, -2, 544, 964);
  drawQuad(t, cells.surface, slices);
  g.fillStyle = '#090b0d';
  g.fillRect(-2, -2, 544, 964);
  // light spilling out of the screen
  const halo = g.createRadialGradient(290, 300, 20, 290, 300, 330);
  halo.addColorStop(0, 'rgba(70,78,88,0.5)');
  halo.addColorStop(.45, 'rgba(34,39,45,0.32)');
  halo.addColorStop(1, 'rgba(9,11,13,0)');
  g.fillStyle = halo;
  g.fillRect(-2, -2, 544, 964);
  g.setTransform(1, 0, 0, 1, 0, 0);
  t.setTransform(1, 0, 0, 1, 0, 0);
  soften(g, temp.surface, blur, width, height);

  // 2. the waveform with colour fringes: cyan left, red right, mint body
  const tint = (color: string, dx: number, alpha: number) => {
    bars.g.clearRect(0, 0, CW * BAR_X, CH);
    paintBars(bars.g, data, color);
    t.setTransform(sx, 0, 0, sy, 0, 0);
    t.clearRect(-2, -2, 544, 964);
    drawQuad(t, bars.surface, slices, BAR_X);
    t.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = alpha;
    g.drawImage(temp.surface as unknown as CanvasImageSource, dx * sx, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  };
  tint('#5fe0d4', -.5 * sx, .55);
  tint('#e05068', .5 * sx, .42);
  tint('#8fd6c2', 0, .95);

  // 3. dot lattice over the screen area
  if (width >= 360) {
    const tile = latticeTile(3.5 * width / 720);
    const pattern = tile ? g.createPattern(tile as unknown as CanvasImageSource, 'repeat') : null;
    if (pattern) {
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = pattern;
      g.fillRect(QL * sx, Math.min(QT_L, QT_R) * sy - 4, (QR - QL) * sx, (Math.max(QB_L, QB_R) - Math.min(QT_L, QT_R)) * sy + 8);
      g.globalCompositeOperation = 'source-over';
    }
  }

  // 4. camera vignette
  const vignette = g.createRadialGradient(width / 2, height * .5, height * .22, width / 2, height * .5, height * .72);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.62)');
  g.fillStyle = vignette;
  g.fillRect(0, 0, width, height);
  return final.surface;
}

export const monitor: Look = {
  id: 'monitor',
  group: 'audio',
  nameRu: 'Монитор',
  nameEn: 'Monitor',
  descriptionRu: 'Окно секвенсора на старом мониторе: волна, спектр и бегущая линия',
  descriptionEn: 'A sequencer window on an old monitor: waveform, spectrogram and a sweeping playhead',
  draw(F) {
    const { ctx } = F;
    const data = sceneData(F);
    const screen = screenFor(F, data);
    if (screen) {
      ctx.globalAlpha = 1;
      ctx.drawImage(screen as unknown as CanvasImageSource, 0, 0, F.ctx.canvas.width, F.ctx.canvas.height, 0, 0, 540, 960);
    } else fill(F, '#0b0d10');

    // playhead: progress through the clip, with the same fringes as the bars
    const progress = F.meta.duration > 0 ? clamp(F.meta.seconds / F.meta.duration) : 0;
    const cx = WAVE_L + progress * (WAVE_R - WAVE_L);
    const u = cx / CW;
    const x = QL + (QR - QL) * u;
    const top = QT_L + (QT_R - QT_L) * u, bottom = QB_L + (QB_R - QB_L) * u;
    const y0 = top + (bottom - top) * (16.5 / CH), y1 = top + (bottom - top) * (159 / CH);
    ctx.lineCap = 'butt';
    for (const [dx, color, alpha, width] of [[-.7, '#35e6d0', .75, 1], [.7, '#ff4f78', .7, 1], [0, '#e8f6f4', .5, .8]] as [number, string, number, number][]) {
      ctx.beginPath();
      ctx.moveTo(x + dx, y0);
      ctx.lineTo(x + dx, y1);
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // a little sensor noise, different every frame
    grain(F, .4, '#c8d4e0', Math.floor(F.meta.seconds * 30));
  },
};
