import { clamp, roundedRect } from '../frame';
import { clock, MONO, partLabel, roleLabel, trackRole } from '../kit';
import { hRollNotes, K, macWindow, pitchRows, rollTracks, squeezed, staticLayer, waveformOverview, type HRollGeo, type WindowTheme } from './_g';
import type { Look } from './types';

// Reference pixels (720 x 1280). Static chrome (cream page, two windows, dark panels) is cached;
// the waveform, texts and the scrolling thin-line roll are drawn per frame.
const WIN1 = { x: 40, y: 334, w: 640, h: 298, bar: 36 };
const WIN2 = { x: 40, y: 667, w: 640, h: 333, bar: 41 };
const PANEL1 = { x: 72, y: 455, w: 576, h: 135 };
const PANEL2 = { x: 72, y: 765, w: 576, h: 219 };
const WAVE = { x: 88, w: 544, cy: 510, bars: 245 };
const ROLL: HRollGeo = { x: 88, y: 802, w: 544, h: 166, headX: 250, beatPx: 34.1 };
const PANEL_BG = '#14151a';
const PART = ['#ec4a2e', '#e58a0c', '#d9488a', '#6f78ff', '#2fa88a', '#c8b020', '#9c5cf0', '#40b8e0'];
const RED = '#dd4d28';
const GREY = '#8e8e92';

const THEME: WindowTheme = { bar: '#ececE8', body: '#f6f6f1', line: '#dcdcd7', title: '#6d6d6b', shadow: 'rgba(60,52,34,.4)' };

