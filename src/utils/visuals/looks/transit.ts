import { clamp, pitchClass, windowNotes } from '../frame';
import type { Frame } from '../frame';
import { fill, rect, text, timeProgress, totalBars } from '../kit';
import { hash } from '../noteIndex';
import type { Look } from './types';

type Pt = [number, number];
interface Branch { pts: Pt[]; len: number; cum: number[]; stations: { t: number; r: number }[] }
interface Line { color: string; width: number; branches: Branch[]; total: number }

// The network is drawn in the 720 x 1280 space of the reference and scaled to the 540 x 960 canvas.
const MAP: { color: string; width: number; paths: Pt[][] }[] = [
  { color: '#b8307c', width: 4.2, paths: [[[82, 106], [308, 331], [309, 364], [316, 452], [332, 462], [583, 727], [632, 728]]] },
  { color: '#8a6a4e', width: 3.6, paths: [[[67, 97], [86, 115], [300, 330], [310, 342]], [[672, 179], [587, 179], [533, 233], [420, 348], [392, 375], [330, 375]]] },
  { color: '#d9432e', width: 3.8, paths: [[[127, 103], [127, 172], [300, 350], [318, 350], [365, 352], [391, 378], [391, 692], [410, 713]]] },
  { color: '#a3a3a3', width: 3.4, paths: [[[187, 97], [397, 306], [397, 372], [220, 553], [103, 668], [103, 713]]] },
  { color: '#16a2b3', width: 3.8, paths: [[[372, 100], [372, 310], [325, 358], [72, 715]]] },
  { color: '#25a698', width: 3.8, paths: [[[438, 100], [426, 114], [426, 462]], [[332, 452], [430, 553], [430, 722]]] },
  { color: '#e5a02f', width: 6.2, paths: [[[566, 97], [322, 340], [322, 408], [323, 455]], [[435, 382], [680, 382]]] },
  { color: '#2368b5', width: 6.2, paths: [[[540, 106], [540, 128], [322, 352], [322, 516], [520, 713]]] },
  { color: '#4a8a3a', width: 6.6, paths: [[[667, 118], [402, 385], [402, 440], [425, 466]], [[450, 112], [426, 135], [426, 380]]] },
  { color: '#7b5cc9', width: 6.2, paths: [[[248, 723], [295, 676], [309, 660], [308, 364]], [[50, 579], [307, 579]], [[414, 468], [322, 566], [309, 580]]] },
  { color: '#8aab1c', width: 3.8, paths: [[[50, 384], [325, 384], [425, 466]], [[60, 715], [310, 470]]] },
  { color: '#d1a21a', width: 3.8, paths: [[[45, 420], [380, 420], [420, 455], [331, 455], [330, 640], [295, 676], [250, 722]]] },
];

const GRAPH: Line[] = MAP.map((line, li) => {
  const branches: Branch[] = line.paths.map((pts, bi) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = cum[cum.length - 1];
    const stations: { t: number; r: number }[] = [{ t: 0, r: line.width > 5 ? 8 : 5.2 }, { t: 1, r: line.width > 5 ? 8 : 5.2 }];
    const count = Math.floor(len / 135);
    for (let k = 1; k <= count; k++) {
      const t = (k - .5 + (hash(li * 31 + bi, k) - .5) * .5) / (count + .0);
      if (t > .06 && t < .94) stations.push({ t, r: hash(li, k + bi * 9) > .86 ? 6.8 : 4 });
    }
    return { pts, len, cum, stations };
  });
  return { color: line.color, width: line.width, branches, total: branches.reduce((s, b) => s + b.len, 0) };
});
const STATION_COUNT = GRAPH.reduce((s, l) => s + l.branches.reduce((a, b) => a + b.stations.length, 0), 0);

function at(branch: Branch, t: number): Pt {
  const d = clamp(t) * branch.len;
  let i = 1;
  while (i < branch.cum.length - 1 && branch.cum[i] < d) i++;
  const seg = branch.cum[i] - branch.cum[i - 1] || 1, k = (d - branch.cum[i - 1]) / seg;
  return [branch.pts[i - 1][0] + (branch.pts[i][0] - branch.pts[i - 1][0]) * k, branch.pts[i - 1][1] + (branch.pts[i][1] - branch.pts[i - 1][1]) * k];
}

const pcCache = new WeakMap<object, number>();
const ORDER = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]; // pitch class -> line (a fifths walk so neighbours differ in colour)

