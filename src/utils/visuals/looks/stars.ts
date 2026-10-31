import { clock2, fill, MONO, rand, text, trackRole, type VNote } from '../kit';
import { TAU, glow, windowNotes, type Frame, type TrackView } from '../frame';
import type { Look } from './types';

const BG = '#050a12';
const CX = 270;
const LEFT = 30, RIGHT = 510;
const BAR_PX = 120;
type Zone = 'bass' | 'chords' | 'lead';
const ZONES: Record<Zone, { low: number; high: number; color: string; line: string }> = {
  bass: { low: 817, high: 603, color: '#6c5bd0', line: '#6a5bc8' },
  chords: { low: 548, high: 343, color: '#2bb59f', line: '#3aa896' },
  lead: { low: 322, high: 196, color: '#e0a23a', line: '#c99236' },
};

function zoneOf(F: Frame, track: TrackView): Zone | null {
  if (F.synthetic) return track.slot === 0 ? 'bass' : track.slot === 1 ? 'chords' : 'lead';
  const role = trackRole(track);
  return role === 'drums' ? null : role;
}

const xOf = (F: Frame, tick: number) => CX + (tick - F.tick) / F.bar * BAR_PX;

function skyDots(F: Frame) {
  const { ctx } = F;
  const count = F.thumb ? 40 : 130;
  for (let i = 0; i < count; i++) {
    const x = rand(i, 1) * 540, y = 40 + rand(i, 2) * 880;
    const size = .6 + rand(i, 3) ** 2 * 1.5;
    const cycles = 3 + Math.floor(rand(i, 5) * 9);
    const twinkle = .78 + .22 * Math.sin(F.tick / F.total * cycles * TAU + rand(i, 6) * TAU);
    const flash = 1 + F.hit * 1.2 * rand(i, 7);
    ctx.globalAlpha = Math.min(1, (.22 + .6 * rand(i, 4) ** 1.5) * twinkle * flash);
    ctx.fillStyle = rand(i, 8) > .8 ? '#a9c4ff' : '#dfe6f2';
    ctx.fillRect(x, y, size, size);
  }
  ctx.globalAlpha = 1;
}

