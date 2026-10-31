import { makeSurface, surfaceContext } from '../frame';
import { fill, MONO, rect, text, timeLine, infoLine, W, H } from '../kit';
import { GRID, gridNotes } from './_F';
import type { Look } from './types';

const PAPER = '#ebe0cd', NAVY = '#0a2d7c', PINK = '#f0608f';
let halftone: HTMLCanvasElement | OffscreenCanvas | null | undefined;

function halftoneLayer() {
  if (halftone !== undefined) return halftone;
  const surface = makeSurface(W, H);
  const g = surface && surfaceContext(surface);
  if (surface && g) {
    g.fillStyle = '#b79f88';
    for (let y = 1; y < H; y += 4.5) for (let x = 1; x < W; x += 4.5) g.fillRect(Math.round(x), Math.round(y), 1.5, 1.5);
  }
  halftone = surface && g ? surface : null;
  return halftone;
}

export const screen: Look = {
  id: 'screen',
  group: 'midi',
  nameRu: 'Экран',
  nameEn: 'Screen',
  descriptionRu: 'Синие квадраты нот с розовым сдвигом печати на бежевой бумаге с растром.',
  descriptionEn: 'Navy note squares with a pink misprint offset on halftone beige paper.',
  draw(F) {
    const { ctx } = F;
    fill(F, PAPER);
    const layer = halftoneLayer();
    if (layer) { ctx.globalAlpha = .3; ctx.drawImage(layer, 0, 0); ctx.globalAlpha = 1; }
    const g = GRID, SIZE = 21, OFF = 6;
    // slight misregistration drift that kicks on hits
    const dx = OFF + F.hit * 1.5, dy = -OFF - F.hit * 1.5;

    // header: black text with a pink ghost
    const head = { size: 15, font: MONO, color: '#161616' };
    const ghost = { ...head, color: PINK, alpha: .8 };
    text(F, infoLine(F), 30 + dx * .9, 41 + dy * .8, ghost);
    text(F, timeLine(F), W - 30 + dx * .9, 41 + dy * .8, { ...ghost, align: 'right' });
    text(F, infoLine(F), 30, 41, head);
    text(F, timeLine(F), W - 30, 41, { ...head, align: 'right' });

    const list = gridNotes(F, SIZE, 6);
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.x0, 0, g.x1 - g.x0, H);
    ctx.clip();
    // pink plate first
    ctx.fillStyle = PINK;
    ctx.globalAlpha = .55;
    for (const n of list) ctx.fillRect(n.x - n.w / 2 + dx * (n.note.env * .0 + 1), n.y - SIZE / 2 + dy, n.w, SIZE);
    // blue plate
    for (const n of list) {
      ctx.globalAlpha = n.started ? .96 : .72;
      ctx.fillStyle = n.started ? NAVY : '#2a4a9a';
      ctx.fillRect(n.x - n.w / 2, n.y - SIZE / 2, n.w, SIZE);
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // playhead: black line + pink offset line
    rect(F, g.playX + dx - 1, g.top + dy * .3, 2, g.bottom - g.top, PINK, .85);
    rect(F, g.playX - .7, g.top, 1.6, g.bottom - g.top, '#111', .95);
  },
};
