import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PatternItem } from '../../services/api';
import { sampleAudioFrame, type AudioAnalysis } from '../../services/audioAnalysis';
import { MIDI_VISUAL_MODES, renderMidiVisual, type MidiVisualMode, type MidiVisualModeInfo, type VisualOptions } from '../../utils/midiVisuals';
import { VisualizerSection } from './Section';
import { LOOK_FILTERS, looksWord, representativeProgress, type LookFilter } from './shared';

export interface ThumbSource { pattern: PatternItem; tracks: PatternItem[]; seconds: number; analysis: AudioAnalysis | null }

interface LookPanelProps {
  isRu: boolean;
  mode: MidiVisualMode;
  filter: LookFilter;
  thumb: ThumbSource;
  accent: string;
  options: VisualOptions;
  reducedMotion: boolean;
  onSelect(mode: MidiVisualMode): void;
  onFilter(filter: LookFilter): void;
}

const FILTER_LABELS: Record<LookFilter, [string, string, string]> = {
  all: ['Все', 'All', 'ti-layout-grid'],
  midi: ['С MIDI', 'With MIDI', 'ti-music'],
  audio: ['Только звук', 'Audio only', 'ti-wave-sine'],
};
const THUMB_BUDGET_MS = 8;
// Collapsed grid height in rows; "show all" reveals the rest.
const COLLAPSED_ROWS = 2;

interface LookCardProps {
  info: MidiVisualModeInfo;
  selected: boolean;
  isRu: boolean;
  onSelect(mode: MidiVisualMode): void;
  register(mode: MidiVisualMode, canvas: HTMLCanvasElement | null): void;
  onHover(mode: MidiVisualMode, active: boolean): void;
}

