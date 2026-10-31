import { audioAt, clamp, loopPhase, windowNotes, pitchNorm } from '../frame';
import type { Frame } from '../frame';
import { fill, lerp, MONO, noise2, rect, setFont, trackRole } from '../kit';
import { hash } from '../noteIndex';
import type { Look } from './types';

const PX = 16, PY = 136, PW = 507, PH = 688;
const COLS = 67, ROWS = 73, CW = PW / COLS, RH = PH / ROWS;
const RAMP = ' .:-=+*#%';
const HISTORY = 36, STEP = .05; // seconds between spectrogram rows

// large soft blobs: [x, y, radius, colour, alpha] in panel fractions
const BLOBS: [number, number, number, string, number][] = [
  [.05, .02, .2, '#4cb82e', 1], [.55, .1, .17, '#237013', 1], [.15, .2, .17, '#1b6410', 1], [.34, .3, .17, '#6cb04a', .9],
  [.05, .45, .2, '#80c058', .9], [.4, .52, .16, '#2f7d1f', .9], [.62, .66, .2, '#195a0c', 1], [.14, .72, .19, '#7fbb55', .95],
  [.5, .82, .18, '#215f14', .9], [.88, .9, .2, '#24471a', 1], [.08, .97, .16, '#8ba46c', .9], [.92, .5, .24, '#4f9a3c', .9],
  [.28, .12, .13, '#2c7a1c', .9], [.45, .4, .13, '#134a09', .8], [.72, .34, .16, '#5fae42', .8], [.78, .75, .18, '#245f19', .9],
  [.2, .36, .1, '#8ccb62', .6], [.1, .6, .09, '#86c35e', .6], [.3, .62, .1, '#8bc762', .55], [.22, .85, .1, '#88c460', .6],
  [.42, .22, .09, '#7cbf58', .55], [.55, .55, .09, '#4a9a38', .6], [.35, .92, .1, '#79ad58', .55], [.62, .93, .1, '#1a4f10', .8],
];

function field(F: Frame) {
  const { ctx } = F;
  rect(F, PX, PY, PW, PH, '#2f7d20');
  ctx.save();
  ctx.beginPath(); ctx.rect(PX, PY, PW, PH); ctx.clip();
  const ph = loopPhase(F, 8), bass = F.audio.present ? F.audio.bass : F.env;
  for (let i = 0; i < BLOBS.length; i++) {
    const [fx, fy, fr, color, alpha] = BLOBS[i];
    const x = PX + PW * (fx + .018 * Math.sin(ph + i * 1.7)), y = PY + PH * (fy + .012 * Math.cos(ph * 1 + i * 2.3));
    const r = PW * fr * 1.25 * (1 + .05 * bass * (i % 3 === 0 ? 1 : 0));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, color + '00');
    ctx.globalAlpha = alpha; ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // pale lime light top right
  const lx = PX + PW * .79, ly = PY + PH * .2, lr = PW * .2;
  const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
  lg.addColorStop(0, '#b6e47c'); lg.addColorStop(1, '#b6e47c00');
  ctx.globalAlpha = .85 + .15 * F.env; ctx.fillStyle = lg; ctx.fillRect(lx - lr, ly - lr, lr * 2, lr * 2);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function ascii(F: Frame) {
  const { ctx } = F;
  // spectrogram history, newest at the bottom
  const hist: { spec: Float32Array; level: number }[] = [];
  for (let k = 0; k < HISTORY; k++) {
    const a = audioAt(F, -k * STEP * 2);
    hist.push({ spec: a.spectrum, level: Math.max(a.level, a.transient) });
  }
  const ph = loopPhase(F, 8), cx = Math.cos(ph) * 1.8, cy = Math.sin(ph) * 1.8;
  setFont(F, { size: 9.2, font: MONO, weight: 400 });
  const adv = ctx.measureText('M').width || 7.4;
  const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in spaced) spaced.letterSpacing = `${CW - adv}px`;
  ctx.fillStyle = '#e8f6cc';
  ctx.textBaseline = 'alphabetic';
  for (let r = 0; r < ROWS; r++) {
    const age = (ROWS - 1 - r) / (ROWS - 1) * (HISTORY - 1), a = Math.floor(age), b = Math.min(HISTORY - 1, a + 1), f = age - a;
    const sa = hist[a].spec, sb = hist[b].spec, level = lerp(hist[a].level, hist[b].level, f);
    const rowNoise = hash(r, Math.floor(F.meta.seconds * 6)) * .1;
    let line = '';
    for (let c = 0; c < COLS; c++) {
      const x = c / (COLS - 1);
      const bin = Math.min(30, Math.floor(Math.pow(x, 1.15) * 31));
      const spec = lerp(sa[bin], sb[bin], f);
      const blob = noise2(c * .075 + cx, r * .075 + cy, 4) * .5 + .5;
      const fade = 1 - clamp((x - .6) / .22);
      let v = (.06 + .2 * blob + .3 * spec + .2 * level * (.4 + .6 * blob) + rowNoise * .6) * fade;
      v *= .82;
      if (r < ROWS * .5) v *= .45 + .55 * (r / (ROWS * .5));
      const idx = v < .11 ? 0 : v < .17 ? 1 : v < .24 ? 2 : v < .31 ? 3 : v < .38 ? 4 : v < .45 ? 5 : v < .52 ? 6 : v < .59 ? 7 : v < .66 ? 8 : 9;
      line += idx < 9 ? RAMP[idx] : c % 2 ? '0' : 'X';
    }
    ctx.globalAlpha = .72;
    ctx.fillText(line, PX + 1, PY + RH * (r + .8));
  }
  if ('letterSpacing' in spaced) spaced.letterSpacing = '0px';
  ctx.globalAlpha = 1;
}

