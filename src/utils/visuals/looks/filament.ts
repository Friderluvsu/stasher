import { fill, rand } from '../kit';
import { TAU, clamp, glow, loopT, pitchNorm, windowNotes, type Frame } from '../frame';
import type { Look } from './types';

const ROOT_X = 270, ROOT_Y = 904;
const MAX_DEPTH = 8;
const DAMP = .78; // each branch is pulled back towards vertical, which keeps the crown a dome

interface Branch {
  parent: number;
  depth: number;
  angle: number;     // rest angle, radians from straight up (positive = right)
  length: number;
  width: number;
  bend: number;      // sideways bow of the branch, fraction of its length
  phase: number;
  leaf: boolean;
  // filled in by layout()
  x0: number; y0: number; x1: number; y1: number; mx: number; my: number; abs: number;
  start: number;     // path length from the root to the branch start
}

const widthOf = (depth: number) => Math.max(.72, depth === 0 ? 5.4 : 5.4 * .58 ** (depth - 1));

function grow(): Branch[] {
  const out: Branch[] = [];
  const add = (parent: number, depth: number, angle: number, length: number): number => {
    const i = out.length;
    out.push({
      parent, depth, angle, length, width: widthOf(depth), bend: (rand(i, 11) - .5) * (depth <= 2 ? .34 : .24), phase: rand(i, 12) * TAU,
      leaf: false, x0: 0, y0: 0, x1: 0, y1: 0, mx: 0, my: 0, abs: 0, start: 0,
    });
    return i;
  };
  const split = (index: number) => {
    const b = out[index];
    if (b.depth >= MAX_DEPTH || (b.depth >= 3 && rand(index, 21) < .05 + .05 * b.depth)) { b.leaf = true; return; }
    const count = b.depth === 0 ? 3 : b.depth < 4 && rand(index, 22) < .24 ? 3 : 2;
    const spread = b.depth === 0 ? [-.5, .08, .55] : count === 3 ? [-.55, 0, .55] : [-1, 1];
    for (let k = 0; k < count; k++) {
      const jitter = (rand(index, 30 + k) - .5) * .16;
      const sign = count === 3 ? spread[k] : (rand(index, 23) < .5 ? spread[k] : -spread[k]);
      const lean = b.depth === 0 ? spread[k] : sign * (.3 + .2 * rand(index, 40 + k));
      const shrink = b.depth === 0 ? 3.0 : .78 * (.82 + .38 * rand(index, 50 + k));
      const child = add(index, b.depth + 1, lean + jitter, b.length * shrink);
      split(child);
    }
  };
  const trunk = add(-1, 0, 0, 20);
  split(trunk);
  return out;
}

interface Tree { branches: Branch[]; leaves: number[] }
let tree: Tree | null = null;
function getTree(): Tree {
  if (tree) return tree;
  const branches = grow();
  const leaves: number[] = [];
  // rest layout to order the leaves from left to right
  const x = new Float64Array(branches.length), abs = new Float64Array(branches.length);
  branches.forEach((b, i) => {
    const p = b.parent >= 0 ? b.parent : -1;
    const a = (p >= 0 ? abs[p] * DAMP : 0) + b.angle;
    abs[i] = a;
    const px = p >= 0 ? x[p] : ROOT_X;
    x[i] = px + Math.sin(a) * b.length;
    if (b.leaf) leaves.push(i);
  });
  leaves.sort((a, b) => x[a] - x[b]);
  tree = { branches, leaves };
  return tree;
}

function layout(F: Frame, t: Tree, sway: number, drift: number) {
  const { branches } = t;
  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];
    const p = b.parent >= 0 ? branches[b.parent] : null;
    const wob = sway * (b.depth ** 1.15) * Math.sin(drift * (1 + (b.depth & 1)) + b.phase + b.depth * .9) * .5;
    b.abs = (p ? p.abs * DAMP : 0) + b.angle + wob;
    b.x0 = p ? p.x1 : ROOT_X;
    b.y0 = p ? p.y1 : ROOT_Y;
    b.x1 = b.x0 + Math.sin(b.abs) * b.length;
    b.y1 = b.y0 - Math.cos(b.abs) * b.length;
    const nx = Math.cos(b.abs), ny = Math.sin(b.abs);
    b.mx = (b.x0 + b.x1) / 2 + nx * b.bend * b.length;
    b.my = (b.y0 + b.y1) / 2 + ny * b.bend * b.length;
    b.start = p ? p.start + p.length : 0;
  }
}