const LookCard = memo<LookCardProps>(({ info, selected, isRu, onSelect, register, onHover }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    register(info.id, canvasRef.current);
    return () => register(info.id, null);
  }, [info.id, register]);
  const name = isRu ? info.nameRu : info.nameEn;
  const description = isRu ? info.descriptionRu : info.descriptionEn;
  return (
    <button
      type="button"
      className={`vz-look ${selected ? 'is-selected' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(info.id)}
      onPointerEnter={() => onHover(info.id, true)}
      onPointerLeave={() => onHover(info.id, false)}
      title={`${name} — ${description}`}
    >
      <span className="vz-look-thumb">
        <canvas ref={canvasRef} width={216} height={384} aria-hidden="true" />
        {selected && <span className="vz-look-check" aria-hidden="true"><i className="ti ti-check" /></span>}
      </span>
      <span className="vz-look-name">{name}</span>
      <span className="vz-look-desc">{description}</span>
    </button>
  );
});

export const LookPanel: React.FC<LookPanelProps> = ({ isRu, mode, filter, thumb, accent, options, reducedMotion, onSelect, onFilter }) => {
  const progress = useMemo(() => representativeProgress(thumb.pattern), [thumb.pattern]);
  const canvases = useRef(new Map<MidiVisualMode, HTMLCanvasElement>());
  const visible = useRef(new Set<MidiVisualMode>());
  const drawn = useRef(new Map<MidiVisualMode, number>());
  const generation = useRef(1);
  const queue = useRef<MidiVisualMode[]>([]);
  const frame = useRef(0);
  const hover = useRef<{ mode: MidiVisualMode; started: number; frame: number } | null>(null);
  const observer = useRef<IntersectionObserver | null>(null);
  const inputs = useRef({ thumb, accent, options, progress, reducedMotion });
  const firstRun = useRef(true);
  const gridRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(0);
  const [showAll, setShowAll] = useState(false);
  inputs.current = { thumb, accent, options, progress, reducedMotion };

  const draw = useCallback((target: MidiVisualMode, at: number) => {
    const ctx = canvases.current.get(target)?.getContext('2d');
    if (!ctx) return;
    const { thumb: source, accent: color, options: style } = inputs.current;
    try {
      renderMidiVisual(ctx, source.pattern, target, at, color, source.tracks, sampleAudioFrame(source.analysis, at * source.seconds), style);
    } catch (error) {
      console.error(`Look preview "${target}" failed:`, error);
    }
  }, []);

  const pump = useCallback(() => {
    frame.current = 0;
    const started = performance.now();
    while (queue.current.length && performance.now() - started < THUMB_BUDGET_MS) {
      const target = queue.current.shift()!;
      if (!visible.current.has(target) || drawn.current.get(target) === generation.current || hover.current?.mode === target) continue;
      draw(target, inputs.current.progress);
      drawn.current.set(target, generation.current);
    }
    if (queue.current.length) frame.current = requestAnimationFrame(pump);
  }, [draw]);

  const schedule = useCallback((target: MidiVisualMode) => {
    if (!queue.current.includes(target)) queue.current.push(target);
    if (!frame.current) frame.current = requestAnimationFrame(pump);
  }, [pump]);

  const register = useCallback((target: MidiVisualMode, canvas: HTMLCanvasElement | null) => {
    const previous = canvases.current.get(target);
    if (previous && previous !== canvas) observer.current?.unobserve(previous);
    if (canvas) {
      canvas.dataset.mode = target;
      canvases.current.set(target, canvas);
      drawn.current.delete(target);
      observer.current?.observe(canvas);
    } else {
      canvases.current.delete(target);
      visible.current.delete(target);
    }
  }, []);

  const onHover = useCallback((target: MidiVisualMode, active: boolean) => {
    const current = hover.current;
    if (current) {
      cancelAnimationFrame(current.frame);
      hover.current = null;
      drawn.current.delete(current.mode);
      schedule(current.mode);
    }
    if (!active || inputs.current.reducedMotion) return;
    const state = { mode: target, started: performance.now(), frame: 0 };
    const loop = () => {
      const { thumb: source, progress: base } = inputs.current;
      draw(target, (base + (performance.now() - state.started) / 1000 / Math.max(.25, source.seconds)) % 1);
      state.frame = requestAnimationFrame(loop);
    };
    hover.current = state;
    state.frame = requestAnimationFrame(loop);
  }, [draw, schedule]);

  useEffect(() => {
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const target = (entry.target as HTMLElement).dataset.mode as MidiVisualMode | undefined;
        if (!target) continue;
        if (entry.isIntersecting) {
          visible.current.add(target);
          schedule(target);
        } else visible.current.delete(target);
      }
    }, { rootMargin: '200px 0px' });
    observer.current = io;
    canvases.current.forEach(canvas => io.observe(canvas));
    return () => {
      io.disconnect();
      observer.current = null;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (hover.current) cancelAnimationFrame(hover.current.frame);
      hover.current = null;
    };
  }, [schedule]);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      generation.current++;
      visible.current.forEach(schedule);
    }, 140);
    return () => clearTimeout(timer);
  }, [thumb, accent, options, progress, schedule]);

  useEffect(() => {
    if (reducedMotion && hover.current) onHover(hover.current.mode, false);
  }, [reducedMotion, onHover]);

  const modes = useMemo(() => filter === 'all' ? MIDI_VISUAL_MODES : MIDI_VISUAL_MODES.filter(item => item.group === filter), [filter]);
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: MIDI_VISUAL_MODES.length };
    for (const item of MIDI_VISUAL_MODES) result[item.group] = (result[item.group] || 0) + 1;
    return result;
  }, []);
  // The grid is laid out by container queries, so its column count is read back from the computed track list.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const read = () => setColumns(getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length);
    read();
    const resize = new ResizeObserver(read);
    resize.observe(grid);
    return () => resize.disconnect();
  }, []);
  // Collapsed, the grid shows COLLAPSED_ROWS rows, grown to the row that holds the selected look so it never hides.
  const selectedIndex = modes.findIndex(item => item.id === mode);
  const visibleCount = Math.max(columns * COLLAPSED_ROWS, Math.ceil((selectedIndex + 1) / Math.max(1, columns)) * columns);
  const collapsible = columns > 0 && visibleCount < modes.length;
  const shown = collapsible && !showAll ? modes.slice(0, visibleCount) : modes;

  const shuffle = () => {
    const pool = (modes.length > 1 ? modes : MIDI_VISUAL_MODES).filter(item => item.id !== mode);
    if (pool.length) onSelect(pool[Math.floor(Math.random() * pool.length)].id);
  };

  return (
    <VisualizerSection
      step={2}
      title={isRu ? 'Стиль' : 'Look'}
      meta={`${MIDI_VISUAL_MODES.length} ${looksWord(MIDI_VISUAL_MODES.length, isRu)}`}
      actions={<button type="button" className="vz-link" onClick={shuffle} title={isRu ? 'Случайный стиль' : 'Random look'}><i className="ti ti-arrows-shuffle" aria-hidden="true" />{isRu ? 'Случайный' : 'Shuffle'}</button>}
    >
      <div className="vz-chips" role="group" aria-label={isRu ? 'Фильтр стилей' : 'Filter looks'}>
        {LOOK_FILTERS.filter(item => item === 'all' || counts[item]).map(item => (
          <button key={item} type="button" className="vz-chip" aria-pressed={filter === item} onClick={() => onFilter(item)}>
            <i className={`ti ${FILTER_LABELS[item][2]}`} aria-hidden="true" />{isRu ? FILTER_LABELS[item][0] : FILTER_LABELS[item][1]}<span>{counts[item] || 0}</span>
          </button>
        ))}
      </div>
      <div ref={gridRef} className="vz-look-grid" id="vz-look-grid">
        {shown.map(info => <LookCard key={info.id} info={info} selected={info.id === mode} isRu={isRu} onSelect={onSelect} register={register} onHover={onHover} />)}
      </div>
      {collapsible && (
        <button type="button" className="vz-more" aria-expanded={showAll} aria-controls="vz-look-grid" onClick={() => setShowAll(open => !open)}>
          <i className={`ti ${showAll ? 'ti-chevron-up' : 'ti-chevron-down'}`} aria-hidden="true" />
          {showAll ? (isRu ? 'Свернуть' : 'Show less') : (isRu ? `Показать все ${modes.length}` : `Show all ${modes.length}`)}
        </button>
      )}
    </VisualizerSection>
  );
};
