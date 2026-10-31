import { clamp } from '../frame';
import type { Frame, TrackView } from '../frame';
import { fill, MONO, noteLabel, rand, rect, text, trackRole } from '../kit';
import type { Look } from './types';

const PAPER = '#faf9f4', DESK = '#26261f', INK = '#161616';
const LEFT = 59, RIGHT = 479, NOTE_X = 82, QTY_X = 66, LEN_X = 286, FIRST_Y = 220, PITCH = 14, ROWS = 40;

interface Row { note: string; len: string; at: string }
const cache = new WeakMap<object, { rows: Row[]; pos: number[]; key: string }>();

// The part printed on the receipt: the lead if there is one, else the busiest melodic part.
function pickPart(F: Frame): TrackView | null {
  const tracks = F.tracks;
  if (!tracks.length) return null;
  const lead = tracks.filter(track => trackRole(track) === 'lead').sort((a, b) => b.index.n - a.index.n)[0];
  if (lead) return lead;
  const melodic = tracks.filter(track => trackRole(track) !== 'drums').sort((a, b) => b.index.n - a.index.n)[0];
  return melodic || tracks[0];
}

function rowsFor(F: Frame, part: TrackView) {
  const key = `${F.ppq}`;
  const known = cache.get(part.index);
  if (known && known.key === key) return known;
  const { index } = part;
  const rows: Row[] = [], pos: number[] = [];
  const sixteenth = F.beat / 4;
  for (let i = 0; i < index.n; i++) {
    const bar = Math.floor(index.pos[i] / F.bar), beat = Math.floor((index.pos[i] % F.bar) / F.beat);
    rows.push({
      note: noteLabel(index.pitch[i]),
      len: `${Math.max(1, Math.round(index.dur[i] / sixteenth))}/16`,
      at: `${bar + 1}.${beat + 1}`,
    });
    pos.push(index.pos[i]);
  }
  const value = { rows, pos, key };
  cache.set(index, value);
  return value;
}

function paperPath(ctx: CanvasRenderingContext2D, x0: number, x1: number, y0: number, y1: number) {
  const tooth = 10.5, depth = 8;
  const count = Math.round((x1 - x0) / tooth), step = (x1 - x0) / count;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + depth);
  for (let i = 0; i < count; i++) { ctx.lineTo(x0 + step * (i + .5), y0); ctx.lineTo(x0 + step * (i + 1), y0 + depth); }
  ctx.lineTo(x1, y1 - depth);
  for (let i = count; i > 0; i--) { ctx.lineTo(x0 + step * (i - .5), y1); ctx.lineTo(x0 + step * (i - 1), y1 - depth); }
  ctx.closePath();
}

function dashes(F: Frame, y: number, ch: string, size: number, x0 = LEFT, x1 = RIGHT) {
  const w = F.ctx.measureText(ch).width || size * .6;
  void w;
  const unit = size * .6;
  text(F, ch.repeat(Math.max(1, Math.floor((x1 - x0) / unit))), x0, y, { size, font: MONO, color: '#8a8982' });
}

