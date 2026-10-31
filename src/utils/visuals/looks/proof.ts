import { clamp, pickTracks, pitchNorm, windowNotes } from '../frame';
import type { Frame, TrackView } from '../frame';
import { barBeat, fill, MONO, rect, strokeRect, text, timeProgress, totalBars } from '../kit';
import type { Look } from './types';

const PAPER = '#f3f3ee';
const WELL = '#e2e2da';
const INK = '#141414';
const PLATES = [
  { letter: 'C', solid: '#27a9e3', pale: '#d3ecf8', full: '#35b4e6' },
  { letter: 'M', solid: '#ea54a3', pale: '#fbd1e5', full: '#ee5eae' },
  { letter: 'Y', solid: '#f3d41c', pale: '#fff8d2', full: '#f6dc2a' },
  { letter: 'K', solid: '#2b2b2b', pale: '#d9d9d6', full: '#3a3a3a' },
];
const X0 = 91, X1 = 448, BARS_PER_PAGE = 4;

const mixHex = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
};

function registration(F: Frame, cx: number, cy: number, top: boolean, left: boolean) {
  const { ctx } = F;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - 18, cy); ctx.lineTo(cx + 18, cy); ctx.moveTo(cx, cy - 18); ctx.lineTo(cx, cy + 18); ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
  // crop ticks beside the mark, on the outer side
  const out = left ? -1 : 1, sy = top ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(cx + out * 44, cy + sy * 22); ctx.lineTo(cx + out * 28, cy + sy * 22);
  ctx.moveTo(cx + out * 21.5, cy - sy * 1); ctx.lineTo(cx + out * 21.5, cy + sy * 15);
  ctx.stroke();
}

export const proof: Look = {
  id: 'proof',
  group: 'midi',
  nameRu: 'Цветопроба',
  nameEn: 'Proof',
  descriptionRu: 'Печатная CMYK-цветопроба: каждая партия — красочная пластина, такты заливаются по мере движения курсора.',
  descriptionEn: 'A CMYK press proof: each part is an ink plate that fills in bar by bar as the playhead passes.',
  draw(F) {
    const { ctx } = F;
    fill(F, PAPER);
    const parts: TrackView[] = pickTracks(F, 4);
    const n = Math.max(1, parts.length);
    const bars = totalBars(F);
    const bar = Math.min(bars - 1, Math.max(0, Math.floor(F.tick / F.bar)));
    const pages = Math.max(1, Math.ceil(bars / BARS_PER_PAGE));
    const page = Math.floor(bar / BARS_PER_PAGE);
    const first = page * BARS_PER_PAGE;
    const barFrac = barBeat(F).barProgress;

    // registration marks
    registration(F, 74, 70, true, true); registration(F, 466, 70, true, false);
    registration(F, 74, 890, false, true); registration(F, 466, 890, false, false);

    // grey ramp
    const cw = (X1 - X0) / 11;
    for (let i = 0; i <= 10; i++) {
      const v = Math.round(253 + (20 - 253) * (i / 10));
      rect(F, X0 + i * cw, 102, cw + .3, 32, `rgb(${v},${v},${v - (i ? 2 : 0)})`);
      text(F, String(i * 10), X0 + i * cw + 3.5, 146, { size: 9.5, weight: 700, font: MONO, color: INK });
    }

    // plate chips: ink coverage of the bar being printed
    const progress = timeProgress(F);
    const coverage: number[] = [];
    for (let p = 0; p < 4; p++) {
      const track = parts[p];
      if (!track) { coverage.push(0); continue; }
      let ink = 0;
      const from = bar * F.bar;
      for (const note of windowNotes(F, track.index, F.tick - from, 0, 0)) {
        const a = Math.max(note.pos, from), b = Math.min(note.end, F.tick);
        if (b > a) ink += (b - a) * (.35 + .65 * pitchNorm(track.index, note.pitch));
      }
      const elapsed = Math.max(F.beat * .5, F.tick - from);
      coverage.push(clamp(ink / elapsed * (.55 + barFrac * .0)));
    }
    for (let p = 0; p < 4; p++) {
      const plate = PLATES[p], value = Math.round(coverage[p] * 10) * 10;
      const x = X0 + p * 89.5;
      rect(F, x, 164, 78, 39, mixHex(plate.pale, plate.full, value / 100));
      text(F, `${plate.letter}${String(value).padStart(4)}`, x + 6, 188, { size: 13.5, weight: 700, font: MONO, color: INK });
    }

    // bar blocks
    const top = 221, blockH = 157.5, labelH = 16;
    const rowPitch = (blockH - labelH - 4) / n, rowH = rowPitch - 8 > 20 ? rowPitch - 8 : rowPitch - 4;
    for (let k = 0; k < BARS_PER_PAGE; k++) {
      const b = first + k, y0 = top + k * blockH;
      text(F, `BAR ${b + 1}`, X0, y0 + 6, { size: 10, weight: 700, font: MONO, color: '#5a5a58', spacing: .3 });
      const state = b < bar ? 1 : b === bar ? 0 : -1;
      const reveal = state === 1 ? 1 : state === 0 ? barFrac : 0;
      const exists = b < bars;
      for (let p = 0; p < n; p++) {
        const plate = PLATES[p % 4], track = parts[p];
        const ry = y0 + labelH + p * rowPitch;
        rect(F, X0, ry, X1 - X0, rowH, WELL);
        text(F, plate.letter, 75, ry + rowH / 2 + 3.5, { size: 10, weight: 700, font: MONO, color: INK, align: 'center' });
        if (!exists || reveal <= 0 || !track) continue;
        const from = b * F.bar, to = from + F.bar;
        const clipW = (X1 - X0) * reveal;
        ctx.save();
        ctx.beginPath(); ctx.rect(X0, ry, clipW, rowH); ctx.clip();
        const list = windowNotes(F, track.index, F.tick - from + 1, to - F.tick + 1, 0);
        for (const note of list) {
          if (note.end <= from || note.pos >= to) continue;
          const a = Math.max(note.pos, from), z = Math.min(note.end, to);
          const nx = X0 + (a - from) / F.bar * (X1 - X0), nw = Math.max(1, (z - a) / F.bar * (X1 - X0) - 1.2);
          const h = rowH * (.3 + .7 * pitchNorm(track.index, note.pitch, 5));
          ctx.globalAlpha = 1;
          ctx.fillStyle = mixHex(plate.solid, '#ffffff', (note.i % 3) * .05);
          ctx.fillRect(nx, ry + rowH - h, nw, h);
          if (state === 0 && note.pos <= F.tick && note.end > F.tick && !F.thumb) {
            strokeRect(F, nx + .5, ry + rowH - h + .5, Math.max(1, nw - 1), h - 1, INK, 1.6);
          }
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      if (state === 0) {
        const px = X0 + (X1 - X0) * barFrac;
        const yb = y0 + labelH + (n - 1) * rowPitch + rowH;
        rect(F, px - 1.5, y0 + labelH - 6, 3, yb - (y0 + labelH) + 8, '#222222');
      }
    }

    // footer
    text(F, F.meta.title, X0, 854, { size: 16, weight: 700, font: MONO, color: INK, maxWidth: X1 - X0 });
    const info = [`${Math.round(F.meta.bpm)} BPM`, F.meta.key, `${parts.length} plate${parts.length === 1 ? '' : 's'}`, `proof ${page + 1}/${pages}`, `${Math.round(progress * 100)}%`]
      .filter(Boolean).join('  ·  ');
    text(F, info, X0, 875, { size: 11, weight: 700, font: MONO, color: INK, maxWidth: X1 - X0 });
  },
};
