import { clamp, roundedRect, TAU } from '../frame';
import { MONO, timeLine, trackRole, partLabel, roleLabel } from '../kit';
import { hRollNotes, K, pitchRows, rollTracks, rowCentre, squeezed, staticLayer, type HRollGeo } from './_g';
import type { Look } from './types';

// Reference pixels (720 x 1280): a quiet blue-grey page with a classic piano-roll plate.
const GUTTER = 37;
const RULER = { x: 40, y: 127, w: 640, h: 18 };
const AREA = { x: 40 + GUTTER, y: 146, w: 640 - GUTTER, h: 876 };
const ROLL: HRollGeo = { x: AREA.x, y: AREA.y, w: AREA.w, h: AREA.h, headX: AREA.x + AREA.w * .3, beatPx: AREA.w / 16 };
const PAGE = '#eff2f3';
const PART = [
  { stroke: '#6a4fd0', ghost: '#a99be0', fill: 'rgba(122,96,224,.12)' },
  { stroke: '#1f9a8c', ghost: '#84c6bd', fill: 'rgba(40,168,150,.12)' },
  { stroke: '#e0707a', ghost: '#eab0b4', fill: 'rgba(232,120,128,.12)' },
  { stroke: '#d79a2a', ghost: '#e8c98a', fill: 'rgba(224,160,50,.12)' },
  { stroke: '#3f86d6', ghost: '#96bde8', fill: 'rgba(70,140,220,.12)' },
  { stroke: '#8bb52e', ghost: '#bcd47c', fill: 'rgba(140,180,50,.12)' },
];
const BLUE = '#3a62b4';

const isBlack = (pitch: number) => [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);

function paintStatic(g: CanvasRenderingContext2D) {
  g.scale(K, K);
  g.fillStyle = PAGE;
  g.fillRect(-4, -4, 728, 1288);
}

