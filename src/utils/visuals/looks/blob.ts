import { audioAt, clamp, loopT, makeSurface, surfaceContext, TAU } from '../frame';
import { H, noise1, rand, W } from '../kit';
import type { Look } from './types';

// Metaball blobs on a 180 x 320 buffer, coloured by height (mint -> teal -> violet -> pink), with thin
// target rings and tick marks around each source circle.
const BW = 180, BH = 320, SC = W / BW;
const GRAD: [number, number, number, number][] = [
  [300, 190, 248, 176], [370, 124, 238, 188], [450, 92, 216, 204], [520, 118, 172, 236], [590, 160, 106, 250], [660, 206, 92, 214], [730, 238, 90, 168],
];
const ROW = new Uint8ClampedArray(BH * 3);
for (let y = 0; y < BH; y++) {
  const py = (y + .5) * SC;
  let k = 1;
  while (k < GRAD.length - 1 && GRAD[k][0] < py) k++;
  const a = GRAD[k - 1], b = GRAD[k], t = clamp((py - a[0]) / (b[0] - a[0]));
  for (let c = 0; c < 3; c++) ROW[y * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * t;
}
const field = new Float32Array(BW * BH);
let surface: ReturnType<typeof makeSurface> = null;
let image: ImageData | null = null;

interface Lobe { x: number; y: number; r: number; w?: number }
const BANDS: [number, number][] = [[0, 4], [4, 9], [9, 15], [15, 22], [22, 28], [28, 32]];
const THR = .25, SHADOW = .1;
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function energies(F: Parameters<Look['draw']>[0]): number[] {
  const snaps = [F.audio, audioAt(F, -.045), audioAt(F, -.09)];
  return BANDS.map(([from, to]) => {
    let sum = 0;
    snaps.forEach((s, i) => {
      let peak = 0;
      for (let k = from; k < to; k++) peak = Math.max(peak, s.spectrum[k]);
      sum += peak * (i === 0 ? 1.4 : 1);
    });
    return clamp(sum / 3.4);
  });
}

export const blob: Look = {
  id: 'blob',
  group: 'audio',
  nameRu: 'Блоб',
  nameEn: 'Blob',
  descriptionRu: 'Светящиеся капли растут и сливаются под разные частоты звука',
  descriptionEn: 'Glowing metaballs swell and merge with each frequency band of the sound',
  draw(F) {
    const { ctx } = F;
    // background: faint oval lift in the middle
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#030408';
    ctx.fillRect(-2, -2, W + 4, H + 4);
    const bg = ctx.createRadialGradient(W / 2, 520, 0, W / 2, 520, 520);
    bg.addColorStop(0, 'rgba(14,18,30,1)'); bg.addColorStop(.55, 'rgba(7,9,16,1)'); bg.addColorStop(1, 'rgba(3,4,8,1)');
    ctx.save();
    ctx.translate(W / 2, 520); ctx.scale(.78, 1); ctx.translate(-W / 2, -520);
    ctx.fillStyle = bg; ctx.fillRect(-300, -100, W + 600, H + 300);
    ctx.restore();

    const e = energies(F);
    const phase = loopT(F, 16) * TAU;
    const lobes: Lobe[] = [];
    const rings: Lobe[] = [];
    const n = e.length;
    for (let b = 0; b < n; b++) {
      const a = b / n * TAU + .6;
      const orbit = 1 + 0.1 * Math.sin(phase * 2 + b * 1.7);
      // slot centre: loose cluster, drifting on whole-number phase cycles so the loop is seamless
      const cx = 255 + (b % 2 ? 1 : -1) * (100 + 45 * Math.cos(a)) * orbit + 36 * Math.sin(phase + b * 1.9) + 14 * noise1(F.meta.seconds * .2 + b * 5, 2);
      const cy = 520 + 190 * Math.sin(a) * orbit * .9 + 40 * Math.cos(phase * 2 + b * 2.3) + 14 * noise1(F.meta.seconds * .2 + b * 7, 3);
      const energy = e[b];
      const r = (b === n - 1 ? 6 : 21) + (b === n - 1 ? 16 : 52) * energy ** .85 + (b === n - 1 ? 0 : 4) * F.hit;
      const main: Lobe = { x: cx, y: cy, r, w: b * 1.7 };
      lobes.push(main);
      rings.push({ x: cx, y: cy, r: r * 1.34 });
      if (b < n - 1) {
        const k = 2 + (b % 2);
        for (let l = 1; l < k; l++) {
          const ang = phase * (l % 2 ? 1 : -1) + b * 2.1 + l * 2.4;
          const sr = r * (.5 + .1 * l) * (.8 + .5 * energy);
          const d = r * (.62 + .25 * Math.sin(phase * 2 + l + b));
          const lobe = { x: cx + Math.cos(ang) * d, y: cy + Math.sin(ang) * d, r: sr, w: b * 1.7 + l };
          lobes.push(lobe);
          if (l === 1) rings.push({ ...lobe, r: sr * 1.5 });
        }
      }
    }

    field.fill(0);
    for (const lobe of lobes) {
      const R = lobe.r * Math.SQRT2 * 1.0, R2 = R * R;
      const gx = lobe.x / SC, gy = lobe.y / SC, gr = R / SC;
      const x0 = Math.max(0, Math.floor(gx - gr)), x1 = Math.min(BW - 1, Math.ceil(gx + gr));
      const y0 = Math.max(0, Math.floor(gy - gr)), y1 = Math.min(BH - 1, Math.ceil(gy + gr));
      for (let y = y0; y <= y1; y++) {
        const dy = (y + .5) * SC - lobe.y;
        for (let x = x0; x <= x1; x++) {
          const dx = (x + .5) * SC - lobe.x;
          const th = Math.atan2(dy, dx), w = lobe.w || 0;
          const wob = 1 + .1 * Math.sin(th * 3 + phase + w) + .06 * Math.sin(th * 5 - phase * 2 + w * 2) + .04 * Math.sin(th * 2 + phase * 3 + w * 3);
          const q = (dx * dx + dy * dy) / (R2 * wob * wob);
          if (q < 1) { const k = 1 - q; field[y * BW + x] += k * k; }
        }
      }
    }
    if (!surface) surface = makeSurface(BW, BH);
    const g = surface && surfaceContext(surface);
    if (surface && g) {
      if (!image) image = g.createImageData(BW, BH);
      const px = image.data;
      for (let y = 0; y < BH; y++) {
        const r = ROW[y * 3], gg = ROW[y * 3 + 1], b = ROW[y * 3 + 2];
        for (let x = 0; x < BW; x++) {
          const i = y * BW + x, v = field[i], o = i * 4;
          const a = smooth(THR - .055, THR + .055, v);
          const sh = smooth(SHADOW, THR, v) * .4;
          const alpha = a + (1 - a) * sh;
          px[o] = alpha > 0 ? (r * a + r * .12 * (alpha - a)) / alpha : 0; px[o + 1] = alpha > 0 ? (gg * a + gg * .12 * (alpha - a)) / alpha : 0; px[o + 2] = alpha > 0 ? (b * a + b * .12 * (alpha - a)) / alpha : 0;
          px[o + 3] = alpha * 255;
        }
      }
      g.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 1;
      ctx.drawImage(surface, 0, 0, BW, BH, 0, 0, W, BH * SC);
    }

    // rings with ticks
    ctx.strokeStyle = '#d8e8ff';
    ctx.lineWidth = .8;
    ctx.globalAlpha = .3;
    ctx.beginPath();
    for (const ring of rings) {
      if (ring.r < 14) continue;
      ctx.moveTo(ring.x + ring.r, ring.y);
      ctx.arc(ring.x, ring.y, ring.r, 0, TAU);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(ring.x + dx * (ring.r - 4), ring.y + dy * (ring.r - 4));
        ctx.lineTo(ring.x + dx * (ring.r + 4), ring.y + dy * (ring.r + 4));
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    void rand;
  },
};
