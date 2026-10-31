import { clamp, makeSurface, surfaceContext, windowNotes, type Frame } from '../frame';
import { mix } from '../color';
import { ease, H, infoLine, text, trackColorAt, W } from '../kit';
import type { Look } from './types';

// Every note is a plank resting on little dominoes. Planks slide leftwards one beat at a time; the one that reaches the
// playhead at its end loses its plank and the dominoes topple (cascading from the top row down) and lie as bricks.

const BG = '#e9e8eb';
const PLAYHEAD_X = 240.7;
const PX_BEAT = 90;
const VIEW_L = 75, VIEW_R = 469;
const ROW = 52.5;
const FADE = 26;

type Ctx = CanvasRenderingContext2D;

interface Shade { outline: string; dark: string; mid: string; light: string; cap: string; plank: string; plankTop: string }
const shades = new Map<string, Shade>();
function shadeOf(color: string): Shade {
  const known = shades.get(color);
  if (known) return known;
  const made: Shade = {
    outline: mix(color, '#0a0418', .82),
    dark: mix(color, '#1b0f3a', .42),
    mid: mix(color, '#3c2a78', .28),
    light: mix(color, '#ffffff', .22),
    cap: mix(color, '#ffffff', .4),
    plank: mix(color, '#241250', .3),
    plankTop: mix(color, '#ffffff', .3),
  };
  shades.set(color, made);
  return made;
}

let scratch: { key: string; surface: HTMLCanvasElement | OffscreenCanvas } | null = null;
function scratchFor(F: Frame): HTMLCanvasElement | OffscreenCanvas | null {
  const key = `${F.W}x${F.H}`;
  if (scratch && scratch.key === key) return scratch.surface;
  const surface = makeSurface(F.W, F.H);
  if (!surface) return null;
  scratch = { key, surface };
  return surface;
}

function warp(F: Frame): number {
  const b = F.tick / F.beat, f = b - Math.floor(b);
  return Math.floor(b) + ease.inOutCubic((f - .42) / .58);
}

interface Layout { low: number; rows: number; rowH: number; y0: number; scale: number; range: number }

function layoutOf(F: Frame): Layout {
  const lo = F.notes.n ? Math.floor(F.notes.minPitch) : 48, hi = F.notes.n ? Math.ceil(F.notes.maxPitch) : 72;
  const range = Math.max(1, hi - lo + 1);
  const rows = Math.min(range, 14);
  const rowH = ROW * Math.min(1, 12 / rows);
  const scale = Math.max(.45, rowH / ROW);
  const y0 = 480 - 20 - (rows - 1) * rowH / 2;
  return { low: lo, rows, rowH, y0, scale, range };
}

function rowOf(L: Layout, pitch: number): number {
  const r = L.range <= 14 ? Math.round(pitch) - L.low : Math.floor((pitch - L.low) / L.range * L.rows);
  return clamp(r, 0, L.rows - 1);
}

function outlinedRect(g: Ctx, x: number, y: number, w: number, h: number, fillColor: string, line: string, lw: number) {
  g.fillStyle = fillColor;
  g.fillRect(x, y, w, h);
  g.strokeStyle = line;
  g.lineWidth = lw;
  g.strokeRect(x + lw / 2, y + lw / 2, w - lw, h - lw);
}

// A standing domino: lighter top cap, light upper half, darker lower half.
function drawLeg(g: Ctx, cx: number, top: number, w: number, h: number, sh: Shade, s: number) {
  const x = cx - w / 2, cap = 6 * s;
  g.fillStyle = sh.dark;
  g.fillRect(x, top + h * .52, w, h * .48);
  g.fillStyle = sh.light;
  g.fillRect(x, top + cap, w, h * .52 - cap);
  g.fillStyle = sh.cap;
  g.fillRect(x, top, w, cap);
  g.strokeStyle = sh.outline;
  g.lineWidth = .8;
  g.strokeRect(x + .4, top + .4, w - .8, h - .8);
  g.beginPath();
  g.moveTo(x, top + cap);
  g.lineTo(x + w, top + cap);
  g.moveTo(x, top + h * .52);
  g.lineTo(x + w, top + h * .52);
  g.globalAlpha *= .45;
  g.stroke();
  g.globalAlpha /= .45;
}

