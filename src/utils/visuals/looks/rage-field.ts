import { makeSurface, pitchNorm, roundedRect, surfaceContext, windowNotes } from '../frame';
import type { TrackView } from '../frame';
import { fill, infoLine, MONO, text, timeLine, trackRole, W } from '../kit';
import { GRID } from './_F';
import type { Look } from './types';

const ROLE_COLOR = { bass: ['#b388ff', '#7b5db5'], chords: ['#52e0d2', '#3c9f97'], lead: ['#ff7b5e', '#a65043'], drums: ['#f2c768', '#9b834a'] } as const;
const PX0 = 30, PX1 = 510, PY0 = 96, PY1 = 766;
let dots: CanvasPattern | null | undefined;

function dotPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (dots !== undefined) return dots;
  const surface = makeSurface(9, 9);
  const g = surface && surfaceContext(surface);
  if (surface && g) {
    g.fillStyle = '#0d0f0f';
    g.fillRect(0, 0, 9, 9);
    g.fillStyle = '#2b2e2e';
    for (const a of [0, 2, 4, 7]) for (const b of [0, 2, 4, 7]) g.fillRect(a, b, 1, 1);
  }
  dots = surface && g ? ctx.createPattern(surface as CanvasImageSource, 'repeat') : null;
  return dots;
}

export const rageField: Look = {
  id: 'rage-field',
  group: 'midi',
  nameRu: 'Рейдж: поле',
  nameEn: 'Rage Field',
  descriptionRu: 'Яркие капсулы нот по партиям скользят по тёмному точечному полю мимо белой линии.',
  descriptionEn: 'Bright note capsules per part slide across a dark dotted field past a glowing white playhead.',
  draw(F) {
    const { ctx } = F;
    const g = GRID;
    fill(F, '#000000');
    text(F, infoLine(F, ' · ').replace(' BPM', ' bpm'), 30, 49, { size: 15, font: MONO, color: '#e9e9e4' });
    text(F, timeLine(F), W - 30, 49, { size: 15, font: MONO, color: '#e9e9e4', align: 'right' });

    const started = (track: TrackView) => track.index.n > 0 && track.index.firstPos <= F.tick + F.beat * .1;
    let lx = 30;
    const seen = new Set<string>();
    for (const track of F.tracks) {
      const role = trackRole(track);
      if (seen.has(role) || seen.size >= 4) continue;
      seen.add(role);
      const lit = started(track);
      ctx.globalAlpha = lit ? 1 : .32;
      ctx.beginPath();
      roundedRect(ctx, lx, 63, 6, 6, 1.4);
      ctx.fillStyle = ROLE_COLOR[role][0];
      ctx.fill();
      const w = text(F, role, lx + 13, 69, { size: 9.5, font: MONO, color: '#a8a8a2', alpha: lit ? 1 : .4 });
      lx += 13 + w + 14;
    }
    ctx.globalAlpha = 1;

    // dotted panel
    const pattern = dotPattern(ctx);
    ctx.fillStyle = pattern || '#101212';
    ctx.fillRect(PX0, PY0, PX1 - PX0, PY1 - PY0);

    ctx.save();
    ctx.beginPath();
    ctx.rect(PX0, PY0, PX1 - PX0, PY1 - PY0);
    ctx.clip();
    const before = (g.playX - g.x0 + 20) / g.pxPerBeat * F.beat, after = (g.x1 - g.playX + 20) / g.pxPerBeat * F.beat;
    const yTop = 118, yBottom = 760;
    for (const track of F.tracks.slice().sort((a, b) => b.slot - a.slot)) {
      const role = trackRole(track), [strong, soft] = ROLE_COLOR[role];
      const entered = started(track);
      for (const note of windowNotes(F, track.index, before, after, 200)) {
        const x0 = g.playX + (note.pos - F.tick) / F.beat * g.pxPerBeat;
        const w = Math.max(10, note.dur / F.beat * g.pxPerBeat - 2);
        const y = yBottom - pitchNorm(F.notes, note.pitch, 36) * (yBottom - yTop);
        const past = note.pos <= F.tick;
        const h = 9.5 + note.env * 1.2;
        ctx.beginPath();
        roundedRect(ctx, x0, y - h / 2, w, h, h / 2);
        ctx.globalAlpha = entered ? 1 : .55;
        ctx.fillStyle = entered ? (past ? strong : soft) : '#1b2828';
        ctx.fill();
        if (entered && note.env > .05) {
          ctx.globalAlpha = note.env * .12;
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // glowing playhead with a tip
    const x = g.playX, y0 = PY0, y1 = PY1;
    ctx.globalAlpha = .18 + F.hit * .12;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 3.5, y0, 7, y1 - y0);
    ctx.globalAlpha = .95;
    ctx.fillRect(x - 1.1, y0, 2.2, y1 - y0);
    ctx.beginPath();
    ctx.moveTo(x - 4, y0);
    ctx.lineTo(x + 4, y0);
    ctx.lineTo(x, y0 + 5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  },
};
