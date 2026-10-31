import { clamp, makeSurface, surfaceContext, windowNotes } from '../frame';
import { fill, H, MONO, noise1, rand, text, trackRole, W } from '../kit';

// Local 2-D value noise (-1..1) with a hash that does not streak.
const cellHash = (x: number, y: number, seed: number) => rand(Math.imul(x, 73856093) ^ Math.imul(y, 19349663), seed);
function noise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = cellHash(ix, iy, seed), b = cellHash(ix + 1, iy, seed), c = cellHash(ix, iy + 1, seed), d = cellHash(ix + 1, iy + 1, seed);
  return ((a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy) * 2 - 1;
}
import type { Look } from './types';

// Heat field on a 60 x 107 grid (9 px cells), colourised with a hot palette and drawn blocky.
const GW = 60, GH = 107, CELL = 9;
const BG = '#06020b';
const STOPS: [number, number, number, number][] = [
  [0, 6, 2, 11], [.1, 24, 6, 48], [.22, 62, 10, 92], [.34, 122, 22, 120], [.46, 196, 52, 88],
  [.58, 226, 84, 66], [.7, 243, 122, 42], [.86, 250, 178, 60], [1, 253, 232, 122],
];
const LEVELS = 16;
const LUT = new Uint8ClampedArray((LEVELS + 1) * 3);
for (let i = 0; i <= LEVELS; i++) {
  const v = i / LEVELS;
  let k = 1;
  while (k < STOPS.length - 1 && STOPS[k][0] < v) k++;
  const a = STOPS[k - 1], b = STOPS[k], t = (v - a[0]) / (b[0] - a[0]);
  for (let c = 0; c < 3; c++) LUT[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * t;
}

const field = new Float32Array(GW * GH);
const speck = new Float32Array(GW * GH);
const label = new Int32Array(GW * GH);
const stack = new Int32Array(GW * GH);
let heat: ReturnType<typeof makeSurface> = null;
let heatImage: ImageData | null = null;

interface Source { x: number; y: number; r: number; a: number; id: number }
interface Comp { area: number; hot: number; x0: number; y0: number; x1: number; y1: number; px: number; py: number; peak: number; id: number }

const hex = (n: number) => `0x${(Math.floor(n * 65535) + 1).toString(16).toUpperCase().padStart(4, '0')}`;

function sources(F: Parameters<Look['draw']>[0]): Source[] {
  const out: Source[] = [];
  const t = F.meta.seconds;
  const decay = F.tps * .55, attack = F.tps * .05;
  const used = F.tracks.slice(0, 8);
  used.forEach((track, slot) => {
    const role = trackRole(track);
    const idx = track.index;
    const span = Math.max(12, idx.maxPitch - idx.minPitch);
    let ax = .5, ay = .42, sx = .22, sy = .2, r0 = 4.5, gain = .9;
    if (role === 'bass') { ax = .3; ay = .62; sx = .12; sy = .08; r0 = 8; gain = 1.05; }
    else if (role === 'chords') { ax = .6; ay = .3; sx = .22; sy = .1; r0 = 4.2; gain = .62; }
    else if (role === 'lead') { ax = .68; ay = .56; sx = .12; sy = .22; r0 = 3.4; gain = .95; }
    else { ax = .25 + .5 * rand(slot, 5); ay = .3 + .3 * rand(slot, 6); sx = .1; sy = .1; r0 = 4.2; gain = 1; }
    ax += .07 * noise1(t * .17 + slot * 9.1, 3);
    ay += .06 * noise1(t * .13 + slot * 5.7, 4);
    const list = windowNotes(F, idx, F.tps * 2.4, 0, 70);
    for (const n of list) {
      const age = F.tick - n.pos;
      if (age < 0) continue;
      const over = F.tick - n.end;
      const a = Math.min(1, age / attack) * (over > 0 ? Math.exp(-over / decay) : 1);
      if (a < .03) continue;
      const pn = clamp((n.pitch - idx.minPitch) / span);
      const wob = noise1(t * .45 + n.seed * 31, n.seed * 17);
      let x = ax + (n.seed - .5) * sx + .03 * wob;
      let y = ay + (role === 'drums' ? (rand(Math.floor(n.seed * 1e6), 2) - .5) * sy : (.5 - pn) * sy) + .03 * noise1(t * .4 + n.seed * 13, 9);
      x = clamp(x, .08, .92); y = clamp(y, .1, .8);
      const size = r0 * (.75 + .5 * n.vel) * (.65 + .35 * a) * (role === 'drums' ? 1 : 1);
      out.push({ x: x * GW, y: y * GH, r: size, a: a * gain * (.55 + .6 * n.vel) * (1 + .25 * F.hit), id: Math.floor(n.seed * 65535) / 65535 });
      const tag = Math.floor(n.seed * 65535);
      for (let k = 0; k < 2; k++) {
        const ang = rand(tag, 20 + k) * 6.283 + t * (k ? .35 : -.28), dist = size * (2.3 + 2 * rand(tag, 30 + k));
        out.push({ x: clamp(x * GW + Math.cos(ang) * dist, 1, GW - 2), y: clamp(y * GH + Math.sin(ang) * dist, 1, GH - 2), r: 1.2 + 1.2 * rand(tag, 40 + k), a: a * (.5 + .5 * n.vel) * (.4 + .5 * rand(tag, 50 + k)) * gain, id: Math.floor(n.seed * 65535) / 65535 });
      }
      if (out.length > 110) return;
    }
  });
  return out;
}

export const blobTrack: Look = {
  id: 'blob-track',
  group: 'midi',
  nameRu: 'Блоб-трекер',
  nameEn: 'Blob Track',
  descriptionRu: 'MIDI мешает тепловое поле, а трекер обводит то, что получилось',
  descriptionEn: 'Your MIDI stirs a heat field and a tracker boxes whatever it becomes',
  draw(F) {
    const { ctx } = F;
    fill(F, BG);
    const t = F.meta.seconds;
    const src = sources(F);
    field.fill(0);
    const speckT = t * 1.4;
    // The speckle noise depends only on the cell and time, so it is shared by every source of this frame.
    speck.fill(NaN);
    for (const s of src) {
      const reach = Math.ceil(s.r * 2.8);
      const x0 = Math.max(0, Math.floor(s.x - reach)), x1 = Math.min(GW - 1, Math.ceil(s.x + reach));
      const y0 = Math.max(0, Math.floor(s.y - reach)), y1 = Math.min(GH - 1, Math.ceil(s.y + reach));
      const inv = 1 / (s.r * s.r), halo = 1 / (s.r * s.r * 3.5);
      const off = s.id * 50;
      for (let y = y0; y <= y1; y++) {
        const dy2 = (y - s.y) ** 2;
        for (let x = x0; x <= x1; x++) {
          const d = (x - s.x) ** 2 + dy2;
          const i = y * GW + x;
          const core = s.a * Math.exp(-d * inv);
          // The texture term only scales the core by 0.4..1.4; where the core is invisible use its mean.
          let v = core < .002 ? core * .9 : core * (.4 + (noise2(x * .21 + off, y * .21 + speckT * .35, 2) * .65 + noise2(x * .55 + off, y * .55 - speckT * .5, 6) * .4) * .5 + .5);
          const h = s.a * .42 * Math.exp(-d * halo);
          if (h > .02) {
            let sp = speck[i];
            if (sp !== sp) sp = speck[i] = noise2(x * .3 + speckT * .5, y * .3 - speckT * .4, 5);
            if (sp > .2) v += h * (sp - .2) * 1.5;
          }
          field[i] += v;
        }
      }
    }
    // ambient dust
    const dust = .03 + .1 * F.audio.level + .08 * F.env;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const n = noise2(x * .28 + speckT * .5, y * .28 - speckT * .4, 8);
      if (n > .6) field[y * GW + x] += (n - .6) * dust * 3;
    }

    if (!heat) heat = makeSurface(GW, GH);
    const g = heat && surfaceContext(heat);
    if (!heat || !g) return;
    if (!heatImage) heatImage = g.createImageData(GW, GH);
    const px = heatImage.data;
    for (let i = 0; i < GW * GH; i++) {
      const raw = field[i];
      let v = raw > 0 ? 1 - Math.exp(-raw * 1.25) : 0;
      if (v > .5) v = Math.min(1, .5 + (v - .5) * 1.7);
      field[i] = v;
      const lv = Math.round(v * LEVELS) * 3;
      px[i * 4] = LUT[lv]; px[i * 4 + 1] = LUT[lv + 1]; px[i * 4 + 2] = LUT[lv + 2]; px[i * 4 + 3] = 255;
    }
    g.putImageData(heatImage, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(heat, 0, 0, GW, GH, 0, 0, GW * CELL, GH * CELL);
    ctx.imageSmoothingEnabled = true;

    // --- tracker: connected components
    const TH = .3, MIN = 3;
    label.fill(0);
    const comps: Comp[] = [];
    let next = 0;
    for (let start = 0; start < GW * GH; start++) {
      if (field[start] < TH || label[start]) continue;
      next++;
      let sp = 0, area = 0, hot = 0, x0 = GW, y0 = GH, x1 = 0, y1 = 0, peak = 0, pxx = 0, pyy = 0;
      stack[sp++] = start; label[start] = next;
      while (sp) {
        const i = stack[--sp], x = i % GW, y = (i / GW) | 0;
        area++;
        const v = field[i];
        if (v > .62) hot++;
        if (v > peak) { peak = v; pxx = x; pyy = y; }
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && !label[i - 1] && field[i - 1] >= TH) { label[i - 1] = next; stack[sp++] = i - 1; }
        if (x < GW - 1 && !label[i + 1] && field[i + 1] >= TH) { label[i + 1] = next; stack[sp++] = i + 1; }
        if (y > 0 && !label[i - GW] && field[i - GW] >= TH) { label[i - GW] = next; stack[sp++] = i - GW; }
        if (y < GH - 1 && !label[i + GW] && field[i + GW] >= TH) { label[i + GW] = next; stack[sp++] = i + GW; }
      }
      if (area < MIN) continue;
      let best = 1e9, id = 0;
      for (const s of src) { const d = (s.x - pxx) ** 2 + (s.y - pyy) ** 2; if (d < best) { best = d; id = s.id; } }
      comps.push({ area, hot, x0, y0, x1, y1, px: pxx, py: pyy, peak, id: best < 1e9 ? id : rand(pxx, pyy) });
    }
    comps.sort((a, b) => b.hot - a.hot || b.area - a.area);
    const lock = comps.length && comps[0].hot >= 6 ? comps[0] : null;

    // crosshair
    const CY = '#7fd6e4';
    let cx = W * .5, cy = H * .5;
    if (lock) { cx = (lock.x0 + lock.x1 + 1) / 2 * CELL; cy = (lock.y0 + lock.y1 + 1) / 2 * CELL; }
    else { cx = W * (.5 + .1 * noise1(t * .3, 1)); cy = H * (.45 + .06 * noise1(t * .3, 2)); }
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = CY;
    ctx.globalAlpha = .85;
    ctx.beginPath();
    ctx.moveTo(Math.round(cx) + .5, 0); ctx.lineTo(Math.round(cx) + .5, H);
    ctx.moveTo(0, Math.round(cy) + .5); ctx.lineTo(W, Math.round(cy) + .5);
    ctx.stroke();

    // nodes + links (small components)
    const small = comps.filter(c => c !== lock).slice(0, 26);
    const nodes = small.map(c => ({ x: (c.px + .5) * CELL, y: (c.py + .5) * CELL, c }));
    ctx.strokeStyle = '#e8e6ee';
    ctx.lineWidth = .8;
    ctx.globalAlpha = .45;
    ctx.beginPath();
    nodes.forEach((a, i) => {
      let b1 = -1, b2 = -1, d1 = 1e9, d2 = 1e9;
      nodes.forEach((b, j) => {
        if (i === j) return;
        const d = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
        if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = j; } else if (d < d2) { d2 = d; b2 = j; }
      });
      if (b1 >= 0 && d1 < 190 * 190) { ctx.moveTo(a.x, a.y); ctx.lineTo(nodes[b1].x, nodes[b1].y); }
      if (b2 >= 0 && d2 < 140 * 140 && rand(Math.floor(a.c.id * 65535), 7) > .5) { ctx.moveTo(a.x, a.y); ctx.lineTo(nodes[b2].x, nodes[b2].y); }
    });
    ctx.stroke();

    // dashed boxes, brackets, dots, labels
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = .8;
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = .8;
    const boxes: { c: Comp; bx: number; by: number; bw: number; bh: number }[] = [];
    for (const n of nodes) {
      const c = n.c;
      const seed = Math.floor(c.id * 65535);
      const grow = 1 + Math.floor(rand(seed, 3) * 3);
      const bx = (c.x0 - grow) * CELL, by = (c.y0 - grow) * CELL;
      const bw = (c.x1 - c.x0 + 1 + grow * 2) * CELL, bh = (c.y1 - c.y0 + 1 + grow * 2) * CELL;
      boxes.push({ c, bx, by, bw, bh });
      if (rand(seed, 4) > .35 && c.area >= 4) ctx.strokeRect(Math.round(bx) + .5, Math.round(by) + .5, bw, bh);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = .95;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const n of nodes) {
      const s = 7, flip = rand(Math.floor(n.c.id * 65535), 9) > .5 ? 1 : -1;
      ctx.moveTo(n.x + flip * 9, n.y - 7); ctx.lineTo(n.x + flip * 9 + (flip > 0 ? 0 : 0), n.y - 7 + 0);
      ctx.moveTo(n.x - flip * 6, n.y + 5 * flip); ctx.lineTo(n.x - flip * 6, n.y + 5 * flip - flip * s); ctx.lineTo(n.x - flip * 6 + flip * s, n.y + 5 * flip - flip * s);
    }
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 1;
    for (const n of nodes) ctx.fillRect(Math.round(n.x) - 1.5, Math.round(n.y) - 1.5, 3, 3);

    // small white labels
    let labels = 0;
    for (const b of boxes) {
      const seed = Math.floor(b.c.id * 65535);
      if (labels >= 7 || rand(seed, 11) < .5) continue;
      labels++;
      const str = hex(b.c.id);
      const lw = 46, lh = 16;
      const lx = Math.round(clamp(b.bx + b.bw * .35, 4, W - lw - 4)), ly = Math.round(clamp(b.by + b.bh - 3, 14, H - 20));
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(lx, ly, lw, lh);
      ctx.strokeStyle = '#000000'; ctx.lineWidth = 1; ctx.strokeRect(lx + .5, ly + .5, lw - 1, lh - 1);
      text(F, str, lx + lw / 2, ly + 12, { size: 11, weight: 600, font: MONO, color: '#06020b', align: 'center' });
    }

    // lock box
    if (lock) {
      const bx = Math.round(lock.x0 * CELL), by = Math.round(lock.y0 * CELL);
      const bw = Math.round((lock.x1 - lock.x0 + 1) * CELL), bh = Math.round((lock.y1 - lock.y0 + 1) * CELL);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#6fd8ee';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx + .5, by + .5, bw, bh);
      const str = `LOCK ${hex(lock.id)}`;
      const lw = 7.8 * str.length + 8, lh = 20;
      const lx = clamp(bx, 0, W - lw), ly = clamp(by - lh, 0, H);
      ctx.fillStyle = '#6fd8ee';
      ctx.fillRect(lx, ly, lw, lh);
      text(F, str, lx + 4, ly + 14.5, { size: 13, weight: 600, font: MONO, color: '#06141a' });
    }

    // HUD
    const hud = { size: 13, weight: 500, font: MONO, color: '#e9e9ee' };
    const hudBg = (x: number, y: number, w: number) => { ctx.globalAlpha = 1; ctx.fillStyle = BG; ctx.fillRect(x - 3, y - 12, w + 6, 17); };
    const count = String(Math.min(99, comps.length)).padStart(2, '0');
    hudBg(75, 105, 7.9 * 11); text(F, `TRACKING ${count}`, 75, 105, hud);
    hudBg(75, 123, 7.9 * 18); text(F, 'THRESH 0.16  MIN 3', 75, 123, hud);
    const key = F.meta.key ? ` ${/m$/.test(F.meta.key) && F.meta.key.length > 1 ? `${F.meta.key.slice(0, -1)} MIN` : `${F.meta.key} MAJ`}` : '';
    const right = `${Math.round(F.meta.bpm)} BPM${key ? ` ${key}` : ''}`.toUpperCase();
    hudBg(470 - 7.9 * right.length, 105, 7.9 * right.length); text(F, right, 470, 105, { ...hud, align: 'right' });
    hudBg(75, 837, 9.6 * 17); text(F, 'GPU STATUS: BURNT', 75, 837, { size: 16, weight: 600, font: MONO, color: '#f1f1f4' });
    const sec = Math.floor(F.meta.seconds), fr = Math.floor((F.meta.seconds - sec) * 25);
    const stamp = `00:${String(sec % 60).padStart(2, '0')}:${String(fr).padStart(2, '0')}`;
    hudBg(75, 858, 7.9 * 8); text(F, stamp, 75, 858, { ...hud, color: '#c9c9d0' });
    const title = F.meta.title.slice(0, 22);
    hudBg(470 - 9.6 * title.length, 858, 9.6 * title.length); text(F, title, 470, 858, { size: 16, weight: 600, font: MONO, color: '#f1f1f4', align: 'right' });
    ctx.globalAlpha = 1;
  },
};
