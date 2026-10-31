import { clamp, makeSurface, surfaceContext, TAU, windowNotes, type Frame, type TrackView } from '../frame';
import type { VNote } from '../noteIndex';
import { ease, infoLine, lerp, rand, SANS, text, trackColorAt, trackRole, W, H } from '../kit';
import { mix } from '../color';
import type { Look } from './types';

// An oblique piano seen from above (rotated ~38 degrees, black keys raised) with little people who walk over to the
// notes that are being played, jump onto the key with their arms up and leave again. Canvas space is 540 x 960.

type Ctx = CanvasRenderingContext2D;

const ANGLE = 37.7 * Math.PI / 180;
const EU = [Math.cos(ANGLE), -Math.sin(ANGLE)];   // along the keyboard (low -> high)
const EV = [Math.sin(ANGLE), Math.cos(ANGLE)];    // along a key (back -> front)
const S0 = [28.65, 738];                          // screen point of the white key boundary u = 0 on the front edge
const KW = 29.6;      // white key width
const L = 122;        // white key length
const CASE = 5;       // dark casing behind the keys
const BW = 16.5;      // black key width
const BL = 69;        // black key length
const BH = 21;        // black key height (screen px)
const FH = 9;         // white key front face height
const BORDER = 4.5;
const SHADOW_DROP = 30;

const BG = '#efeef1';
const INK = '#18181b';

function pt(u: number, v: number, z = 0): [number, number] {
  return [S0[0] + u * EU[0] + (v - L) * EV[0], S0[1] + u * EU[1] + (v - L) * EV[1] - z];
}

function poly(g: Ctx, points: [number, number][]) {
  g.beginPath();
  g.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i][0], points[i][1]);
  g.closePath();
}

function quad(g: Ctx, u0: number, u1: number, v0: number, v1: number, z: number, color: string | CanvasGradient, alpha = 1) {
  poly(g, [pt(u0, v0, z), pt(u1, v0, z), pt(u1, v1, z), pt(u0, v1, z)]);
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.fill();
}

const WHITE_FIRST = -2, WHITE_LAST = 23;
const BLACK_PCS: Record<number, number> = { 1: .9, 3: 2.1, 6: 3.88, 8: 5, 10: 6.12 };
const WHITE_INDEX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

interface KeyInfo { black: boolean; w: number; cu: number }

function keyOf(pitch: number, base: number): KeyInfo {
  let p = Math.round(pitch);
  while (p < base) p += 12;
  while (p > base + 36) p -= 12;
  const rel = p - base, oct = Math.floor(rel / 12), pc = rel % 12;
  const black = pc in BLACK_PCS;
  const w = oct * 7 + WHITE_INDEX[pc];
  const cu = black ? (oct * 7 + BLACK_PCS[pc]) * KW : (w + .5) * KW;
  return { black, w, cu };
}

function paintUnder(g: Ctx) {
  g.globalAlpha = 1;
  g.fillStyle = BG;
  g.fillRect(-4, -4, W + 8, H + 8);
  // soft grey wedge in the upper left
  poly(g, [[0, 127.5], [217.5, 127.5], [0, 287]]);
  g.fillStyle = '#e4e4e8';
  g.fill();
  const U0 = -120, U1 = 780;
  // drop shadow along the front of the keyboard
  poly(g, [pt(U0, L, -FH - BORDER + 1), pt(U1, L, -FH - BORDER + 1), pt(U1, L, -FH - BORDER - SHADOW_DROP), pt(U0, L, -FH - BORDER - SHADOW_DROP)]);
  g.fillStyle = '#dddde1';
  g.fill();
  // dark casing at the back and the front lip
  quad(g, U0, U1, -CASE, 0.5, 0, '#1d1d21');
  quad(g, U0, U1, L, L, -FH - BORDER, '#1d1d21');
  poly(g, [pt(U0, L, -FH), pt(U1, L, -FH), pt(U1, L, -FH - BORDER), pt(U0, L, -FH - BORDER)]);
  g.fillStyle = '#1d1d21';
  g.fill();
  // white keys
  for (let w = WHITE_FIRST; w <= WHITE_LAST; w++) {
    const u0 = w * KW, u1 = u0 + KW;
    quad(g, u0, u1, 0, L, 0, '#fbfbfd');
    poly(g, [pt(u0, L, 0), pt(u1, L, 0), pt(u1, L, -FH), pt(u0, L, -FH)]);
    g.fillStyle = '#c9c9cc';
    g.fill();
  }
  g.strokeStyle = '#38383d';
  g.lineWidth = 1;
  g.globalAlpha = .9;
  g.beginPath();
  for (let w = WHITE_FIRST; w <= WHITE_LAST + 1; w++) {
    const [x0, y0] = pt(w * KW, 0), [x1, y1] = pt(w * KW, L, -FH);
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
  }
  g.stroke();
  g.globalAlpha = 1;
}

