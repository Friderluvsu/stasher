import { signal } from '../frame';
import type { Frame } from '../frame';
import { fill, MONO, text } from '../kit';
import type { Look } from './types';

// Oscilloscope locked to the low end: the mid signal is low-passed at 150 Hz, triggered on a rising zero
// crossing and drawn over a 10 x 8 graticule, with the last few sweeps fading out like phosphor persistence.

const SX = 30, SY = 210, SW = 480, SH = 380; // screen
const COLS = 10, ROWS = 8;
const RATE = 11025;
const WINDOW = 0.0632; // seconds across the screen (6.3 ms/div)
const LEAD = 0.014; // filter warm-up
const SEARCH = 0.05; // trigger search span
const CUTOFF = 150;

interface Sweep { values: Float32Array; start: number; scale: number }

function sweep(F: Frame, offset: number): Sweep {
  const total = Math.ceil((LEAD + SEARCH + WINDOW) * RATE) + 4;
  const raw = signal(F, 'mid', offset - LEAD - SEARCH - WINDOW + 0.0, total, RATE);
  // 4th-order Butterworth low-pass: two cascaded biquads
  const out = new Float32Array(total);
  const w0 = 2 * Math.PI * CUTOFF / RATE, cosw = Math.cos(w0), sinw = Math.sin(w0);
  const stages = [0.5412, 1.3066].map(q => {
    const alpha = sinw / (2 * q), a0 = 1 + alpha;
    return { b0: (1 - cosw) / 2 / a0, b1: (1 - cosw) / a0, a1: -2 * cosw / a0, a2: (1 - alpha) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  });
  for (let i = 0; i < total; i++) {
    let v = raw[i];
    for (const f of stages) {
      const y = f.b0 * v + f.b1 * f.x1 + f.b0 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
      f.x2 = f.x1; f.x1 = v; f.y2 = f.y1; f.y1 = y;
      v = y;
    }
    out[i] = v;
  }
  // The newest sample is at the end; the sweep is searched in the part before the visible window so the trace
  // always shows audio that has already played.
  const lead = Math.ceil(LEAD * RATE), search = Math.ceil(SEARCH * RATE), span = Math.ceil(WINDOW * RATE);
  const limit = lead + search;
  let at = -1, frac = 0;
  // hysteresis: must have been clearly negative before crossing zero upwards
  const threshold = 0.004;
  let armed = false;
  for (let i = lead; i < limit; i++) {
    if (out[i] < -threshold) armed = true;
    if (armed && out[i] < 0 && out[i + 1] >= 0) { at = i; frac = -out[i] / (out[i + 1] - out[i] || 1); break; }
  }
  if (at < 0) { at = lead + Math.floor(search / 2); frac = 0; }
  const values = new Float32Array(span + 2);
  for (let i = 0; i < values.length; i++) values[i] = out[Math.min(total - 1, at + i)];
  // partly normalised: quiet passages still show a readable trace, loud ones stay clearly bigger
  let peak = 0;
  for (let i = lead; i < total; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
  return { values, start: frac, scale: peak > .008 ? peak ** -.75 : .008 ** -.75 * (peak / .008) ** .5 };
}

function drawGraticule(F: Frame) {
  const { ctx } = F;
  // screen
  const screen = ctx.createLinearGradient(0, SY, 0, SY + SH);
  screen.addColorStop(0, '#0a0f08');
  screen.addColorStop(.5, '#090f08');
  screen.addColorStop(1, '#0a0f08');
  ctx.globalAlpha = 1;
  ctx.fillStyle = screen;
  ctx.fillRect(SX, SY, SW, SH);
  // soft vignette inside the screen
  const vignette = ctx.createRadialGradient(SX + SW / 2, SY + SH / 2, SH * .3, SX + SW / 2, SY + SH / 2, SW * .72);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = vignette;
  ctx.fillRect(SX, SY, SW, SH);

  const cw = SW / COLS, ch = SH / ROWS;
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#dfe8d6';
  ctx.globalAlpha = .1;
  ctx.beginPath();
  for (let i = 1; i < COLS; i++) if (i !== COLS / 2) { const x = Math.round(SX + i * cw) + .5; ctx.moveTo(x, SY); ctx.lineTo(x, SY + SH); }
  for (let j = 1; j < ROWS; j++) if (j !== ROWS / 2) { const y = Math.round(SY + j * ch) + .5; ctx.moveTo(SX, y); ctx.lineTo(SX + SW, y); }
  ctx.stroke();
  // centre axes, brighter, with minor ticks
  ctx.globalAlpha = .2;
  ctx.beginPath();
  const cx = Math.round(SX + SW / 2) + .5, cy = Math.round(SY + SH / 2) + .5;
  ctx.moveTo(cx, SY); ctx.lineTo(cx, SY + SH);
  ctx.stroke();
  ctx.globalAlpha = .14;
  ctx.beginPath();
  ctx.moveTo(SX, cy); ctx.lineTo(SX + SW, cy);
  ctx.stroke();
  ctx.globalAlpha = .26;
  ctx.beginPath();
  for (let i = 0; i < COLS * 5; i++) {
    const x = Math.round(SX + i * cw / 5) + .5;
    ctx.moveTo(x, cy - 3); ctx.lineTo(x, cy + 3);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function tracePoints(s: Sweep, gain: number, mid: number, step: number): number[] {
  const pts: number[] = [];
  const { values } = s;
  const count = Math.min(values.length - 2, Math.ceil(WINDOW * RATE));
  const perSample = SW / (WINDOW * RATE);
  for (let i = 0; i <= count; i += step) {
    const v = values[i] * (1 - s.start) + values[i + 1] * s.start;
    const x = SX + (i - s.start) * perSample;
    const y = mid - Math.tanh(v * gain * s.scale) * (SH / 2 - 10);
    pts.push(i === 0 ? Math.max(SX, x) : Math.min(SX + SW, x), y);
  }
  return pts;
}

function strokePoints(ctx: CanvasRenderingContext2D, pts: number[], color: string, width: number, alpha: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.stroke();
}

export const scope: Look = {
  id: 'scope',
  group: 'audio',
  nameRu: 'Осциллограф',
  nameEn: 'Scope',
  descriptionRu: 'Осциллограф, синхронизированный с 808',
  descriptionEn: 'An oscilloscope locked to the 808',
  draw(F) {
    const { ctx } = F;
    fill(F, '#070a05');

    // heading
    text(F, F.meta.title, 30, 52, { size: 27, weight: 500, color: '#f0f4ea', spacing: -.5, maxWidth: 480 });
    const sub = [`${Math.round(F.meta.bpm)} BPM`, F.meta.key].filter(Boolean).join(' · ');
    text(F, sub, 30.5, 72, { size: 10.5, font: MONO, color: '#8c9488', alpha: .62, spacing: 1.9 });

    drawGraticule(F);

    const mid = SY + SH / 2;
    const gain = .58;
    const step = F.thumb ? 4 : 2;
    const dt = 1 / 24;
    ctx.save();
    ctx.beginPath();
    ctx.rect(SX, SY, SW, SH);
    ctx.clip();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // phosphor persistence: older sweeps are fainter
    const ghosts = F.thumb ? 1 : 3;
    for (let k = ghosts; k >= 1; k--) {
      const pts = tracePoints(sweep(F, -k * dt), gain, mid, step + 1);
      strokePoints(ctx, pts, '#8fb41c', 1.1, .26 / k);
    }
    const pts = tracePoints(sweep(F, 0), gain, mid, step);
    strokePoints(ctx, pts, '#9acb14', 9, .07);
    strokePoints(ctx, pts, '#9acb14', 5, .14);
    strokePoints(ctx, pts, '#c9ea2c', 2.4, .9);
    strokePoints(ctx, pts, '#f0ffae', 1, .6);
    ctx.restore();
    ctx.globalAlpha = 1;

    // readouts
    const label = { size: 8.6, font: MONO, color: '#c6d0be', alpha: .5, spacing: .55 };
    text(F, 'TRIG ↑', SX + 8, SY + 16, label);
    text(F, 'LP 150 Hz', SX + SW - 8, SY + 16, { ...label, align: 'right' });
    text(F, '6.3 ms/div', SX + 8, SY + SH - 7, label);
    text(F, '0.05 V/div', SX + SW - 8, SY + SH - 7, { ...label, align: 'right' });
  },
};
