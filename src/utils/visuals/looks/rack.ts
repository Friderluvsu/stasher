import { audioAt, clamp, signal } from '../frame';
import type { Frame } from '../frame';
import { fill, MONO, text, timeProgress } from '../kit';
import { fmtLufs, loudnessModel, lookup } from './_c';
import type { Look } from './types';

// A rack of four instrument panels: scrolling waveform around the playhead, phase scope, 12-band LED meter and a
// loudness read-out with the whole-track loudness curve.

const BG = '#0c0e10';
const BORDER = '#2e3032';
const LIME = '#c8f35a';
const LED = '#b5db51';
const LABEL = '#76787a';

// panels (540 x 960 space)
const WAVE = { x: 30, y: 253.5, w: 480, h: 159 };
const PHASE = { x: 30, y: 428.5, w: 184.5, h: 184.5 };
const BANDS = { x: 232, y: 428.5, w: 278, h: 184.5 };
const LOUD = { x: 30, y: 628.5, w: 480, h: 133 };

const WAVE_SECONDS = 2.06;
const POINTS = 116;
// Notes-only scenes synthesise very dense signals; this tames them to the range of real audio.
// audioAt(F, 0) returns the live frame, which is empty without a sound file; a tiny offset gives the note-based read.
const at = (F: Frame, offset: number) => audioAt(F, offset || 1e-4);
const tame = (F: Frame, v: number) => (F.audio.analysis ? v : v ** 2.3);
const levelOf = (F: Frame, a: ReturnType<typeof audioAt>) => {
  if (F.audio.analysis) return a.level;
  let sum = 0;
  for (let i = 0; i < a.spectrum.length; i++) sum += a.spectrum[i] * a.spectrum[i];
  return clamp(Math.sqrt(sum / a.spectrum.length) * .85 + a.transient * .1);
};

function panel(F: Frame, p: { x: number; y: number; w: number; h: number }, name: string) {
  const { ctx } = F;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(p.x) + .5, Math.round(p.y) + .5, Math.round(p.w), Math.round(p.h));
  text(F, name, p.x + 8, p.y + 14.5, { size: 7.7, font: MONO, color: LABEL, spacing: .3 });
}

