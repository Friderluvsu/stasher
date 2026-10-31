import { fill, MONO, rand, text } from '../kit';
import { TAU, audioAt, glow, type Frame } from '../frame';
import type { Look } from './types';

const BG = '#0c0b10';
const CX = 270, CY = 424;
const SUN = 6.75, RING0 = 33.75, GAP = 14.25, RIM = 203.25;
const BANDS = 12;
const COLORS = ['#7b5ae0', '#25a99c', '#d2f547', '#f2a229'];
const BASE_RATE = .1;

interface Track { step: number; cum: Float32Array }
const tracks = new WeakMap<object, Track>();

// Mean level of each of the 12 log-spaced bands out of the 32-bin spectrum.
function bandsOf(spectrum: Float32Array, out: Float32Array) {
  for (let k = 0; k < BANDS; k++) {
    const from = k * 32 / BANDS, to = (k + 1) * 32 / BANDS;
    let sum = 0, weight = 0;
    for (let i = Math.floor(from); i < Math.ceil(to); i++) {
      const w = Math.min(i + 1, to) - Math.max(i, from);
      sum += spectrum[i] * w; weight += w;
    }
    out[k] = Math.min(1, (sum / Math.max(1e-6, weight)) ** .85 * 1.25);
  }
}

// Orbital angle is the integral of the band level, so it is rebuilt from the whole clip once (cached per audio / note set).
function history(F: Frame): Track {
  const key = (F.audio.analysis || F.notes) as object;
  const known = tracks.get(key);
  if (known) return known;
  const duration = Math.max(1, F.meta.duration);
  const n = Math.min(900, Math.max(60, Math.ceil(duration / .12)));
  const step = duration / n;
  const cum = new Float32Array((n + 1) * BANDS);
  const levels = new Float32Array(BANDS);
  for (let i = 0; i < n; i++) {
    const a = audioAt(F, (i + .5) * step - F.meta.seconds + 1e-6);
    bandsOf(a.spectrum, levels);
    for (let k = 0; k < BANDS; k++) cum[(i + 1) * BANDS + k] = cum[i * BANDS + k] + (BASE_RATE + levels[k]) * step;
  }
  const track = { step, cum };
  tracks.set(key, track);
  return track;
}

function integral(track: Track, seconds: number, k: number): number {
  const n = track.cum.length / BANDS - 1;
  const at = Math.min(n, Math.max(0, seconds / track.step));
  const i = Math.min(n - 1, Math.floor(at)), t = at - i;
  return track.cum[i * BANDS + k] * (1 - t) + track.cum[(i + 1) * BANDS + k] * t;
}

export const orrery: Look = {
  id: 'orrery',
  group: 'audio',
  nameRu: 'Оррери',
  nameEn: 'Orrery',
  descriptionRu: 'Двенадцать планет по кольцам: скорость орбиты равна громкости своей полосы частот',
  descriptionEn: 'Twelve planets on twelve rings, each orbiting at the speed of its frequency band',
  draw(F) {
    const { ctx } = F;
    fill(F, BG);
    const track = history(F);
    const now = new Float32Array(BANDS);
    bandsOf(audioAt(F, 1e-6).spectrum, now);
    const seconds = F.meta.seconds;

    // rings
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = .9;
    ctx.globalAlpha = .23;
    for (let k = 0; k < BANDS; k++) { ctx.beginPath(); ctx.arc(CX, CY, RING0 + GAP * k, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = .3;
    ctx.beginPath(); ctx.arc(CX, CY, 13.5, 0, TAU); ctx.stroke();
    ctx.globalAlpha = .26;
    ctx.beginPath(); ctx.arc(CX, CY, RIM, 0, TAU); ctx.stroke();
    // rim scale: minor ticks every 6 degrees, long ones every 30
    ctx.beginPath();
    for (let i = 0; i < 60; i++) {
      const long = i % 5 === 0, a = i / 60 * TAU - Math.PI / 2, c = Math.cos(a), s = Math.sin(a), r0 = RIM - (long ? 9 : 4.5);
      ctx.moveTo(CX + c * r0, CY + s * r0);
      ctx.lineTo(CX + c * RIM, CY + s * RIM);
    }
    ctx.globalAlpha = .24;
    ctx.stroke();
    ctx.globalAlpha = 1;
    text(F, '6.3 kHz', CX + 10, CY - RIM + 3, { size: 7.5, font: MONO, color: '#6a6a7a', spacing: 1.2 });
    text(F, '40 Hz', CX + 8, CY - RING0 - 5, { size: 7.5, font: MONO, color: '#6a6a7a', spacing: 1.2 });

    // planets
    const planets: { x: number; y: number; angle: number; r: number; color: string; level: number; size: number; speed: number }[] = [];
    for (let k = 0; k < BANDS; k++) {
      const orbit = RING0 + GAP * k;
      const rate = 1.4 - .07 * k;
      const angle = rand(k, 91) * TAU + rate * integral(track, seconds, k) * 1.0 - Math.PI / 2;
      const level = now[k];
      planets.push({
        x: CX + Math.cos(angle) * orbit, y: CY + Math.sin(angle) * orbit, angle, r: orbit, color: COLORS[k % 4],
        level, size: 4.3 + 3.4 * level ** .7 + 1.2 * F.hit * level, speed: rate * (BASE_RATE + level),
      });
    }

    // spokes from the sun, brighter the louder the planet
    ctx.lineWidth = .8;
    for (const p of planets) {
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = .1 + .22 * p.level;
      ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    // alignments: two planets on one line through the sun
    ctx.strokeStyle = '#ffffff';
    for (let i = 0; i < BANDS; i++) for (let j = i + 1; j < BANDS; j++) {
      let d = Math.abs(planets[i].angle - planets[j].angle) % TAU;
      if (d > Math.PI) d = TAU - d;
      const off = Math.min(d, Math.PI - d);
      if (off > .09) continue;
      const strength = (1 - off / .09) * Math.min(1, .35 + planets[i].level + planets[j].level);
      ctx.globalAlpha = .4 * strength;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(planets[i].x, planets[i].y); ctx.lineTo(planets[j].x, planets[j].y); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // trails and bodies
    ctx.lineCap = 'round';
    for (const p of planets) {
      const length = Math.min(1.1, p.speed * .55);
      const parts = F.thumb ? 3 : 8;
      for (let s = 0; s < parts; s++) {
        const a0 = p.angle - length * (s + 1) / parts, a1 = p.angle - length * s / parts;
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = .6 * (1 - s / parts) ** 1.6 * (.4 + .6 * p.level);
        ctx.lineWidth = Math.max(.6, p.size * .5 * (1 - s / parts));
        ctx.beginPath(); ctx.arc(CX, CY, p.r, a0, a1 + .01); ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
    for (const p of planets) {
      if (!F.thumb) glow(F, p.color, p.x, p.y, p.size * 3.2, .3 + .3 * p.level);
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    }
    // sun
    ctx.fillStyle = '#c0bfce';
    ctx.beginPath(); ctx.arc(CX, CY, SUN, 0, TAU); ctx.fill();

    text(F, F.meta.title, 30, 54, { size: 27, font: MONO, color: '#d8d9e2', maxWidth: 480 });
    text(F, [Math.round(F.meta.bpm) + ' BPM', F.meta.key].filter(Boolean).join(' · '), 30, 70, { size: 9, font: MONO, color: '#666674', spacing: 2.6 });
    text(F, 'TWELVE RINGS · RATE = BAND LEVEL · ALIGNMENT IS THE EVENT', 30, 902, { size: 8.25, font: MONO, color: '#74748a', spacing: 2.1 });
  },
};
