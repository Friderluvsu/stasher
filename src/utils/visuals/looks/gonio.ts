import { clamp, signal, TAU } from '../frame';
import type { Frame } from '../frame';
import { fill, MONO, SERIF, text } from '../kit';
import type { Look } from './types';

// Stereo goniometer: the last 50 ms of L/R samples joined into a polyline and rotated 45 degrees (mid up, side
// sideways), older 50 ms windows fading behind it (300 ms persistence), a correlation meter and L/R level bars.

const CX = 272.6, CY = 388.5, R = 154.1;
const LEFT = 75.5, RIGHT = 470.2;
const BAR_X = 93;
const RATE = 3000;
const WINDOW = .05;
const COUNT = 150;
const WINDOWS = 6;

function db01(amplitude: number): number {
  return clamp((20 * Math.log10(Math.max(1e-5, amplitude)) + 40) / 40);
}

function dashedLine(F: Frame, x1: number, y1: number, x2: number, y2: number, alpha: number) {
  const { ctx } = F;
  ctx.save();
  ctx.setLineDash([3, 4.5]);
  ctx.strokeStyle = '#7a8084';
  ctx.globalAlpha = alpha;
  ctx.lineWidth = .8;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function polyline(F: Frame, l: Float32Array, r: Float32Array, gain: number, color: string, width: number, alpha: number) {
  const { ctx } = F;
  const unit = R * .7071 * gain;
  ctx.beginPath();
  for (let i = 0; i < l.length; i++) {
    const x = CX + (r[i] - l[i]) * unit, y = CY - (l[i] + r[i]) * unit;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.stroke();
}

export const gonio: Look = {
  id: 'gonio',
  group: 'audio',
  nameRu: 'Гониометр',
  nameEn: 'Gonio',
  descriptionRu: 'Стерео-картина микса: фигура L/R, корреляция и уровни',
  descriptionEn: 'The stereo picture of the mix: L/R figure, correlation and levels',
  draw(F) {
    const { ctx } = F;
    fill(F, '#07090b');

    // ---- title (condensed serif)
    ctx.save();
    ctx.translate(LEFT, 118);
    ctx.scale(.8, 1);
    text(F, F.meta.title, 0, 0, { size: 31, font: SERIF, weight: 400, color: '#e6e9ec', maxWidth: 520 });
    ctx.restore();

    // ---- scope frame
    ctx.lineWidth = .9;
    ctx.strokeStyle = '#d4d8dc';
    ctx.globalAlpha = .17;
    ctx.beginPath(); ctx.arc(CX, CY, R, 0, TAU); ctx.stroke();
    ctx.globalAlpha = .1;
    ctx.beginPath(); ctx.arc(CX, CY, R / 2, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    dashedLine(F, CX - R, CY, CX + R, CY, .36);
    dashedLine(F, CX, CY - R, CX, CY + R, .36);
    const d = R * .7071;
    dashedLine(F, CX - d, CY - d, CX + d, CY + d, .3);
    dashedLine(F, CX + d, CY - d, CX - d, CY + d, .3);
    const tag = { size: 8, font: MONO, color: '#9aa0a6', alpha: .6, align: 'center' as const, spacing: .4 };
    text(F, 'M', CX, CY - 165 + 3, tag);
    text(F, 'L', CX - 165 * .7071, CY - 165 * .7071 + 3, tag);
    text(F, 'R', CX + 165 * .7071, CY - 165 * .7071 + 3, tag);

    // ---- samples: newest 50 ms first, older windows behind it
    const windows = F.thumb ? 2 : WINDOWS;
    const lefts: Float32Array[] = [], rights: Float32Array[] = [];
    for (let k = 0; k < windows; k++) {
      lefts.push(signal(F, 'left', -WINDOW * (k + 1), COUNT, RATE));
      rights.push(signal(F, 'right', -WINDOW * (k + 1), COUNT, RATE));
    }
    let peak = 0, sumL = 0, sumR = 0, sumLR = 0, sqL = 0, sqR = 0, n = 0, nowL = 0, nowR = 0;
    for (let k = 0; k < windows; k++) {
      for (let i = 0; i < COUNT; i++) {
        const l = lefts[k][i], r = rights[k][i];
        const m = Math.max(Math.abs(l), Math.abs(r));
        if (m > peak) peak = m;
        sumL += l * l; sumR += r * r; sumLR += l * r; n++;
        if (k === 0) { nowL += l * l; nowR += r * r; }
      }
    }
    void sqL; void sqR;
    const corr = sumL > 1e-9 && sumR > 1e-9 ? clamp(sumLR / Math.sqrt(sumL * sumR), -1, 1) : 0;
    // partly normalised gain: quiet passages stay readable, loud ones are visibly bigger
    const gain = clamp(.5 * Math.max(peak, .02) ** -.8, .6, 14) * (F.audio.analysis ? 1.5 : 1.15);
    const ghosts = ['#7e93a6', '#7a8a9c', '#74818f', '#6c7782', '#656d76'];
    ctx.lineJoin = 'round';
    for (let k = windows - 1; k >= 1; k--) {
      polyline(F, lefts[k], rights[k], gain, ghosts[k - 1], .8, .42 * (1 - (k - 1) / windows) ** 1.6);
    }
    polyline(F, lefts[0], rights[0], gain, '#57b9b0', 2.4, .18);
    polyline(F, lefts[0], rights[0], gain, '#a6ece6', .9, .92);
    ctx.globalAlpha = 1;

    // ---- correlation meter
    const mono = { size: 7.8, font: MONO, color: '#9a9ea3' };
    text(F, 'CORRELATION', LEFT, 574.5, { ...mono, alpha: .62, spacing: 4.9 });
    text(F, `${corr >= 0 ? '+' : '−'}${Math.abs(corr).toFixed(2)}`, RIGHT, 574.5, { ...mono, color: '#e4e6e8', align: 'right', alpha: .95, spacing: 0 });
    const ly = 596.2, mid = (LEFT + RIGHT) / 2;
    ctx.strokeStyle = '#9a9ea3';
    ctx.lineWidth = .9;
    ctx.globalAlpha = .38;
    ctx.beginPath(); ctx.moveTo(LEFT, ly); ctx.lineTo(RIGHT, ly); ctx.stroke();
    ctx.globalAlpha = .62;
    ctx.beginPath();
    for (const x of [LEFT, mid, RIGHT]) { ctx.moveTo(x, ly - 5.5); ctx.lineTo(x, ly + 5.5); }
    ctx.stroke();
    ctx.globalAlpha = 1;
    const labelY = 616.5;
    text(F, '-1', LEFT + 1, labelY, { ...mono, alpha: .55 });
    text(F, '0', mid, labelY, { ...mono, alpha: .55, align: 'center' });
    text(F, '+1', RIGHT, labelY, { ...mono, alpha: .55, align: 'right' });
    const mx = mid + corr * (RIGHT - mid);
    const halo = ctx.createRadialGradient(mx, ly, 0, mx, ly, 14);
    halo.addColorStop(0, 'rgba(76,200,180,0.28)');
    halo.addColorStop(1, 'rgba(76,200,180,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(mx - 14, ly - 16, 28, 32);
    ctx.fillStyle = '#58cdb5';
    ctx.fillRect(mx - 1.1, ly - 12.5, 2.2, 25);

    // ---- level bars with peak hold
    const meter = F.audio.analysis ? 2.2 : 1.5;
    const rmsL = Math.sqrt(nowL / COUNT), rmsR = Math.sqrt(nowR / COUNT);
    const holdL = holdOf(F, 'left', meter / 2.2, Math.max(...lefts[0].map(Math.abs))), holdR = holdOf(F, 'right', meter / 2.2, Math.max(...rights[0].map(Math.abs)));
    const rows: [string, number, number, number][] = [['L', 663, db01(rmsL * meter), holdL], ['R', 702.8, db01(rmsR * meter), holdR]];
    const barW = RIGHT - BAR_X;
    for (const [name, y, level, hold] of rows) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0f131a';
      ctx.fillRect(BAR_X, y - 3.8, barW, 7.6);
      ctx.fillStyle = '#258e89';
      ctx.fillRect(BAR_X, y - 3.8, barW * level, 7.6);
      ctx.fillStyle = '#b4b6bd';
      ctx.fillRect(BAR_X + barW * Math.max(level, hold) - 1.1, y - 6.8, 2.2, 13.6);
      text(F, name, LEFT, y + 3.4, { ...mono, alpha: .62 });
    }
    ctx.strokeStyle = '#d4d8dc';
    ctx.globalAlpha = .17;
    ctx.lineWidth = .9;
    ctx.beginPath(); ctx.moveTo(BAR_X, 744.8); ctx.lineTo(RIGHT, 744.8); ctx.stroke();
    ctx.globalAlpha = 1;
    text(F, '-40', BAR_X, 758.5, { ...mono, alpha: .5 });
    text(F, '0 dB', RIGHT, 758.5, { ...mono, alpha: .5, align: 'right' });

    // ---- footer
    text(F, 'L / R · 50 MS · 300 MS', LEFT, 857.5, { ...mono, alpha: .5, spacing: .2 });
  },
};

// Peak hold: the loudest sample of a few short bursts over the last second and a half, falling 9 dB per second.
function holdOf(F: Frame, channel: 'left' | 'right', scale: number, now: number): number {
  let best = db01(now * 2.2 * scale);
  if (F.thumb) return best;
  for (let j = 1; j <= 5; j++) {
    const age = j * .28;
    const burst = signal(F, channel, -age, 36, RATE);
    let top = 0;
    for (let i = 0; i < burst.length; i++) { const a = Math.abs(burst[i]); if (a > top) top = a; }
    const value = db01(top * 2.2 * scale) - age * 9 / 40;
    if (value > best) best = value;
  }
  return best;
}
