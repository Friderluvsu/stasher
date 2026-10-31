import { clamp, glowOval, windowNotes, type Frame, type TrackView } from '../frame';
import { clock2, fill, H, MONO, text, trackRole, W } from '../kit';
import { mix } from '../color';
import type { Look } from './types';

// A four-lane note highway in perspective (green / red / yellow / blue gems rolling toward a white hit line) for the
// part that carries the melody. Drawn in the reference's 720 x 1280 space and scaled into the 540 x 960 canvas.

const K = .75;
const VP_X = 360, VP_Y = 101;
const HIT_Y = 1105;
const TOP_Y = 215, BOTTOM_Y = 1208;
const LANE_W = 160 / 1107;      // lane width per pixel below the vanishing point
const DEPTH = 16.2;             // beats between the hit line and the far end
const LANE_COLORS = ['#3fbb78', '#e0452b', '#dcb423', '#3f7bd6'];

const yOf = (depth: number) => TOP_Y + (HIT_Y - TOP_Y) * (1 - depth / DEPTH) ** 2;
const scaleAt = (y: number) => (y - VP_Y) * LANE_W;   // lane width at screen row y
const laneX = (lane: number, y: number) => VP_X + (lane - 1.5) * scaleAt(y);

function pickTrack(F: Frame): TrackView {
  let best: TrackView | null = null, bestScore = -Infinity;
  for (const track of F.tracks) {
    const role = trackRole(track);
    if (role === 'drums' || !track.index.n) continue;
    let sum = 0;
    for (let i = 0; i < track.index.n; i++) sum += track.index.pitch[i];
    const mean = sum / track.index.n;
    const score = (role === 'lead' ? 1000 : 0) + mean + Math.min(60, track.index.n) * .2;
    if (score > bestScore) { best = track; bestScore = score; }
  }
  return best ?? F.tracks[F.tracks.length - 1] ?? F.tracks[0];
}

interface Lanes { cut: number[]; map: Map<number, number> | null }
const cuts = new WeakMap<object, Lanes>();

// Pitch thresholds that split the part's notes into four lanes with roughly equal counts
// (few distinct pitches are spread across the lanes instead).
function laneCuts(track: TrackView): Lanes {
  const known = cuts.get(track.index);
  if (known) return known;
  const pitches = Array.from(track.index.pitch.subarray(0, track.index.n)).sort((a, b) => a - b);
  const distinct = [...new Set(pitches)];
  let made: Lanes;
  if (distinct.length <= 4) {
    const map = new Map<number, number>();
    distinct.forEach((pitch, rank) => map.set(pitch, distinct.length < 2 ? 1 : Math.round(rank * 3 / (distinct.length - 1))));
    made = { cut: [], map };
  } else {
    const out = [.25, .5, .75].map(q => pitches[Math.floor(q * (pitches.length - 1))] + .5);
    for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + .01;
    made = { cut: out, map: null };
  }
  cuts.set(track.index, made);
  return made;
}

function laneOf(lanes: Lanes, pitch: number): number {
  if (lanes.map) return lanes.map.get(pitch) ?? 1;
  const cut = lanes.cut;
  return pitch < cut[0] ? 0 : pitch < cut[1] ? 1 : pitch < cut[2] ? 2 : 3;
}

function capsule(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.beginPath();
  g.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
}

