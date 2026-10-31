import { blendBands, clamp, roundedRect } from '../frame';
import { clock2, fill, MONO, timeProgress } from '../kit';
import { K, lattice, rollGrid, rollNotes, rollTracks, squeezed, staticLayer, type RollGeo } from './_g';
import type { Look } from './types';

// Geometry below is in reference pixels (720 x 1280); the dynamic part runs inside ctx.scale(K).
const LCD = { x: 85, y: 431, w: 365, h: 231 };
const ROLL: RollGeo = { x: 111, y: 529, w: 314, h: 72, headY: 549, beatPx: 4.6, cell: 3, pad: 4 };
const METER = { x: 130, y: 674, w: 10, h: 21, pitch: 15.1, count: 12 };
const INK = '#1c3507';

function limeGradient(g: CanvasRenderingContext2D) {
  const gradient = g.createLinearGradient(0, LCD.y, 0, LCD.y + LCD.h);
  gradient.addColorStop(0, '#bee257');
  gradient.addColorStop(.5, '#b2dc41');
  gradient.addColorStop(1, '#a4d02e');
  return gradient;
}

function paintStatic(g: CanvasRenderingContext2D) {
  const px = g.canvas.width / 720;
  g.scale(K, K);
  // pastel page
  const page = g.createLinearGradient(0, 0, 0, 1280);
  page.addColorStop(0, '#f7f6fb');
  page.addColorStop(.5, '#fafafa');
  page.addColorStop(1, '#f4faf9');
  g.fillStyle = page;
  g.fillRect(-4, -4, 728, 1288);
  const blob = (x: number, y: number, r: number, rgb: string, a: number) => {
    const gradient = g.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(${rgb},${a})`);
    gradient.addColorStop(.55, `rgba(${rgb},${a * .4})`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gradient;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blob(150, 190, 230, '214,196,255', .5);
  blob(610, 320, 230, '255,196,160', .55);
  blob(105, 1085, 240, '170,235,200', .5);
  blob(610, 1020, 250, '176,212,255', .5);

  // body
  const bx = 40, by = 375, bw = 640, bh = 343, br = 96;
  g.save();
  g.shadowColor = 'rgba(30,32,40,.62)';
  g.shadowBlur = 16 * px;
  g.shadowOffsetY = 9 * px;
  g.beginPath();
  roundedRect(g, bx, by, bw, bh, br);
  g.fillStyle = '#d4d6d1';
  g.fill();
  g.restore();
  g.save();
  g.shadowColor = 'rgba(46,48,58,.7)';
  g.shadowBlur = 44 * px;
  g.shadowOffsetY = 24 * px;
  g.beginPath();
  roundedRect(g, bx, by, bw, bh, br);
  g.fillStyle = '#d4d6d1';
  g.fill();
  g.restore();
  const shell = g.createLinearGradient(0, by, 0, by + bh);
  shell.addColorStop(0, '#eeeeea');
  shell.addColorStop(.16, '#e8e9e5');
  shell.addColorStop(.54, '#d0d3ce');
  shell.addColorStop(.86, '#b6b9b3');
  shell.addColorStop(1, '#aaada7');
  g.beginPath();
  roundedRect(g, bx, by, bw, bh, br);
  g.fillStyle = shell;
  g.fill();
  // brushed horizontal grain
  g.save();
  g.beginPath();
  roundedRect(g, bx, by, bw, bh, br);
  g.clip();
  for (let y = by; y < by + bh; y += 2) {
    g.fillStyle = (y / 2) % 2 ? 'rgba(255,255,255,.07)' : 'rgba(60,66,56,.035)';
    g.fillRect(bx, y, bw, 1);
  }
  g.restore();
  // rim light and the inset contour
  g.beginPath();
  roundedRect(g, bx + .75, by + .75, bw - 1.5, bh - 1.5, br);
  g.strokeStyle = 'rgba(255,255,255,.75)';
  g.lineWidth = 1.5;
  g.stroke();
  g.beginPath();
  roundedRect(g, bx + 9, by + 9, bw - 18, bh - 18, br - 9);
  g.strokeStyle = 'rgba(110,116,106,.42)';
  g.lineWidth = 1.2;
  g.stroke();
  g.beginPath();
  roundedRect(g, bx + 10.5, by + 10.5, bw - 21, bh - 21, br - 10.5);
  g.strokeStyle = 'rgba(255,255,255,.55)';
  g.lineWidth = 1;
  g.stroke();

  // LCD
  g.beginPath();
  roundedRect(g, LCD.x - 1, LCD.y + 2, LCD.w + 2, LCD.h, 17);
  g.strokeStyle = 'rgba(255,255,255,.35)';
  g.lineWidth = 1.5;
  g.stroke();
  g.beginPath();
  roundedRect(g, LCD.x, LCD.y, LCD.w, LCD.h, 16);
  g.fillStyle = '#15230b';
  g.fill();
  g.beginPath();
  roundedRect(g, LCD.x + 3, LCD.y + 3, LCD.w - 6, LCD.h - 6, 13);
  g.fillStyle = limeGradient(g);
  g.fill();
  const recess = g.createLinearGradient(0, LCD.y + 3, 0, LCD.y + 22);
  recess.addColorStop(0, 'rgba(40,70,0,.30)');
  recess.addColorStop(1, 'rgba(40,70,0,0)');
  g.fillStyle = recess;
  g.save();
  g.beginPath();
  roundedRect(g, LCD.x + 3, LCD.y + 3, LCD.w - 6, LCD.h - 6, 13);
  g.clip();
  g.fillRect(LCD.x, LCD.y, LCD.w, 24);
  g.restore();

  // big play sphere
  const cx = 587, cy = 527, cr = 67;
  g.save();
  g.shadowColor = 'rgba(40,42,48,.45)';
  g.shadowBlur = 30 * px;
  g.shadowOffsetY = 20 * px;
  g.beginPath();
  g.arc(cx, cy, cr, 0, Math.PI * 2);
  g.fillStyle = '#c4c6c1';
  g.fill();
  g.restore();
  const sphere = g.createRadialGradient(cx - 22, cy - 28, 4, cx, cy, cr + 6);
  sphere.addColorStop(0, '#fcfcfb');
  sphere.addColorStop(.36, '#e6e7e3');
  sphere.addColorStop(.72, '#c9cac6');
  sphere.addColorStop(1, '#a6a8a3');
  g.beginPath();
  g.arc(cx, cy, cr, 0, Math.PI * 2);
  g.fillStyle = sphere;
  g.fill();
  g.beginPath();
  g.arc(cx, cy, cr - .8, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(255,255,255,.45)';
  g.lineWidth = 1.4;
  g.stroke();
  const sheen = g.createRadialGradient(cx + 18, cy + 34, 4, cx + 18, cy + 34, 52);
  sheen.addColorStop(0, 'rgba(255,255,255,.28)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.beginPath();
  g.arc(cx, cy, cr, 0, Math.PI * 2);
  g.fillStyle = sheen;
  g.fill();
  g.beginPath();
  g.moveTo(572, 503);
  g.lineTo(572, 551);
  g.lineTo(612, 527);
  g.closePath();
  g.fillStyle = '#0b0b0c';
  g.strokeStyle = '#0b0b0c';
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.fill();
  g.stroke();

  // prev / next
  const pill = (x: number, next: boolean) => {
    g.save();
    g.shadowColor = 'rgba(60,62,66,.3)';
    g.shadowBlur = 9 * px;
    g.shadowOffsetY = 5 * px;
    g.beginPath();
    roundedRect(g, x, 616, 52, 37, 18.5);
    g.fillStyle = '#d9dbd6';
    g.fill();
    g.restore();
    const face = g.createLinearGradient(0, 616, 0, 653);
    face.addColorStop(0, '#e6e8e4');
    face.addColorStop(1, '#cbcdc8');
    g.beginPath();
    roundedRect(g, x, 616, 52, 37, 18.5);
    g.fillStyle = face;
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,.4)';
    g.lineWidth = 1;
    g.stroke();
    const mid = x + 26;
    g.fillStyle = '#8e928b';
    g.beginPath();
    if (next) {
      g.moveTo(mid - 7, 628); g.lineTo(mid - 7, 640); g.lineTo(mid + 2, 634);
      g.fill();
      g.fillRect(mid + 3.5, 628, 2.4, 12);
    } else {
      g.fillRect(mid - 5.9, 628, 2.4, 12);
      g.moveTo(mid + 7, 628); g.lineTo(mid + 7, 640); g.lineTo(mid - 2, 634);
      g.fill();
    }
  };
  pill(530, false);
  pill(591, true);

  // meter slots
  for (let i = 0; i < METER.count; i++) {
    g.fillStyle = '#b6e03f';
    g.fillRect(METER.x + i * METER.pitch, METER.y, METER.w, METER.h);
  }
}

export const trapChrome: Look = {
  id: 'trap-chrome',
  group: 'midi',
  nameRu: 'Трэп: хром',
  nameEn: 'Trap Chrome',
  descriptionRu: 'Серебристый MP3-плеер из нулевых: салатовый LCD с пиксельным пиано-роллом, уровнем и кнопкой play',
  descriptionEn: 'A silver 2000s MP3 player: lime LCD with a pixel piano roll, level meter and a big play button',
  draw(F) {
    const { ctx } = F;
    if (!staticLayer(F, 'trap-chrome', paintStatic)) fill(F, '#f6f6f6');

    ctx.save();
    ctx.scale(K, K);
    const progress = timeProgress(F);

    // LCD content, clipped to the glass
    ctx.save();
    ctx.beginPath();
    roundedRect(ctx, LCD.x + 3, LCD.y + 3, LCD.w - 6, LCD.h - 6, 13);
    ctx.clip();

    // status flags
    const flag = { size: 19, sx: .75, font: MONO, weight: 500, align: 'right' as const };
    const shuf = squeezed(F, 'SHUF', 425, 469, { ...flag, color: INK, alpha: .2 });
    const loop = squeezed(F, 'LOOP', 425 - shuf - 11, 469, { ...flag, color: INK, alpha: .2 });
    squeezed(F, 'PAUSE', 425 - shuf - loop - 22, 469, { ...flag, color: INK });

    // title (pushed a little by the bass hit, like a backlit LCD refreshing)
    squeezed(F, F.meta.title.toUpperCase(), 111, 518, { size: 44, sx: .75, maxWidth: 314, font: MONO, weight: 600, color: INK });

    // piano roll
    ctx.save();
    ctx.beginPath();
    ctx.rect(ROLL.x, ROLL.y, ROLL.w, ROLL.h);
    ctx.clip();
    rollGrid(F, ROLL, '#2f5a05', .12, INK, .1, .3, 6);
    const parts = rollTracks(F);
    const lead = parts.length;
    rollNotes(F, ROLL, parts, ({ x, top, bottom, age, slot }) => {
      const sounding = age >= 0 && top <= ROLL.headY && bottom >= ROLL.headY;
      const h = Math.max(3, bottom - top);
      const tone = lead > 1 ? 1 - slot * .06 : 1;
      ctx.fillStyle = INK;
      ctx.globalAlpha = (sounding ? .95 : age < 0 ? .72 : .5) * tone;
      ctx.fillRect(x - 1.5, top, 3, h);
      if (sounding) {
        ctx.globalAlpha = .22;
        ctx.fillRect(x - 4.5, top, 9, h);
      }
    });
    ctx.globalAlpha = 1;
    // playhead
    ctx.fillStyle = INK;
    ctx.globalAlpha = .92;
    ctx.fillRect(ROLL.x, ROLL.headY - 1.5, ROLL.w, 3);
    ctx.restore();

    // clock
    const t = squeezed(F, clock2(F.meta.seconds), 111, 645, { size: 40, sx: .77, font: MONO, weight: 600, color: INK });
    squeezed(F, `/ ${clock2(F.meta.duration)}`, 111 + t + 12, 645, { size: 15, sx: .85, font: MONO, weight: 500, color: INK });
    const info = [`${Math.round(F.meta.bpm)} BPM`, F.meta.key].filter(Boolean).join(' · ');
    squeezed(F, info, 425, 645, { size: 19, sx: .75, font: MONO, weight: 500, color: INK, align: 'right', maxWidth: 190 });

    // progress dots
    const dots = 45;
    for (let i = 0; i < dots; i++) {
      const on = (i + .5) / dots <= progress;
      ctx.fillStyle = INK;
      ctx.globalAlpha = on ? .9 : .22;
      const s = on ? 3 : 2;
      ctx.fillRect(111 + i * (314 / dots) + (3 - s) / 2, 654 - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // level meter under the glass
    const bands = blendBands(F, METER.count);
    for (let i = 0; i < METER.count; i++) {
      const level = clamp(bands[i]) ** 1.5;
      const rows = 1 + Math.round(level * 5);
      for (let r = 0; r < rows; r++) {
        ctx.fillStyle = INK;
        ctx.globalAlpha = .92;
        ctx.fillRect(METER.x + i * METER.pitch, METER.y + METER.h - 2 - r * 3, METER.w, r === 0 ? 2 : 1.6);
      }
    }
    ctx.globalAlpha = 1;

    // dot-matrix mask over glass and meter
    if (!F.thumb) {
      lattice(F, LCD.x + 3, LCD.y + 3, LCD.w - 6, LCD.h - 6, 3, 1.1, '#7a9f12', .42);
      for (let i = 0; i < METER.count; i++) lattice(F, METER.x + i * METER.pitch, METER.y, METER.w, METER.h, 3, 1.1, '#7a9f12', .42);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },
};
