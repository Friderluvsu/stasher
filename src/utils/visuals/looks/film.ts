import { clamp, pitchNorm, windowNotes } from '../frame';
import { fill, infoLine, MONO, noise1, rand, rect, text, timeLine, W, H } from '../kit';
import { makeSurface, surfaceContext } from '../frame';
import type { Look } from './types';

const PLAY_X = 174, X0 = 30, X1 = 510, PX_PER_BEAT = 31;
const ROWS = 9, ROW0 = 98, ROW_STEP = 81, TOP = 78, BOTTOM = 767;

let vignette: { key: string; surface: HTMLCanvasElement | OffscreenCanvas | null } | null = null;

// Static vignette + scanline layer, cached per output size.
function vignetteLayer(): HTMLCanvasElement | OffscreenCanvas | null {
  const key = 'v1';
  if (vignette && vignette.key === key) return vignette.surface;
  const surface = makeSurface(W, H);
  const g = surface && surfaceContext(surface);
  if (surface && g) {
    g.clearRect(0, 0, W, H);
    const side = (x0: number, x1: number, a0: number, mid: number) => {
      const gr = g.createLinearGradient(x0, 0, x1, 0);
      gr.addColorStop(0, `rgba(60,60,52,${a0})`);
      gr.addColorStop(mid, `rgba(60,60,52,${a0 * .45})`);
      gr.addColorStop(1, 'rgba(60,60,52,0)');
      g.fillStyle = gr;
      g.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), H);
    };
    side(0, 130, .3, .3);
    side(W, W - 150, .3, .3);
    const vert = (y0: number, y1: number, a0: number) => {
      const gr = g.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, `rgba(60,60,52,${a0})`);
      gr.addColorStop(1, 'rgba(60,60,52,0)');
      g.fillStyle = gr;
      g.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0));
    };
    vert(0, 130, .26);
    vert(H, H - 200, .34);
    // faint horizontal scanlines
    g.fillStyle = 'rgba(70,70,60,0.07)';
    for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
  }
  vignette = { key, surface: surface && g ? surface : null };
  return vignette.surface;
}

export const film: Look = {
  id: 'film',
  group: 'midi',
  nameRu: 'Плёнка',
  nameEn: 'Film',
  descriptionRu: 'Ноты как точки на старой кинопленке с виньеткой, мерцанием и зерном.',
  descriptionEn: 'Notes as dots on old projected film with vignette, flicker and grain.',
  draw(F) {
    const { ctx } = F;
    const time = F.meta.seconds;
    const flick = 1 + noise1(time * 18, 4) * .018 + (rand(Math.floor(time * 24), 9) - .5) * .02;
    fill(F, '#f1f1ec');
    // gate weave
    const wx = noise1(time * 2.3, 1) * 1.1, wy = noise1(time * 3.1, 2) * 1.4;
    ctx.save();
    ctx.translate(wx, wy);

    // faint hot-spot in the middle
    const hot = ctx.createRadialGradient(W * .5, H * .45, 20, W * .5, H * .45, 420);
    hot.addColorStop(0, 'rgba(255,255,250,0.55)');
    hot.addColorStop(1, 'rgba(255,255,250,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = hot;
    ctx.fillRect(-4, -4, W + 8, H + 8);

    // header
    text(F, infoLine(F), 30, 41, { size: 15, font: MONO, color: '#1c1c1a', alpha: .95 });
    text(F, timeLine(F), W - 30, 41, { size: 15, font: MONO, color: '#1c1c1a', align: 'right', alpha: .95 });

    // notes
    const before = (PLAY_X - X0 + 10) / PX_PER_BEAT * F.beat, after = (X1 - PLAY_X + 10) / PX_PER_BEAT * F.beat;
    const list = windowNotes(F, F.notes, before, after, 260);
    ctx.save();
    ctx.beginPath();
    ctx.rect(X0, 0, X1 - X0, H);
    ctx.clip();
    for (const note of list) {
      const x = PLAY_X + (note.pos - F.tick) / F.beat * PX_PER_BEAT;
      const row = Math.round(pitchNorm(F.notes, note.pitch, 12) * (ROWS - 1));
      const y = ROW0 + (ROWS - 1 - row) * ROW_STEP;
      const stretch = clamp(note.dur / F.beat - .5, 0, 1) * 5;
      const w = 18 + stretch, h = 18;
      const passed = x <= PLAY_X ? 1 : 0;
      const pulse = note.env * .35;
      const tone = passed ? 128 : 172;
      const g = Math.round(tone - note.vel * 20 - pulse * 30);
      ctx.globalAlpha = (passed ? .9 : .82) * flick;
      ctx.fillStyle = `rgb(${g},${g},${g - 3})`;
      ctx.beginPath();
      ctx.ellipse(x + w / 2 - 9, y, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // playhead
    rect(F, PLAY_X - 1.2, TOP, 3.2, BOTTOM - TOP, '#cfcfc8', .5);
    rect(F, PLAY_X - .7, TOP, 1.5, BOTTOM - TOP, '#2c2c2a', .88);
    ctx.restore();

    // vignette and scanlines
    const layer = vignetteLayer();
    if (layer) { ctx.globalAlpha = 1; ctx.drawImage(layer, 0, 0); }

    // flicker: brief brightness pulses
    const dark = Math.max(0, -noise1(time * 14, 7)) * .06 + (rand(Math.floor(time * 24), 5) > .94 ? .05 : 0);
    rect(F, 0, 0, W, H, '#202018', dark);
    const bright = Math.max(0, noise1(time * 11, 8)) * .05;
    rect(F, 0, 0, W, H, '#ffffff', bright);

    // grain, dust and a hair
    if (!F.thumb) {
      const seed = Math.floor(time * 24);
      ctx.fillStyle = '#4a4a40';
      for (let i = 0; i < 900; i++) {
        ctx.globalAlpha = .03 + .06 * rand(i, seed + 3);
        ctx.fillRect(rand(i, seed) * W, rand(i, seed + 1) * H, 1.4, 1);
      }
      for (let i = 0; i < 3; i++) {
        if (rand(i, seed + 11) > .35) continue;
        ctx.globalAlpha = .35;
        ctx.fillRect(rand(i, seed + 12) * W, rand(i, seed + 13) * H, 1, 3 + rand(i, seed + 14) * 5);
      }
      ctx.globalAlpha = 1;
    }
  },
};
