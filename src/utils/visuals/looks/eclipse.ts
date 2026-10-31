import { fill, MONO, text, timeProgress } from '../kit';
import { TAU, blendBands, loopT } from '../frame';
import type { Look } from './types';

const CX = 270, CY = 449;
const R_DARK = 160, R_MOON = 139, R_RING = 174;

// Rim ripples: [lobes, amplitude, phase, drift cycles per loop]
const RIPPLES: [number, number, number, number][] = [
  [3, 1.6, .4, 1], [5, 1.4, 2.1, -1], [8, 1.7, 4.2, 2], [11, 1.8, 1.3, -2], [14, 1.9, 5.1, 3], [19, 1.1, .8, -3], [26, .5, 3.3, 2],
];

function rimRadius(theta: number, drift: number, bands: Float32Array, gain: number): number {
  let r = 0;
  for (const [lobes, amp, phase, cycles] of RIPPLES) r += amp * Math.sin(lobes * theta + phase + cycles * drift);
  // pointed lobes: soften the troughs of the strongest ripple into notches
  r += .9 * (Math.abs(Math.sin(9 * theta + 1.1 + drift)) - .6);
  const at = (theta / TAU % 1 + 1) % 1 * bands.length;
  const i = Math.floor(at), t = at - i, e = bands[i % bands.length] * (1 - t) + bands[(i + 1) % bands.length] * t;
  return R_DARK + r * (.82 + .3 * gain * e) + 1.6 * e * gain;
}

export const eclipse: Look = {
  id: 'eclipse',
  group: 'audio',
  nameRu: 'Затмение',
  nameEn: 'Eclipse',
  descriptionRu: 'Светлый диск медленно закрывает тёмный с рябью по краю, пока играет трек',
  descriptionEn: 'A pale disc slowly covers a dark rippling one as the track plays',
  draw(F) {
    const { ctx } = F;
    // paper with a soft vignette
    fill(F, '#f1f1ec');
    const paper = ctx.createRadialGradient(CX, 440, 40, CX, 460, 640);
    paper.addColorStop(0, '#f8f8f5');
    paper.addColorStop(.55, '#f4f4f1');
    paper.addColorStop(1, '#e9eae3');
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, 540, 960);

    const bands = blendBands(F, 24);
    const gain = Math.min(1.3, F.env + F.audio.level * .6 + F.hit * .5);
    const drift = loopT(F, 16) * TAU;
    const breathe = 1 + .012 * F.audio.bass + .008 * F.hit;

    // shadow under the dark disc
    const shadow = ctx.createRadialGradient(CX, CY + 8, R_DARK * .8, CX, CY + 8, R_DARK + 46);
    shadow.addColorStop(0, 'rgba(30,32,40,0.2)');
    shadow.addColorStop(.35, 'rgba(30,32,40,0.14)');
    shadow.addColorStop(1, 'rgba(30,32,40,0)');
    ctx.fillStyle = shadow;
    ctx.fillRect(CX - R_DARK - 60, CY - R_DARK - 50, (R_DARK + 60) * 2, (R_DARK + 60) * 2);

    // faint ring around the disc
    ctx.strokeStyle = '#9a9a96';
    ctx.globalAlpha = .26;
    ctx.lineWidth = .8;
    ctx.beginPath(); ctx.arc(CX, CY, R_RING, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;

    // the dark disc
    const steps = F.thumb ? 72 : 180;
    ctx.beginPath();
    for (let s = 0; s <= steps; s++) {
      const theta = s / steps * TAU, a = theta - Math.PI / 2;
      const r = rimRadius(theta, drift, bands, gain) * breathe;
      const x = CX + Math.cos(a) * r, y = CY + Math.sin(a) * r;
      if (s) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    const body = ctx.createRadialGradient(CX - 30, CY - 60, 8, CX - 20, CY - 40, R_DARK * 1.45);
    body.addColorStop(0, '#282933');
    body.addColorStop(.45, '#1c1d24');
    body.addColorStop(1, '#0a0b0f');
    ctx.fillStyle = body;
    ctx.fill();

    // the pale disc crossing over it: one full pass per song
    const p = timeProgress(F);
    const mx = -29 + 598 * p, my = CY + 4;
    const soft = ctx.createRadialGradient(mx, my, R_MOON * .9, mx, my, R_MOON + 26);
    soft.addColorStop(0, 'rgba(60,62,66,0.10)');
    soft.addColorStop(1, 'rgba(60,62,66,0)');
    ctx.fillStyle = soft;
    ctx.fillRect(mx - R_MOON - 30, my - R_MOON - 30, (R_MOON + 30) * 2, (R_MOON + 30) * 2);
    ctx.fillStyle = '#f9f9f7';
    ctx.beginPath(); ctx.arc(mx, my, R_MOON, 0, TAU); ctx.fill();
    if (!F.thumb) {
      ctx.strokeStyle = '#8c8c88';
      ctx.lineWidth = .7;
      ctx.globalAlpha = .22;
      ctx.setLineDash([1, 4]);
      ctx.beginPath(); ctx.arc(mx, my, R_MOON * .8, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = .1;
      ctx.beginPath(); ctx.arc(mx, my, R_MOON, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    text(F, `${F.meta.title.toUpperCase()} · ${Math.round(F.meta.bpm)} BPM${F.meta.key ? ` · ${F.meta.key}` : ''}`, 30, 922, { size: 9, font: MONO, color: '#85857f', spacing: 2.1 });
  },
};
