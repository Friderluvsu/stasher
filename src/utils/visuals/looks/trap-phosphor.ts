import { blendBands, clamp, roundedRect, TAU } from '../frame';
import { MONO, partLabel, roleLabel, timeProgress, trackRole } from '../kit';
import type { TrackView } from '../frame';
import { K, lattice, rollGrid, rollNotes, rollTracks, squeezed, staticLayer, type RollGeo } from './_g';
import type { Look } from './types';

// Reference pixels (720 x 1280); the dynamic part runs inside ctx.scale(K). Everything is snapped to a 3 px
// dot grid whose origin is (75, 168), then masked with a lattice so the whole screen reads as a dot matrix.
const ORIGIN = { x: 75, y: 168 };
const ROLL: RollGeo = { x: 75, y: 168, w: 570, h: 783, headY: 402, beatPx: 48.75, cell: 3, pad: 8 };
const SCREEN = { x: 58, y: 66, w: 604, h: 936 };
const GREEN = '#7cf05c';
const DIM = '#3f9234';
const PHOSPHOR = ['#7cf05c', '#27e3cb', '#d7bd35', '#c8f06a', '#8fe9b4', '#52b8f0', '#f08a5c', '#b88cf0'];

const phosphorOf = (slot: number) => PHOSPHOR[slot % PHOSPHOR.length];

function paintStatic(g: CanvasRenderingContext2D) {
  g.scale(K, K);
  g.fillStyle = '#000000';
  g.fillRect(-4, -4, 728, 1288);
  const bezel = g.createLinearGradient(0, 40, 0, 1022);
  bezel.addColorStop(0, '#2b312d');
  bezel.addColorStop(1, '#262b27');
  g.beginPath();
  roundedRect(g, 40, 40, 640, 982, 26);
  g.fillStyle = bezel;
  g.fill();
  g.beginPath();
  roundedRect(g, 40.5, 40.5, 639, 981, 26);
  g.strokeStyle = 'rgba(255,255,255,.05)';
  g.lineWidth = 1;
  g.stroke();
  const glass = g.createLinearGradient(0, 58, 0, 1004);
  glass.addColorStop(0, '#0e170d');
  glass.addColorStop(.5, '#080f09');
  glass.addColorStop(1, '#040803');
  g.beginPath();
  roundedRect(g, 58, 58, 604, 946, 14);
  g.fillStyle = glass;
  g.fill();
  // soft phosphor bloom in the middle of the glass
  const bloom = g.createRadialGradient(360, 400, 20, 360, 520, 520);
  bloom.addColorStop(0, 'rgba(60,120,40,.06)');
  bloom.addColorStop(1, 'rgba(60,120,40,0)');
  g.fillStyle = bloom;
  g.beginPath();
  roundedRect(g, 58, 58, 604, 946, 14);
  g.fill();
}