function petal(F: Frame) {
  const { ctx } = F;
  const hit = F.hit, e = F.env, ph = loopPhase(F, 4);
  const x = 345 + 3 * Math.sin(ph), y = 518 + 4 * Math.cos(ph * 2), rx = 24 + 6 * e + 5 * hit, ry = 46 + 9 * e + 7 * hit;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(.22);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(.1, .2, 0, 0, 0, 1.15);
  g.addColorStop(0, 'rgba(255,196,214,1)'); g.addColorStop(.55, 'rgba(250,160,186,.95)'); g.addColorStop(.85, 'rgba(236,150,170,.35)'); g.addColorStop(1, 'rgba(236,150,170,0)');
  ctx.fillStyle = g; ctx.globalAlpha = .55 + .4 * clamp(e + hit);
  ctx.beginPath(); ctx.arc(0, 0, 1.15, 0, Math.PI * 2); ctx.fill();
  const h = ctx.createRadialGradient(.4, -.55, 0, .4, -.55, .7);
  h.addColorStop(0, 'rgba(255,255,255,.95)'); h.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = h; ctx.globalAlpha = .6 + .4 * clamp(hit + e * .5);
  ctx.beginPath(); ctx.arc(.4, -.55, .7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

function bars(F: Frame) {
  const leads = F.tracks.filter(track => trackRole(track) === 'lead');
  const parts = F.tracks.filter(track => trackRole(track) !== 'drums');
  const pool = leads.length ? leads : parts.length ? parts : F.tracks;
  const speed = 112; // px per second of the vertical time axis
  for (const track of pool) {
    for (const note of windowNotes(F, track.index, F.tps * 2.4, F.tps * 2.4, 9)) {
      const dt = (note.pos - F.tick) / F.tps, end = (note.end - F.tick) / F.tps;
      const y1 = PY + PH * .5 - dt * speed, y0 = PY + PH * .5 - end * speed;
      const x = 326 + 106 * pitchNorm(F.notes, note.pitch);
      const top = Math.max(PY + 6, y0), bot = Math.min(PY + PH - 6, y1);
      if (bot - top < 4) continue;
      rect(F, x, top, 5, Math.min(bot - top, 100), '#e4f2dc', .2 + .2 * note.env);
    }
  }
}

export const glyph: Look = {
  id: 'glyph',
  group: 'audio',
  nameRu: 'ASCII-поле',
  nameEn: 'Glyph',
  descriptionRu: 'Зелёное размытое поле с ASCII-спектрограммой символов, розовым бликом и бледными столбиками нот.',
  descriptionEn: 'A blurred green field overlaid with an ASCII-character spectrogram, a pink glow and faint note bars.',
  draw(F) {
    fill(F, '#f4f4ee');
    field(F);
    F.ctx.save();
    F.ctx.beginPath(); F.ctx.rect(PX, PY, PW, PH); F.ctx.clip();
    ascii(F);
    petal(F);
    bars(F);
    F.ctx.restore();
  },
};
