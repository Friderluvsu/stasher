import { H, infoLine, MONO, noteLabel, text, W } from '../kit';
import { TAU, fillRounded, glow } from '../frame';
import type { Frame } from '../frame';
import { legendLabels, partColor, pitchMap } from './_E';
import type { Look } from './types';

const BG = '#080a0e';
const CX = W / 2, CY = 486;
const R_LOW = 61.5, R_HIGH = 178, R_TICK = 193;
const NOTE_W = 4.8;
const DIM = .21;


function drawBackdrop(F: Frame) {
  const { ctx } = F;
  ctx.globalAlpha = 1;
  ctx.fillStyle = BG;
  ctx.fillRect(-2, -2, W + 4, H + 4);
  const lift = .88 + .12 * Math.max(F.env * .6, F.audio.level);
  const gradient = ctx.createRadialGradient(CX, CY, 0, CX, CY, 225);
  gradient.addColorStop(0, `rgba(26,22,48,${lift})`);
  gradient.addColorStop(.4, `rgba(22,18,38,${.9 * lift})`);
  gradient.addColorStop(.7, 'rgba(17,13,28,0.75)');
  gradient.addColorStop(.9, 'rgba(12,11,20,0.45)');
  gradient.addColorStop(1, 'rgba(8,10,14,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(CX - 225, CY - 225, 450, 450);
}

function drawDial(F: Frame) {
  const { ctx } = F;
  // pitch rings
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = .75;
  ctx.globalAlpha = .14;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.arc(CX, CY, R_LOW + (R_HIGH - R_LOW) * i / 3, 0, TAU);
    ctx.stroke();
  }
  // ticks every 5 degrees, long ones at the cardinal points
  ctx.beginPath();
  for (let i = 0; i < 72; i++) {
    if (i % 18 === 0) continue;
    const a = i / 72 * TAU - Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    ctx.moveTo(CX + c * R_TICK, CY + s * R_TICK);
    ctx.lineTo(CX + c * (R_TICK + 5), CY + s * (R_TICK + 5));
  }
  ctx.globalAlpha = .3;
  ctx.lineWidth = .8;
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU - Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    ctx.moveTo(CX + c * (R_TICK - 2.5), CY + s * (R_TICK - 2.5));
    ctx.lineTo(CX + c * (R_TICK + 8.5), CY + s * (R_TICK + 8.5));
  }
  ctx.globalAlpha = .75;
  ctx.lineWidth = 1.1;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function strokeArcs(F: Frame, arcs: number[], alpha: number) {
  const { ctx } = F;
  if (!arcs.length) return;
  ctx.beginPath();
  for (let i = 0; i < arcs.length; i += 3) {
    ctx.moveTo(CX + Math.cos(arcs[i]) * arcs[i + 2], CY + Math.sin(arcs[i]) * arcs[i + 2]);
    ctx.arc(CX, CY, arcs[i + 2], arcs[i], arcs[i + 1]);
  }
  ctx.globalAlpha = alpha;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawNotes(F: Frame) {
  const { ctx } = F;
  const map = pitchMap(F);
  const sweep = F.tick / F.total;
  text(F, noteLabel(map.low), CX + 6, CY - R_LOW + 3, { size: 8.5, font: MONO, color: '#9a9ba2', alpha: .6, spacing: .3 });
  text(F, noteLabel(map.high), CX + 6, CY - R_HIGH + 3, { size: 8.5, font: MONO, color: '#9a9ba2', alpha: .6, spacing: .3 });
  ctx.lineCap = 'round';
  ctx.lineWidth = NOTE_W;
  const heads: { x: number; y: number; color: string; value: number }[] = [];
  for (const track of F.tracks) {
    const { index } = track;
    const color = partColor(track);
    const dim: number[] = [], lit: number[] = [];
    for (let i = 0; i < index.n; i++) {
      const t0 = index.pos[i] / F.total;
      if (t0 >= 1) continue;
      const r = R_LOW + (R_HIGH - R_LOW) * map.norm(track, index.pitch[i]);
      const pad = NOTE_W / 2 / r / TAU; // cap radius as a fraction of the turn
      const segments: [number, number][] = [[t0, Math.min(1, index.end[i] / F.total)]];
      if (index.end[i] > F.total) segments.push([0, Math.min(t0, index.end[i] / F.total - 1)]);
      for (const [s0, s1] of segments) {
        const start = s0 + pad, stop = Math.max(start, s1 - pad);
        const edge = (t: number) => -Math.PI / 2 + t * TAU;
        const arc = (path: number[], a: number, b: number) => { path.push(edge(a), edge(Math.max(a + .0004, b)), r); };
        if (sweep <= s0) arc(dim, start, stop);
        else if (sweep >= s1) arc(lit, start, stop);
        else {
          arc(lit, start, Math.max(start, sweep));
          if (sweep < stop) arc(dim, sweep, stop);
          heads.push({ x: CX + Math.cos(edge(sweep)) * r, y: CY + Math.sin(edge(sweep)) * r, color, value: .5 + .5 * index.vel[i] });
        }
      }
    }
    ctx.strokeStyle = color;
    strokeArcs(F, dim, DIM);
    strokeArcs(F, lit, 1);
  }
  ctx.lineCap = 'butt';
  ctx.globalAlpha = 1;
  if (!F.thumb) for (const head of heads) glow(F, head.color, head.x, head.y, 13 + 6 * F.hit, .4 * head.value);
  ctx.globalAlpha = 1;
}

function drawSweep(F: Frame) {
  const { ctx } = F;
  const a = F.tick / F.total * TAU - Math.PI / 2;
  const length = 208;
  // soft trailing wedge behind the line
  const steps = F.thumb ? 6 : 18, span = .22;
  ctx.fillStyle = '#c9c4ff';
  for (let i = 0; i < steps; i++) {
    const a0 = a - span * (i + 1) / steps, a1 = a - span * i / steps;
    ctx.globalAlpha = .05 * (1 - i / steps) ** 2.4;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.arc(CX, CY, length, a0, a1 + .002);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = .18;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(CX, CY);
  ctx.lineTo(CX + Math.cos(a) * length, CY + Math.sin(a) * length);
  ctx.stroke();
  ctx.globalAlpha = .95;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawLegend(F: Frame) {
  const tracks = F.tracks.slice(0, 6);
  const labels = legendLabels(F, tracks);
  const step = Math.min(104, 480 / Math.max(1, tracks.length));
  tracks.forEach((track, i) => {
    const x = 30 + i * step;
    const { ctx } = F;
    ctx.globalAlpha = 1;
    ctx.fillStyle = partColor(track);
    fillRounded(F, x, 875.5, 19.5, 3, 1.5, partColor(track));
    text(F, labels[i], x, 892, { size: 9, font: MONO, color: '#a6a8ae', spacing: .35 });
  });
  F.ctx.globalAlpha = .9;
  F.ctx.fillStyle = '#242629';
  F.ctx.fillRect(30, 903.2, 480, 1.1);
  F.ctx.globalAlpha = 1;
  text(F, infoLine(F, ' · ', false), 30, 922, { size: 9.75, font: MONO, color: '#8b8d94' });
}

export const oracle: Look = {
  id: 'oracle',
  group: 'midi',
  nameRu: 'Оракул',
  nameEn: 'Oracle',
  descriptionRu: 'Радар: луч за один оборот проходит весь цикл, ноты ложатся дугами на кольца высоты',
  descriptionEn: 'A radar sweep makes one turn per loop, notes light up as arcs on pitch rings',
  draw(F) {
    drawBackdrop(F);
    drawDial(F);
    drawNotes(F);
    drawSweep(F);
    if (F.meta.key) text(F, F.meta.key, CX, 491, { size: 21.5, font: MONO, color: '#f4f4f6', align: 'center' });
    text(F, F.meta.title, 30, 62, { size: 31.5, font: MONO, color: '#f2f2f4', maxWidth: 480 });
    text(F, 'ORACLE · ONE TURN = ONE LOOP', 30, 82.5, { size: 9, font: MONO, color: '#8f9096', spacing: .35 });
    drawLegend(F);
  },
};