export const filament: Look = {
  id: 'filament',
  group: 'midi',
  nameRu: 'Филамент',
  nameEn: 'Filament',
  descriptionRu: 'Светящееся дерево: каждая нота пускает световой импульс от корня к своей веточке',
  descriptionEn: 'A glowing tree where each note sends a pulse of light from the root up to its own twig',
  draw(F) {
    const { ctx } = F;
    fill(F, '#030809');
    // tall soft haze behind the tree
    ctx.save();
    ctx.translate(270, 600);
    ctx.scale(1, 1.8);
    const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, 250);
    const lift = .92 + .16 * Math.max(F.env * .6, F.audio.level);
    haze.addColorStop(0, `rgba(24,38,50,${lift})`);
    haze.addColorStop(.4, `rgba(15,24,32,${.8 * lift})`);
    haze.addColorStop(.75, 'rgba(8,14,18,0.5)');
    haze.addColorStop(1, 'rgba(3,8,9,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(-250, -250, 500, 500);
    ctx.restore();
    if (!F.thumb) {
      ctx.fillStyle = '#9fb5c4';
      for (let i = 0; i < 26; i++) { ctx.globalAlpha = .12 + .25 * rand(i, 3); ctx.fillRect(rand(i, 1) * 540, rand(i, 2) * 780, 1, 1); }
      ctx.globalAlpha = 1;
    }

    const t = getTree();
    const { branches, leaves } = t;
    const level = Math.max(F.env * .75, F.audio.level);
    const drift = loopT(F, 8) * TAU;
    layout(F, t, .016 + .02 * level + .03 * F.hit * .5, drift);

    // pulses: each sounding or recent note lights the path root -> its leaf
    const lit = new Float32Array(branches.length);
    const flash = new Float32Array(branches.length);
    const total = 1;
    for (const track of F.tracks) {
      const span = F.tps * 1.4;
      for (const note of windowNotes(F, track.index, span, 0, 48)) {
        const age = (F.tick - note.pos) / F.tps;
        if (age < 0 || age > 1.4) continue;
        const pn = pitchNorm(F.notes, note.pitch);
        const pick = clamp(pn + (note.seed - .5) * .12);
        let leaf = leaves[Math.round(pick * (leaves.length - 1))];
        // path length of the target
        const path: number[] = [];
        for (let i = leaf; i >= 0; i = branches[i].parent) path.push(i);
        path.reverse();
        const end = branches[leaf].start + branches[leaf].length;
        const front = Math.min(1.25, age / .55) * end;
        const sustain = Math.max(0, note.env) * (.25 + .35 * note.vel);
        for (const i of path) {
          const b = branches[i], mid = b.start + b.length / 2;
          const wave = Math.exp(-(((front - mid) / (end * .22)) ** 2)) * (.45 + .55 * note.vel) * Math.max(0, 1 - age / 1.4);
          lit[i] = Math.min(1, lit[i] + wave + sustain * (1 - b.depth / (MAX_DEPTH + 2)));
        }
        if (front >= end * .96) flash[leaf] = Math.min(1, flash[leaf] + (.6 + .4 * note.vel) * Math.exp(-(age - .5) / .35) * (age < 1.2 ? 1 : 0));
        void total;
        leaf = 0;
      }
    }

    // draw: one pass per depth so widths batch into a few strokes
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let pass = 0; pass < 2; pass++) {
      for (let depth = 0; depth <= MAX_DEPTH; depth++) {
        const width = widthOf(depth);
        const strength = depth <= 1 ? 1 : depth <= 3 ? .9 : .78;
        ctx.strokeStyle = depth <= 1 ? '#dcebf5' : depth <= 3 ? '#b6c9d6' : '#a6bac7';
        if (pass === 0) {
          if (depth > 4 || F.thumb) continue;
          ctx.globalAlpha = .075 * strength;
          ctx.lineWidth = width * 2 + 5;
        } else {
          ctx.globalAlpha = strength;
          ctx.lineWidth = width;
        }
        ctx.beginPath();
        for (const b of branches) {
          if (b.depth !== depth) continue;
          ctx.moveTo(b.x0, b.y0);
          ctx.quadraticCurveTo(b.mx, b.my, b.x1, b.y1);
        }
        ctx.stroke();
      }
    }
    // lit branches on top
    ctx.strokeStyle = '#ffffff';
    for (let i = 0; i < branches.length; i++) {
      if (lit[i] < .03) continue;
      const b = branches[i];
      ctx.globalAlpha = Math.min(1, lit[i]) * .95;
      ctx.lineWidth = Math.max(.9, b.width * 1.15);
      ctx.beginPath();
      ctx.moveTo(b.x0, b.y0);
      ctx.quadraticCurveTo(b.mx, b.my, b.x1, b.y1);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    // junction nodes and tips
    ctx.fillStyle = '#e6f1f8';
    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      if (b.leaf) {
        const r = .9 + 1.3 * rand(i, 61) ** 3 + 3.4 * flash[i];
        ctx.globalAlpha = .55 + .4 * flash[i];
        ctx.beginPath(); ctx.arc(b.x1, b.y1, r, 0, TAU); ctx.fill();
        if (flash[i] > .08 && !F.thumb) glow(F, '#b9dcf2', b.x1, b.y1, 9 + 9 * flash[i], .5 * flash[i]);
      } else if (b.depth > 0 && rand(i, 62) < .3) {
        ctx.globalAlpha = .85;
        ctx.beginPath(); ctx.arc(b.x1, b.y1, Math.max(1, b.width * .85), 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // glow at the root
    glow(F, '#cfe6f5', ROOT_X, ROOT_Y - 3, 34 + 10 * F.hit, .55 + .25 * level);
    ctx.globalAlpha = 1;
  },
};
