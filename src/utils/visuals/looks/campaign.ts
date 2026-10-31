import { blendBands, clamp, TAU } from '../frame';
import type { Frame } from '../frame';
import { chordsByBar, fill, line, noise2, rand, rect, SANS, SERIF, text, timeProgress } from '../kit';
import type { Look } from './types';

const INK = '#161616', GREY = '#8d8d8d';
const L = 75, R = 465;

function caption(F: Frame, value: string, x: number, y: number) {
  text(F, value, x, y, { size: 8.6, weight: 500, color: '#9a9a9a', spacing: 1.2 });
}

function sleeve(F: Frame, p: number) {
  const { ctx } = F;
  const x = L, y = 156, s = 213;
  rect(F, x, y, s, s, '#594596');
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, s, s); ctx.clip();
  const cx = 227, cy = 220.5, pulse = 1 + .012 * (F.audio.present ? F.audio.bass : F.env);
  ctx.strokeStyle = '#b3a6a2'; ctx.lineWidth = 1.1;
  for (let k = 0; k < 7; k++) {
    ctx.globalAlpha = .8 - k * .04;
    ctx.beginPath(); ctx.arc(cx, cy, (63 + k * 40) * pulse, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const chords = chordsByBar(F).filter(Boolean);
  const word = (chords.length ? chords[0] : F.meta.key || F.meta.title).toLowerCase();
  text(F, word, x + 13, y + 179, { size: 45, font: SERIF, color: '#f3eee8', maxWidth: 118, spacing: -1 });
  text(F, 'SIDE A', x + 12, y + 202, { size: 8.7, weight: 700, color: '#f3eee8', spacing: 1.4 });
  rect(F, x + s * p - 1, y, 2, s, '#f2ecee', .92);
  ctx.restore();
  caption(F, '12" SLEEVE · 1/1', L, 380);
}

function vinyl(F: Frame, p: number) {
  const { ctx } = F;
  const cx = 382, cy = 239, R0 = 82.5;
  ctx.fillStyle = '#10201f';
  ctx.beginPath(); ctx.arc(cx, cy, R0, 0, TAU); ctx.fill();
  // grooves: thin teal rings in bands, a little brighter near the needle
  const needle = .93 - .3 * p;
  for (let r = .6; r < .975; r += .0125) {
    const i = Math.round(r * 80);
    const band = Math.sin(r * 38) > -.15 ? 1 : .6;
    const near = Math.exp(-(((r - needle) / .06) ** 2));
    ctx.strokeStyle = i % 2 ? '#1b7a72' : '#27a094';
    ctx.globalAlpha = (.55 + .25 * rand(i, 4) + .3 * near * (F.audio.present ? F.audio.level : F.env)) * band;
    ctx.lineWidth = .8;
    ctx.beginPath(); ctx.arc(cx, cy, R0 * r, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(cx, cy, R0, 0, TAU); ctx.stroke();
  ctx.fillStyle = '#e1472b';
  ctx.beginPath(); ctx.arc(cx, cy, 48.5, 0, TAU); ctx.fill();
  ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, TAU); ctx.fill();
  const code = `${(F.meta.title.replace(/[^a-z]/gi, '').slice(0, 2) || 'ST').toUpperCase()}-014`;
  text(F, `${code} · A`, cx, cy + 27, { size: 14.5, color: '#1c1210', align: 'center', spacing: -.2, maxWidth: 74 });
  // tonearm
  const angle = -Math.atan2(50, 82), tipR = R0 * needle;
  const tx = cx + Math.cos(angle) * tipR, ty = cy + Math.sin(angle) * tipR;
  line(F, tx + 19.5, ty - 42, tx, ty, '#ffffff', 1.6, .75);
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(tx, ty, 3.4, 0, TAU); ctx.fill();
  caption(F, 'LABEL A/B', 299, 333);
}

function crops(F: Frame, p: number) {
  const { ctx } = F;
  const y = 390, h = 75;
  // spectrum
  rect(F, 75, y, 125, h, '#0c0d10');
  const n = 36, bands = blendBands(F, n), bw = 125 / n;
  for (let i = 0; i < n; i++) {
    const v = Math.max(.06, bands[i]);
    const g = ctx.createLinearGradient(0, y + h, 0, y + h * (1 - v));
    g.addColorStop(0, '#a56a1c'); g.addColorStop(1, '#e3a53c');
    ctx.fillStyle = g; ctx.globalAlpha = 1;
    ctx.fillRect(75 + i * bw + .4, y + h - h * v, bw - .8, h * v);
  }
  rect(F, 75 + 125 * p - 1, y, 2, h, '#f4eee6', .92);
  // flat
  rect(F, 208, y, 124, h, '#e1472b');
  text(F, F.meta.title.toLowerCase(), 270, y + h / 2 + 8, { size: 25, font: SERIF, color: '#1a0e0b', align: 'center', maxWidth: 108, spacing: -.5 });
  // halftone
  rect(F, 341, y, 124, h, '#f4f3ee');
  const cols = 16, rows = 10, t = F.meta.seconds, bass = F.audio.present ? F.audio.bass : F.env;
  const spec = F.audio.spectrum;
  ctx.fillStyle = '#0d0d0d';
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const band = spec[Math.min(31, Math.floor(c / cols * 20))] || 0;
    const wave = .5 + .5 * Math.sin((c * .55 - r * .55) + t * 1.8);
    const nz = noise2(c * .45 + t * .9, r * .45, 3);
    const v = clamp(.22 + .38 * wave + .3 * nz + .45 * band + .25 * bass * (1 - r / rows));
    const rad = .3 + 2.7 * v * v;
    ctx.beginPath(); ctx.arc(341 + (c + .5) * (124 / cols), y + (r + .5) * (h / rows), rad, 0, TAU); ctx.fill();
  }
  caption(F, 'CROPS · SPECTRUM / FLAT / HALFTONE', L, 476);
}

function trackList(F: Frame, p: number) {
  rect(F, L, 486, 191, 243, '#f2f2ee');
  text(F, 'SIDE A · ' + (chordsByBar(F)[0] || F.meta.key || 'TAKE').toUpperCase(), 87, 507, { size: 8.8, weight: 700, color: '#2a2a2a', spacing: 1.7 });
  const names: string[] = [];
  const add = (v: string) => { const t = v.trim(); if (t && !names.includes(t) && t.toLowerCase() !== F.meta.title.toLowerCase()) names.push(t); };
  for (const track of F.tracks) add(track.name.toLowerCase());
  for (const chord of chordsByBar(F)) add(chord.toLowerCase());
  const filler = ['intro', 'verse', 'hook', 'bridge', 'outro', 'reprise', 'interlude', 'coda'];
  for (const f of filler) add(f);
  const items: string[] = [];
  for (let i = 0, k = 0; i < 10; i++) items.push(i === 6 ? F.meta.title.toLowerCase() : names[k++] || `take ${i + 1}`);
  const { ctx } = F;
  for (let i = 0; i < 10; i++) {
    const y = 530 + i * 19, cur = i === 6;
    const label = `A${i + 1}.`;
    const style = { size: 17.5, weight: cur ? 700 : 400, color: cur ? '#111' : '#2b2b2b', spacing: -.2 };
    const w = text(F, label, 87, y, style);
    text(F, items[i], 87 + w + 5, y, { ...style, maxWidth: 190 - 12 - w - 5 });
  }
  ctx.fillStyle = '#e3472b'; ctx.beginPath(); ctx.arc(81, 637.5, 2.8, 0, TAU); ctx.fill();
  line(F, 87, 649, 246, 649, '#d4d4d0', 1);
  line(F, 87, 649, 87 + 159 * p, 649, '#e3472b', 1.6);
  text(F, `${(F.meta.title.replace(/[^a-z]/gi, '').slice(0, 2) || 'ST').toUpperCase()}-014-A  ·  MATRIX`, 87, 716, { size: 8.6, weight: 500, color: '#a4a4a0', spacing: 1.2 });
  caption(F, 'INNER · PRINTED', L, 740);
}

function back(F: Frame) {
  rect(F, 276, 486, 189, 243, '#121317');
  const level = F.audio.present ? F.audio.level : F.env;
  const lufs = -14 - (1 - level) * .6 * Math.sin(F.meta.seconds * .8), peak = -1.3 - level * .4;
  const grey = { size: 13, color: '#9d9da2', spacing: -.2 };
  text(F, [Math.round(F.meta.bpm) + ' BPM', F.meta.key].filter(Boolean).join(' · '), 287, 506, grey);
  text(F, `Loudness ${lufs.toFixed(1).replace('-', '−')} LUFS`, 287, 523, grey);
  text(F, `True peak ${peak.toFixed(1).replace('-', '−')} dBTP`, 287, 540, grey);
  text(F, `${(F.meta.title.replace(/[^a-z]/gi, '').slice(0, 2) || 'ST').toUpperCase()}-014`, 287, 566, { size: 19.5, color: '#8c8c92', spacing: -.3 });
  for (let i = 0, x = 287; x < 374; i++) {
    const w = .8 + Math.floor(rand(i, 77) * 2) * .6, gap = 1.2 + Math.floor(rand(i, 78) * 2) * .5;
    rect(F, x, 706, w, 17, '#d4d4d8', .9);
    x += w + gap;
  }
  caption(F, 'BACK · CREDITS', 276, 740);
}

export const campaign: Look = {
  id: 'campaign',
  group: 'audio',
  nameRu: 'Релиз-кампания',
  nameEn: 'Campaign',
  descriptionRu: 'Раскладка релиза: обложка, винил, спектр, растр, треклист и обратная сторона, с курсором по времени.',
  descriptionEn: 'A release spread: sleeve, vinyl, spectrum crop, halftone, tracklist and credits, with a playhead through the time.',
  draw(F) {
    fill(F, '#ffffff');
    const p = timeProgress(F);
    text(F, `"${F.meta.title.toUpperCase()}"`, L, 144, { size: 18, weight: 700, color: '#0e0e0e', spacing: 1, maxWidth: 250 });
    text(F, [Math.round(F.meta.bpm) + ' BPM', F.meta.key].filter(Boolean).join(' · '), R, 144, { size: 13.5, color: GREY, align: 'right' });
    line(F, L, 150.5, R, 150.5, '#a8a8a8', 1);
    sleeve(F, p);
    vinyl(F, p);
    crops(F, p);
    trackList(F, p);
    back(F);
  },
};
