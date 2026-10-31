import { audioAt, clamp, swing, TAU } from '../frame';
import type { Frame } from '../frame';
import { rand } from '../kit';
import type { Look } from './types';

// A lidar-style point cloud of a room on pale paper: back wall, two side walls and a floor made of grey dots, seen
// from a gently swaying camera. The floor is a waterfall of the last 0.7 s of spectrum, the lower part of the back wall
// turns green like a level meter, clusters pulse on the wall, a doorway breathes rising dots, a wireframe globe sits
// on the right and two small cubes float above.

const FOCAL = 560, HORIZON = 470, EYE = 2.07, CENTER_X = 266, ZC = 6;
const WALL_X = 2.73, WALL_H = 3.5, WALL_Z = 8;
const DOOR_L = -.7, DOOR_R = .6, DOOR_H = 1.93;

const K_BACK = 0, K_SIDE = 1, K_FLOOR = 2;
interface Dot { x: number; y: number; z: number; k: number; s: number; band: number; h: number }

let dots: Dot[] | null = null;

function build(): Dot[] {
  const out: Dot[] = [];
  const add = (x: number, y: number, z: number, k: number, s: number, band: number, h: number) => out.push({ x, y, z, k, s, band, h });
  let n = 0;
  // back wall
  const cols = 33, rows = 21;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      n++;
      const x = -WALL_X + (c + .5) / cols * WALL_X * 2 + (rand(n, 1) - .5) * .09;
      const y = (r + .5) / rows * WALL_H + (rand(n, 2) - .5) * .09;
      const door = x > DOOR_L && x < DOOR_R && y < DOOR_H;
      if (door && rand(n, 3) > .05) continue;
      add(x, y, WALL_Z, K_BACK, rand(n, 4), c / (cols - 1), y / WALL_H);
    }
  }
  // side walls: a main slab and a shorter, nearer second slab
  for (const side of [-1, 1]) {
    for (let c = 0; c < 24; c++) {
      for (let r = 0; r < 27; r++) {
        n++;
        add(side * 3.0, (r + .5) / 27 * WALL_H + (rand(n, 2) - .5) * .09, 5.65 + (c + .5) / 24 * (WALL_Z - 5.65) + (rand(n, 1) - .5) * .09, K_SIDE, rand(n, 4), 0, 0);
      }
    }
    for (let c = 0; c < 12; c++) {
      for (let r = 0; r < 23; r++) {
        n++;
        add(side * 3.5, (r + .5) / 23 * 3.0 + (rand(n, 2) - .5) * .09, 5.2 + (c + .5) / 12 * 1.5 + (rand(n, 1) - .5) * .09, K_SIDE, rand(n, 4), 0, 0);
      }
    }
  }
  // floor: dots evenly spread on screen (rows of equal screen height), so the band reads as one dense carpet
  const floorRows = 18;
  for (let r = 0; r < floorRows; r++) {
    const sy = 623 + r * 6.2;
    const z = FOCAL * EYE / (sy - HORIZON);
    const count = 96;
    for (let c = 0; c < count; c++) {
      n++;
      const sx = -30 + (c + (r % 2) * .5) * (600 / count) + (rand(n, 1) - .5) * 4;
      add((sx - CENTER_X) * z / FOCAL, 0, z + (rand(n, 2) - .5) * .06, K_FLOOR, rand(n, 4), Math.abs(sx - CENTER_X) / 330, r / (floorRows - 1));
    }
  }
  return out;
}

const SHADE = [118, 150, 108];
const GREENS = ['rgb(52,96,48)', 'rgb(70,108,58)', 'rgb(88,118,74)'];