export const trapPhosphor: Look = {
  id: 'trap-phosphor',
  group: 'midi',
  nameRu: 'Трэп: фосфор',
  nameEn: 'Trap Phosphor',
  descriptionRu: 'Тёмный точечный дисплей: пиано-ролл падает вниз сквозь светящуюся линию, сверху спектр, снизу уровень',
  descriptionEn: 'A dark dot-matrix display: the piano roll falls through a glowing line, spectrum on top, meter below',
  draw(F) {
    const { ctx } = F;
    staticLayer(F, 'trap-phosphor', paintStatic);
    ctx.save();
    ctx.scale(K, K);
    const progress = timeProgress(F);

    ctx.save();
    ctx.beginPath();
    roundedRect(ctx, 58, 58, 604, 946, 14);
    ctx.clip();

    // title
    squeezed(F, F.meta.title.toUpperCase(), 75, 96, { size: 26, sx: .9, maxWidth: 570, font: MONO, weight: 400, color: '#55dc3f' });

    // spectrum, bright for the part of the track already played
    const bars = 48;
    const bands = blendBands(F, bars);
    const pitch = 570 / bars;
    for (let i = 0; i < bars; i++) {
      const rows = Math.round(5 + clamp(bands[i]) ** .6 * 7);
      const h = Math.min(12, Math.max(4, rows)) * 3;
      const played = (i + .5) / bars <= progress;
      ctx.fillStyle = played ? GREEN : DIM;
      ctx.globalAlpha = played ? .95 : .85;
      ctx.fillRect(Math.round(i * pitch / 3) * 3 + 75, 147 - h, 9, h);
    }
    ctx.globalAlpha = 1;

    const parts = rollTracks(F);
    const visible = new Set<TrackView>();

    // piano roll
    ctx.save();
    ctx.beginPath();
    ctx.rect(ROLL.x - 4, ROLL.y, ROLL.w + 8, ROLL.h);
    ctx.clip();
    rollGrid(F, ROLL, '#78b050', .085, '#4f7a46', .1, .24, 9);
    const rings: { x: number; age: number; color: string }[] = [];
    rollNotes(F, ROLL, parts, ({ x, top, bottom, age, track, note }) => {
      const sounding = age >= 0 && top <= ROLL.headY && bottom >= ROLL.headY + 0;
      const color = phosphorOf(track.slot);
      const h = Math.max(6, bottom - top);
      const base = age < 0 ? .85 : sounding ? 1 : clamp(.8 - age * .09, .45, 1);
      ctx.fillStyle = color;
      ctx.globalAlpha = base * (.82 + .18 * note.vel);
      ctx.beginPath();
      roundedRect(ctx, x - 3.6, top, 7.2, h, 3.6);
      ctx.fill();
      if (sounding) {
        ctx.globalAlpha = .1 + .14 * note.env;
        ctx.fillRect(x - 6.5, top, 13, h);
      }
      visible.add(track);
      if (age >= 0 && age < .38) rings.push({ x, age, color });
    });
    ctx.globalAlpha = 1;

    // playhead: a thick glowing scan line
    const head = ROLL.headY;
    const pulse = .5 + .5 * clamp(F.hit);
    ctx.fillStyle = '#4fe02e';
    ctx.globalAlpha = .13 + .1 * pulse;
    ctx.fillRect(ROLL.x - 4, head - 13, ROLL.w + 8, 26);
    ctx.globalAlpha = .26 + .1 * pulse;
    ctx.fillRect(ROLL.x - 4, head - 7, ROLL.w + 8, 14);
    ctx.fillStyle = '#82f45a';
    ctx.globalAlpha = 1;
    ctx.fillRect(ROLL.x - 3, head - 2.5, ROLL.w + 6, 5);
    ctx.fillStyle = '#b4ff8c';
    ctx.globalAlpha = .2 + .25 * pulse;
    ctx.fillRect(ROLL.x - 3, head - 1, ROLL.w + 6, 2);
    // onset rings expanding from the note that just landed on the line
    for (const ring of rings) {
      const t = ring.age / .38;
      ctx.beginPath();
      ctx.arc(ring.x, head, 4 + t * 16, 0, TAU);
      ctx.strokeStyle = '#c8f2b6';
      ctx.globalAlpha = (1 - t) * .55;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // legend: a dimmed entry for parts with nothing in view
    let lx = 75;
    const roles = parts.map(trackRole);
    const legend = parts.slice(0, 6);
    legend.forEach((track: TrackView, i: number) => {
      const duplicate = roles.indexOf(roles[i]) !== i || roles.lastIndexOf(roles[i]) !== i;
      const label = (duplicate ? partLabel(track, 10) : roleLabel(track)).toLowerCase();
      const alpha = visible.has(track) ? 1 : .3;
      ctx.fillStyle = phosphorOf(track.slot);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      roundedRect(ctx, lx, 156, 12, 12, 2.5);
      ctx.fill();
      const width = squeezed(F, label, lx + 18, 167, { size: 14, sx: 1, font: MONO, weight: 400, color: DIM, alpha });
      lx += 18 + width + 14;
    });
    ctx.globalAlpha = 1;

    // bottom level meter, 12 bands
    const low = blendBands(F, 12);
    for (let i = 0; i < 12; i++) {
      const rows = 1 + Math.round(clamp(low[i]) ** 1.2 * 6);
      ctx.fillStyle = GREEN;
      ctx.globalAlpha = .95;
      const x = 74 + i * 47.5;
      const snapped = Math.round((x - 75) / 3) * 3 + 75;
      ctx.fillRect(snapped, 990 - rows * 3, 9, rows * 3);
    }
    ctx.globalAlpha = 1;

    // dot-matrix mask
    if (!F.thumb) {
      const glass = ['#0d150c', '#0a110a', '#080f09', '#070d08', '#050a06', '#040803'];
      const chunk = 156;
      for (let i = 0; i < glass.length; i++) lattice(F, ORIGIN.x, SCREEN.y + i * chunk, 573, chunk, 3, .8, glass[i], 1);
    }
    ctx.restore();
    ctx.restore();
    ctx.globalAlpha = 1;
  },
};
