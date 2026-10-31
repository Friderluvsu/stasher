import { fill, MONO, text, W } from '../kit';
import { TAU, activeNotes, dot, loopT, type Frame, type TrackView } from '../frame';
import { trackRole } from '../kit';
import { pitchMap } from './_E';
import type { Look } from './types';

const PAPER = '#edece1';
const CX = W / 2, CY = 500;
const R_MIN = 49, R_MAX = 192;
const SQUASH = .84;
const COLORS = ['#d9432b', '#2a9388', '#8c8a7a', '#c9962f', '#3b6fb5', '#6a9a3c', '#b8508f', '#2b8aa6'];
const stationColor = (track: TrackView) => COLORS[track.slot % COLORS.length];

// Harmonics of every isobar: [order, amplitude, phase, drift direction]
const LEVELS = [43, 65, 90, 120, 154, 192];
const HARM: [number, number, number, number][][] = LEVELS.map((_, k) => [
  [1, .075 + k * .012, k * 1.7 + .4, 1], [2, .07, k * 2.3 + 1.1, -1], [3, .05, k * .9 + 2.6, 1], [5, .022, k * 1.3, -2],
]);

function contour(F: Frame, k: number, bumps: { theta: number; radius: number; push: number }[], drift: number) {
  const { ctx } = F;
  const R = LEVELS[k];
  const steps = F.thumb ? 56 : 96;
  ctx.beginPath();
  for (let s = 0; s <= steps; s++) {
    const theta = s / steps * TAU;
    let rho = 0;
    for (const [order, amp, phase, dir] of HARM[k]) rho += amp * Math.sin(order * theta + phase + dir * drift);
    rho = R * (1 + rho) + (k > 1 ? 5 * Math.sin(theta - .8 + drift) * k : 0);
    for (const bump of bumps) {
      let d = Math.abs(theta - bump.theta);
      if (d > Math.PI) d = TAU - d;
      const dr = (R - bump.radius) / 38;
      rho += bump.push * Math.exp(-((d / .55) ** 2) - dr * dr);
    }
    const a = theta - Math.PI / 2;
    const x = CX + Math.cos(a) * rho - 8 + k * 3, y = CY + Math.sin(a) * rho * SQUASH;
    if (s) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function station(F: Frame, x: number, y: number, tx: number, ty: number, color: string, alpha: number, pop: number, length: number) {
  const { ctx } = F;
  const r = 4.6 * pop;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + tx * r, y + ty * r);
  ctx.lineTo(x + tx * length, y + ty * length);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = PAPER;
  ctx.fill();
  ctx.lineWidth = 1.7;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export const weather: Look = {
  id: 'weather',
  group: 'midi',
  nameRu: 'Погода',
  nameEn: 'Weather',
  descriptionRu: 'Синоптическая карта: изобары вокруг тональности, ноты как метеостанции, фронт идёт по кругу',
  descriptionEn: 'A surface-analysis weather map: isobars around the key, notes as stations, a front sweeping the loop',
  draw(F) {
    const { ctx } = F;
    fill(F, PAPER);
    const map = pitchMap(F);
    const sweep = F.tick / F.total;
    const radiusOf = (track: TrackView, pitch: number) => R_MIN + (R_MAX - R_MIN) * map.norm(track, pitch);

    // pressure bumps from sounding notes
    const bumps: { theta: number; radius: number; push: number }[] = [];
    for (const track of F.tracks) {
      if (trackRole(track) === 'drums') continue;
      for (const note of activeNotes(F, track.index)) {
        bumps.push({ theta: ((note.pos / F.total) % 1 + 1) % 1 * TAU, radius: radiusOf(track, note.pitch), push: 8 * note.env * (.4 + .6 * note.vel) });
      }
    }
    const drift = loopT(F, 16) * TAU;

    // isobars: dark in the middle, pale outside
    for (let k = 0; k < LEVELS.length; k++) {
      const t = k / (LEVELS.length - 1);
      ctx.strokeStyle = `rgb(${Math.round(112 + 78 * t)},${Math.round(112 + 77 * t)},${Math.round(108 + 70 * t)})`;
      ctx.lineWidth = 1.15 - .1 * t;
      contour(F, k, bumps.slice(0, 24), drift);
      ctx.stroke();
    }

    // centre label
    const key = F.meta.key || 'L';
    text(F, key, CX, CY + 10.5, { size: 30, weight: 300, color: '#16181a', align: 'center', font: MONO });
    text(F, String(1012 - Math.round(7 + 12 * F.env + 8 * F.hit)), CX, CY + 28, { size: 8.5, font: MONO, color: '#72736c', align: 'center' });

    // stations
    for (const track of F.tracks) {
      const { index } = track;
      const color = stationColor(track), drum = trackRole(track) === 'drums';
      for (let i = 0; i < index.n; i++) {
        const t0 = index.pos[i] / F.total;
        if (t0 >= 1) continue;
        const theta = t0 * TAU, a = theta - Math.PI / 2;
        const r = radiusOf(track, index.pitch[i]);
        const x = CX + Math.cos(a) * r, y = CY + Math.sin(a) * r;
        const lit = sweep >= t0;
        if (drum) {
          const recent = lit ? (F.tick - index.pos[i]) / F.tps : 9;
          if (recent < .35) dot(F, x, y, 1.6 + 2.2 * (1 - recent / .35), color, .85 * (1 - recent / .35));
          continue;
        }
        const age = lit ? (F.tick - index.pos[i]) / F.tps : -1;
        const pop = lit ? 1 + .6 * Math.exp(-age / .22) : 1;
        const length = 15 + 4.5 * index.vel[i];
        station(F, x, y, Math.cos(theta), Math.sin(theta), color, lit ? 1 : .4, pop, length);
      }
    }

    ctx.globalAlpha = 1;
    // the front: a heavy line with triangles on the side the sweep moves towards
    const fa = sweep * TAU - Math.PI / 2, c = Math.cos(fa), s = Math.sin(fa);
    const r0 = 78, r1 = 232;
    ctx.strokeStyle = '#74756d';
    ctx.lineWidth = 2.1;
    ctx.beginPath();
    ctx.moveTo(CX + c * r0, CY + s * r0);
    ctx.lineTo(CX + c * r1, CY + s * r1);
    ctx.stroke();
    ctx.fillStyle = '#6d6e66';
    for (let r = r0 + 28; r < r1 - 4; r += 30) {
      const bx = CX + c * r, by = CY + s * r;
      ctx.beginPath();
      ctx.moveTo(bx - c * 4, by - s * 4);
      ctx.lineTo(bx + c * 4, by + s * 4);
      ctx.lineTo(bx - s * 6.5, by + c * 6.5);
      ctx.closePath();
      ctx.fill();
    }

    text(F, F.meta.title, 30, 62, { size: 30, font: MONO, color: '#14181b', maxWidth: 480 });
    text(F, `SURFACE ANALYSIS · ${Math.round(F.meta.bpm)} BPM${F.meta.key ? ` · ${F.meta.key}` : ''}`, 30, 80, { size: 9, font: MONO, color: '#66655c' });
  },
};