function frameworks(F: Frame) {
  const { ctx } = F;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = .9;
  ctx.setLineDash([6, 5]);
  ctx.globalAlpha = .28;
  ctx.beginPath(); ctx.moveTo(CX, 159); ctx.lineTo(CX, 848); ctx.stroke();
  ctx.globalAlpha = .33;
  ctx.strokeStyle = '#b9c0cc';
  ctx.beginPath(); ctx.moveTo(30, 529); ctx.quadraticCurveTo(262, 440, 510, 506); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

interface Dot { x: number; y: number; past: boolean; active: boolean; env: number; note: VNote }

function drawZone(F: Frame, zone: Zone, tracks: TrackView[], stack: boolean) {
  const { ctx } = F;
  const spec = ZONES[zone];
  let low = Infinity, high = -Infinity;
  for (const track of tracks) { low = Math.min(low, track.index.minPitch); high = Math.max(high, track.index.maxPitch); }
  if (high - low < 12) { const mid = (low + high) / 2; low = mid - 6; high = mid + 6; }
  const span = F.bar * 2.2;
  const dots: Dot[] = [];
  for (const track of tracks) {
    for (const note of windowNotes(F, track.index, span, span)) {
      const x = xOf(F, note.pos);
      if (x < LEFT - 70 || x > RIGHT + 70) continue;
      const y = spec.low + (spec.high - spec.low) * ((note.pitch - low) / (high - low));
      dots.push({ x, y, past: note.pos <= F.tick, active: note.pos <= F.tick && note.end > F.tick, env: note.env, note });
    }
  }
  dots.sort((a, b) => a.note.pos - b.note.pos || a.note.pitch - b.note.pitch);
  ctx.save();
  ctx.beginPath();
  ctx.rect(LEFT, 0, RIGHT - LEFT, 960);
  ctx.clip();
  ctx.strokeStyle = spec.line;
  ctx.lineWidth = .9;

  const link = (a: Dot, b: Dot, alpha: number) => {
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  };
  const groups: Dot[][] = [];
  if (stack) {
    const gap = F.beat / 6;
    for (const dot of dots) {
      const last = groups[groups.length - 1];
      if (last && dot.note.pos - last[0].note.pos <= gap) last.push(dot); else groups.push([dot]);
    }
    groups.forEach((group, g) => {
      const alpha = group[0].past ? .6 : .38;
      for (let i = 1; i < group.length; i++) link(group[i - 1], group[i], alpha);
      const next = groups[g + 1];
      if (next && Math.floor(group[0].note.pos / F.bar + 1e-6) % 4 === 2) link(group[group.length - 1], next[0], .5);
    });
  } else {
    for (let i = 1; i < dots.length; i++) {
      if (dots[i].note.pos - dots[i - 1].note.pos > F.bar * 1.2) continue;
      link(dots[i - 1], dots[i], dots[i].past ? .62 : .3);
    }
  }

  const labelled = new Set<number>();
  for (const dot of dots) {
    const bar = Math.floor(dot.note.pos / F.bar + 1e-6);
    const showLabel = !stack && !labelled.has(bar);
    if (showLabel) labelled.add(bar);
    if (dot.x < LEFT - 8 || dot.x > RIGHT + 8) continue;
    const r = 4.1;
    if (dot.past && !F.thumb) glow(F, spec.color, dot.x, dot.y, 13 + 3 * dot.env, .32);
    ctx.globalAlpha = 1;
    ctx.fillStyle = dot.past ? '#ffffff' : '#7c8189';
    ctx.globalAlpha = dot.past ? 1 : .8;
    ctx.beginPath(); ctx.arc(dot.x, dot.y, r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
    if (dot.active) {
      ctx.strokeStyle = spec.color;
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = .55 + .45 * dot.env;
      ctx.beginPath(); ctx.arc(dot.x, dot.y, 7.8 + 1.6 * F.hit * dot.env, 0, TAU); ctx.stroke();
      ctx.strokeStyle = spec.line;
      ctx.lineWidth = .9;
    }
    ctx.globalAlpha = 1;
    if (showLabel) {
      const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      const p = Math.round(dot.note.pitch);
      text(F, `${names[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`, dot.x + 7, dot.y + 3.5, { size: 7.8, font: MONO, color: dot.past ? '#c4c6cf' : '#6a6d7a' });
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

export const stars: Look = {
  id: 'stars',
  group: 'audio',
  nameRu: 'Звёзды',
  nameEn: 'Stars',
  descriptionRu: 'Ноты как созвездия, плывущие через пунктирную линию «сейчас»: сыгранные горят белым',
  descriptionEn: 'Notes as constellations drifting through a dashed now-line, played stars light up white',
  draw(F) {
    const { ctx } = F;
    fill(F, BG);
    skyDots(F);
    frameworks(F);

    const byZone: Record<Zone, TrackView[]> = { bass: [], chords: [], lead: [] };
    for (const track of F.tracks) { const zone = zoneOf(F, track); if (zone) byZone[zone].push(track); }
    for (const zone of ['lead', 'chords', 'bass'] as Zone[]) if (byZone[zone].length) drawZone(F, zone, byZone[zone], zone === 'chords');

    // bar labels
    const first = Math.floor(F.tick / F.bar - 2.2), last = Math.ceil(F.tick / F.bar + 2.2);
    const bars = Math.max(1, Math.round(F.total / F.bar));
    const current = Math.floor(F.tick / F.bar + 1e-6);
    for (let b = first; b <= last; b++) {
      const x = xOf(F, b * F.bar);
      if (x < LEFT + 4 || x > RIGHT - 4) continue;
      const number = ((b % bars) + bars) % bars + 1;
      const now = b === current;
      text(F, `${number}h`, x, 866, { size: 9.5, font: MONO, align: 'center', color: now ? '#f1f2f6' : '#5c6272', weight: now ? 600 : 400 });
    }

    text(F, F.meta.title, 30, 62, { size: 30, font: MONO, color: '#ffffff', maxWidth: 480 });
    text(F, `FOUR CONSTELLATIONS${F.meta.key ? ` · ${F.meta.key}` : ''}`, 30, 81, { size: 9, font: MONO, color: '#7c8190', spacing: 5.2 });
    text(F, `${Math.round(F.meta.bpm)} BPM`, 30, 925, { size: 10, font: MONO, color: '#70788a', spacing: 6.4 });
    text(F, `${clock2(F.meta.seconds)} / ${clock2(F.meta.duration)}`, 510, 925, { size: 10, font: MONO, color: '#70788a', align: 'right', spacing: .4 });
    ctx.globalAlpha = 1;
  },
};
