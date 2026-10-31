import { clamp, pitchNorm, roundedRect, windowNotes } from '../frame';
import { fill, infoLine, MONO, pastelBlobs, rect, text, timeLine, trackColorAt, trackRole, W, H } from '../kit';
import { GRID } from './_F';
import type { Look } from './types';

const BG = '#faf9f3';

export const strip: Look = {
  id: 'strip',
  group: 'midi',
  nameRu: 'Лента',
  nameEn: 'Strip',
  descriptionRu: 'Скользящая лента нот-капсул по партиям на тёплом светлом фоне с чёрным плейхедом.',
  descriptionEn: 'A scrolling piano-roll strip of coloured note capsules per part on a warm light page with a black playhead.',
  draw(F) {
    const { ctx } = F;
    const g = GRID;
    fill(F, BG);
    pastelBlobs(F, [
      [98, 143, 150, '#f0e2bd', .85], [458, 240, 190, '#fddcb9', .8], [80, 812, 170, '#efe4d0', .7],
      [435, 765, 170, '#fde6cd', .55], [300, 480, 260, '#fffdf5', .6],
    ]);

    // header + legend
    text(F, infoLine(F, ' · ').replace(' BPM', ' bpm'), 30, 49, { size: 15, font: MONO, color: '#1c1c1a' });
    text(F, timeLine(F), W - 30, 49, { size: 15, font: MONO, color: '#1c1c1a', align: 'right' });
    let lx = 30;
    const shown = F.tracks.slice(0, 5);
    shown.forEach(track => {
      const first = track.index.n ? track.index.firstPos : Infinity;
      const lit = first <= F.tick + F.beat * .1;
      const color = trackColorAt(track.slot);
      ctx.globalAlpha = lit ? 1 : .28;
      ctx.beginPath();
      ctx.arc(lx + 4, 65, 3.2, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      const label = trackRole(track);
      const w = text(F, label, lx + 13, 69, { size: 9.5, font: MONO, color: '#5a5a4e', alpha: lit ? 1 : .3 });
      lx += 13 + w + 14;
    });
    ctx.globalAlpha = 1;

    // notes
    const before = (g.playX - g.x0 + 20) / g.pxPerBeat * F.beat, after = (g.x1 - g.playX + 20) / g.pxPerBeat * F.beat;
    const yTop = 118, yBottom = 760;
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.x0, 0, g.x1 - g.x0, H);
    ctx.clip();
    const ordered = F.tracks.slice().sort((a, b) => b.slot - a.slot);
    for (const track of ordered) {
      const color = trackColorAt(track.slot);
      for (const note of windowNotes(F, track.index, before, after, 200)) {
        const x0 = g.playX + (note.pos - F.tick) / F.beat * g.pxPerBeat;
        const w = Math.max(10, note.dur / F.beat * g.pxPerBeat - 2);
        const y = yBottom - pitchNorm(F.notes, note.pitch, 36) * (yBottom - yTop);
        const started = note.pos <= F.tick;
        const a = started ? 1 : .6;
        const h = 7, lift = note.env * 1.5;
        ctx.beginPath();
        roundedRect(ctx, x0, y - h / 2 - lift / 2, w, h + lift, (h + lift) / 2);
        ctx.globalAlpha = a * .5;
        ctx.fillStyle = '#e8e8ea';
        ctx.fill();
        ctx.globalAlpha = a * .22;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = a;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.1 + note.env * .5;
        ctx.stroke();
      }
    }
    ctx.restore();

    // playhead with a little flag
    rect(F, g.playX - 1.8, g.top + 18, 3.6, g.bottom - g.top - 18, '#d8d6cc', .45);
    rect(F, g.playX - .9, g.top + 18, 1.8, g.bottom - g.top - 18, '#141412', .95);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#141412';
    ctx.beginPath();
    ctx.moveTo(g.playX - 4, g.top + 17);
    ctx.lineTo(g.playX + 4, g.top + 17);
    ctx.lineTo(g.playX, g.top + 22);
    ctx.closePath();
    ctx.fill();
    void clamp;
  },
};
