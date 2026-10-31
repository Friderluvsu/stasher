import { audioAt, clamp, loopT, makeSurface, surfaceContext, TAU } from '../frame';
import { H, noise2, rand, W } from '../kit';
import type { Look } from './types';

// Ink stippling on paper: a fixed pool of dots, each with its own threshold; a lumpy shaded shape
// (driven by the sound) decides which dots are inked, so the form morphs while the dots stay put.
const GRID = 6, GX = Math.ceil(W / GRID) + 1, GY = Math.ceil(H / GRID) + 1;
const X0 = 70, X1 = 480, Y0 = 170, Y1 = 760;
const POOL = 42000;
const CLS_END = [Math.round(POOL * .5), Math.round(POOL * .85), POOL];
const mass = new Float32Array(GX * GY);

interface Dots { x: Float32Array; y: Float32Array; t: Float32Array; cls: Uint8Array }
let dots: Dots | null = null;
let paper: ReturnType<typeof makeSurface> = null;

function pool(): Dots {
  if (dots) return dots;
  const d: Dots = { x: new Float32Array(POOL), y: new Float32Array(POOL), t: new Float32Array(POOL), cls: new Uint8Array(POOL) };
  for (let i = 0; i < POOL; i++) {
    d.x[i] = X0 + rand(i, 1) * (X1 - X0);
    d.y[i] = Y0 + rand(i, 2) * (Y1 - Y0);
    d.t[i] = rand(i, 3);
    d.cls[i] = i < CLS_END[0] ? 0 : i < CLS_END[1] ? 1 : 2;
  }
  return (dots = d);
}

function buildPaper(): ReturnType<typeof makeSurface> {
  const s = makeSurface(W, H);
  const g = s && surfaceContext(s);
  if (!s || !g) return null;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#f6f6f1'); grad.addColorStop(.45, '#efefe9'); grad.addColorStop(1, '#e9e9e2');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 5000; i++) {
    g.globalAlpha = .03 + .05 * rand(i, 11);
    g.fillStyle = rand(i, 12) < .5 ? '#6f6f66' : '#ffffff';
    g.fillRect(rand(i, 13) * W, rand(i, 14) * H, 1 + rand(i, 15), 1);
  }
  g.globalAlpha = 1;
  return s;
}

const BANDS: [number, number][] = [[0, 3], [3, 7], [7, 12], [12, 18], [18, 25], [25, 32]];
// lobe anchors (x, y, radius) in canvas px
const LOBES: [number, number, number][] = [[215, 340, 75], [335, 410, 60], [262, 480, 90], [235, 620, 78], [320, 565, 72], [205, 500, 62]];

function bandEnergy(spec: Float32Array, [a, b]: [number, number]) {
  let peak = 0;
  for (let i = a; i < b; i++) peak = Math.max(peak, spec[i]);
  return peak;
}

export const stipple: Look = {
  id: 'stipple',
  group: 'audio',
  nameRu: 'Пунктир',
  nameEn: 'Stipple',
  descriptionRu: 'Чернильные точки на бумаге складываются в комок, который меняет форму вместе со звуком',
  descriptionEn: 'Ink dots on paper gather into a shaded lump that changes shape with the sound',
  draw(F) {
    const { ctx } = F;
    if (!paper) paper = buildPaper();
    ctx.globalAlpha = 1;
    if (paper) ctx.drawImage(paper, 0, 0, W, H); else { ctx.fillStyle = '#eeeee8'; ctx.fillRect(0, 0, W, H); }

    const d = pool();
    const phase = loopT(F, 8) * TAU;
    const snaps = [F.audio, audioAt(F, -.05), audioAt(F, -.1)];
    const e = BANDS.map(b => clamp(snaps.reduce((s, a, i) => s + bandEnergy(a.spectrum, b) * (i ? 1 : 1.3), 0) / 3.3));
    const breathe = .06 * F.audio.bass + .05 * F.hit;

    // coarse mass field
    const cur = LOBES.map(([x, y, r], k) => {
      const sway = 14 * Math.sin(phase + k * 1.3), sway2 = 10 * Math.cos(phase * 2 + k * .9);
      return { x: x + sway, y: y + sway2, r: r * 1.02 * (.9 + .24 * e[k] + breathe), r2: 0 };
    });
    const t = F.meta.seconds;
    for (const c of cur) c.r2 = c.r * c.r * 2.2;
    for (let gy = 0; gy < GY; gy++) {
      const y = gy * GRID;
      if (y < Y0 - 40 || y > Y1 + 40) { for (let gx = 0; gx < GX; gx++) mass[gy * GX + gx] = 0; continue; }
      for (let gx = 0; gx < GX; gx++) {
        const x = gx * GRID;
        let m = 0;
        for (const c of cur) {
          const q = ((x - c.x) ** 2 + (y - c.y) ** 2) / c.r2;
          if (q < 1) { const k = 1 - q; m += k * k * 1.15; }
        }
        if (m > 0) m += .22 * noise2(x * .02 + t * .1, y * .02, 4) * Math.min(1, m * 2);
        mass[gy * GX + gx] = m;
      }
    }

    const stride = F.thumb ? 3 : 1;
    ctx.fillStyle = '#16161a';
    const sizes = [.95, 1.35, 1.8], alphas = [.55, .8, .95];
    for (let cls = 0; cls < 3; cls++) {
      ctx.beginPath();
      const sz = sizes[cls];
      for (let i = cls ? CLS_END[cls - 1] : 0; i < CLS_END[cls]; i += stride) {
        const x = d.x[i], y = d.y[i];
        const fx = x / GRID, fy = y / GRID, ix = fx | 0, iy = fy | 0, u = fx - ix, v = fy - iy;
        const o = iy * GX + ix;
        const m00 = mass[o], m10 = mass[o + 1], m01 = mass[o + GX], m11 = mass[o + GX + 1];
        const m = (m00 * (1 - u) + m10 * u) * (1 - v) + (m01 * (1 - u) + m11 * u) * v;
        if (m < .12) continue;
        const gxv = (m10 - m00 + m11 - m01) * .5, gyv = (m01 - m00 + m11 - m10) * .5;
        const shade = clamp(.5 + 7 * gxv - 2 * gyv);
        const dens = clamp((m - .12) / .3) * (.1 + 1.05 * shade);
        if (dens > d.t[i]) ctx.rect(x, y, sz, sz);
      }
      ctx.globalAlpha = alphas[cls];
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    void H;
  },
};