function blackKeys(): number[] {
  const list: number[] = [];
  for (let oct = -1; oct <= 4; oct++) for (const pc of Object.keys(BLACK_PCS)) list.push((oct * 7 + BLACK_PCS[Number(pc)]) * KW);
  return list.filter(cu => cu > (WHITE_FIRST + .5) * KW && cu < (WHITE_LAST + .5) * KW);
}

function paintBlackKey(g: Ctx, cu: number, tint: string | null, tintAlpha = 1) {
  const u0 = cu - BW / 2, u1 = cu + BW / 2;
  const top = '#0e0d10';
  // top face, front face (the left side reads as a soft shadow on the keys, drawn separately)
  g.globalAlpha = 1;
  quad(g, u0, u1, 0, BL, BH, top);
  const front = g.createLinearGradient(0, pt(cu, BL, BH)[1], 0, pt(cu, BL, 0)[1]);
  front.addColorStop(0, '#2a2a2e');
  front.addColorStop(.2, '#1b1b1e');
  front.addColorStop(1, '#0d0d0f');
  poly(g, [pt(u0, BL, BH), pt(u1, BL, BH), pt(u1, BL, 0), pt(u0, BL, 0)]);
  g.fillStyle = front;
  g.fill();
  if (tint) {
    poly(g, [pt(u0, 0, BH), pt(u1, 0, BH), pt(u1, BL, BH), pt(u0, BL, BH)]);
    g.fillStyle = tint; g.globalAlpha = tintAlpha; g.fill();
    poly(g, [pt(u0, BL, BH), pt(u1, BL, BH), pt(u1, BL, 0), pt(u0, BL, 0)]);
    g.fillStyle = mix(tint, '#000000', .25); g.fill();
    g.globalAlpha = 1;
  }
}

function paintOver(g: Ctx) {
  const keys = blackKeys();
  g.globalAlpha = 1;
  for (const cu of keys) {
    const u0 = cu - BW / 2;
    poly(g, [pt(u0, 0, BH), pt(u0, BL, BH), pt(u0, BL, 0), pt(u0, 0, 0)]);
    g.fillStyle = 'rgba(22,22,34,0.27)';
    g.fill();
  }
  for (const cu of keys) paintBlackKey(g, cu, null);
}

interface Layers { under: HTMLCanvasElement | OffscreenCanvas | null; over: HTMLCanvasElement | OffscreenCanvas | null }
const layerCache = new Map<string, Layers>();

function layers(F: Frame): Layers {
  const key = `${F.W}x${F.H}`;
  const known = layerCache.get(key);
  if (known) return known;
  const build = (paint: (g: Ctx) => void) => {
    const surface = makeSurface(F.W, F.H);
    const g = surface && surfaceContext(surface);
    if (!surface || !g) return null;
    g.scale(F.W / W, F.H / H);
    paint(g);
    return surface;
  };
  const made: Layers = { under: build(paintUnder), over: build(paintOver) };
  if (layerCache.size > 6) layerCache.delete(layerCache.keys().next().value as string);
  layerCache.set(key, made);
  return made;
}

// --- people

const SHIRTS = ['#5dbb6e', '#3f86e8', '#ea6a2e', '#1fa08c', '#58b4e8', '#f1b72f', '#82c277', '#6f93d8'];
const SKINS = ['#e3a982', '#c98a5e', '#a06a44', '#6b4430', '#f0c9a2', '#8a5a3a'];
const PANTS = ['#27406e', '#1f4d46', '#2d3550', '#2a3f5f'];
const CROWD = 14;
const PERSON = 1.22;

interface Person { shirt: string; skin: string; pants: string; hair: string; cx: number; cy: number; ax: number; ay: number; k1: number; k2: number; p1: number; p2: number; gait: number }

const crowdCache = new Map<string, Person[]>();