// A fallen domino: top face and two front halves, long side horizontal.
function drawBrick(g: Ctx, x: number, bottom: number, s: number, sh: Shade) {
  const w = 37.5 * s, h = 21 * s, top = bottom - h, cap = h * .34;
  g.fillStyle = sh.cap;
  g.fillRect(x, top, w, cap);
  g.fillStyle = sh.dark;
  g.fillRect(x, top + cap, w / 2, h - cap);
  g.fillStyle = sh.mid;
  g.fillRect(x + w / 2, top + cap, w / 2, h - cap);
  g.strokeStyle = sh.outline;
  g.lineWidth = .8;
  g.strokeRect(x + .4, top + .4, w - .8, h - .8);
  g.beginPath();
  g.moveTo(x, top + cap);
  g.lineTo(x + w, top + cap);
  g.moveTo(x + w / 2, top + cap);
  g.lineTo(x + w / 2, bottom);
  g.stroke();
  // soft shadow to the lower left
  g.fillStyle = 'rgba(40,30,70,0.13)';
  g.fillRect(x - 5 * s, bottom - 3 * s, 5 * s, 3.5 * s);
}

function drawPlank(g: Ctx, x0: number, x1: number, y: number, active: number, sh: Shade, s: number, fade: number) {
  const thick = 9 * s, top = 3 * s;
  if (x1 - x0 < 3) return;
  const pale = 1 - active;
  const body = mix(sh.plank, '#dcd6ee', pale * .55), lit = mix(sh.plankTop, '#ffffff', pale * .35);
  g.globalAlpha = fade;
  g.fillStyle = body;
  g.fillRect(x0, y, x1 - x0, thick);
  g.fillStyle = lit;
  g.fillRect(x0, y, x1 - x0, top);
  if (pale > .3) {
    // a bevelled left end: the plank has not started yet
    g.beginPath();
    g.moveTo(x0, y);
    g.lineTo(x0 + 4 * s, y - 2.5 * s);
    g.lineTo(x1, y - 2.5 * s);
    g.lineTo(x1, y);
    g.closePath();
    g.fillStyle = mix(sh.cap, '#ffffff', .25);
    g.fill();
  }
  g.strokeStyle = sh.outline;
  g.lineWidth = .9;
  g.strokeRect(x0 + .45, y + .45, x1 - x0 - .9, thick - .9);
  g.globalAlpha = 1;
}