export const arcade: Look = {
  id: 'arcade',
  group: 'midi',
  nameRu: 'Аркада',
  nameEn: 'Arcade',
  descriptionRu: 'Четыре дорожки: ноты мелодии катятся к белой линии, как в гитарной игре',
  descriptionEn: 'A four-lane note highway where the melody rolls toward a white hit line',
  draw(F) {
    const g = F.ctx;
    fill(F, '#000102');
    g.save();
    g.scale(K, K);

    // faint bed behind the highway
    const bed = g.createLinearGradient(0, 150, 0, 1250);
    bed.addColorStop(0, 'rgba(8,10,16,0)');
    bed.addColorStop(.85, 'rgba(8,11,18,0.5)');
    bed.addColorStop(1, 'rgba(8,11,18,0)');
    g.fillStyle = bed;
    g.fillRect(0, 150, 720, 1090);

    // rails
    for (let i = 0; i <= 4; i++) {
      const rail = g.createLinearGradient(0, TOP_Y, 0, BOTTOM_Y);
      rail.addColorStop(0, 'rgba(130,140,170,0)');
      rail.addColorStop(.3, 'rgba(130,140,170,0.16)');
      rail.addColorStop(1, 'rgba(130,140,170,0.42)');
      g.strokeStyle = rail;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(laneX(i - .5, TOP_Y), TOP_Y);
      g.lineTo(laneX(i - .5, BOTTOM_Y), BOTTOM_Y);
      g.stroke();
    }

    // beat lines
    const nowBeat = F.tick / F.beat;
    for (let b = Math.floor(nowBeat) - 1; b <= nowBeat + DEPTH; b++) {
      const depth = b - nowBeat;
      if (depth > DEPTH - .05) continue;
      const y = yOf(depth);
      if (y > BOTTOM_Y || y < TOP_Y) continue;
      const fade = clamp((y - TOP_Y) / 140);
      g.strokeStyle = 'rgba(150,160,190,1)';
      g.globalAlpha = (b % 4 === 0 ? .32 : .2) * fade;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(laneX(-.5, y), y);
      g.lineTo(laneX(3.5, y), y);
      g.stroke();
    }
    g.globalAlpha = 1;

    // hit line glow
    const lineGlow = g.createLinearGradient(0, HIT_Y - 38, 0, HIT_Y + 42);
    lineGlow.addColorStop(0, 'rgba(255,255,255,0)');
    lineGlow.addColorStop(.46, 'rgba(255,255,255,0.12)');
    lineGlow.addColorStop(.54, 'rgba(255,255,255,0.1)');
    lineGlow.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lineGlow;
    g.fillRect(40, HIT_Y - 38, 640, 80);

    // gems
    const track = pickTrack(F);
    const lanes = laneCuts(track);
    const notes = windowNotes(F, track.index, F.beat * 1.1, F.beat * (DEPTH + .5), 0).sort((a, b) => b.pos - a.pos);
    for (const note of notes) {
      const depth = (note.pos - F.tick) / F.beat;
      const y = yOf(depth);
      if (y < TOP_Y - 4 || y > BOTTOM_Y + 6) continue;
      const lane = laneOf(lanes, note.pitch);
      const lw = scaleAt(y), w = lw * .8, h = lw * .24, x = laneX(lane, y);
      const passed = clamp(-depth / .18);
      const far = clamp((y - TOP_Y) / 70), near = clamp((BOTTOM_Y + 4 - y) / 24);
      const base = LANE_COLORS[lane];
      const dim = .22 * (1 - clamp((y - TOP_Y) / (HIT_Y - TOP_Y)) ** .7);
      const color = mix(base, '#000000', .16 * passed + dim);
      const alpha = (1 - .12 * passed) * far * near;
      if (alpha < .01) continue;
      if (!F.thumb) glowOval(F, base, x, y, w * .72, h * 1.8, .2 * alpha * (1 - passed * .6));
      g.globalAlpha = alpha;
      g.fillStyle = color;
      capsule(g, x, y, w, h);
      g.fill();
      if (h > 9 && !F.thumb) {
        g.save();
        capsule(g, x, y, w, h);
        g.clip();
        g.fillStyle = '#000000';
        g.globalAlpha = .13 * alpha;
        for (let ly = y - h / 2 + 2; ly < y + h / 2; ly += 3.2) g.fillRect(x - w / 2, ly, w, 1);
        g.globalAlpha = .12 * alpha;
        g.fillStyle = '#ffffff';
        g.fillRect(x - w / 2, y - h / 2, w, h * .3);
        g.restore();
      }
    }
    g.globalAlpha = 1;

    // hit line and target rings
    g.fillStyle = '#f4f4f4';
    g.fillRect(40, HIT_Y - 2, 640, 4);
    const lw = scaleAt(HIT_Y);
    for (let lane = 0; lane < 4; lane++) {
      g.strokeStyle = LANE_COLORS[lane];
      g.lineWidth = 2.4;
      g.globalAlpha = .95;
      capsule(g, laneX(lane, HIT_Y), HIT_Y, lw * .455, 28);
      g.stroke();
    }
    g.globalAlpha = 1;

    // typography
    const role = trackRole(track).toLowerCase();
    text(F, F.meta.title, 40, 64, { size: 22, font: MONO, color: '#c9c9c9', spacing: 11, maxWidth: 380 });
    text(F, `${Math.round(F.meta.bpm)} BPM`, 680, 64, { size: 22, font: MONO, color: '#a97b34', align: 'right', spacing: 11 });
    text(F, [role, '4 LANES', F.meta.key].filter(Boolean).join(' · '), 40, 96, { size: 13, font: MONO, color: '#5f6262', spacing: 6.5 });
    text(F, `${clock2(F.meta.seconds)} / ${clock2(F.meta.duration)}`, 683, 1233, { size: 14, font: MONO, color: '#5b5d5e', align: 'right', spacing: 6 });
    g.restore();
    // keep the unused import honest
    void W; void H;
  },
};