function crowd(T: number): Person[] {
  const key = T.toFixed(3);
  const known = crowdCache.get(key);
  if (known) return known;
  const list: Person[] = [];
  for (let i = 0; i < CROWD; i++) {
    const pick = <A,>(arr: A[], s: number) => arr[Math.floor(rand(i, s) * arr.length) % arr.length];
    list.push({
      shirt: pick(SHIRTS, 1), skin: pick(SKINS, 2), pants: pick(PANTS, 3), hair: rand(i, 4) < .15 ? '#5a3a24' : '#2b1a14',
      cx: 70 + rand(i, 10) * 400, cy: 195 + rand(i, 11) * 560, ax: 20 + rand(i, 12) * 42, ay: 20 + rand(i, 13) * 42,
      k1: Math.max(1, Math.round(T / (8 + rand(i, 14) * 9))), k2: Math.max(1, Math.round(T / (9 + rand(i, 15) * 9))),
      p1: rand(i, 16) * TAU, p2: rand(i, 17) * TAU, gait: rand(i, 18) * TAU,
    });
  }
  if (crowdCache.size > 8) crowdCache.delete(crowdCache.keys().next().value as string);
  crowdCache.set(key, list);
  return list;
}

function ambient(p: Person, t: number, T: number): [number, number] {
  return [p.cx + p.ax * Math.sin(TAU * p.k1 * t / T + p.p1), p.cy + p.ay * Math.sin(TAU * p.k2 * t / T + p.p2)];
}

interface Gig { person: number; t0: number; ta: number; t1: number; tin: number; tout: number; key: [number, number]; from: [number, number]; to: [number, number] }

function dist(a: [number, number], b: [number, number]) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

const ROLE_ORDER: Record<string, number> = { lead: 0, bass: 1, chords: 2, drums: 3 };

function planGigs(F: Frame, people: Person[], base: number, T: number): Gig[] {
  const items: { note: VNote; track: TrackView; role: number }[] = [];
  for (const track of F.tracks) {
    const role = trackRole(track);
    if (role === 'drums') continue;
    for (const note of windowNotes(F, track.index, F.tps * 8, F.tps * 4, 0)) {
      if (note.dur < F.beat * .3) continue;
      items.push({ note, track, role: ROLE_ORDER[role] ?? 2 });
    }
  }
  items.sort((a, b) => a.role - b.role || a.note.pos - b.note.pos || a.note.pitch - b.note.pitch);
  const busy: [number, number][][] = people.map(() => []);
  const gigs: Gig[] = [];
  const CAP = 5;
  for (const { note } of items) {
    const t0 = note.pos / F.tps, t1 = note.end / F.tps, ta = t0 - .3;
    let concurrent = 0;
    for (const g of gigs) if (g.ta < t1 && g.t1 > ta) concurrent++;
    if (concurrent >= CAP) continue;
    const info = keyOf(note.pitch, base);
    const v = (info.black ? BL * (.3 + .45 * note.seed) : L * (.25 + .5 * note.seed));
    const z = info.black ? BH : 0;
    const pos = pt(info.cu + (note.seed - .5) * (info.black ? 3 : 8), v, z);
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < people.length; i++) {
      const d = dist(ambient(people[i], ta - 1.1, T), pos);
      if (d >= bestDist) continue;
      const lo = ta - 2.6, hi = t1 + 2.6;
      if (busy[i].some(([a, b]) => a < hi && b > lo)) continue;
      best = i; bestDist = d;
    }
    if (best < 0) continue;
    const tin = clamp(bestDist / 55, .7, 2.4);
    const from = ambient(people[best], ta - tin, T);
    const tout = clamp(dist(ambient(people[best], t1 + 1.2, T), pos) / 55, .7, 2.4);
    const to = ambient(people[best], t1 + tout, T);
    if (busy[best].some(([a, b]) => a < t1 + tout && b > ta - tin)) continue;
    busy[best].push([ta - tin, t1 + tout]);
    gigs.push({ person: best, t0, ta, t1, tin, tout, key: pos, from, to });
  }
  return gigs;
}

interface Stance { x: number; y: number; walk: number; cheer: boolean; hop: number }

function stanceOf(F: Frame, people: Person[], gigs: Gig[], i: number, t: number, T: number): Stance {
  const p = people[i];
  const gig = gigs.find(g => g.person === i && t >= g.ta - g.tin && t <= g.t1 + g.tout);
  const at = (time: number): [number, number] => {
    if (gig) {
      if (time < gig.ta) { const s = ease.inOutCubic((time - (gig.ta - gig.tin)) / gig.tin); return [lerp(gig.from[0], gig.key[0], s), lerp(gig.from[1], gig.key[1], s)]; }
      if (time <= gig.t1) return gig.key;
      const s = ease.inOutCubic((time - gig.t1) / gig.tout);
      return [lerp(gig.key[0], gig.to[0], s), lerp(gig.key[1], gig.to[1], s)];
    }
    return ambient(p, time, T);
  };
  const a = at(t), b = at(t + .06);
  const speed = Math.hypot(b[0] - a[0], b[1] - a[1]) / .06;
  const cheer = !!gig && t >= gig.ta && t <= gig.t1;
  const hop = cheer ? Math.max(0, Math.sin((t - gig!.ta) * 11 + p.gait)) * 1.6 * Math.min(1, (t - gig!.ta) * 2) : 0;
  return { x: a[0], y: a[1], walk: clamp(speed / 16), cheer, hop };
}

