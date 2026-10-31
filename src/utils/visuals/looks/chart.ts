import { clamp, glow, TAU, type Frame, type TrackView } from '../frame';
import { fill, MONO, rand, text, trackColorAt, trackRole } from '../kit';
import { mix } from '../color';
import type { Look } from './types';

// A night-sky chart: every note of the loop is a star (time across, pitch up), joined by thin arcs, and a soft vertical
// scan band sweeps across them; stars ignite when the band passes, bass notes get a little satellite and a glare.
// Drawn in the reference's 720 x 1280 space.

const K = .75;
const X0 = 85, X1 = 632;
const Y_TOP = 300, Y_BOTTOM = 1040;
const STARS = 90;

interface Star { x: number; y: number; on: boolean; age: number; r: number; i: number; vel: number; dur: number }

const rangeCache = new WeakMap<object, [number, number]>();

function chartRange(F: Frame): [number, number] {
  const known = rangeCache.get(F.notes);
  if (known) return known;
  let lo = Infinity, hi = -Infinity;
  for (const track of F.tracks) {
    if (trackRole(track) === 'drums' && F.tracks.length > 1) continue;
    lo = Math.min(lo, track.index.minPitch);
    hi = Math.max(hi, track.index.maxPitch);
  }
  if (!(hi > lo)) { lo = 48; hi = 72; }
  if (hi - lo < 14) { const m = (hi + lo) / 2; lo = m - 7; hi = m + 7; }
  const made: [number, number] = [lo, hi];
  rangeCache.set(F.notes, made);
  return made;
}

function lighten(color: string, t: number) { return mix(color, '#ffffff', t); }

