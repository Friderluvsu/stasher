import { clamp, pitchNorm, windowNotes } from '../frame';
import type { TrackView } from '../frame';
import { fill, infoLine, MONO, pastelBlobs, rect, text, timeLine, trackRole, W, H } from '../kit';
import type { Look } from './types';

const LINE_Y = 296, PX_PER_BEAT = 43, Y_TOP = 95, Y_BOTTOM = 766, X0 = 30, X1 = 510;

const ROLE_COLOR = { bass: ['#111111', '#4a4a4a'], chords: ['#2a58a8', '#6f8dbd'], lead: ['#c4566a', '#d98f9c'], drums: ['#5a5a5a', '#9a9a9a'] } as const;

export const monoStudio: Look = {
  id: 'mono-studio',
  group: 'midi',
  nameRu: 'Моно-студия',
  nameEn: 'Mono Studio',
  descriptionRu: 'Тонкие вертикальные штрихи нот плывут вверх через горизонтальную линию на светлом фоне с пастельными пятнами.',
  descriptionEn: 'Thin vertical note bars drift upward through a horizontal playhead line on a light page with pastel blobs.',
  draw(F) {
    const { ctx } = F;
    fill(F, '#fafaf8');
    pastelBlobs(F, [
      [105, 143, 170, '#e2d8ff', .75], [458, 240, 190, '#ffdcc6', .85], [80, 812, 190, '#d2f4e2', .8], [458, 765, 190, '#d2e6ff', .85],
    ]);

    text(F, infoLine(F, ' · ').replace(' BPM', ' bpm'), 30, 49, { size: 15, font: MONO, color: '#1c1c1a' });
    text(F, timeLine(F), W - 30, 49, { size: 15, font: MONO, color: '#1c1c1a', align: 'right' });

    // legend: filled squares per part, dimmed until the part has entered
    let lx = 30;
    const started = (track: TrackView) => track.index.n > 0 && track.index.firstPos <= F.tick + F.beat * .1;
    const shown: TrackView[] = [];
    const seen = new Set<string>();
    for (const track of F.tracks) { const role = trackRole(track); if (!seen.has(role) && shown.length < 4) { seen.add(role); shown.push(track); } }
    for (const track of shown) {
      const lit = started(track), role = trackRole(track);
      ctx.globalAlpha = lit ? 1 : .3;
      ctx.fillStyle = ROLE_COLOR[role][0];
      ctx.fillRect(lx, 63, 6, 6);
      const w = text(F, role, lx + 13, 69, { size: 9.5, font: MONO, color: '#5a5a4e', alpha: lit ? 1 : .3 });
      lx += 13 + w + 14;
    }
    ctx.globalAlpha = 1;

    // note bars
    const before = (LINE_Y - Y_TOP + 8) / PX_PER_BEAT * F.beat, after = (Y_BOTTOM - LINE_Y + 8) / PX_PER_BEAT * F.beat;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, Y_TOP, W, Y_BOTTOM - Y_TOP);
    ctx.clip();
    for (const track of F.tracks.slice().sort((a, b) => b.slot - a.slot)) {
      const role = trackRole(track), [strong, soft] = ROLE_COLOR[role];
      const entered = started(track);
      for (const note of windowNotes(F, track.index, before, after, 220)) {
        const x = 34 + pitchNorm(F.notes, note.pitch, 48) * (X1 - 40);
        const top = LINE_Y + (note.pos - F.tick) / F.beat * PX_PER_BEAT;
        const bottom = LINE_Y + (note.end - F.tick) / F.beat * PX_PER_BEAT;
        const h = Math.max(4, bottom - top - 1.5);
        const past = top <= LINE_Y;
        if (!entered) ctx.fillStyle = '#e6e6e6';
        else ctx.fillStyle = past ? strong : soft;
        ctx.globalAlpha = entered ? (past ? .98 : .9) : .6;
        const wide = 3.4 + (past && bottom > LINE_Y ? note.env * 1.4 : 0);
        ctx.fillRect(x - wide / 2, top, wide, h);
      }
    }
    ctx.restore();

    // playhead line with a soft shadow
    rect(F, X0, LINE_Y - 3, X1 - X0, 6, '#9a9a96', .22);
    rect(F, X0, LINE_Y - 1.1, X1 - X0, 2.2, '#161616', .92);
    rect(F, X0, LINE_Y - 3, 4, 6, '#111', .95);
    void clamp; void H;
  },
};