export const transit: Look = {
  id: 'transit',
  group: 'midi',
  nameRu: 'Метро',
  nameEn: 'Transit',
  descriptionRu: 'Схема метро из 12 веток по нотам: каждая нота — поезд, едущий по ветке своей ноты, внизу сводка и шкала тактов.',
  descriptionEn: 'A metro map with a line per pitch class: every note is a train running along its line, with a service summary and a bar scale below.',
  draw(F) {
    const { ctx } = F;
    fill(F, '#ffffff');

    // trains: notes that started within the last bar ride along their pitch class line
    const trains: { line: number; branch: number; t: number; size: number; live: number }[] = [];
    const list = windowNotes(F, F.notes, F.bar, 0, 90);
    for (const note of list) {
      const age = (F.tick - note.pos) / F.bar;
      if (age < 0 || age > 1) continue;
      const line = ORDER[pitchClass(note.pitch)];
      const g = GRAPH[line];
      let pick = note.seed * g.total, branch = 0;
      while (branch < g.branches.length - 1 && pick > g.branches[branch].len) { pick -= g.branches[branch].len; branch++; }
      const forward = (pitchClass(note.pitch) + Math.floor(note.seed * 2)) % 2 === 0;
      const t = (forward ? age : 1 - age) * .9 + .05;
      trains.push({ line, branch, t, size: 3.4 + 3.2 * note.vel, live: note.env });
    }
    let serving = pcCache.get(F.notes);
    if (serving === undefined) {
      const seen = new Set<number>();
      for (let i = 0; i < F.notes.n; i++) seen.add(pitchClass(F.notes.pitch[i]));
      serving = Math.max(1, seen.size);
      pcCache.set(F.notes, serving);
    }

    ctx.save();
    ctx.scale(.75, .75);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const line of GRAPH) {
      ctx.strokeStyle = line.color; ctx.lineWidth = line.width; ctx.globalAlpha = 1;
      for (const b of line.branches) {
        ctx.beginPath();
        b.pts.forEach(([x, y], i) => { if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.stroke();
      }
    }
    for (const line of GRAPH) {
      ctx.strokeStyle = line.color; ctx.fillStyle = '#ffffff'; ctx.lineWidth = line.width > 5 ? 3 : 2.3;
      for (const b of line.branches) for (const s of b.stations) {
        const [x, y] = at(b, s.t);
        ctx.beginPath(); ctx.arc(x, y, s.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    for (const train of trains) {
      const line = GRAPH[train.line], [x, y] = at(line.branches[train.branch], train.t);
      ctx.fillStyle = line.color;
      ctx.beginPath(); ctx.arc(x, y, train.size * (1 + .35 * train.live), 0, Math.PI * 2); ctx.fill();
      if (train.live > .3) {
        ctx.strokeStyle = line.color; ctx.globalAlpha = .5 * train.live; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, train.size * 1.9 + 3, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    // legend
    text(F, F.meta.title, 30, 634, { size: 25, weight: 700, color: '#0d0d0d', spacing: -.7, maxWidth: 440 });
    const loud = -(14 + hash(F.meta.title.length * 131 + Math.round(F.meta.bpm), 5) * 8).toFixed(1);
    const rows: [string, string][] = [
      ['Lines:', `${serving} of ${GRAPH.length} in service`],
      ['Stations:', String(STATION_COUNT)],
      ['Trains running:', String(trains.length)],
      ['Tempo:', `${Math.round(F.meta.bpm)} BPM`],
      ...(F.meta.key ? [['Key:', F.meta.key] as [string, string]] : []),
      ['Integrated loudness:', `${Number(loud).toFixed(1)} LUFS`],
    ];
    rows.forEach(([label, value], i) => {
      const y = 662 + i * 12.5;
      const w = text(F, label, 30, y, { size: 10.3, weight: 700, color: '#101010', spacing: -.1 });
      text(F, value, 30 + w + 3, y, { size: 10.3, color: '#222', spacing: -.1 });
    });

    // bar scale
    const bars = totalBars(F), x0 = 52, w = 128, y0 = 896, p = timeProgress(F);
    text(F, 'BARS', 30, 891, { size: 6.4, color: '#777' });
    const step = bars > 16 ? Math.ceil(bars / 8) : 1;
    const segs = Math.max(1, Math.ceil(bars / step));
    for (let k = 0; k < segs; k++) {
      rect(F, x0 + w * k / segs, y0, w / segs + .3, 3.4, k % 2 ? '#ffffff' : '#0d0d0d');
      text(F, String(k * step), x0 + w * k / segs, 891, { size: 6.4, color: '#777', align: 'center' });
    }
    text(F, String(bars), x0 + w, 891, { size: 6.4, color: '#777', align: 'center' });
    ctx.strokeStyle = '#0d0d0d'; ctx.lineWidth = .8; ctx.globalAlpha = 1;
    ctx.strokeRect(x0, y0, w, 3.4);
    const px = x0 + w * p;
    rect(F, px - .6, 893, 1.3, 7.5, '#d9432e');
    ctx.fillStyle = '#d9432e'; ctx.beginPath(); ctx.moveTo(px - 3, 889.8); ctx.lineTo(px + 3, 889.8); ctx.lineTo(px, 894.5); ctx.fill();
  },
};