function drawShadow(g: Ctx, x: number, y: number) {
  g.save();
  g.translate(x - 8, y + 5.5);
  g.rotate(2.5);
  g.beginPath();
  g.ellipse(0, 0, 11, 2.7, 0, 0, TAU);
  g.fillStyle = 'rgba(28,28,48,0.24)';
  g.globalAlpha = 1;
  g.fill();
  g.restore();
}

function drawPerson(g: Ctx, x: number, y: number, p: Person, st: Stance, t: number) {
  const legH = 11, torsoH = 10.6, torsoW = 11.6;
  y -= st.hop;
  g.save();
  g.translate(x, y);
  g.scale(PERSON, PERSON);
  g.translate(-x, -y);
  const ph = t * 8.5 + p.gait;
  const sw = Math.sin(ph) * st.walk;
  g.globalAlpha = 1;
  // legs
  g.fillStyle = p.pants;
  for (const s of [-1, 1]) {
    const lift = Math.max(0, s * sw) * 2.4;
    g.fillRect(x + s * 2.1 - 1.4 + s * st.walk * .5, y - legH, 2.9, legH - lift);
  }
  const top = y - legH - torsoH + 1;
  // arms
  const sleeve = mix(p.shirt, '#000000', .1);
  if (st.cheer) {
    g.lineCap = 'round';
    for (const s of [-1, 1]) {
      const wave = Math.sin(t * 9 + (s > 0 ? 0 : 2.1) + p.gait) * 1.4;
      const ex = x + s * (9.6 + wave * .3), ey = top - 6.6 + wave;
      g.strokeStyle = sleeve;
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(x + s * 5.4, top + 2.4);
      g.lineTo(ex, ey);
      g.stroke();
      g.fillStyle = p.skin;
      g.beginPath();
      g.arc(ex, ey - .6, 1.5, 0, TAU);
      g.fill();
    }
  } else {
    for (const s of [-1, 1]) {
      const swing = -s * sw * 1.6;
      g.fillStyle = sleeve;
      g.fillRect(x + s * (torsoW / 2 + .2) - (s > 0 ? 0 : 2.2), top + 1 + swing, 2.2, 8);
      g.fillStyle = p.skin;
      g.fillRect(x + s * (torsoW / 2 + .2) - (s > 0 ? 0 : 2.2), top + 8.6 + swing, 2.2, 1.6);
    }
  }
  // torso
  g.fillStyle = p.shirt;
  g.beginPath();
  g.roundRect(x - torsoW / 2, top, torsoW, torsoH, 1.6);
  g.fill();
  // head
  const hy = top - 4.1;
  g.fillStyle = p.skin;
  g.beginPath();
  g.arc(x, hy, 4.3, 0, TAU);
  g.fill();
  g.fillStyle = p.hair;
  g.beginPath();
  g.arc(x, hy, 4.4, Math.PI * 1.04, Math.PI * 1.96);
  g.closePath();
  g.fill();
  g.restore();
}

// --- the burst of dashes when a key goes down

function drawBurst(g: Ctx, x: number, y: number, age: number, color: string, seed: number) {
  const dur = .38;
  if (age < 0 || age > dur) return;
  const t = age / dur;
  const e = ease.outCubic(t);
  const centre = Math.atan2(EV[1], EV[0]);
  const count = 15;
  g.lineCap = 'round';
  g.strokeStyle = color;
  g.lineWidth = 1.6;
  for (let i = 0; i < count; i++) {
    const a = centre + (i / (count - 1) - .5) * 3.5 + (rand(i, Math.floor(seed * 1e4)) - .5) * .12;
    const r0 = 9 + 22 * e + rand(i, 3) * 3, len = Math.max(.8, 10 * (1 - t) ** 1.4);
    g.globalAlpha = clamp((1 - t) * 1.25);
    g.beginPath();
    g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    g.lineTo(x + Math.cos(a) * (r0 + len), y + Math.sin(a) * (r0 + len));
    g.stroke();
  }
  g.globalAlpha = 1;
}

