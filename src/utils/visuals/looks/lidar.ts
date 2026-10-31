import { audioAt, clamp, TAU } from '../frame';
import { H, rand, W } from '../kit';
import type { Look } from './types';

// A perspective floor of scan dashes (rows of round dots). The spectrum, mirrored around the centre
// (bass in the middle), raises a bright ridge through the rows; dashes under the ridge glow teal,
// the far ones stay dim blue. Strong onsets send an elliptical sweep ring across the floor.
const ROWS = 50;
const Y_FAR = 312, Y_NEAR = 812;
const CX = 270;
const rowT = (r: number) => r / (ROWS - 1);
const rowY = (t: number) => Y_FAR + (Y_NEAR - Y_FAR) * t ** 1.2;
const radiusAt = (t: number) => .8 + 2.7 * t;
const spacingAt = (t: number) => 2.45 * radiusAt(t);
const rowWidth = (t: number) => W * (.4 + .72 * t);

interface Dash { row: number; u: number; n: number; v: number }
let layout: Dash[] | null = null;

function buildLayout(): Dash[] {
  const out: Dash[] = [];
  for (let r = 0; r < ROWS; r++) {
    const t = rowT(r), width = rowWidth(t), step = spacingAt(t);
    let x = -width / 2 + rand(r, 1) * 30;
    let k = 0;
    while (x < width / 2) {
      const n = 3 + Math.floor(rand(r * 97 + k, 2) ** 1.4 * 7);
      const len = n * step;
      if (rand(r * 97 + k, 3) < .92 - .6 * t) out.push({ row: r, u: (x + width / 2) / width, n, v: .45 + .55 * rand(r * 97 + k, 4) });
      x += len + step * (1.3 + rand(r * 97 + k, 5) * 4.5);
      k++;
    }
  }
  return (layout = out);
}

const SPEC = new Float32Array(64);

export const lidar: Look = {
  id: 'lidar',
  group: 'audio',
  nameRu: 'Лидар',
  nameEn: 'Lidar',
  descriptionRu: 'Точечная сетка в перспективе, где спектр поднимает светящийся гребень',
  descriptionEn: 'A perspective floor of dotted scan lines where the spectrum raises a glowing ridge',
  draw(F) {
    const { ctx } = F;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#02050b';
    ctx.fillRect(-2, -2, W + 4, H + 4);
    // soft haze over the floor
    const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    haze.addColorStop(0, 'rgba(18,52,96,.22)'); haze.addColorStop(1, 'rgba(18,52,96,0)');
    ctx.save();
    ctx.translate(CX, 540); ctx.scale(330, 330);
    ctx.fillStyle = haze; ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();

    const dashes = layout || buildLayout();
    const past = audioAt(F, -.06), past2 = audioAt(F, -.13);
    for (let i = 0; i < 32; i++) {
      const s = (F.audio.spectrum[i] * 1.5 + past.spectrum[i] + past2.spectrum[i] * .5) / 3;
      SPEC[i] = 1 - Math.exp(-s * 3.4);
    }
    const level = clamp(F.audio.level * .5 + F.hit * .5);
    const rowStep = 1 / (ROWS - 1);

    // buckets: [colour, alpha] -> list of dots
    type Bucket = { color: string; alpha: number; xs: number[]; ys: number[]; rs: number[] };
    const buckets = new Map<string, Bucket>();
    const add = (color: string, alpha: number, x: number, y: number, r: number) => {
      const key = `${color}|${Math.round(alpha * 12)}`;
      let b = buckets.get(key);
      if (!b) { b = { color, alpha: Math.round(alpha * 12) / 12, xs: [], ys: [], rs: [] }; buckets.set(key, b); }
      b.xs.push(x); b.ys.push(y); b.rs.push(r);
    };
    for (const d of dashes) {
      const t = rowT(d.row), width = rowWidth(t), step = spacingAt(t), r = radiusAt(t);
      const uc = d.u + d.n * step / width / 2;
      const band = Math.abs(uc - .5) * 2;
      const bin = Math.min(31, Math.floor(band ** 1.05 * 30));
      const e = SPEC[bin] * (.8 + .4 * d.v);
      const ridge = .6 - .22 * e + (rand(d.row, bin) - .5) * .015;
      const dist = (t - ridge) / rowStep;
      let color: string, alpha: number;
      if (Math.abs(dist) < 1.3 && e > .06) {
        color = t > .45 ? '#e2e6d2' : '#d6e8e6'; alpha = .75 + .25 * d.v;
      } else if (dist > 0) {
        const k = Math.exp(-dist / (3.5 + 3 * e));
        color = dist < 5 ? '#4cb4b0' : '#2f8aa8'; alpha = (.12 + .6 * k * (.5 + e)) * (.6 + .4 * d.v) * (1 - .55 * t);
      } else {
        const k = Math.exp(dist / 8);
        color = '#3470bc'; alpha = (.2 + .5 * k) * (.55 + .45 * d.v) * (.75 + .5 * level);
      }
      // fade the far edge of the floor and the nearest rows
      alpha *= clamp((t + .04) * 4) * clamp((1 - t) * 3.2 + .12);
      if (alpha < .035) continue;
      const x0 = CX - width / 2 + d.u * width;
      const y = rowY(t);
      for (let k = 0; k < d.n; k++) add(color, alpha, x0 + k * step, y, r);
    }
    for (const b of buckets.values()) {
      ctx.fillStyle = b.color;
      ctx.globalAlpha = b.alpha;
      ctx.beginPath();
      for (let i = 0; i < b.xs.length; i++) { ctx.moveTo(b.xs[i] + b.rs[i], b.ys[i]); ctx.arc(b.xs[i], b.ys[i], b.rs[i], 0, TAU); }
      ctx.fill();
      if (b.alpha > .6 && !F.thumb) {
        ctx.globalAlpha = .12;
        ctx.beginPath();
        for (let i = 0; i < b.xs.length; i++) { ctx.moveTo(b.xs[i] + b.rs[i] * 2, b.ys[i]); ctx.arc(b.xs[i], b.ys[i], b.rs[i] * 2, 0, TAU); }
        ctx.fill();
      }
    }

    // sweep ring on strong onsets
    if (F.onsetAge < .9 && F.onsetStrength > .5) {
      const p = F.onsetAge / .9, rx = 70 + 330 * p, ry = rx * .06 + 2;
      ctx.globalAlpha = (1 - p) * .55 * F.onsetStrength;
      ctx.strokeStyle = '#cfe2ee'; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.ellipse(CX, rowY(.52), rx, ry, 0, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
};
