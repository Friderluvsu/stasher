import { audioAt, clamp, loopCycles, makeSurface, surfaceContext, TAU } from '../frame';
import type { Frame } from '../frame';
import { H, noise1, rand, W } from '../kit';
import type { Look } from './types';

// A soft sunset "video" (violet sky, white sun, blue and yellow shapes) that is datamoshed:
// blocks freeze on old frames, slide sideways, rows smear and the picture edges tear with colour fringes.
const TOP = 120, REG_H = 720, SW = 135, SH = 180, BLOCK = 45;
const BARS = '#05040a';
type Feat = { level: number; bass: number; mid: number; treble: number };

const surfaces: (ReturnType<typeof makeSurface>)[] = [null, null, null];

function blobPath(g: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, ph: number, seed: number) {
  g.beginPath();
  for (let i = 0; i <= 36; i++) {
    const th = i / 36 * TAU;
    const k = 1 + .14 * Math.sin(2 * th + ph + seed) + .1 * Math.sin(3 * th - 2 * ph + seed * 2) + .06 * Math.sin(5 * th + 3 * ph + seed * 3);
    const x = cx + Math.cos(th) * rx * k, y = cy + Math.sin(th) * ry * k;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
}

function scene(g: CanvasRenderingContext2D, ph: number, a: Feat) {
  const sky = g.createLinearGradient(0, 0, 0, SH);
  sky.addColorStop(0, '#2f1262'); sky.addColorStop(.3, '#4a1f86'); sky.addColorStop(.5, '#5e2896');
  sky.addColorStop(.6, '#b5379a'); sky.addColorStop(.68, '#d457a0'); sky.addColorStop(.8, '#f39a78'); sky.addColorStop(1, '#f6b05e');
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = sky; g.fillRect(0, 0, SW, SH);
  // blue shape
  const bx = SW * (.3 + .06 * Math.sin(ph) + .03 * a.mid), by = SH * (.7 + .02 * Math.sin(ph * 2 + 1));
  const bg = g.createLinearGradient(0, by - SH * .12, 0, by + SH * .12);
  bg.addColorStop(0, '#9dbbd2'); bg.addColorStop(1, '#7ea0b9');
  g.fillStyle = bg;
  blobPath(g, bx, by, SW * (.27 + .06 * a.mid), SH * (.1 + .03 * a.mid), ph, 1);
  g.fill();
  // yellow shape
  const yx = SW * (.76 + .03 * Math.sin(ph * 2 + 2)), yy = SH * (.8 + .02 * Math.sin(ph + 3));
  const yg = g.createLinearGradient(0, yy - SH * .1, 0, yy + SH * .1);
  yg.addColorStop(0, '#f5d56a'); yg.addColorStop(1, '#efb25e');
  g.fillStyle = yg;
  blobPath(g, yx, yy, SW * (.3 + .05 * a.treble), SH * (.1 + .03 * a.level), -ph, 4);
  g.fill();
  // sun
  const sx = SW * (.56 + .06 * Math.sin(ph)), sy = SH * (.4 + .015 * Math.cos(ph * 2));
  const r = SW * (.3 + .12 * a.bass + .04 * a.level);
  const sun = g.createRadialGradient(sx, sy, 0, sx, sy, r);
  sun.addColorStop(0, 'rgba(255,252,246,1)'); sun.addColorStop(.1, 'rgba(255,222,228,.9)'); sun.addColorStop(.3, 'rgba(240,150,172,.55)');
  sun.addColorStop(.62, 'rgba(210,100,176,.2)'); sun.addColorStop(1, 'rgba(180,70,170,0)');
  g.globalCompositeOperation = 'lighter';
  g.fillStyle = sun; g.fillRect(0, 0, SW, SH);
  g.globalCompositeOperation = 'source-over';
}

export const mosh: Look = {
  id: 'mosh',
  group: 'audio',
  nameRu: 'Мош',
  nameEn: 'Mosh',
  descriptionRu: 'Закатный кадр рассыпается на датамош-блоки и рваные полосы в такт звуку',
  descriptionEn: 'A sunset frame breaks into frozen blocks, sliding rows and torn edges with the sound',
  draw(F: Frame) {
    const { ctx } = F;
    ctx.globalAlpha = 1;
    ctx.fillStyle = BARS;
    ctx.fillRect(-2, -2, W + 4, H + 4);
    const cycles = loopCycles(F, 6);
    const phaseAt = (lag: number) => ((F.tick - lag * F.tps) / F.total * cycles) * TAU;
    const lags = [0, .35, 1.1];
    for (let i = 0; i < 3; i++) {
      if (!surfaces[i]) surfaces[i] = makeSurface(SW, SH);
      const g = surfaces[i] && surfaceContext(surfaces[i]!);
      if (g) scene(g, phaseAt(lags[i]), i ? audioAt(F, -lags[i]) : F.audio);
    }
    if (!surfaces[0]) return;
    const t = F.meta.seconds;
    const energy = clamp(F.audio.level * .6 + F.hit * .9 + F.audio.transient * .4);

    ctx.save();
    ctx.beginPath(); ctx.rect(0, TOP, W, REG_H); ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(surfaces[0]!, 0, 0, SW, SH, 0, TOP, W, REG_H);

    // macroblocks
    const cols = Math.ceil(W / BLOCK), rows = REG_H / BLOCK;
    const sc = SW / W;
    const chance = .14 + .5 * energy;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const key = j * 31 + i;
        const epoch = Math.floor(t * 5 + rand(key, 1) * 4);
        const r = rand(key, epoch + 100);
        if (r > chance) continue;
        const dx = i * BLOCK, dy = TOP + j * BLOCK;
        const kind = rand(key, epoch + 200);
        if (kind < .5) {
          const s = surfaces[kind < .28 ? 1 : 2]!;
          const ox = Math.round((rand(key, epoch + 300) - .5) * 3) * BLOCK * sc;
          ctx.drawImage(s, i * BLOCK * sc + ox, j * BLOCK * sc, BLOCK * sc, BLOCK * sc, dx, dy, BLOCK, BLOCK);
        } else if (kind < .8) {
          const ox = (rand(key, epoch + 400) < .5 ? -1 : 1) * (1 + Math.floor(rand(key, epoch + 410) * 2)) * BLOCK * sc;
          const oy = Math.round((rand(key, epoch + 420) - .5) * 2) * BLOCK * sc;
          ctx.drawImage(surfaces[0]!, clamp(i * BLOCK * sc + ox, 0, SW - BLOCK * sc), clamp(j * BLOCK * sc + oy, 0, SH - BLOCK * sc), BLOCK * sc, BLOCK * sc, dx, dy, BLOCK, BLOCK);
        } else {
          ctx.globalAlpha = .1 + .1 * rand(key, epoch + 500);
          ctx.fillStyle = rand(key, epoch + 510) < .5 ? '#ffffff' : '#12041f';
          ctx.fillRect(dx, dy, BLOCK, BLOCK);
          ctx.globalAlpha = 1;
        }
      }
    }

    // smeared rows: one source row stretched into a band
    const bands = 2 + Math.round(energy * 3);
    const epoch = Math.floor(t * 4);
    for (let b = 0; b < bands; b++) {
      const by = Math.floor(rand(b, epoch) * (REG_H - 60) / 15) * 15;
      const bh = 15 + Math.floor(rand(b, epoch + 9) * 3) * 15;
      const row = clamp(Math.floor(by * sc) - 1, 0, SH - 1);
      const shift = (rand(b, epoch + 5) - .5) * 70 * (.3 + energy);
      ctx.drawImage(surfaces[0]!, 0, row, SW, 1, shift, TOP + by, W, bh);
      if (shift > 0) ctx.drawImage(surfaces[0]!, SW - 2, row, 2, 1, 0, TOP + by, shift, bh);
      else ctx.drawImage(surfaces[0]!, 0, row, 2, 1, W + shift, TOP + by, -shift, bh);
    }
    // soft vignette inside the picture
    const vg = ctx.createLinearGradient(0, TOP, 0, TOP + REG_H);
    vg.addColorStop(0, 'rgba(8,2,18,.28)'); vg.addColorStop(.12, 'rgba(8,2,18,0)'); vg.addColorStop(.88, 'rgba(8,2,18,0)'); vg.addColorStop(1, 'rgba(8,2,18,.35)');
    ctx.fillStyle = vg; ctx.fillRect(0, TOP, W, REG_H);
    ctx.restore();

    // torn edges with colour fringes
    const wob = F.hit * 5 + energy * 3;
    for (let y = TOP; y < TOP + REG_H; y += 9) {
      const k = Math.floor(y / 9);
      const n = noise1(y * .045 + t * 1.5, 7), m = noise1(y * .05 - t * 1.2, 8);
      const left = 6 + 7 * (n + 1) + wob * rand(k, Math.floor(t * 10)), right = 6 + 7 * (m + 1) + wob * rand(k, Math.floor(t * 10) + 1);
      ctx.globalAlpha = .95; ctx.fillStyle = BARS;
      ctx.fillRect(0, y, left, 9); ctx.fillRect(W - right, y, right, 9);
      if (rand(k, Math.floor(t * 6) + 3) < .55) {
        ctx.globalAlpha = .75; ctx.fillStyle = '#d4283a'; ctx.fillRect(left, y, 2, 9);
        ctx.fillStyle = '#25c16a'; ctx.fillRect(left + 2, y, 2, 9);
      }
      if (rand(k, Math.floor(t * 6) + 4) < .55) {
        ctx.globalAlpha = .75; ctx.fillStyle = '#d4283a'; ctx.fillRect(W - right - 2, y, 2, 9);
        ctx.fillStyle = '#2a5ae0'; ctx.fillRect(W - right - 4, y, 2, 9);
      }
    }
    // top rim (yellow glints) and ragged bottom edge
    ctx.globalAlpha = 1;
    ctx.fillStyle = BARS; ctx.fillRect(0, 0, W, TOP - 2);
    for (let x = 0; x < W; x += 15) {
      const n = noise1(x * .03 + t * .6, 3);
      const lit = rand(x, Math.floor(t * 3)) < .3 + energy * .3;
      ctx.fillStyle = BARS; ctx.fillRect(x, TOP - 2, 15, 6 + 5 * (n + 1));
      if (lit) { ctx.globalAlpha = .7; ctx.fillStyle = '#e8c04c'; ctx.fillRect(x, TOP - 3, 15, 2); ctx.globalAlpha = 1; }
    }
    const bottom = TOP + REG_H;
    for (let x = 0; x < W; x += 15) {
      const n = noise1(x * .02 + t * .5, 5), k = Math.floor(x / 45);
      const h = 7 + 6 * (n + 1) + 10 * rand(k, Math.floor(t * 2) + 20) * energy;
      ctx.fillStyle = '#1d0f3c'; ctx.fillRect(x, bottom - h - 3, 15, 3);
      ctx.fillStyle = BARS; ctx.fillRect(x, bottom - h, 15, h + 4);
      if (rand(x, Math.floor(t * 5)) < .35) { ctx.globalAlpha = .6; ctx.fillStyle = '#d4283a'; ctx.fillRect(x, bottom - h - 4, 15, 1.5); ctx.globalAlpha = 1; }
    }
    ctx.fillStyle = BARS; ctx.fillRect(0, bottom + 2, W, H - bottom);
    ctx.globalAlpha = 1;
  },
};
