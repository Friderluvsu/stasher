import type { Frame } from '../frame';
import { clamp, pitchNorm, windowNotes } from '../frame';
import type { VNote } from '../noteIndex';

// Shared layout of the "scrolling note grid" looks (film, screen): a fixed playhead, notes scroll right to left,
// nine pitch rows, note width follows its length up to a square.
export const GRID = { playX: 174, x0: 30, x1: 510, pxPerBeat: 31, rows: 9, row0: 98, rowStep: 81, top: 78, bottom: 767 };

export interface GridNote { note: VNote; x: number; y: number; w: number; started: boolean }

export function gridNotes(F: Frame, size: number, minW: number): GridNote[] {
  const g = GRID;
  const before = (g.playX - g.x0 + 20) / g.pxPerBeat * F.beat, after = (g.x1 - g.playX + 20) / g.pxPerBeat * F.beat;
  const out: GridNote[] = [];
  for (const note of windowNotes(F, F.notes, before, after, 260)) {
    const x = g.playX + (note.pos - F.tick) / F.beat * g.pxPerBeat;
    const row = Math.round(pitchNorm(F.notes, note.pitch, 12) * (g.rows - 1));
    const y = g.row0 + (g.rows - 1 - row) * g.rowStep;
    const w = clamp(note.dur / F.beat * g.pxPerBeat * .9, minW, size);
    out.push({ note, x, y, w, started: note.pos <= F.tick });
  }
  return out;
}