export const receipt: Look = {
  id: 'receipt',
  group: 'midi',
  nameRu: 'Чек',
  nameEn: 'Receipt',
  descriptionRu: 'Ноты печатаются кассовым чеком: пройденные строки чёрные, текущая подсвечена, будущие бледные.',
  descriptionEn: 'The notes listed as a till receipt: played lines are black, the current one is highlighted, upcoming ones are faint.',
  draw(F) {
    const { ctx } = F;
    fill(F, DESK);
    const part = pickPart(F);
    const data = part ? rowsFor(F, part) : { rows: [] as Row[], pos: [] as number[] };
    // current row: the last note that has started
    let current = -1;
    for (let lo = 0, hi = data.pos.length - 1; lo <= hi;) {
      const mid = (lo + hi) >> 1;
      if (data.pos[mid] <= F.tick + 1e-6) { current = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const start = Math.max(0, Math.min(Math.max(0, data.rows.length - ROWS), current - 22));
    const visible = data.rows.slice(start, start + ROWS);

    ctx.save();
    ctx.translate(270, 480);
    ctx.rotate(-.0125);
    ctx.translate(-270, -480);
    // paper with a soft shadow and torn teeth
    paperPath(ctx, 37, 502, 36, 916);
    ctx.globalAlpha = .35; ctx.fillStyle = '#000'; ctx.save(); ctx.translate(3, 4); ctx.fill(); ctx.restore();
    ctx.globalAlpha = 1; ctx.fillStyle = PAPER; ctx.fill();
    ctx.save();
    ctx.clip();

    dashes(F, 101, '=', 9);
    text(F, F.meta.title, LEFT, 124, { size: 16, font: MONO, color: INK, maxWidth: RIGHT - LEFT });
    const sub = { size: 8, font: MONO, color: '#55554f', spacing: 8.3 };
    text(F, String(Math.round(F.meta.bpm)), LEFT, 136, sub);
    text(F, 'BPM', 102, 136, sub);
    if (F.meta.key) { text(F, '·', 147, 136, sub); text(F, F.meta.key, 170, 136, sub); }
    const bars = Math.max(1, Math.round(F.total / F.bar));
    text(F, String(bars), 210, 136, sub);
    text(F, 'BARS', 235, 136, sub);
    text(F, 'ALL LINES', LEFT, 155, { size: 9, font: MONO, color: '#2a2a28' });
    text(F, part ? (part.name || 'lead').toLowerCase() : 'lead', 120, 155, { size: 9, font: MONO, color: '#2a2a28', maxWidth: 160 });
    dashes(F, 172, '-', 8);
    text(F, 'QTY', LEFT, 191, { size: 8, font: MONO, color: '#3a3a36' });
    text(F, 'NOTE', 79, 191, { size: 8, font: MONO, color: '#3a3a36' });
    text(F, 'LEN', 288, 189, { size: 8, font: MONO, color: '#3a3a36', align: 'center' });
    text(F, 'AT', RIGHT, 187, { size: 8, font: MONO, color: '#3a3a36', align: 'right' });
    dashes(F, 206, '-', 8);

    const total = Math.max(1, visible.length);
    for (let i = 0; i < visible.length; i++) {
      const row = visible[i], idx = start + i, y = FIRST_Y + i * PITCH;
      const past = idx < current, now = idx === current;
      if (now) {
        rect(F, 52, y - 11, RIGHT - 52 + 8, 15, '#e3e2dc');
        text(F, '>', 48, y, { size: 10, font: MONO, color: INK });
      }
      const shift = past || now ? 0 : 1 + (idx - current) * .03;
      const color = past || now ? INK : '#b9b8b0';
      const alpha = past || now ? 1 : .75 - .3 * (i / total);
      const dx = past || now ? 0 : shift;
      text(F, '1', QTY_X + dx, y, { size: 10, font: MONO, color, alpha });
      text(F, row.note, NOTE_X + dx, y, { size: 10, font: MONO, color, alpha });
      text(F, row.len, LEN_X + dx, y, { size: 10, font: MONO, color, alpha, align: 'center' });
      text(F, row.at, RIGHT + dx * .5, y - 1, { size: 10, font: MONO, color, alpha, align: 'right' });
    }

    dashes(F, 776, '-', 8);
    text(F, 'SUBTOTAL', 63, 797, { size: 10, font: MONO, color: INK });
    text(F, `${data.rows.length} NOTES`, 177, 796, { size: 10, font: MONO, color: INK });
    text(F, 'TOTAL', 63, 813, { size: 11.5, font: MONO, color: INK });
    text(F, F.meta.duration >= 3600 ? '--:--' : `${String(Math.floor(F.meta.duration / 60)).padStart(2, '0')}:${String(Math.floor(F.meta.duration) % 60).padStart(2, '0')}`, 200, 813, { size: 12, font: MONO, color: INK });
    dashes(F, 826, '=', 9);

    // barcode derived from the title
    let seed = 7;
    for (const ch of F.meta.title) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
    ctx.fillStyle = '#111';
    ctx.globalAlpha = 1;
    for (let x = 187, i = 0; x < 360; i++) {
      const w = 1 + Math.floor(rand(seed, i) * 3) * 1, gap = 1 + Math.floor(rand(seed, i + 500) * 2) * 1;
      ctx.fillRect(x, 836, Math.min(w, 360 - x), 39);
      x += w + gap;
    }
    text(F, `${Math.round(F.meta.bpm)}`, 218, 889, { size: 7.5, font: MONO, color: '#55554f', spacing: 6 });
    text(F, F.meta.title.toUpperCase(), 272, 889, { size: 7.5, font: MONO, color: '#55554f', spacing: 6, maxWidth: 120 });
    ctx.restore();
    ctx.restore();
    ctx.globalAlpha = 1;
    void clamp;
  },
};
