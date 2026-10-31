import { clamp, windowNotes } from '../frame';
import type { Frame, TrackView } from '../frame';
import { chordsByBar, fill, HAND, line, MONO, noise1, rect, text, totalBars, trackColorAt, trackRole } from '../kit';
import type { Look } from './types';

const PAPER = '#fbfbf4', INK = '#121212', LINE = '#7d7d79';
const X0 = 88, X1 = 508, SX0 = 30, SX1 = 510;
const SPACE = 14.6, HALF = SPACE / 2, PITCH = 161.5, TOP0 = 239;
const STEP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];
const BASS_BOTTOM = 18, TREBLE_BOTTOM = 30; // diatonic step of the bottom line (G2, E4)

const stepOf = (pitch: number) => (Math.floor(Math.round(pitch) / 12) - 1) * 7 + STEP[((Math.round(pitch) % 12) + 12) % 12];

const roleColor = (track: TrackView) => {
  const role = trackRole(track);
  return role === 'bass' ? '#c8862a' : role === 'chords' ? '#26a69a' : trackColorAt(track.slot + 3);
};

interface Head { step: number; sharp: boolean; shift: number; side: number }
interface Group { x: number; heads: Head[]; color: string; role: string; env: number; up: boolean }

function sharpMark(F: Frame, x: number, y: number, color: string) {
  const { ctx } = F;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.globalAlpha = 1;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 3, y - 15); ctx.lineTo(x - 3, y + 17); ctx.moveTo(x + 3, y - 17); ctx.lineTo(x + 3, y + 15);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 7, y - 1); ctx.lineTo(x + 7, y - 6); ctx.lineTo(x + 7, y - 2.5); ctx.lineTo(x - 7, y + 2.5);
  ctx.moveTo(x - 7, y + 9); ctx.lineTo(x + 7, y + 4); ctx.lineTo(x + 7, y + 7.5); ctx.lineTo(x - 7, y + 12.5);
  ctx.fill();
}

function head(F: Frame, x: number, y: number, color: string, scale: number) {
  const { ctx } = F;
  ctx.fillStyle = color; ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.ellipse(x, y, 7.3 * scale, 5.6 * scale, -.38, 0, Math.PI * 2); ctx.fill();
}