export const chart: Look = {
  id: 'chart',
  group: 'midi',
  nameRu: 'Звёздная карта',
  nameEn: 'Star chart',
  descriptionRu: 'Ноты как звёзды на ночной карте: световая полоса проходит и зажигает их',
  descriptionEn: 'Notes as stars on a night chart that a soft scan band sweeps across and ignites',
  draw(F) {
    const g = F.ctx;
    fill(F, '#03060f');
    g.save();
    g.scale(K, K);

    // deep navy glow and vignette
    const bg = g.createRadialGradient(340, 560, 20, 340, 560, 720);
    bg.addColorStop(0, '#12254f');
    bg.addColorStop(.35, '#0c1a3c');
    bg.addColorStop(.75, '#050b1d');
    bg.addColorStop(1, '#02040b');
    g.fillStyle = bg;
    g.fillRect(0, 0, 720, 1280);
    const side = g.createLinearGradient(0, 0, 720, 0);
    side.addColorStop(0, 'rgba(1,3,8,0.85)');
    side.addColorStop(.12, 'rgba(1,3,8,0)');
    side.addColorStop(.88, 'rgba(1,3,8,0)');
    side.addColorStop(1, 'rgba(1,3,8,0.8)');
    g.fillStyle = side;
    g.fillRect(0, 0, 720, 1280);

    // dust
    if (!F.thumb) {
      for (let i = 0; i < STARS; i++) {
        const tw = .6 + .4 * Math.sin(F.meta.seconds * (.6 + rand(i, 3)) + rand(i, 4) * TAU);
        g.fillStyle = `rgba(190,205,255,${(.18 + .4 * rand(i, 5)) * tw})`;
        g.fillRect(rand(i, 1) * 720, rand(i, 2) * 1280, 1 + (rand(i, 6) > .85 ? 1 : 0), 1 + (rand(i, 6) > .85 ? 1 : 0));
      }
    }

    const [lo, hi] = chartRange(F);
    const yOf = (pitch: number) => Y_BOTTOM - (pitch - lo) / (hi - lo) * (Y_BOTTOM - Y_TOP);
    const xOf = (pos: number) => X0 + (X1 - X0) * pos / F.total;
    const xNow = xOf(F.tick);

    const parts = F.tracks.filter(track => trackRole(track) !== 'drums');
    const shown: TrackView[] = parts.length ? parts : F.tracks;
    for (const track of shown) {
      const color = lighten(trackColorAt(track.slot), .22);
      const role = trackRole(track);
      const { index } = track;
      const step = Math.max(1, Math.ceil(index.n / 240));
      const stars: Star[] = [];
      for (let i = 0; i < index.n; i += step) {
        const age = F.tick - index.pos[i];
        stars.push({ x: xOf(index.pos[i]), y: yOf(index.pitch[i]), on: age >= 0, age, r: 3 + 2.6 * index.vel[i], i, vel: index.vel[i], dur: index.dur[i] });
      }
      // arcs to the next two stars
      g.lineWidth = 1.1;
      for (let k = 0; k < stars.length; k++) {
        for (let hop = 1; hop <= 2; hop++) {
          const a = stars[k], b = stars[k + hop];
          if (!b) continue;
          const dy = b.y - a.y, bow = Math.abs(b.x - a.x) < 2 ? -11 : 0;
          g.strokeStyle = color;
          g.globalAlpha = (b.on ? .26 : .1) / hop;
          g.beginPath();
          g.moveTo(a.x, a.y);
          g.bezierCurveTo(a.x + bow, a.y + dy * .6, b.x + bow, b.y - dy * .6, b.x, b.y);
          g.stroke();
        }
      }
      g.globalAlpha = 1;
      let lastPlayed = -1;
      stars.forEach((s, k) => { if (s.on) lastPlayed = k; });
      stars.forEach((s, k) => {
        const sinceTicks = s.age / F.beat;
        let fresh = s.on ? clamp(1 - sinceTicks / 2.6) : 0;
        if (role === 'bass' && s.on && lastPlayed - k < 3) fresh = Math.max(fresh, [1, .8, .62][lastPlayed - k] * .8);
        const flash = s.on ? clamp(1 - s.age / (F.tps * .35)) : 0;
        const dim = s.on ? 1 : .42;
        const r = s.r * (role === 'bass' ? 1.5 : 1) * (1 + .6 * flash);
        // glow for lit stars
        if (s.on && !F.thumb) glow(F, color, s.x, s.y, r * (4 + 4 * flash), .22 + .35 * fresh + .3 * flash);
        g.globalAlpha = dim;
        g.fillStyle = s.on ? color : mix(color, '#0c1a3c', .5);
        g.beginPath();
        g.arc(s.x, s.y, r, 0, TAU);
        g.fill();
        if (role === 'bass' && s.dur < F.beat * 3) {
          g.globalAlpha = dim * (s.on ? .85 : .6);
          g.beginPath();
          g.arc(s.x + 30, s.y, r * .52, 0, TAU);
          g.fill();
        }
        // four-point glare on the freshest notes
        if (s.on && fresh > .02 && !F.thumb) {
          const len = (30 + 40 * flash) * fresh ** .6;
          g.strokeStyle = color;
          g.lineWidth = 1;
          g.globalAlpha = .55 * fresh ** 1.3;
          g.beginPath();
          g.moveTo(s.x - len, s.y);
          g.lineTo(s.x + len, s.y);
          g.moveTo(s.x, s.y - len * .9);
          g.lineTo(s.x, s.y + len * .9);
          g.stroke();
        }
        g.globalAlpha = 1;
      });
    }

    // the scan band
    {
      const w = 28, top = 40, bottom = 1213;
      const band = g.createLinearGradient(xNow - w, 0, xNow + 2, 0);
      band.addColorStop(0, 'rgba(160,180,230,0)');
      band.addColorStop(1, 'rgba(170,190,235,0.26)');
      const vertical = g.createLinearGradient(0, top, 0, bottom);
      vertical.addColorStop(0, 'rgba(255,255,255,0)');
      vertical.addColorStop(.1, 'rgba(255,255,255,1)');
      vertical.addColorStop(.9, 'rgba(255,255,255,1)');
      vertical.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalAlpha = 1;
      g.fillStyle = band;
      g.fillRect(xNow - w, top, w + 2, bottom - top);
      g.fillStyle = 'rgba(190,205,245,0.5)';
      g.fillRect(xNow - 1.2, top + 230, 1.6, bottom - top - 330);
      g.fillStyle = 'rgba(210,225,255,0.13)';
      g.fillRect(xNow + 1, top, 4, bottom - top);
      void vertical;
    }

    text(F, `${F.meta.title.toUpperCase()} · ${Math.round(F.meta.bpm)} BPM${F.meta.key ? ` · ${F.meta.key}` : ''}`, 40, 1231, { size: 13.5, font: MONO, color: '#8d96b4', spacing: 2, maxWidth: 640 });
    g.restore();
  },
};