export const plate: Look = {
  id: 'plate',
  group: 'midi',
  nameRu: 'Пластина',
  nameEn: 'Plate',
  descriptionRu: 'Светлый пиано-ролл с контурными нотами, скобками под аккордами и синей линией воспроизведения',
  descriptionEn: 'A pale piano-roll plate with outlined notes, brackets under chords and a blue playhead',
  draw(F) {
    const { ctx } = F;
    staticLayer(F, 'plate', paintStatic);
    ctx.save();
    ctx.scale(K, K);
    const mono = { font: MONO };
    const parts = rollTracks(F);

    // header
    squeezed(F, [F.meta.title.toLowerCase(), `${Math.round(F.meta.bpm)} bpm`, F.meta.key].filter(Boolean).join(' · '), 40, 65, { ...mono, size: 20, color: '#202224', maxWidth: 400 });
    squeezed(F, timeLine(F), 680, 65, { ...mono, size: 20, color: '#2a2c2e', align: 'right' });

    // grid rows (black-key rows are shaded)
    const range = pitchRows(F, 24);
    const rowH = ROLL.h / range.rows;
    const visible = new Set<unknown>();

    ctx.save();
    ctx.beginPath();
    ctx.rect(AREA.x, AREA.y, AREA.w, AREA.h);
    ctx.clip();
    ctx.fillStyle = '#e3e8e9';
    for (let p = range.lo; p <= range.hi; p++) {
      if (!isBlack(p)) continue;
      ctx.fillRect(AREA.x, rowCentre(ROLL, range, p) - rowH / 2, AREA.w, rowH);
    }
    // beat and bar lines scroll with the clock
    const perBeat = ROLL.beatPx;
    const first = Math.floor((F.tick - (ROLL.headX - ROLL.x) / perBeat * F.beat) / F.beat) - 1;
    const last = Math.ceil((F.tick + (ROLL.x + ROLL.w - ROLL.headX) / perBeat * F.beat) / F.beat) + 1;
    const bars: { x: number; n: number }[] = [];
    const loopBars = Math.max(1, Math.round(F.total / F.bar));
    for (let b = first; b <= last; b++) {
      const x = ROLL.headX + (b * F.beat - F.tick) / F.beat * perBeat;
      if (x < AREA.x - 1 || x > AREA.x + AREA.w + 1) continue;
      const isBar = ((b % 4) + 4) % 4 === 0;
      ctx.fillStyle = isBar ? '#c9cecf' : '#dde2e3';
      ctx.fillRect(Math.round(x) - .5, AREA.y, 1, AREA.h);
      if (isBar) bars.push({ x, n: ((Math.floor(b / 4) % loopBars) + loopBars) % loopBars + 1 });
    }

    // notes
    hRollNotes(F, ROLL, parts, range, ({ track, left, right, y, age }) => {
      const x0 = Math.max(AREA.x - 40, left), x1 = Math.min(AREA.x + AREA.w + 40, right);
      if (x1 <= x0) return;
      visible.add(track);
      const palette = PART[track.slot % PART.length];
      const sounding = left <= ROLL.headX && right >= ROLL.headX;
      const alpha = sounding ? 1 : age < 0 ? .72 : 1;
      const h = Math.max(6, Math.min(16, rowH * .86));
      const w = Math.max(6, x1 - x0 - 3);
      ctx.beginPath();
      roundedRect(ctx, x0 + 1.5, y - h / 2, w, h, 2);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = palette.fill;
      ctx.fill();
      ctx.strokeStyle = age < 0 ? palette.ghost : palette.stroke;
      ctx.lineWidth = 2.2;
      ctx.stroke();
      if (trackRole(track) === 'chords' && x1 - x0 > 20) {
        // bracket under chord notes: the span of the held note
        const by = y + h / 2 + 5.5;
        ctx.globalAlpha = (age < 0 ? .75 : 1) * .9;
        ctx.strokeStyle = '#3f5fb0';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x0 + 1.5, by); ctx.lineTo(x0 + 1.5 + w, by);
        ctx.moveTo(x0 + 1.5, by - 4); ctx.lineTo(x0 + 1.5, by + 4);
        ctx.moveTo(x0 + 1.5 + w, by - 4); ctx.lineTo(x0 + 1.5 + w, by + 4);
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;

    // playhead: soft glow, crisp line, a cap at the top
    const head = ROLL.headX;
    const pulse = .85 + .15 * clamp(F.hit);
    for (const [w, a] of [[12, .06], [7, .1], [4, .2]] as const) {
      ctx.fillStyle = '#4c7ad2';
      ctx.globalAlpha = a * pulse;
      ctx.fillRect(head - w / 2 + .2, AREA.y, w, AREA.h);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = BLUE;
    ctx.fillRect(head - 1, AREA.y, 2, AREA.h);
    ctx.beginPath();
    ctx.arc(head, AREA.y, 6, 0, TAU);
    ctx.fill();
    ctx.restore();

    // key gutter (covers notes that slide under it)
    ctx.fillStyle = '#e6ebec';
    ctx.fillRect(RULER.x, AREA.y, GUTTER, AREA.h);
    ctx.fillStyle = '#d4d8d9';
    ctx.fillRect(AREA.x - 1, AREA.y, 1.2, AREA.h);
    for (let p = range.lo; p <= range.hi; p++) {
      if (((p % 12) + 12) % 12 !== 0) continue;
      const cy = rowCentre(ROLL, range, p);
      ctx.fillStyle = '#d8ddde';
      ctx.fillRect(RULER.x, cy - rowH / 2, GUTTER - 1, rowH);
      squeezed(F, `C${Math.floor(p / 12) - 2}`, AREA.x - 7, cy + 3.6, { ...mono, size: 11, color: '#4a4e50', align: 'right' });
    }

    // time ruler
    ctx.fillStyle = '#e6ebec';
    ctx.fillRect(RULER.x, RULER.y, RULER.w, RULER.h);
    ctx.fillStyle = '#d3d8d9';
    ctx.fillRect(RULER.x, RULER.y + RULER.h - .5, RULER.w, 1.2);
    ctx.save();
    ctx.beginPath();
    ctx.rect(AREA.x, RULER.y, AREA.w, RULER.h);
    ctx.clip();
    for (const bar of bars) squeezed(F, String(bar.n), bar.x + 7, RULER.y + 13, { ...mono, size: 13, color: '#6e7274' });
    ctx.restore();

    // legend
    let lx = 44;
    const roles = parts.map(trackRole);
    parts.slice(0, 5).forEach((track, i) => {
      const palette = PART[track.slot % PART.length];
      const alive = visible.has(track);
      ctx.beginPath();
      ctx.arc(lx, 89, 4.2, 0, TAU);
      ctx.globalAlpha = alive ? 1 : .5;
      ctx.strokeStyle = alive ? palette.stroke : palette.ghost;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const label = (roles.indexOf(roles[i]) !== roles.lastIndexOf(roles[i]) ? partLabel(track, 10) : roleLabel(track)).toLowerCase();
      const width = squeezed(F, label, lx + 9, 93.5, { ...mono, size: 12, color: alive ? '#62666a' : '#c3c7c9' });
      lx += 9 + width + 18;
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  },
};