function staffLines(F: Frame, top: number, seed: number) {
  const { ctx } = F;
  ctx.strokeStyle = LINE; ctx.lineWidth = 1.1; ctx.globalAlpha = 1;
  for (let k = 0; k < 5; k++) {
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const x = SX0 + (SX1 - SX0) * i / 24;
      const y = top + k * SPACE + noise1(x * .018 + k * 3.1, seed) * 1.1;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
}

function clef(F: Frame, treble: boolean, top: number) {
  const glyph = treble ? '\u{1D11E}' : '\u{1D122}';
  const fonts = '"Apple Symbols", "Noto Music", "Segoe UI Symbol", "Bravura", "Symbola", serif';
  if (treble) text(F, glyph, 29, top + 4 * SPACE + 12, { size: 139, font: fonts, color: INK });
  else text(F, glyph, 29, top + 3.6 * SPACE, { size: 85, font: fonts, color: INK });
}

export const sheet: Look = {
  id: 'sheet',
  group: 'midi',
  nameRu: 'Нотный лист',
  nameEn: 'Sheet',
  descriptionRu: 'Гравированный нотный лист: по стану на такт, партии цветными нотами, аккорды от руки и красный курсор с серой подсветкой.',
  descriptionEn: 'An engraved score page: one staff per bar, parts as coloured notes, hand-written chords and a red playhead with a grey wash.',
  draw(F) {
    const { ctx } = F;
    fill(F, PAPER);
    const bars = totalBars(F), pages = Math.max(1, Math.ceil(bars / 4));
    const bar = Math.min(bars - 1, Math.max(0, Math.floor(F.tick / F.bar)));
    const page = Math.floor(bar / 4), first = page * 4;
    const frac = F.tick / F.bar - bar;
    const melodic = F.tracks.filter(track => trackRole(track) !== 'drums');
    const pool = melodic.length ? melodic : F.tracks;
    const keep = new Set(pool.slice().sort((a, b) => b.index.n - a.index.n).slice(0, 4));
    const parts = pool.filter(track => keep.has(track));
    const chords = chordsByBar(F);

    text(F, [F.meta.title, `${Math.round(F.meta.bpm)} BPM`, F.meta.key, `${bars} BARS`, `PAGE ${page + 1}/${pages}`].filter(Boolean).join(' · ').toUpperCase(), 30, 86,
      { size: 10, font: MONO, color: '#a9a9a4', spacing: 1.9, maxWidth: 480 });

    const names: string[] = [];
    for (let k = 0; k < 4; k++) {
      const b = first + k;
      if (b >= bars) break;
      const top = TOP0 + k * PITCH, bottom = top + 4 * SPACE, from = b * F.bar, to = from + F.bar;
      names.push(chords[b] || '');
      // gather note groups of the bar
      const raw: { track: TrackView; pos: number; pitch: number; env: number }[] = [];
      for (const track of parts) {
        for (const note of windowNotes(F, track.index, F.tick - from + 1, to - F.tick + 1, 0, 0)) {
          if (note.pos < from - 1e-6 || note.pos >= to - 1e-6) continue;
          raw.push({ track, pos: note.pos, pitch: note.pitch, env: note.env });
        }
      }
      // clef from the harmony (non-bass) notes, else everything
      const harmony = raw.filter(n => trackRole(n.track) === 'chords');
      const upper = raw.filter(n => trackRole(n.track) !== 'bass');
      const sample = harmony.length ? harmony : upper.length ? upper : raw;
      const mean = sample.length ? sample.reduce((s, n) => s + n.pitch, 0) / sample.length : 48;
      const treble = mean >= 65.5;
      const lo = treble ? 60 : 40, hi = treble ? 86 : 62, bottomStep = treble ? TREBLE_BOTTOM : BASS_BOTTOM;
      staffLines(F, top, b * 3 + 1);
      clef(F, treble, top);
      text(F, String(b + 1), 35, top + 68.5, { size: 8, font: MONO, color: '#9a9a96' });
      if (chords[b]) text(F, chords[b], 36, top - 27, { size: 19, font: HAND, color: INK, weight: 700 });

      // current bar wash and playhead
      const active = b === bar;
      if (active) {
        const px = X0 + (X1 - X0) * clamp(frac), y0 = top - 23, y1 = bottom + 16.5;
        for (let i = 0; i < 6; i++) {
          const inset = i * 2.4;
          rect(F, SX0 + inset * .8, y0 + inset, Math.max(0, px - SX0 - inset * .8 + 4), y1 - y0 - inset * 2, '#8d8d8d', .042);
        }
      }

      // groups by onset and part
      const groups = new Map<string, Group>();
      for (const n of raw) {
        const key = `${n.track.slot}|${Math.round(n.pos / (F.beat / 8))}`;
        let g = groups.get(key);
        if (!g) {
          g = { x: X0 + 12 + (n.pos - from) / F.bar * (X1 - X0 - 24), heads: [], color: roleColor(n.track), role: trackRole(n.track), env: 0, up: true };
          groups.set(key, g);
        }
        let shift = 0, written = n.pitch;
        while (written < lo) { written += 12; shift++; }
        while (written >= hi) { written -= 12; shift--; }
        const p = Math.round(written);
        g.heads.push({ step: stepOf(p), sharp: SHARP[((p % 12) + 12) % 12], shift, side: 0 });
        g.env = Math.max(g.env, n.env);
      }
      const order = [...groups.values()].sort((a, c) => (a.role === 'chords' ? 1 : 0) - (c.role === 'chords' ? 1 : 0) || a.x - c.x);
      const midStep = bottomStep + 4;
      const labelled = new Set<string>();
      for (const g of order) {
        g.heads.sort((a, c) => a.step - c.step);
        const dedupe: Head[] = [];
        for (const h of g.heads) if (!dedupe.length || dedupe[dedupe.length - 1].step !== h.step) dedupe.push(h);
        g.heads = dedupe;
        const avg = g.heads.reduce((s, h) => s + h.step, 0) / g.heads.length;
        g.up = g.role === 'chords' ? true : avg < midStep;
        for (let i = 1; i < g.heads.length; i++) if (g.heads[i].step - g.heads[i - 1].step === 1 && g.heads[i - 1].side === 0) g.heads[i].side = 1;
        const yOf = (step: number) => bottom - (step - bottomStep) * HALF;
        const scale = 1 + .22 * g.env;
        // ledger lines
        ctx.strokeStyle = '#4a4a48'; ctx.lineWidth = 1.2; ctx.globalAlpha = 1;
        for (const h of g.heads) {
          const rel = h.step - bottomStep;
          const ledgers: number[] = [];
          if (rel <= -2) for (let r = -2; r >= rel - (rel % 2 ? 1 : 0); r -= 2) ledgers.push(r);
          if (rel >= 10) for (let r = 10; r <= rel; r += 2) ledgers.push(r);
          for (const r of ledgers) {
            const y = bottom - r * HALF, xo = h.side ? 14 : 0;
            ctx.beginPath(); ctx.moveTo(g.x + xo - 11, y); ctx.lineTo(g.x + xo + 11, y); ctx.stroke();
          }
        }
        // stem
        const low = yOf(g.heads[0].step), high = yOf(g.heads[g.heads.length - 1].step);
        ctx.strokeStyle = g.color; ctx.lineWidth = 1.5;
        const sx = g.up ? g.x + 6.8 : g.x - 6.8;
        ctx.beginPath();
        if (g.up) { ctx.moveTo(sx, low + 1); ctx.lineTo(sx, high - SPACE * (g.role === 'chords' ? 1.8 : 3.2)); } else { ctx.moveTo(sx, high - 1); ctx.lineTo(sx, low + SPACE * 3.2); }
        ctx.stroke();
        let col = 0;
        for (const h of g.heads.slice().reverse()) {
          const y = yOf(h.step), hx = g.x + (h.side ? (g.up ? 13 : -13) : 0);
          head(F, hx, y, g.color, scale);
          if (h.sharp) { sharpMark(F, g.x - 16 - (col++ % 2) * 9, y, g.color); }
          const lk = `${Math.round(hx / 3)}|${Math.round(y / 6)}`;
          if (h.shift && !labelled.has(lk)) { labelled.add(lk); text(F, h.shift < 0 ? '8va' : '8vb', hx + 11, y - 5, { size: 7.5, font: MONO, italic: true, color: '#9b9b96' }); }
        }
      }
    }
    const footer = names.filter(Boolean).join(' – ');
    if (footer) text(F, footer, 30, 909, { size: 17, font: HAND, color: INK, weight: 700 });
    ctx.globalAlpha = 1;

    // red playhead on the current staff
    const k = bar - first, top = TOP0 + k * PITCH;
    if (bar < bars) {
      const px = X0 + (X1 - X0) * clamp(frac);
      line(F, px, top - 23, px, top + 4 * SPACE + 16.5, '#d9544d', 2);
    }
  },
};
