import { audioAt, clamp, makeSurface, surfaceContext } from '../frame';
import { H, rand, W } from '../kit';
import type { Look } from './types';

// A dusk landscape of tree silhouettes; long light streaks (one lane per frequency band) are fired by
// onsets in the sound and drift sideways while their tail fades.
const HORIZON = 551;
const LANES: { y: number; from: number; to: number; speed: number }[] = [
  { y: 124, from: 0, to: 3, speed: 16 }, { y: 240, from: 3, to: 8, speed: 24 }, { y: 334, from: 8, to: 14, speed: 19 },
  { y: 510, from: 14, to: 22, speed: 30 }, { y: 660, from: 22, to: 32, speed: 21 },
];
const HIST = 26, DT = .06, LIFE = HIST * DT;
const KS = 1.5;

let cache: ReturnType<typeof makeSurface> = null;

function tree(g: CanvasRenderingContext2D, x: number, base: number, size: number, seed: number) {
  g.fillStyle = '#050309';
  const trunk = size * (.9 + .5 * rand(seed, 1));
  // trunks
  const count = size > 30 ? 3 : size > 14 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const tx = x + (i - (count - 1) / 2) * size * .55 + (rand(seed, 2 + i) - .5) * size * .2;
    const w = Math.max(1.6, size * .1), top = base - trunk * (.7 + .3 * rand(seed, 6 + i));
    g.beginPath(); g.moveTo(tx - w, base); g.lineTo(tx - w * .55, top); g.lineTo(tx + w * .55, top); g.lineTo(tx + w, base); g.closePath(); g.fill();
  }
  // mushroom canopy: a cluster of ellipses
  const cy = base - trunk - size * .35;
  const lobes = size > 30 ? 4 : size > 14 ? 3 : 2;
  for (let i = 0; i < lobes; i++) {
    const a = (i - (lobes - 1) / 2) * .8 + (rand(seed, 10 + i) - .5) * .3;
    const rx = size * (.62 + .22 * rand(seed, 14 + i)), ry = size * (.46 + .16 * rand(seed, 18 + i));
    g.beginPath(); g.ellipse(x + a * size * .62, cy - Math.cos(a * .9) * size * .1 + (rand(seed, 22 + i) - .5) * size * .2, rx, ry, 0, 0, Math.PI * 2); g.fill();
  }
}

function buildScene(): ReturnType<typeof makeSurface> {
  const s = makeSurface(W * KS, H * KS);
  const g = s && surfaceContext(s);
  if (!s || !g) return null;
  g.scale(KS, KS);
  const sky = g.createLinearGradient(0, 0, 0, HORIZON);
  sky.addColorStop(0, '#04030a'); sky.addColorStop(.3, '#0c0818'); sky.addColorStop(.55, '#22103a'); sky.addColorStop(.8, '#431a4c'); sky.addColorStop(1, '#5e2550');
  g.fillStyle = '#07050b'; g.fillRect(0, 0, W, H);
  g.fillStyle = sky; g.fillRect(0, 0, W, HORIZON + 12);
  // warm beam rising from the horizon
  const beam = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  beam.addColorStop(0, 'rgba(226,120,96,.7)'); beam.addColorStop(.35, 'rgba(190,88,96,.38)'); beam.addColorStop(.7, 'rgba(130,52,100,.12)'); beam.addColorStop(1, 'rgba(110,40,110,0)');
  g.save();
  g.beginPath(); g.rect(0, 0, W, HORIZON + 1); g.clip();
  g.translate(385, HORIZON + 20); g.scale(165, 235);
  g.fillStyle = beam; g.fillRect(-1, -1, 2, 2);
  g.restore();
  // ground
  const ground = g.createLinearGradient(0, HORIZON, 0, H);
  ground.addColorStop(0, '#2a2023'); ground.addColorStop(.18, '#1b1519'); ground.addColorStop(.5, '#0c0a0f'); ground.addColorStop(1, '#07060a');
  g.fillStyle = ground;
  g.beginPath(); g.moveTo(0, HORIZON + 4);
  for (let x = 0; x <= W; x += 20) g.lineTo(x, HORIZON + 4 - 3 * Math.sin(x * .012) - (x > 440 ? (x - 440) * .12 : 0));
  g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
  g.fillStyle = 'rgba(200,110,120,.22)'; g.fillRect(0, HORIZON + 2, W, 3);
  // right hill
  g.fillStyle = '#050309';
  g.beginPath(); g.moveTo(W + 2, HORIZON + 4); g.quadraticCurveTo(470, HORIZON - 12, 380, HORIZON + 2); g.lineTo(W + 2, HORIZON + 6); g.closePath(); g.fill();
  // trees (hand-laid, tall cluster in the middle-left, small ones scattered)
  const list: [number, number][] = [
    [8, 24], [48, 21], [92, 11], [110, 27], [138, 19], [160, 16], [182, 31], [206, 34], [238, 15], [262, 37], [268, 8], [296, 24], [326, 12], [350, 22],
    [384, 11], [408, 14], [436, 7], [468, 21], [492, 15], [530, 31], [75, 7], [220, 8], [320, 6], [455, 6],
  ];
  list.forEach(([x, size], i) => tree(g, x, HORIZON + 1, size * 1.3, i * 7 + 3));
  return s;
}

