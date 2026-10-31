import { audioAt, loopPhase, pitchNorm, roundedRect } from '../frame';
import type { Frame, TrackView } from '../frame';
import { fill, MONO, text, timeProgress, trackRole, totalBars, clock, W, H } from '../kit';
import type { Look } from './types';

const ROLE_COLOR = { bass: '#a78bfa', chords: '#ec7bbd', lead: '#5a82bd', drums: '#f2c768' } as const;
const PURPLE = '#b388ff';
const BARS = 136;

const levelCache = new WeakMap<object, Float32Array>();

// Loudness profile of the whole clip (one value per waveform bar). Cached per audio / scene: inputs are immutable.
function profile(F: Frame): Float32Array {
  const key = (F.audio.analysis || F.notes) as object;
  const known = levelCache.get(key);
  if (known) return known;
  const out = new Float32Array(BARS);
  const seconds = Math.max(.1, F.meta.duration);
  let peak = 1e-4;
  for (let i = 0; i < BARS; i++) {
    const t = (i + .5) / BARS * seconds;
    const a = audioAt(F, t - F.meta.seconds);
    const value = Math.max(a.level, (a.bass * .9 + a.mid * .7 + a.treble * .4) * .8);
    out[i] = value;
    if (value > peak) peak = value;
  }
  for (let i = 0; i < BARS; i++) out[i] = out[i] / peak;
  // light smoothing so the shape reads like an RMS envelope
  const smooth = new Float32Array(BARS);
  for (let i = 0; i < BARS; i++) smooth[i] = (out[Math.max(0, i - 1)] * .25 + out[i] * .5 + out[Math.min(BARS - 1, i + 1)] * .25);
  levelCache.set(key, smooth);
  return smooth;
}

function windowFrame(F: Frame, x: number, y: number, w: number, h: number, title: string) {
  const { ctx } = F;
  // shadow
  ctx.globalAlpha = .35;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  roundedRect(ctx, x - 2, y + 4, w + 4, h + 6, 12);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  roundedRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = '#1c1b24';
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#25242e';
  ctx.fillRect(x, y, w, 28);
  ctx.fillStyle = '#34333f';
  ctx.fillRect(x, y + 28, w, 1);
  ctx.restore();
  ctx.beginPath();
  roundedRect(ctx, x + .5, y + .5, w - 1, h - 1, 10);
  ctx.strokeStyle = '#2f2e3a';
  ctx.lineWidth = 1;
  ctx.stroke();
  const cy = y + 14;
  [['#c8504d', 19.5], ['#d8a02e', 34.5], ['#2fa043', 49.5]].forEach(([color, dx]) => {
    ctx.beginPath();
    ctx.arc(x + (dx as number), cy, 4.6, 0, Math.PI * 2);
    ctx.fillStyle = color as string;
    ctx.fill();
  });
  text(F, title, x + 70, cy + 4, { size: 10.5, font: MONO, color: '#9a9aa2' });
}

function innerBox(F: Frame, x: number, y: number, w: number, h: number) {
  const { ctx } = F;
  ctx.beginPath();
  roundedRect(ctx, x, y, w, h, 9);
  ctx.fillStyle = '#131218';
  ctx.fill();
}

