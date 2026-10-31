import { clamp, roundedRect, TAU } from '../frame';
import { MONO, partLabel, roleLabel, trackRole } from '../kit';
import { hRollNotes, K, macWindow, pitchRows, rollTracks, squeezed, staticLayer, waveformOverview, type HRollGeo, type WindowTheme } from './_g';
import type { Look } from './types';

// Reference pixels (720 x 1280). A cream page, a small "listen" window with a waveform and a tall
// "current step" window whose dark frame holds a paper-coloured roll of outlined pill notes.
const WIN1 = { x: 40, y: 40, w: 640, h: 117, bar: 37 };
const WIN2 = { x: 40, y: 171, w: 640, h: 851, bar: 37 };
const BAR = { x: 72, y: 120, w: 576, h: 27 };
const FRAME = { x: 56, y: 219, w: 608, h: 793 };
const PAPER = { x: 66, y: 229, w: 588, h: 773 };
const ROLL: HRollGeo = { x: PAPER.x, y: PAPER.y, w: PAPER.w, h: PAPER.h, headX: PAPER.x + PAPER.w * .3, beatPx: PAPER.w / 16 };
const AMBER = '#b8791f';
const PART = [
  { stroke: '#b8801f', ghost: '#d9a24a', fill: 'rgba(238,196,112,.30)' },
  { stroke: '#8a9a2e', ghost: '#a8b45a', fill: 'rgba(206,218,120,.30)' },
  { stroke: '#cc7a86', ghost: '#dba0a8', fill: 'rgba(238,176,184,.28)' },
  { stroke: '#5a8ec0', ghost: '#86aed0', fill: 'rgba(150,188,224,.28)' },
  { stroke: '#8c6cc4', ghost: '#aa92d4', fill: 'rgba(188,168,224,.28)' },
  { stroke: '#3e9c88', ghost: '#72b8a8', fill: 'rgba(140,208,192,.28)' },
];
const THEME: WindowTheme = { bar: '#ececE8', body: '#f6f6f1', line: '#dcdcd7', title: '#6d6d6b', shadow: 'rgba(60,52,34,.4)' };