const bandOf = (spectrum: Float32Array, from: number, to: number) => {
  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, spectrum[i]);
  return peak;
};

export const smear: Look = {
  id: 'smear',
  group: 'audio',
  nameRu: 'Смаз',
  nameEn: 'Smear',
  descriptionRu: 'Над силуэтами деревьев по полосам частот дрейфуют длинные световые росчерки',
  descriptionEn: 'Long light streaks, one lane per frequency band, drift across a dusk tree line',
  draw(F) {
    const { ctx } = F;
    if (!cache) cache = buildScene();
    ctx.globalAlpha = 1;
    if (cache) { ctx.imageSmoothingEnabled = true; ctx.drawImage(cache, 0, 0, W * KS, H * KS, 0, 0, W, H); }
    else { ctx.fillStyle = '#0a0812'; ctx.fillRect(0, 0, W, H); }

    const hist: Float32Array[] = [];
    for (let j = 0; j <= HIST + 1; j++) hist.push(audioAt(F, -j * DT).spectrum);
    const t = F.meta.seconds;
    ctx.lineCap = 'round';
    LANES.forEach((lane, k) => {
      let e0 = bandOf(hist[0], lane.from, lane.to), found = -1, level = 0;
      const gain = 1 + k * .12;
      for (let j = 0; j <= HIST; j++) {
        const e = bandOf(hist[j], lane.from, lane.to) * gain, prev = bandOf(hist[j + 1], lane.from, lane.to) * gain;
        if (e > .22 && e - prev > .06) { found = j; level = e; break; }
        e0 = e;
      }
      void e0;
      if (found < 0) return;
      const age = found * DT, fade = clamp(1 - age / LIFE), stamp = Math.round((t - age) / DT);
      const x0 = 120 + rand(stamp, k + 40) * 290;
      const head = x0 + lane.speed * age * (.7 + .6 * rand(stamp, k + 50));
      const len = (70 + 190 * clamp(level)) * (.45 + .55 * fade);
      const y = lane.y + (rand(stamp, k + 60) - .5) * 6;
      const alpha = clamp(fade * 1.4) * (k === 4 ? .5 : 1);
      const tail = head - len;
      const grad = ctx.createLinearGradient(tail, 0, head, 0);
      grad.addColorStop(0, 'rgba(210,110,190,0)'); grad.addColorStop(.08, 'rgba(214,120,196,.8)'); grad.addColorStop(.4, 'rgba(236,224,248,.95)'); grad.addColorStop(1, '#ffffff');
      ctx.strokeStyle = grad;
      ctx.beginPath(); ctx.moveTo(tail, y); ctx.lineTo(head, y);
      ctx.globalAlpha = alpha * .3; ctx.lineWidth = 7; ctx.stroke();
      ctx.globalAlpha = alpha; ctx.lineWidth = k === 3 ? 1.8 : 2.6; ctx.stroke();
      if (k !== 4) { ctx.globalAlpha = alpha; ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(head, y, 2.6, 0, Math.PI * 2); ctx.fill(); }
      if (k === 3) { ctx.globalAlpha = alpha * .5; ctx.strokeStyle = '#9fe8ff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(tail, y + 1); ctx.lineTo(head, y + 1); ctx.stroke(); }
    });
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  },
};