export const rack: Look = {
  id: 'rack',
  group: 'audio',
  nameRu: 'Рэк',
  nameEn: 'Rack',
  descriptionRu: 'Студийный рэк: волна, фаза, полосы и громкость',
  descriptionEn: 'A studio rack: waveform, phase, band meter and loudness',
  draw(F) {
    const { ctx } = F;
    fill(F, BG);

    // ---- heading
    text(F, F.meta.title, 30, 58, { size: 26.8, font: MONO, color: '#ffffff', maxWidth: 480 });
    text(F, [`${Math.round(F.meta.bpm)} BPM`, F.meta.key].filter(Boolean).join(' · '), 30, 77.5, { size: 10, font: MONO, color: '#82848a', alpha: .95 });

    // ---- WAVE: scrolling overview of +-1 s around the playhead
    panel(F, WAVE, 'WAVE');
    {
      const x0 = WAVE.x + 8.5, x1 = WAVE.x + WAVE.w - 8.5;
      const top = WAVE.y + 22, bottom = WAVE.y + WAVE.h - 9, mid = (top + bottom) / 2, half = (bottom - top) / 2;
      const columns = F.thumb ? 60 : 154;
      const core: number[] = [], outer: number[] = [];
      for (let i = 0; i <= columns; i++) {
        const t = (i / columns - .5) * WAVE_SECONDS;
        const a = at(F, t);
        const level = clamp(levelOf(F, a));
        const c = level * 28.5 * (.9 + .1 * level);
        const o = c * 1.12 + 10.5 * Math.sqrt(clamp(level * 2.5)) + a.transient * 3.5;
        core.push(Math.min(half - 1, c));
        outer.push(Math.min(half - 1, o));
      }
      const path = (heights: number[]) => {
        ctx.beginPath();
        const px = (i: number) => x0 + (x1 - x0) * i / columns;
        ctx.moveTo(px(0), mid - heights[0]);
        for (let i = 1; i < columns; i++) {
          const mx = (px(i) + px(i + 1)) / 2, my = mid - (heights[i] + heights[i + 1]) / 2;
          ctx.quadraticCurveTo(px(i), mid - heights[i], mx, my);
        }
        ctx.lineTo(px(columns), mid - heights[columns]);
        ctx.lineTo(px(columns), mid + heights[columns]);
        for (let i = columns - 1; i >= 1; i--) {
          const mx = (px(i) + px(i + 1)) / 2, my = mid + (heights[i] + heights[i + 1]) / 2;
          ctx.quadraticCurveTo(px(i + 1), mid + heights[i + 1], mx, my);
        }
        ctx.lineTo(px(0), mid + heights[0]);
        ctx.closePath();
      };
      ctx.fillStyle = LIME;
      path(outer);
      ctx.globalAlpha = .37;
      ctx.fill();
      path(core);
      ctx.globalAlpha = 1;
      ctx.fill();
      // playhead
      const px = Math.round((x0 + x1) / 2) + .5;
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = .55;
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(px, WAVE.y + 23); ctx.lineTo(px, WAVE.y + WAVE.h - 8); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ---- PHASE: M/S scatter of the last 20 ms
    panel(F, PHASE, 'PHASE');
    {
      const size = 114.8, cx = PHASE.x + PHASE.w / 2, cy = 522.4;
      ctx.strokeStyle = '#2c2e30';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1;
      ctx.strokeRect(cx - size / 2 + .5, cy - size / 2 + .5, size, size);
      ctx.strokeStyle = '#303234';
      ctx.globalAlpha = .55;
      ctx.beginPath();
      ctx.moveTo(cx + .5, cy - size / 2); ctx.lineTo(cx + .5, cy + size / 2);
      ctx.moveTo(cx - size / 2, cy + .5); ctx.lineTo(cx + size / 2, cy + .5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const rate = 11025, count = F.thumb ? 100 : 300;
      const l = signal(F, 'left', -count / rate, count, rate), r = signal(F, 'right', -count / rate, count, rate);
      let ll = 0, rr = 0, lr = 0;
      const k = F.audio.analysis ? 1 : .5;
      ctx.fillStyle = LED;
      ctx.strokeStyle = LED;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.globalAlpha = .95;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const s = (r[i] - l[i]) * 80 * k, m = Math.abs(l[i] + r[i]) * 62 * k;
        if (i) ctx.lineTo(cx + s, cy - m); else ctx.moveTo(cx + s, cy - m);
        ctx.fillRect(cx + s - 1, cy - m - 1, 2, 2);
        ll += l[i] * l[i]; rr += r[i] * r[i]; lr += l[i] * r[i];
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      const corr = ll > 1e-9 && rr > 1e-9 ? clamp(lr / Math.sqrt(ll * rr), -1, 1) : 0;
      text(F, `${corr >= 0 ? '+' : '-'}${Math.abs(corr).toFixed(2)}`, cx, 604.5, { size: 7.9, font: MONO, color: '#6d6f71', align: 'center', alpha: 1 });
    }

    // ---- BANDS: 12 x 6 LED matrix, fast attack / slower fall
    panel(F, BANDS, 'BANDS');
    {
      const cols = 12, rows = 6;
      const levels = new Float32Array(cols);
      const memory = F.thumb ? 1 : 4;
      for (let j = 0; j < memory; j++) {
        const a = at(F, -j * .045);
        const decay = .74 ** j;
        for (let c = 0; c < cols; c++) {
          const from = Math.floor((c / cols) ** 1.35 * 30), to = Math.max(from + 1, Math.floor(((c + 1) / cols) ** 1.35 * 30));
          let v = 0;
          for (let b = from; b < Math.min(32, to); b++) v = Math.max(v, a.spectrum[b]);
          levels[c] = Math.max(levels[c], tame(F, v) * decay);
        }
      }
      const gx = 239.7, gy = 444.7, pw = 21.7, ph = 26.5, cw = 19.6, chh = 24.6;
      const off = ['#221414', '#231b13', '#1e2517', '#1e2517', '#1e2517', '#1e2517'];
      const on = ['#d8452a', '#d98d2a', LED, LED, LED, LED];
      for (let c = 0; c < cols; c++) {
        const lit = Math.round(clamp(levels[c] ** .9) * 5.7);
        for (let k = 0; k < rows; k++) {
          const row = rows - 1 - k; // 0 = bottom
          const y = gy + k * ph;
          ctx.fillStyle = row < lit ? on[k] : off[k];
          ctx.fillRect(gx + c * pw, y, cw, chh);
        }
      }
    }

    // ---- LOUDNESS
    panel(F, LOUD, 'LOUDNESS');
    {
      const model = loudnessModel(F);
      const progress = timeProgress(F);
      const shortTerm = lookup(model, model.short, F.meta.seconds);
      const cols = [38.25, 154.5, 270, 386.25];
      const heads = ['I', 'S', 'TP', 'LRA'];
      const values = [fmtLufs(model.integrated), fmtLufs(shortTerm), fmtLufs(model.truePeak), model.range.toFixed(1)];
      for (let i = 0; i < 4; i++) {
        text(F, heads[i], cols[i], 653.5, { size: 7.7, font: MONO, color: '#696b6d' });
        text(F, values[i], cols[i], 684, { size: 25.5, font: MONO, color: '#ffffff' });
      }
      const curve = new Float32Array(POINTS);
      for (let i = 0; i < POINTS; i++) curve[i] = lookup(model, model.short, (i + .5) / POINTS * model.duration);
      const info = { curve };
      const gx0 = 38.25, gx1 = 501.75, floor = 754, span = gx1 - gx0;
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < POINTS; i++) { if (info.curve[i] < min) min = info.curve[i]; if (info.curve[i] > max) max = info.curve[i]; }
      const range = Math.max(4, max - min);
      const centre = (max + min) / 2;
      const yAt = (i: number) => floor - 11 - clamp(.5 + (info.curve[i] - centre) / range) * 34;
      ctx.beginPath();
      ctx.moveTo(gx0, floor);
      for (let i = 0; i < POINTS; i++) ctx.lineTo(gx0 + span * i / (POINTS - 1), yAt(i));
      ctx.lineTo(gx1, floor);
      ctx.closePath();
      ctx.fillStyle = '#272e1b';
      ctx.globalAlpha = 1;
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < POINTS; i++) {
        const x = gx0 + span * i / (POINTS - 1);
        if (i) ctx.lineTo(x, yAt(i)); else ctx.moveTo(x, yAt(i));
      }
      ctx.strokeStyle = '#c4ea52';
      ctx.lineWidth = 1.1;
      ctx.lineJoin = 'round';
      ctx.stroke();
      const hx = Math.round(gx0 + span * progress) + .5;
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = .62;
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(hx, 696); ctx.lineTo(hx, floor); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  },
};
