import { clamp } from '../frame';
import { clock2, fill, MONO, text } from '../kit';
import { fmtLufs, loudnessModel, lookup, toLufs } from './_c';
import type { Look } from './types';

// A loudness report on warm paper: the big integrated reading, four bar-and-number rows (momentary, short term,
// integrated, true peak against a -14 target) and a scrolling momentary-loudness trace over level bars with a red
// playhead that stays put while the clip slides underneath it.

const PAPER = '#f4f4ef';
const INK = '#0b0b0a';
const MUTED = '#8c8c88';
const TEAL = '#2b9f95';
const RED = '#df5841';
const L = 30, R = 510, W = R - L;
const PX = 375; // playhead x
const CHART = { top: 662, bottom: 857, base: 887 };

function label(F: Parameters<typeof text>[0], value: string, x: number, y: number, extra: Partial<Parameters<typeof text>[4]> = {}) {
  return text(F, value, x, y, { size: 8.2, font: MONO, color: MUTED, spacing: 2.4, ...extra });
}

export const ladder: Look = {
  id: 'ladder',
  group: 'audio',
  nameRu: 'Лесенка',
  nameEn: 'Ladder',
  descriptionRu: 'Отчёт о громкости: большие цифры, шкалы и бегущий график',
  descriptionEn: 'A loudness report: big readings, level bars and a scrolling trace',
  draw(F) {
    const { ctx } = F;
    fill(F, PAPER);
    const model = loudnessModel(F);
    const now = F.meta.seconds;
    const momentary = lookup(model, model.momentary, now);
    const short = lookup(model, model.short, now);

    // ---- heading and the big number
    text(F, F.meta.title, L, 54, { size: 26.8, font: MONO, color: '#0f0f0d', maxWidth: 400 });
    text(F, [`${Math.round(F.meta.bpm)} BPM`, F.meta.key].filter(Boolean).join(' · '), L, 70.5, { size: 9, font: MONO, color: '#898985', spacing: 2.9 });
    text(F, fmtLufs(model.integrated), 30.5, 257, { size: 92.5, font: MONO, color: '#0d0d0c', spacing: 0 });
    label(F, 'LUFS INTEGRATED', 33.5, 286, { size: 9.2, color: '#85857f', spacing: 4.7 });

    // ---- four readings
    const rows: [string, number, number, number, string][] = [
      ['MOMENTARY', momentary, clamp((momentary + 30) / 22), 0, '#3b3b39'],
      ['SHORT TERM', short, clamp((short + 30) / 22), 1, '#3b3b39'],
      ['INTEGRATED', model.integrated, clamp((model.integrated + 30) / 22), 2, '#3b3b39'],
      ['TRUE PEAK', model.truePeak, clamp((model.truePeak + 24) / 24), 3, RED],
    ];
    for (const [name, value, frac, k, color] of rows) {
      const y = 390.75 + k * 74;
      label(F, name, L, y - 31, {});
      text(F, fmtLufs(value), R, y - 35.5, { size: 21, font: MONO, color: INK, align: 'right' });
      ctx.fillStyle = '#d7d8d2';
      ctx.fillRect(L, y - .5, W, 1.1);
      ctx.fillStyle = color;
      ctx.fillRect(L, y - 3, W * frac, 6);
    }
    // -14 target
    ctx.strokeStyle = TEAL;
    ctx.globalAlpha = .6;
    ctx.lineWidth = 1;
    const tx = Math.round(L + W * (-14 + 30) / 22) + .5;
    ctx.beginPath(); ctx.moveTo(tx, 344); ctx.lineTo(tx, 617); ctx.stroke();
    ctx.globalAlpha = 1;
    label(F, 'TARGET -14', 384, 336.5, { size: 7.4, color: TEAL, spacing: 1.5 });

    // ---- trace window: the playhead stays at x = PX, the clip slides past
    const window = clamp(model.duration, 6, 30);
    const t0 = now - (PX - L) / W * window;
    const points = F.thumb ? 80 : 200;
    const xs = new Float32Array(points), vs = new Float32Array(points);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < points; i++) {
      xs[i] = L + W * i / (points - 1);
      vs[i] = lookup(model, model.momentary, t0 + window * i / (points - 1));
      if (vs[i] < min) min = vs[i];
      if (vs[i] > max) max = vs[i];
    }
    if (max - min < 3) { const mid = (max + min) / 2; min = mid - 1.5; max = mid + 1.5; }
    label(F, `MOMENTARY · ${window.toFixed(1)} s`, L, 625);
    label(F, `${min.toFixed(1)} … ${max.toFixed(1)} LUFS`, R, 625, { align: 'right' });
    const yOf = (v: number) => CHART.bottom - clamp((v - min) / (max - min)) * (CHART.bottom - CHART.top);
    // target level across the chart
    const ty = clamp(yOf(-14), CHART.top - 8, CHART.bottom);
    ctx.strokeStyle = '#8fc4bd';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, Math.round(ty) + .5); ctx.lineTo(R, Math.round(ty) + .5); ctx.stroke();

    // level bars
    const bars = 64, pitch = W / bars * .985;
    ctx.fillStyle = '#bbbcb6';
    for (let k = 0; k < bars; k++) {
      const t = t0 + (k + .5) / bars * window;
      let v = 0;
      for (let s = -1; s <= 1; s++) v += lookup(model, model.level, t + s * window / bars * .33);
      const norm = clamp((toLufs(v / 3) - min) / (max - min));
      const height = 28 + norm * 100;
      ctx.fillRect(L + 5 + k * pitch, CHART.base - height, pitch * .64, height);
    }
    ctx.fillStyle = '#d5d6d1';
    ctx.fillRect(L, CHART.base, W, 1);

    // trace: dark before the playhead, pale after it
    ctx.lineJoin = 'round';
    const stroke = (from: number, to: number, color: string, width: number) => {
      ctx.beginPath();
      let started = false;
      for (let i = from; i <= to; i++) {
        const y = yOf(vs[i]);
        if (!started) { ctx.moveTo(xs[i], y); started = true; } else ctx.lineTo(xs[i], y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    const split = Math.max(1, Math.min(points - 1, Math.round((PX - L) / W * (points - 1))));
    stroke(split, points - 1, '#a9aaa4', 1.25);
    stroke(0, split, '#222220', 1.75);

    // playhead
    ctx.fillStyle = RED;
    ctx.fillRect(PX - .7, 630, 1.5, CHART.base - 630);

    // ---- footer
    label(F, 'EBU R128 · 400 ms / 75 % · 4x OVERSAMPLED PEAK', L, 924);
    label(F, `${clock2(F.meta.seconds)} / ${clock2(F.meta.duration)}`, R, 924, { align: 'right' });
  },
};