export const rageNight: Look = {
  id: 'rage-night',
  group: 'midi',
  nameRu: 'Рейдж: ночь',
  nameEn: 'Rage Night',
  descriptionRu: 'Два тёмных терминальных окна: волна трека с плейхедом и обзор нот по партиям с неоновым свечением.',
  descriptionEn: 'Two dark terminal windows: the track waveform with a playhead and a glowing overview of the notes per part.',
  draw(F) {
    const { ctx } = F;
    fill(F, '#0b0c0d');

    // slowly drifting dark colour blobs
    const p = loopPhase(F, 16);
    const blob = (x: number, y: number, r: number, color: string, a: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = a;
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    const s = Math.sin(p), c = Math.cos(p);
    blob(110 + s * 25, 150 + c * 20, 230, '#2d1b45', .9);
    blob(470 - s * 30, 235 + c * 25, 200, '#10403f', .85);
    blob(75 + c * 30, 830 - s * 20, 230, '#0f3a33', .8);
    blob(430 - c * 25, 800 + s * 25, 230, '#2a1a45', .85);
    ctx.globalAlpha = 1;

    // window 1: listen
    const X = 30, WW = 480;
    windowFrame(F, X, 250, WW, 223, 'listen');
    text(F, F.meta.title, X + 24, 324, { size: 36, weight: 700, font: MONO, color: PURPLE, maxWidth: WW - 48 });
    const bx = X + 24, by = 342, bw = WW - 48, bh = 100;
    innerBox(F, bx, by, bw, bh);
    const levels = profile(F);
    const progress = timeProgress(F);
    const wx = bx + 12, ww = bw - 24, midY = 382, half = 25;
    for (let i = 0; i < BARS; i++) {
      const x = wx + (i + .5) / BARS * ww;
      const level = levels[i];
      const h = 2.5 + level * half * 2 * (.8 + .2 * Math.sin(i * 1.7));
      const played = (i + .5) / BARS <= progress;
      ctx.globalAlpha = played ? .95 : .3;
      ctx.fillStyle = played ? PURPLE : '#9a7ae0';
      ctx.fillRect(x - .8, midY - h / 2, 1.6, h);
      if (played && !F.thumb) {
        ctx.globalAlpha = .1;
        ctx.fillRect(x - 2, midY - h / 2 - 2, 4, h + 4);
      }
    }
    ctx.globalAlpha = 1;
    const phx = wx + progress * ww;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(phx - 1, 354, 2, 57);
    const keyText = F.meta.key ? ` ${F.meta.key.toLowerCase().replace(/m$/, 'min').replace(/^([a-g][#b]?)$/, '$1maj')}` : '';
    text(F, `${F.meta.title} ${Math.round(F.meta.bpm)}${keyText} · 48 khz`, bx + 12, 430, { size: 9.5, font: MONO, color: '#a0a0a6', maxWidth: bw - 70 });
    text(F, clock(F.meta.seconds), bx + bw - 12, 430, { size: 9.5, font: MONO, color: '#a0a0a6', align: 'right' });
    text(F, [`${Math.round(F.meta.bpm)} bpm`, F.meta.key].filter(Boolean).join(' · '), bx, 461, { size: 9.5, font: MONO, color: '#8a8a90' });

    // window 2: MIDI
    windowFrame(F, X, 500, WW, 249, 'MIDI');
    text(F, `${new Set(F.tracks.map(trackRole)).size} layers`, X + 24, 561, { size: 20, weight: 700, font: MONO, color: PURPLE });
    const tail = [`${totalBars(F)} bars`, F.meta.key, String(Math.round(F.meta.bpm))].filter(Boolean).join(' · ');
    text(F, tail, X + WW - 24, 562, { size: 20, font: MONO, color: '#8c8c92', align: 'right' });
    const mx = X + 24, my = 574, mw = WW - 48, mh = 164;
    innerBox(F, mx, my, mw, mh);

    const started = (track: TrackView) => track.index.n > 0 && track.index.firstPos <= F.tick + F.beat * .1;
    let lx = mx + 14;
    const shown: TrackView[] = [];
    const seen = new Set<string>();
    for (const track of F.tracks) { const role = trackRole(track); if (!seen.has(role) && shown.length < 4) { seen.add(role); shown.push(track); } }
    for (const track of shown) {
      const role = trackRole(track), lit = started(track);
      ctx.globalAlpha = lit ? 1 : .45;
      ctx.beginPath();
      roundedRect(ctx, lx, 589, 7, 7, 1.5);
      ctx.fillStyle = ROLE_COLOR[role];
      ctx.fill();
      const w = text(F, role, lx + 12, 596, { size: 9, font: MONO, color: '#a0a0a6', alpha: lit ? 1 : .35 });
      lx += 12 + w + 14;
    }
    ctx.globalAlpha = 1;

    const rx = mx + 12, rw = mw - 24, ry0 = 600, ry1 = 726;
    // faint grid: rows and 2-bar lines
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = .035;
    for (let y = ry0 + 4; y < ry1; y += 6) ctx.fillRect(rx, y, rw, 1);
    const segments = Math.max(1, Math.round(totalBars(F) / 2));
    ctx.globalAlpha = .07;
    for (let i = 0; i <= segments; i++) ctx.fillRect(Math.round(rx + i / segments * rw), ry0, 1, ry1 - ry0);
    ctx.globalAlpha = 1;

    const along = F.tick / F.total;
    const lo = ry1 - 3, hi = ry0 + 14;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, ry0, rw, ry1 - ry0 + 2);
    ctx.clip();
    for (const track of F.tracks.slice().sort((a, b) => b.slot - a.slot)) {
      const role = trackRole(track), color = ROLE_COLOR[role];
      const entered = started(track);
      const { index } = track;
      for (let i = 0; i < index.n; i++) {
        const x0 = rx + index.pos[i] / F.total * rw;
        const w = Math.max(2.5, index.dur[i] / F.total * rw - 1);
        if (x0 > rx + rw) continue;
        const y = lo - pitchNorm(F.notes, index.pitch[i], 36) * (lo - hi);
        const now = index.pos[i] <= F.tick && index.end[i] > F.tick;
        const past = index.pos[i] <= F.tick;
        const boost = now ? 1 : 0;
        if (!entered) { ctx.globalAlpha = .12; ctx.fillStyle = '#7a8a8a'; ctx.fillRect(x0, y - 1, w, 2); continue; }
        if (!F.thumb) {
          ctx.globalAlpha = .1 + boost * .2;
          ctx.fillStyle = color;
          ctx.fillRect(x0 - 1, y - 3.2, w + 2, 6.4);
        }
        ctx.globalAlpha = past ? .95 : .85;
        ctx.fillStyle = boost ? '#ffd9f0' : color;
        ctx.fillRect(x0, y - 1.1, w, 2.2);
      }
    }
    ctx.restore();
    ctx.globalAlpha = .22;
    ctx.fillStyle = '#ffffff';
    const px = rx + along * rw;
    ctx.fillRect(px - 3, ry0, 6, ry1 - ry0);
    ctx.globalAlpha = 1;
    ctx.fillRect(px - 1.1, ry0, 2.2, ry1 - ry0);
    void H; void W;
  },
};
