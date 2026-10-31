import type { AudioFrame } from '../services/audioAnalysis';
import type { PatternItem } from '../services/api';
import { DEFAULT_ACCENT } from './visuals/color';
import { buildFrame, patternTicks, type VisualOptions } from './visuals/frame';
import { trackColorAt } from './visuals/kit';
import { LOOK_LIST, type Look, type LookGroup } from './visuals/looks';

export { noteEnvelope } from './visuals/noteIndex';
export type { VisualBackground, VisualOptions } from './visuals/frame';

export type MidiVisualMode = string;
export type MidiVisualGroup = LookGroup;

export interface MidiVisualModeInfo {
  id: MidiVisualMode;
  group: MidiVisualGroup;
  nameRu: string;
  nameEn: string;
  descriptionRu: string;
  descriptionEn: string;
}

export const MIDI_VISUAL_MODES: MidiVisualModeInfo[] = LOOK_LIST.map(({ id, group, nameRu, nameEn, descriptionRu, descriptionEn }) => ({ id, group, nameRu, nameEn, descriptionRu, descriptionEn }));

const LOOKS = new Map<string, Look>(LOOK_LIST.map(look => [look.id, look]));

const reported = new Set<string>();

export function getPatternTicks(pattern: PatternItem): number {
  return patternTicks(pattern);
}

// The colour the looks give tracks[slot], so UI legends can match the canvas.
export function getTrackColor(_accent: string, slot: number): string {
  return trackColorAt(Number.isFinite(slot) ? slot : 0);
}

export function renderMidiVisual(ctx: CanvasRenderingContext2D, pattern: PatternItem, mode: MidiVisualMode, progress: number, accent = DEFAULT_ACCENT, tracks?: PatternItem[], audio?: AudioFrame, options?: VisualOptions) {
  const canvas = ctx?.canvas;
  if (!canvas || !canvas.width || !canvas.height) return;
  ctx.save();
  try {
    ctx.setTransform(canvas.width / 540, 0, 0, canvas.height / 960, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.imageSmoothingEnabled = true;
    if ('filter' in ctx) ctx.filter = 'none';
    const frame = buildFrame(ctx, pattern, progress, accent, tracks ?? [pattern], audio, options);
    const look = LOOKS.get(mode) || LOOK_LIST[0];
    ctx.save();
    try {
      look.draw(frame);
    } catch (error) {
      const key = `${look.id}:${error instanceof Error ? error.message : String(error)}`;
      if (!reported.has(key)) { reported.add(key); console.error('Visualizer look failed:', look.id, error); }
    } finally {
      ctx.restore();
    }
  } finally {
    ctx.restore();
  }
}
