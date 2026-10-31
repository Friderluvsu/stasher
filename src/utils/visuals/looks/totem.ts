import { clamp, TAU, type Frame, type TrackView } from '../frame';
import { clock2, fill, MONO, partLabel, roleLabel, text, timeProgress, trackRole } from '../kit';
import type { Look } from './types';

// A totem pole: one spine, a fan of bar lamps on top and a segment per part that has started playing. Each note of a
// part is a row of the segment: faded until the note has been played, then inked in (gold discs for the bass, teal
// chevrons for chords, red beads for the melody, dashes for drums). Drawn in 720 x 1280 reference space.

const K = .75;
const CX = 360;
const SPINE_TOP = 95, SPINE_BOTTOM = 1113;
const BG = '#e9e4d2';
const INK = '#1d170c';
const TEAL = '#128a86', TEAL_FADE = 'rgba(18,138,134,0.2)';
const GOLD = '#b0791f', GOLD_FADE = 'rgba(176,140,80,0.22)';
const RED = '#d64b26';
const CREAM = '#f4edde';
const MAX_ROWS = 40;
const ROLE_ORDER: Record<string, number> = { lead: 0, chords: 1, bass: 2, drums: 3 };

interface Segment { track: TrackView; role: string; rows: number[]; count: number; weight: number; mean: number }

function rowsOf(track: TrackView): number[] {
  const { index } = track;
  const step = Math.max(1, Math.ceil(index.n / MAX_ROWS));
  const rows: number[] = [];
  for (let i = 0; i < index.n; i += step) rows.push(i);
  return rows;
}

const rowCache = new WeakMap<object, number[]>();

function segmentsOf(F: Frame): Segment[] {
  const out: Segment[] = [];
  for (const track of F.tracks) {
    const { index } = track;
    if (!index.n) continue;
    const appear = F.tick - index.firstPos;
    if (appear < 0) continue;
    let rows = rowCache.get(index);
    if (!rows) { rows = rowsOf(track); rowCache.set(index, rows); }
    let sum = 0;
    for (let i = 0; i < index.n; i++) sum += index.pitch[i];
    out.push({ track, role: trackRole(track), rows, count: index.n, weight: 1 - (1 - clamp(appear / (F.beat * 1.2))) ** 3, mean: sum / index.n });
  }
  out.sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || b.mean - a.mean);
  // keep the pole readable: melodic parts only (at most three), drums only when there is nothing else
  const melodic = out.filter(seg => seg.role !== 'drums');
  const pool = melodic.length ? melodic : out;
  if (pool.length <= 3) return pool;
  const keep = new Set(pool.slice().sort((a, b) => b.count - a.count).slice(0, 3));
  return pool.filter(seg => keep.has(seg));
}

function ellipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, TAU);
}

function drawFan(F: Frame, g: CanvasRenderingContext2D) {
  const baseY = 93, radius = 47, count = 8;
  const bars = Math.max(1, Math.round(F.total / F.bar));
  const done = Math.min(count, Math.floor(timeProgress(F) * Math.min(count, bars)) + 1);
  g.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const a = (-57 + i * 16) * Math.PI / 180;
    const x = CX + Math.sin(a) * radius, y = baseY - Math.cos(a) * radius;
    g.strokeStyle = INK;
    g.lineWidth = 3.4;
    g.beginPath();
    g.moveTo(CX, baseY);
    g.lineTo(CX + Math.sin(a) * (radius - 6), baseY - Math.cos(a) * (radius - 6));
    g.stroke();
    const lit = i < done;
    const pop = lit && i === done - 1 ? 1 + .22 * (1 - clamp(((F.tick / F.bar) % 1) * 4)) ** 2 : 1;
    g.fillStyle = lit ? RED : CREAM;
    g.lineWidth = 2.6;
    ellipse(g, x, y, 7.4 * pop, 7.4 * pop);
    g.fill();
    g.stroke();
  }
}

function drawChevrons(g: CanvasRenderingContext2D, y: number, pitch: number, played: boolean, pop: number) {
  const s = clamp(Math.pow(pitch / 13.7, .6), .6, 1.7) * pop;
  const half = 14 * s, rise = 14 * s;
  g.strokeStyle = played ? TEAL : TEAL_FADE;
  g.lineWidth = 3.1;
  g.lineCap = 'butt';
  g.lineJoin = 'miter';
  for (const side of [-1, 1]) {
    const cx = CX + side * 20 * s;
    g.beginPath();
    g.moveTo(cx - half, y + rise / 2);
    g.lineTo(cx, y - rise / 2);
    g.lineTo(cx + half, y + rise / 2);
    g.stroke();
  }
}