function paintStatic(g: CanvasRenderingContext2D) {
  const px = g.canvas.width / 720;
  g.scale(K, K);
  g.fillStyle = '#fbf9f3';
  g.fillRect(-4, -4, 728, 1288);
  const blob = (x: number, y: number, r: number, rgb: string, a: number) => {
    const gradient = g.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(${rgb},${a})`);
    gradient.addColorStop(.5, `rgba(${rgb},${a * .5})`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gradient;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blob(720, 270, 320, '240,222,196', .85);
  blob(0, 250, 240, '238,228,204', .75);
  blob(100, 1100, 270, '236,228,208', .65);
  blob(620, 1100, 260, '246,232,205', .55);
  macWindow(g, WIN1.x, WIN1.y, WIN1.w, WIN1.h, WIN1.bar, 'listen', THEME, px, MONO);
  macWindow(g, WIN2.x, WIN2.y, WIN2.w, WIN2.h, WIN2.bar, 'current step', THEME, px, MONO);
  // waveform bar
  g.beginPath();
  roundedRect(g, BAR.x, BAR.y, BAR.w, BAR.h, 8);
  g.fillStyle = '#19191d';
  g.fill();
  // the dark frame and its paper
  g.beginPath();
  roundedRect(g, FRAME.x, FRAME.y, FRAME.w, FRAME.h, 14);
  g.fillStyle = '#17161b';
  g.fill();
  g.beginPath();
  roundedRect(g, PAPER.x, PAPER.y, PAPER.w, PAPER.h, 4);
  g.fillStyle = '#f3f4ef';
  g.fill();
}

export const afroPaper: Look = {
  id: 'afro-paper',
  group: 'midi',
  nameRu: 'Бумага',
  nameEn: 'Paper Roll',
  descriptionRu: 'Бумажные окна: тёмная полоса волны с янтарной меткой и лист с контурными нотами, плывущими к серой линии',
  descriptionEn: 'Paper windows: a dark waveform strip with an amber marker and a sheet of outlined notes gliding into a grey playhead',
  draw(F) {
    const { ctx } = F;
    staticLayer(F, 'afro-paper', paintStatic);
    ctx.save();
    ctx.scale(K, K);
    const progress = F.meta.duration > 0 ? clamp(F.meta.seconds / F.meta.duration) : 0;
    const bpm = Math.round(F.meta.bpm);
    const mono = { font: MONO };

    // --- window 1
    squeezed(F, F.meta.title.toLowerCase(), 72, 106, { ...mono, size: 26.5, weight: 700, color: AMBER, maxWidth: 330 });
    squeezed(F, `${bpm} bpm${F.meta.key ? ` · ${F.meta.key}` : ''}`, 648, 105, { ...mono, size: 14.8, color: '#777773', align: 'right' });
    ctx.save();
    ctx.beginPath();
    roundedRect(ctx, BAR.x, BAR.y, BAR.w, BAR.h, 8);
    ctx.clip();
    const count = 190;
    const wave = waveformOverview(F, count);
    const pitch = (BAR.w - 24) / count;
    for (let i = 0; i < count; i++) {
      const half = 1.4 + wave[i] * 8.6;
      ctx.fillStyle = (i + .5) / count <= progress ? '#e6e6e4' : '#707074';
      ctx.fillRect(BAR.x + 12 + i * pitch, BAR.y + BAR.h / 2 - half, 1.7, half * 2);
    }
    ctx.fillStyle = '#d6a13a';
    ctx.fillRect(BAR.x + 12 + progress * (BAR.w - 24) - 1, BAR.y - 1, 2, BAR.h + 2);
    ctx.restore();

    // --- window 2: legend rings in the title bar
    const parts = rollTracks(F);
    const visible = new Set<unknown>();
    const range = pitchRows(F, 24);
    const rowH = ROLL.h / range.rows;
    const pillH = Math.max(5, Math.min(11, rowH * .66));

    ctx.save();
    ctx.beginPath();
    roundedRect(ctx, PAPER.x, PAPER.y, PAPER.w, PAPER.h, 4);
    ctx.clip();
    hRollNotes(F, ROLL, parts, range, ({ track, left, right, y, age }) => {
      const x0 = Math.max(ROLL.x - 30, left), x1 = Math.min(ROLL.x + ROLL.w + 30, right);
      if (x1 <= x0) return;
      visible.add(track);
      const palette = PART[track.slot % PART.length];
      const sounding = left <= ROLL.headX && right >= ROLL.headX;
      const alpha = sounding ? 1 : age < 0 ? .5 : clamp(.88 - age * .05, .55, .9);
      const width = Math.max(pillH, x1 - x0 - 2);
      ctx.beginPath();
      roundedRect(ctx, x0 + 1, y - pillH / 2, width, pillH, pillH / 2);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = palette.fill;
      ctx.fill();
      ctx.strokeStyle = age < 0 ? palette.ghost : palette.stroke;
      ctx.lineWidth = sounding ? 2.8 : 2.3;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    // playhead: a thin grey line with a soft shadow on both sides
    const pulse = .8 + .2 * clamp(F.hit);
    const head = ROLL.headX;
    for (const [w, a] of [[16, .03], [9, .05], [5, .07]] as const) {
      ctx.fillStyle = '#5a5a56';
      ctx.globalAlpha = a * pulse;
      ctx.fillRect(head - w / 2 + .5, PAPER.y, w, PAPER.h);
    }
    ctx.globalAlpha = .9;
    ctx.fillStyle = '#85867f';
    ctx.fillRect(head - .5, PAPER.y, 1.8, PAPER.h);
    ctx.restore();

    let lx = 261;
    const roles = parts.map(trackRole);
    parts.slice(0, 4).forEach((track, i) => {
      const palette = PART[track.slot % PART.length];
      const alive = visible.has(track);
      ctx.beginPath();
      ctx.arc(lx, 189, 4.1, 0, TAU);
      ctx.globalAlpha = alive ? 1 : .45;
      ctx.strokeStyle = palette.stroke;
      ctx.lineWidth = 1.7;
      ctx.stroke();
      const label = (roles.indexOf(roles[i]) !== roles.lastIndexOf(roles[i]) ? partLabel(track, 9) : roleLabel(track)).toLowerCase();
      const width = squeezed(F, label, lx + 10, 194, { ...mono, size: 14, color: '#ffffff', alpha: alive ? .6 : .35 });
      lx += 10 + width + 15;
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  },
};