export const domino: Look = {
  id: 'domino',
  group: 'midi',
  nameRu: 'Домино',
  nameEn: 'Domino',
  descriptionRu: 'Каждая нота — планка на костяшках: у конца ноты костяшки падают одна за другой',
  descriptionEn: 'Each note is a plank on dominoes; when the note ends its dominoes topple one after another',
  draw(F) {
    const { ctx } = F;
    ctx.globalAlpha = 1;
    ctx.fillStyle = BG;
    ctx.fillRect(-2, -2, W + 4, H + 4);

    const L = layoutOf(F);
    const s = L.scale;
    const bw = warp(F);
    const xOf = (tick: number) => PLAYHEAD_X + (tick / F.beat - bw) * PX_BEAT;
    const surface = scratchFor(F);
    const sctx = surface ? surfaceContext(surface) : null;
    const g: Ctx = sctx ?? ctx;
    if (sctx) {
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(0, 0, F.W, F.H);
      sctx.scale(F.W / W, F.H / H);
    } else { ctx.save(); ctx.beginPath(); ctx.rect(VIEW_L, 0, VIEW_R - VIEW_L, H); ctx.clip(); }

    const before = (PLAYHEAD_X - VIEW_L) / PX_BEAT + 1.2, after = (VIEW_R - PLAYHEAD_X) / PX_BEAT + 1.2;
    const items: { y: number; draw: () => void }[] = [];
    let held = 0, down = 0;
    for (let i = 0; i < F.notes.n; i++) { if (F.notes.end[i] <= F.tick) down++; else if (F.notes.pos[i] <= F.tick) held++; }
    const legH = 41 * s, legW = 11.6 * s;
    for (const track of F.tracks) {
      const sh = shadeOf(mix('#7e5ce0', trackColorAt(track.slot), .16));
      for (const note of windowNotes(F, track.index, before * F.beat, after * F.beat, 0)) {
        const x0 = xOf(note.pos), x1 = Math.max(x0 + legW + 2, xOf(note.end));
        const y = L.y0 + (L.rows - 1 - rowOf(L, note.pitch)) * L.rowH;
        const started = F.tick >= note.pos, ended = F.tick >= note.end;
        // dominoes: at the start, at the end and every one or two beats in between
        const step = (note.seed < .4 ? 1 : 2) * F.beat;
        const legs: number[] = [];
        for (let t = note.pos; t < note.end - F.beat * .3; t += step) legs.push(t);
        if (note.dur > F.beat * 1.2) legs.push(note.end - 12 / PX_BEAT * F.beat);
        if (!legs.length) legs.push(note.pos);
        const age = (F.tick - note.end) / F.tps;
        const foot = y + 9 * s + legH;
        if (x1 < VIEW_L - 50 || x0 > VIEW_R + 10) { if (x0 > VIEW_R + 10 || age > 0) continue; }
        items.push({
          y,
          draw: () => {
            const active = started && !ended ? 1 : 0;
            if (!ended) {
              if (active && !F.thumb) {
                const gl = g.createLinearGradient(0, y - 22, 0, y + 30);
                gl.addColorStop(0, 'rgba(110,70,210,0)');
                gl.addColorStop(.45, 'rgba(110,70,210,0.2)');
                gl.addColorStop(1, 'rgba(110,70,210,0)');
                g.fillStyle = gl;
                g.fillRect(x0 - 6, y - 22, x1 - x0 + 12, 52);
              }
              drawPlank(g, x0, x1, y, active, sh, s, 1);
            } else if (age < .28) {
              drawPlank(g, x0, x1, y, 1, sh, s, 1 - age / .28);
            }
            legs.forEach((t, k) => {
              const cx = xOf(t) + legW / 2 + 3 * s;
              if (!ended) {
                const lift = active ? 0 : 0;
                g.globalAlpha = active ? 1 : .62;
                drawLeg(g, cx, y + 9 * s - lift, legW, legH, sh, s);
                g.globalAlpha = 1;
                return;
              }
              const delay = (L.rows - 1 - rowOf(L, note.pitch)) * .018 + note.seed * .05 + k * .025;
              const q = clamp((age - delay) / .3);
              if (q <= 0) { drawLeg(g, cx, y + 9 * s, legW, legH, sh, s); return; }
              if (q >= 1) { drawBrick(g, cx - legW / 2, foot, s, sh); return; }
              const angle = ease.inOutCubic(q) * Math.PI / 2;
              g.save();
              g.translate(cx + legW / 2, foot);
              g.rotate(angle);
              drawLeg(g, -legW / 2, -legH, legW, legH, sh, s);
              g.restore();
              if (q > .85) { g.globalAlpha = (q - .85) / .15; drawBrick(g, cx - legW / 2, foot, s, sh); g.globalAlpha = 1; }
            });
          },
        });
      }
    }
    items.sort((a, b) => a.y - b.y);
    for (const item of items) item.draw();
    g.globalAlpha = 1;

    if (sctx && surface) {
      // soft left / right edges of the window
      sctx.globalCompositeOperation = 'destination-in';
      const mask = sctx.createLinearGradient(VIEW_L, 0, VIEW_R, 0);
      mask.addColorStop(0, 'rgba(0,0,0,0)');
      mask.addColorStop(FADE / (VIEW_R - VIEW_L), 'rgba(0,0,0,1)');
      mask.addColorStop(1 - FADE / (VIEW_R - VIEW_L), 'rgba(0,0,0,1)');
      mask.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.fillStyle = mask;
      sctx.fillRect(0, 0, W, H);
      sctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(surface as CanvasImageSource, 0, 0, W, H);
    } else ctx.restore();

    // playhead
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#7d7b80';
    ctx.fillRect(PLAYHEAD_X - .6, 136, 1.2, 693);

    text(F, F.meta.title, 75, 118, { size: 22.5, weight: 700, color: '#1f1a2c', spacing: -.3, maxWidth: 270 });
    text(F, infoLine(F, ' · ', false), 470, 118, { size: 13, weight: 500, color: '#75727d', align: 'right' });
    text(F, `${down} down · ${held} held`, 75, 857, { size: 13, weight: 600, color: '#1f1a2c' });
  },
};