function paintStatic(g: CanvasRenderingContext2D) {
  const px = g.canvas.width / 720;
  g.scale(K, K);
  g.fillStyle = '#faf8f0';
  g.fillRect(-4, -4, 728, 1288);
  const blob = (x: number, y: number, r: number, rgb: string, a: number) => {
    const gradient = g.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, `rgba(${rgb},${a})`);
    gradient.addColorStop(.5, `rgba(${rgb},${a * .45})`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gradient;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  blob(130, 190, 270, '240,222,170', .62);
  blob(610, 320, 290, '250,214,168', .58);
  blob(100, 1090, 280, '232,222,196', .55);
  blob(620, 1080, 270, '248,222,186', .5);
  macWindow(g, WIN1.x, WIN1.y, WIN1.w, WIN1.h, WIN1.bar, 'listen', THEME, px, MONO);
  macWindow(g, WIN2.x, WIN2.y, WIN2.w, WIN2.h, WIN2.bar, 'current step', THEME, px, MONO);
  for (const panel of [PANEL1, PANEL2]) {
    g.beginPath();
    roundedRect(g, panel.x, panel.y, panel.w, panel.h, 14);
    g.fillStyle = PANEL_BG;
    g.fill();
  }
}

function keyWord(key: string): string {
  if (!key) return '';
  const minor = /m(in)?$/i.test(key) && !/maj$/i.test(key);
  const root = key.replace(/m(in|aj)?$/i, '').toLowerCase();
  return `${root}${minor ? 'min' : 'maj'}`;
}

export const amaSun: Look = {
  id: 'ama-sun',
  group: 'midi',
  nameRu: 'Окна: солнце',
  nameEn: 'Sun Windows',
  descriptionRu: 'Два окна на тёплом фоне: красная метка бежит по волне трека, ниже тонкие линии нот едут к белой линии',
  descriptionEn: 'Two windows on a warm page: a red marker walks the track waveform, thin note lines glide into a white playhead',
  draw(F) {
    const { ctx } = F;
    staticLayer(F, 'ama-sun', paintStatic);
    ctx.save();
    ctx.scale(K, K);
    const progress = F.meta.duration > 0 ? clamp(F.meta.seconds / F.meta.duration) : 0;
    const bpm = Math.round(F.meta.bpm);
    const key = F.meta.key;
    const mono = { font: MONO };

    // --- window 1: the track
    squeezed(F, F.meta.title.toLowerCase(), 72, 432, { ...mono, size: 48, weight: 700, color: RED, maxWidth: 576 });

    ctx.save();
    ctx.beginPath();
    roundedRect(ctx, PANEL1.x, PANEL1.y, PANEL1.w, PANEL1.h, 14);
    ctx.clip();
    const wave = waveformOverview(F, WAVE.bars);
    const pitch = WAVE.w / WAVE.bars;
    const playedBars = progress * WAVE.bars;
    for (let i = 0; i < WAVE.bars; i++) {
      const half = 2.5 + wave[i] * 30;
      ctx.fillStyle = i + .5 <= playedBars ? '#e7e7e7' : '#6c6c71';
      ctx.fillRect(WAVE.x + i * pitch, WAVE.cy - half, 1.5, half * 2);
    }
    const markerX = WAVE.x + progress * WAVE.w;
    ctx.fillStyle = '#d93a2d';
    ctx.fillRect(markerX - 1, 471, 2, 77);
    ctx.restore();
    const rate = F.audio.analysis ? `${Math.round(F.audio.analysis.sampleRate / 1000)} khz` : 'midi';
    squeezed(F, [F.meta.title.toLowerCase(), bpm, keyWord(key)].filter(Boolean).join(' ') + ` · ${rate}`, 88, 578, { ...mono, size: 14, color: GREY, maxWidth: 440 });
    squeezed(F, clock(F.meta.seconds), 632, 578, { ...mono, size: 14, color: GREY, align: 'right' });
    squeezed(F, `${bpm} bpm${key ? ` · ${key}` : ''}`, 72, 614, { ...mono, size: 14, color: '#7a7a78' });

    // --- window 2: the layers
    const parts = rollTracks(F);
    squeezed(F, `${parts.length} ${parts.length === 1 ? 'layer' : 'layers'}`, 72, 746, { ...mono, size: 26.5, weight: 700, color: RED });
    const bars = Math.max(1, Math.round(F.total / F.bar));
    squeezed(F, [`${bars} bars`, key, bpm].filter(Boolean).join(' · '), 648, 751, { ...mono, size: 26.5, color: '#7b7b79', align: 'right', maxWidth: 360 });

    ctx.save();
    ctx.beginPath();
    roundedRect(ctx, PANEL2.x, PANEL2.y, PANEL2.w, PANEL2.h, 14);
    ctx.clip();

    const range = pitchRows(F, 14);
    const rowH = ROLL.h / range.rows;
    // lanes
    const step = rowH < 4.5 ? 2 : 1;
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = .055;
    for (let r = 0; r <= range.rows; r += step) ctx.fillRect(ROLL.x, ROLL.y + r * rowH - .5, ROLL.w, 1);
    // bar lines and beat ticks scroll with the clock
    const perBeat = ROLL.beatPx;
    const first = Math.floor((F.tick - (ROLL.headX - ROLL.x) / perBeat * F.beat) / F.beat) - 1;
    const last = Math.ceil((F.tick + (ROLL.x + ROLL.w - ROLL.headX) / perBeat * F.beat) / F.beat) + 1;
    for (let b = first; b <= last; b++) {
      const x = ROLL.headX + (b * F.beat - F.tick) / F.beat * perBeat;
      if (x < ROLL.x || x > ROLL.x + ROLL.w) continue;
      const isBar = ((b % 4) + 4) % 4 === 0;
      ctx.globalAlpha = isBar ? .1 : .05;
      ctx.fillRect(Math.round(x) - .5, isBar ? ROLL.y - 4 : ROLL.y, 1, isBar ? ROLL.h + 4 : 5);
    }
    // notes: thin lines
    const visible = new Set<unknown>();
    hRollNotes(F, ROLL, parts, range, ({ track, left, right, y, age, note }) => {
      const color = PART[track.slot % PART.length];
      const sounding = left <= ROLL.headX && right >= ROLL.headX;
      visible.add(track);
      ctx.fillStyle = color;
      ctx.globalAlpha = sounding ? .62 : age < 0 ? .3 : .22;
      const h = Math.max(1.3, Math.min(2, rowH * .5));
      const x0 = Math.max(ROLL.x, left), x1 = Math.min(ROLL.x + ROLL.w, right);
      if (x1 > x0) ctx.fillRect(x0, y - h / 2, x1 - x0, h);
      if (sounding) {
        ctx.globalAlpha = .07 + .08 * note.env;
        ctx.fillRect(x0, y - 2.5, x1 - x0, 5);
      }
    });
    // playhead
    const pulse = .6 + .4 * clamp(F.hit);
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = .1 * pulse;
    ctx.fillRect(ROLL.headX - 7, 798, 14, 172);
    ctx.globalAlpha = .22 * pulse;
    ctx.fillRect(ROLL.headX - 4, 798, 8, 172);
    ctx.globalAlpha = .98;
    ctx.fillRect(ROLL.headX - 1.5, 798, 3, 172);

    // legend
    let lx = 93;
    const roles = parts.map(trackRole);
    parts.slice(0, 5).forEach((track, i) => {
      const dim = visible.has(track) ? 1 : .32;
      const duplicate = roles.indexOf(roles[i]) !== roles.lastIndexOf(roles[i]);
      const label = (duplicate ? partLabel(track, 10) : roleLabel(track)).toLowerCase();
      ctx.fillStyle = PART[track.slot % PART.length];
      ctx.globalAlpha = dim;
      ctx.beginPath();
      roundedRect(ctx, lx, 787, 8, 8, 2);
      ctx.fill();
      const width = squeezed(F, label, lx + 13, 796, { ...mono, size: 12.6, color: '#a4a4a8', alpha: dim });
      lx += 13 + width + 18;
    });
    ctx.globalAlpha = 1;
    ctx.restore();
    ctx.restore();
    ctx.globalAlpha = 1;
  },
};