export const scan: Look = {
  id: 'scan',
  group: 'audio',
  nameRu: 'Скан',
  nameEn: 'Scan',
  descriptionRu: 'Облако точек комнаты: пол-спектрограмма, зелёные точки и сфера',
  descriptionEn: 'A point-cloud room: a spectrogram floor, green meter dots and a wireframe globe',
  draw(F) {
    const { ctx } = F;
    if (!dots) dots = build();

    // ---- paper
    const paper = ctx.createLinearGradient(0, 0, 0, 960);
    paper.addColorStop(0, '#f8f8f7');
    paper.addColorStop(.45, '#f2f3ef');
    paper.addColorStop(.75, '#eaebe6');
    paper.addColorStop(1, '#e7e8e0');
    ctx.globalAlpha = 1;
    ctx.fillStyle = paper;
    ctx.fillRect(-2, -2, 544, 964);

    // ---- audio features for the room
    const now = audioAt(F, 1e-4);
    const level = clamp(F.audio.present ? F.audio.level : now.level);
    const bass = F.audio.present ? F.audio.bass : now.bass;
    const mid = F.audio.present ? F.audio.mid : now.mid;
    const treble = F.audio.present ? F.audio.treble : now.treble;
    const spectrum = F.audio.present ? F.audio.spectrum : now.spectrum;
    const rowCount = 22;
    const rowSpectra: Float32Array[] = [];
    const rowStep = F.thumb ? 4 : 1;
    let last = spectrum;
    for (let r = 0; r < rowCount; r++) {
      if (r % rowStep === 0) last = audioAt(F, -r * .034 - 1e-4).spectrum;
      rowSpectra.push(last);
    }

    // ---- camera
    const yaw = swing(F, 16, .05) + F.hit * .004;
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const eye = EYE + swing(F, 8, .03);
    const centerX = CENTER_X;
    const project = (x: number, y: number, z: number): [number, number, number] => {
      const dz = z - ZC;
      const X = x * cosY - dz * sinY, Z = x * sinY + dz * cosY + ZC;
      return [centerX + FOCAL * X / Z, HORIZON + FOCAL * (eye - y) / Z, Z];
    };

    // soft platform shadow
    ctx.fillStyle = '#dcddd8';
    ctx.globalAlpha = .7;
    ctx.beginPath(); ctx.ellipse(268, 761, 212, 26, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = .6;
    ctx.beginPath(); ctx.ellipse(268, 761, 208, 24, 0, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;

    // ---- project every dot into colour buckets
    const buckets = 8; // 0..4 greys by shade, 5..7 greens
    const bx: number[][] = Array.from({ length: buckets }, () => []);
    const by: number[][] = Array.from({ length: buckets }, () => []);
    const br: number[][] = Array.from({ length: buckets }, () => []);
    const tick = Math.floor(F.meta.seconds * 14);
    const shimmer = .35 + level * 1.1;
    const detail = F.thumb ? 2 : 1;
    const wave = (d: Dot, rowIndex: number) => {
      const spec = rowSpectra[rowIndex];
      const at = clamp(d.band) * 22 + 1;
      const lo = Math.floor(at), t = at - lo;
      const v = spec[lo] * (1 - t) + spec[Math.min(31, lo + 1)] * t;
      return v ** 1.2 * .4 * (1 - .25 * d.h) + .02 * Math.sin(d.x * 1.3 + F.meta.seconds * 1.7);
    };
    for (let i = 0; i < dots.length; i += 1) {
      const d = dots[i];
      if (detail > 1 && i % detail && d.k !== K_FLOOR) continue;
      let y = d.y;
      if (d.k === K_FLOOR) y += wave(d, Math.min(rowCount - 1, Math.round(d.h * 21)));
      const [sx, sy, Z] = project(d.x, y, d.z);
      if (Z < 1.5 || sx < -12 || sx > 552) continue;
      let r = .0192 * FOCAL / Z;
      let bucket: number;
      let px = sx, py = sy;
      if (d.k === K_BACK) {
        // the lower wall lights up green under the spectrum
        const at = clamp(d.band) * 26 + 1, lo = Math.floor(at), t = at - lo;
        const v = spectrum[lo] * (1 - t) + spectrum[Math.min(31, lo + 1)] * t;
        const g = .36 + v * .45 + bass * .08 - d.h * 1.2;
        const green = d.s < clamp(g * 3.0);
        if (green) {
          bucket = 5 + Math.floor(d.s * 3 / Math.max(.05, clamp(g * 3.0)));
          bucket = Math.min(7, bucket);
          r *= 1.4;
          const j = rand(i, tick) - .5, k = rand(i, tick + 9) - .5;
          px += j * shimmer * 2.2; py += k * shimmer * 2.2 - v * 2;
        } else { bucket = Math.min(2, 1 + Math.floor(d.s * 2.2)); r *= 1.15; }
      } else if (d.k === K_SIDE) {
        bucket = Math.min(4, 3 + Math.floor(d.s * 2));
        r = Math.min(1.75, r * 1.05);
      } else {
        const near = clamp((8 - Z) / 4.2);
        bucket = Math.min(4, Math.floor(clamp(1 - near * .9 + (d.s - .5) * .5) * 5));
        r *= 1.08;
        px += (rand(i, tick) - .5) * shimmer; py += (rand(i, tick + 5) - .5) * shimmer * .6;
      }
      bx[bucket].push(px); by[bucket].push(py); br[bucket].push(r);
    }

    // doorway: dots rising out of the opening
    const rising = F.thumb ? 30 : 100;
    for (let i = 0; i < rising; i++) {
      const s = rand(i, 77), p = ((s * 7 + F.meta.seconds * (.18 + .35 * rand(i, 78))) % 1 + 1) % 1;
      if (rand(i, 79) > .4 + level * .8) continue;
      const [sx, sy, Z] = project(DOOR_L + (DOOR_R - DOOR_L) * rand(i, 80), p * (.7 + bass * 1.2 + mid * .5), 7.9);
      const triangular = (1 - p) * (.4 + .6 * rand(i, 81));
      if (triangular < .06) continue;
      const bucket = rand(i, 82) < .45 ? 5 : 3;
      bx[bucket].push(sx); by[bucket].push(sy); br[bucket].push(.019 * FOCAL / Z * 1.1);
    }

    // clusters on the wall that pulse with the mids and highs
    for (const [cx, cy, energy, seed] of [[-1.17, 2.87, mid, 1], [.14, 3.14, treble, 2]] as [number, number, number, number][]) {
      const count = F.thumb ? 10 : 8 + Math.round(34 * clamp(.25 + energy * 1.1));
      const spread = .36 + energy * .3;
      for (let i = 0; i < count; i++) {
        const a = rand(i, 90 + seed) * TAU, rr = Math.sqrt(-Math.log(1 - rand(i, 95 + seed) * .93)) * spread * .55;
        const wob = rand(i, tick + seed) - .5;
        const [sx, sy, Z] = project(cx + Math.cos(a) * rr + wob * .02, cy + Math.sin(a) * rr, 7.95);
        bx[5 + (i % 3)].push(sx); by[5 + (i % 3)].push(sy); br[5 + (i % 3)].push(.019 * FOCAL / Z * 1.25);
      }
    }

    // ---- paint dots
    const grey = [[96, 97, 88], [108, 109, 101], [120, 121, 113], [136, 136, 128], [152, 151, 144]];
    for (let b = 0; b < buckets; b++) {
      if (!bx[b].length) continue;
      ctx.fillStyle = b < 5 ? `rgb(${grey[b][0]},${grey[b][1]},${grey[b][2]})` : GREENS[b - 5];
      ctx.globalAlpha = b < 5 ? .92 : .95;
      ctx.beginPath();
      const xs = bx[b], ys = by[b], rs = br[b];
      for (let i = 0; i < xs.length; i++) { ctx.moveTo(xs[i] + rs[i], ys[i]); ctx.arc(xs[i], ys[i], rs[i], 0, TAU); }
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ---- wireframe globe
    {
      const [gx, gy, gz] = project(1.67, .95, 6.4);
      const R = .73 * FOCAL / gz * (1 + F.hit * .04 + bass * .03);
      const tilt = .26, spin = F.meta.seconds * .5;
      ctx.strokeStyle = '#8b94b0';
      ctx.lineWidth = .8;
      ctx.globalAlpha = .48;
      ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const lat = -1.2 + i * .4;
        const rx = R * Math.cos(lat), cy = gy - R * Math.sin(lat) * Math.cos(tilt);
        ctx.moveTo(gx + rx, cy);
        ctx.ellipse(gx, cy, Math.abs(rx), Math.abs(rx) * Math.sin(tilt), 0, 0, TAU);
      }
      for (let i = 0; i < 6; i++) {
        const lon = spin + i * Math.PI / 6;
        const rx = Math.abs(R * Math.sin(lon));
        ctx.moveTo(gx + rx, gy);
        ctx.ellipse(gx, gy, Math.max(.01, rx), R, 0, 0, TAU);
      }
      ctx.moveTo(gx + R, gy);
      ctx.arc(gx, gy, R, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ---- floating cubes (flat squares with scattered points) and loose triangles
    const sway = yaw * 60;
    for (const [bx0, by0, sign, seed] of [[208, 321, 1, 11], [351, 335, -1, 12]] as [number, number, number, number][]) {
      const angle = sign * (F.onsetStrength * Math.exp(-F.onsetAge * 6) * .5);
      const cx = bx0 - sway * .6, cy = by0 + 2 * Math.sin(F.meta.seconds * 1.3 + seed);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.strokeStyle = '#8d8f88';
      ctx.globalAlpha = .55;
      ctx.lineWidth = .7;
      ctx.strokeRect(-13.5, -13.5, 27, 27);
      ctx.globalAlpha = .9;
      const count = F.thumb ? 14 : 44;
      for (let i = 0; i < count; i++) {
        const green = rand(i, seed) < .55;
        ctx.fillStyle = green ? GREENS[i % 3] : 'rgb(110,111,103)';
        ctx.beginPath();
        ctx.arc((rand(i, seed + 20 + tick % 3) - .5) * 25, (rand(i, seed + 40 + tick % 3) - .5) * 25, .9 + rand(i, seed + 5) * .5, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.strokeStyle = '#9a9c95';
    ctx.lineWidth = .7;
    ctx.globalAlpha = .38;
    for (const [tx, ty, size, rot] of [[183, 373, 7, .3], [214, 371, 8, -.5], [238, 368, 9, .1], [166, 530, 6, .9]] as [number, number, number, number][]) {
      const a = rot + F.meta.seconds * .15 * (rot > 0 ? 1 : -1);
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const an = a + k * TAU / 3;
        const x = tx - sway * .5 + Math.cos(an) * size, y = ty + Math.sin(an) * size * .8;
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },
};