const baseCache = new WeakMap<object, number>();

function pitchBase(F: Frame): number {
  if (F.synthetic) return 48;
  let mid = baseCache.get(F.notes);
  if (mid === undefined) {
    let sum = 0;
    for (let i = 0; i < F.notes.n; i++) sum += F.notes.pitch[i];
    mid = F.notes.n ? sum / F.notes.n : 60;
    baseCache.set(F.notes, mid);
  }
  return Math.max(0, 12 * Math.round((mid - 18) / 12));
}

export const keys: Look = {
  id: 'keys',
  group: 'midi',
  nameRu: 'Клавиши',
  nameEn: 'Keys',
  descriptionRu: 'Косая клавиатура: человечки подбегают к играемым нотам и поднимают руки',
  descriptionEn: 'A slanted piano where little people run to the notes being played and cheer',
  draw(F) {
    const { ctx } = F;
    const T = Math.max(1, F.total / F.tps);
    const t = F.tick / F.tps;
    const base = pitchBase(F);
    const layer = layers(F);

    if (layer.under) { ctx.globalAlpha = 1; ctx.drawImage(layer.under as CanvasImageSource, 0, 0, W, H); } else paintUnder(ctx);

    // held keys
    const held: { key: KeyInfo; color: string; alpha: number; age: number; role: string; seed: number }[] = [];
    for (const track of F.tracks) {
      const color = trackColorAt(track.slot), role = trackRole(track);
      for (const note of windowNotes(F, track.index, F.tps * .45, .02, 0)) {
        if (note.pos > F.tick) continue;
        const age = (F.tick - note.pos) / F.tps;
        const after = (F.tick - note.end) / (F.tps * .08);
        const alpha = clamp(age / .04) * (1 - clamp(after));
        if (alpha < .01 && age > .4) continue;
        if (alpha < .01) continue;
        held.push({ key: keyOf(note.pitch, base), color, alpha, age, role, seed: note.seed });
      }
    }
    for (const h of held) {
      if (h.key.black) continue;
      const u0 = h.key.w * KW + .6, u1 = u0 + KW - 1.2;
      quad(ctx, u0, u1, 0, L, 0, h.color, .9 * h.alpha);
      poly(ctx, [pt(u0, L, 0), pt(u1, L, 0), pt(u1, L, -FH), pt(u0, L, -FH)]);
      ctx.fillStyle = mix(h.color, '#ffffff', .3);
      ctx.globalAlpha = h.alpha;
      ctx.fill();
      // sheen near the back of the bar
      quad(ctx, u0 + (u1 - u0) * .22, u1 - (u1 - u0) * .22, L * .04, L * .36, 0, '#ffffff', .24 * h.alpha);
    }
    ctx.globalAlpha = 1;

    if (layer.over) { ctx.drawImage(layer.over as CanvasImageSource, 0, 0, W, H); } else paintOver(ctx);
    for (const h of held) if (h.key.black) paintBlackKey(ctx, h.key.cu, h.color, .92 * h.alpha);
    ctx.globalAlpha = 1;

    // people
    const people = crowd(T);
    const gigs = planGigs(F, people, base, T);
    const stances = people.map((_, i) => stanceOf(F, people, gigs, i, t, T));
    const order = people.map((_, i) => i).sort((a, b) => stances[a].y - stances[b].y);
    for (const i of order) drawShadow(ctx, stances[i].x, stances[i].y);
    for (const i of order) drawPerson(ctx, stances[i].x, stances[i].y, people[i], stances[i], t);
    let playing = 0;
    for (const s of stances) if (s.cheer) playing++;

    // bursts above everything
    if (!F.thumb) {
      let shown = 0;
      for (const h of held) {
        if (h.role === 'drums' || h.age > .4 || shown > 5) continue;
        const [x, y] = h.key.black ? pt(h.key.cu, BL, 0) : pt((h.key.w + .5) * KW, L, -FH - 1);
        drawBurst(ctx, x, y, h.age, h.color, h.seed);
        shown++;
      }
    }

    // typography
    text(F, F.meta.title, 75, 118, { size: 22.5, weight: 700, color: INK, spacing: -.3, maxWidth: 270 });
    text(F, infoLine(F, ' · ', false), 470, 118, { size: 13, weight: 500, color: '#6e6e74', align: 'right' });
    text(F, `${playing} on the keys`, 75, 857, { size: 13, weight: 600, color: INK, spacing: -.1, font: SANS });
  },
};