function drawDisc(g: CanvasRenderingContext2D, y: number, pitch: number, size: number, played: boolean, pop: number) {
  const s = clamp(Math.pow(pitch / 15, .9), .45, 1.9) * pop;
  const rx = 18.5 * s * size, ry = 10.6 * s * size, dx = rx + 3;
  for (const side of [-1, 1]) {
    const x = CX + side * dx;
    ellipse(g, x, y, rx, ry);
    g.fillStyle = played ? GOLD : GOLD_FADE;
    g.fill();
    g.strokeStyle = played ? '#2a1c0a' : 'rgba(150,130,90,0.55)';
    g.lineWidth = played ? 2 : 1.2;
    g.stroke();
  }
  g.strokeStyle = played ? 'rgba(40,30,15,0.45)' : 'rgba(110,100,80,0.7)';
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(CX - dx, y);
  g.lineTo(CX + dx, y);
  g.stroke();
  for (const side of [-1, 1]) {
    ellipse(g, CX + side * dx, y, 4.7 * Math.max(.7, s * size), 4.7 * Math.max(.7, s * size));
    g.fillStyle = played ? '#1f1a14' : 'rgba(150,135,105,0.6)';
    g.fill();
  }
}

function drawBeads(g: CanvasRenderingContext2D, y: number, pitch: number, played: boolean, pop: number) {
  const s = clamp(pitch / 14, .4, 1.6) * pop;
  for (const side of [-1, 1]) {
    ellipse(g, CX + side * 19 * s, y, 6.2 * s, 6.2 * s);
    g.fillStyle = played ? RED : 'rgba(214,75,38,0.2)';
    g.fill();
    g.strokeStyle = played ? INK : 'rgba(80,60,40,0.3)';
    g.lineWidth = played ? 2 : 1.2;
    g.stroke();
  }
  g.strokeStyle = played ? 'rgba(29,23,12,0.5)' : 'rgba(110,100,80,0.45)';
  g.lineWidth = 1.2;
  g.beginPath();
  g.moveTo(CX - 13 * s, y);
  g.lineTo(CX + 13 * s, y);
  g.stroke();
}

function drawDash(g: CanvasRenderingContext2D, y: number, pitch: number, played: boolean, pop: number) {
  const half = 16 * clamp(pitch / 14, .5, 1.5) * pop;
  g.strokeStyle = played ? INK : 'rgba(29,23,12,0.2)';
  g.lineWidth = played ? 3.4 : 2;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(CX - half, y);
  g.lineTo(CX - 5, y);
  g.moveTo(CX + 5, y);
  g.lineTo(CX + half, y);
  g.stroke();
}

export const totem: Look = {
  id: 'totem',
  group: 'midi',
  nameRu: 'Тотем',
  nameEn: 'Totem',
  descriptionRu: 'Столб из нот: сыгранные ноты каждой партии закрашиваются сверху вниз',
  descriptionEn: 'A pole of notes: each part\'s played notes ink in from the top down',
  draw(F) {
    const g = F.ctx;
    fill(F, BG);
    g.save();
    g.scale(K, K);

    const segments = segmentsOf(F);
    let total = 0;
    for (const s of segments) total += s.weight;
    const span = SPINE_BOTTOM - 14 - (SPINE_TOP + 4);

    // spine
    g.strokeStyle = '#777062';
    g.lineWidth = 3;
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(CX, SPINE_TOP - 4);
    g.lineTo(CX, SPINE_BOTTOM);
    g.stroke();

    let cursor = SPINE_TOP + 4;
    const nowTick = F.tick;
    for (const seg of segments) {
      const length = total > 0 ? span * seg.weight / total : 0;
      const n = seg.rows.length;
      const pitch = length / Math.max(1, n);
      const { index } = seg.track;
      // faded rows first (so the inked ones overlap them), top to bottom
      for (let k = 0; k < n; k++) {
        const i = seg.rows[k];
        const y = cursor + pitch * (k + .5);
        const played = index.pos[i] <= nowTick;
        const age = (nowTick - index.pos[i]) / F.tps;
        const pop = played && age < .3 ? 1 + .22 * (1 - age / .3) ** 2 : 1;
        if (seg.role === 'bass') drawDisc(g, y, pitch, .82 + .18 * (.5 * index.vel[i] + .5 * clamp(index.dur[i] / (F.beat * 2))), played, pop);
        else if (seg.role === 'chords') drawChevrons(g, y, pitch, played, pop);
        else if (seg.role === 'lead') drawBeads(g, y, pitch, played, pop);
        else drawDash(g, y, pitch, played, pop);
      }
      cursor += length;
    }

    // arrow head
    g.beginPath();
    g.moveTo(326, SPINE_BOTTOM);
    g.lineTo(394, SPINE_BOTTOM);
    g.lineTo(CX, SPINE_BOTTOM + 18);
    g.closePath();
    g.fillStyle = '#1a1408';
    g.fill();

    drawFan(F, g);

    const seen = new Set<string>();
    const parts = segments.map(seg => {
      let label = roleLabel(seg.track);
      if (seen.has(label)) label = partLabel(seg.track, 8);
      seen.add(label);
      return `${label} ${seg.count}`;
    });
    text(F, [...parts, `${Math.round(F.meta.bpm)} BPM`, F.meta.key].filter(Boolean).join(' · '), 40, 1205, { size: 14.5, font: MONO, color: '#8a8270', spacing: 1.3, maxWidth: 640 });
    void clock2;
    g.restore();
  },
};
