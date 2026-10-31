import React, { useEffect, useRef, useState } from 'react';
import type { PatternItem } from '../../services/api';
import type { AudioAnalysis } from '../../services/audioAnalysis';
import { recordMidiVideo, type VideoResolution } from '../../services/midiVideoExport';
import { notify } from '../../state/toastStore';
import type { MidiVisualMode, VisualOptions } from '../../utils/midiVisuals';
import { formatClock } from '../../utils/visualizerScene';
import { VisualizerSection } from './Section';
import { describeExportError, isAbortError, MAX_EXPORT_SECONDS, type ExportPreset, type VisualizerPrefs } from './shared';

export interface ExportJob {
  scene: PatternItem;
  tracks: PatternItem[];
  mode: MidiVisualMode;
  accent: string;
  audioFile: File | null;
  audioAnalysis: AudioAnalysis | null;
  visualOptions: VisualOptions;
  slug: string;
}

type ExportPrefs = Pick<VisualizerPrefs, 'exportPreset' | 'customSeconds' | 'resolution' | 'fps' | 'fromPlayhead'>;

interface ExportPanelProps {
  isRu: boolean;
  prefs: ExportPrefs;
  blockedReason: string | null;
  fullSeconds: number;
  fullKind: 'loop' | 'song' | 'audio' | null;
  audioSeconds: number;
  getJob(): ExportJob | null;
  getPlayhead(): number;
  onPrefs(patch: Partial<ExportPrefs>): void;
  onExportingChange(active: boolean): void;
}

const RESOLUTIONS: VideoResolution[] = ['1080x1920', '720x1280'];
const SR_ONLY: React.CSSProperties = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 };
const clampSeconds = (value: number) => Math.min(MAX_EXPORT_SECONDS, Math.max(1, Number.isFinite(value) ? value : 1));

export function resolveExportSeconds(preset: ExportPreset, customSeconds: number, fullSeconds: number, audioSeconds: number): number {
  if (preset === 'full') return clampSeconds(fullSeconds || 30);
  if (preset === 'audio') return clampSeconds(audioSeconds || fullSeconds || 30);
  if (preset === 'custom') return clampSeconds(customSeconds);
  return Number(preset);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const ExportPanel: React.FC<ExportPanelProps> = ({ isRu, prefs, blockedReason, fullSeconds, fullKind, audioSeconds, getJob, getPlayhead, onPrefs, onExportingChange }) => {
  const [progress, setProgress] = useState<{ value: number; eta: number | null } | null>(null);
  const [customDraft, setCustomDraft] = useState(String(prefs.customSeconds));
  const abortRef = useRef<AbortController | null>(null);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const exportBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const wasExportingRef = useRef(false);
  const isRuRef = useRef(isRu);
  isRuRef.current = isRu;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (!abortRef.current) return;
      abortRef.current.abort();
      notify.info(isRuRef.current ? 'Экспорт остановлен: вы ушли из визуализатора' : 'Export stopped: you left the visualizer', isRuRef.current ? 'Визуализатор' : 'Visualizer');
    };
  }, []);
  useEffect(() => setCustomDraft(String(prefs.customSeconds)), [prefs.customSeconds]);

  const preset = prefs.exportPreset === 'audio' && !audioSeconds ? '30' : prefs.exportPreset;
  const seconds = resolveExportSeconds(preset, prefs.customSeconds, fullSeconds, audioSeconds);
  const exporting = progress !== null;

  // The Export button is replaced by the progress block (and back), which would drop keyboard focus onto <body>.
  // Hand it to the button that takes over, but only if focus was lost, so nothing is stolen from another control.
  useEffect(() => {
    if (wasExportingRef.current === exporting) return;
    wasExportingRef.current = exporting;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    (exporting ? cancelBtnRef : exportBtnRef).current?.focus();
  }, [exporting]);

  const fullLabel = fullKind === 'song' ? (isRu ? 'Песня' : 'Song') : fullKind === 'audio' ? (isRu ? 'Трек' : 'Track') : (isRu ? 'Луп' : 'Loop');
  const presets: { id: ExportPreset; label: string; hint?: string; disabled?: boolean }[] = [
    { id: '15', label: `15 ${isRu ? 'с' : 's'}` },
    { id: '30', label: `30 ${isRu ? 'с' : 's'}` },
    { id: '60', label: `60 ${isRu ? 'с' : 's'}` },
    { id: 'full', label: fullLabel, hint: fullSeconds ? formatClock(fullSeconds) : undefined, disabled: !fullSeconds },
    { id: 'audio', label: isRu ? 'По аудио' : 'Audio', hint: audioSeconds ? formatClock(audioSeconds) : undefined, disabled: !audioSeconds },
  ];

  const commitCustom = () => {
    const value = Math.round(clampSeconds(Number(customDraft.replace(',', '.'))));
    setCustomDraft(String(value));
    // Tabbing through the field must not change the preset: it only becomes "custom" when the value is edited or clicked.
    onPrefs({ customSeconds: value });
  };

  const run = async () => {
    const job = getJob();
    if (!job || exporting || blockedReason) return;
    const controller = new AbortController();
    abortRef.current = controller;
    cancelledRef.current = false;
    const total = seconds;
    const startSeconds = prefs.fromPlayhead ? Math.max(0, getPlayhead()) : 0;
    onExportingChange(true);
    setProgress({ value: 0, eta: null });
    let lastUpdate = 0;
    try {
      const result = await recordMidiVideo({
        scene: job.scene,
        tracks: job.tracks,
        mode: job.mode,
        accent: job.accent,
        durationSeconds: total,
        audioFile: job.audioFile,
        audioAnalysis: job.audioAnalysis,
        signal: controller.signal,
        visualOptions: job.visualOptions,
        startSeconds,
        resolution: prefs.resolution,
        fps: prefs.fps,
        onProgress: (value, eta) => {
          const now = performance.now();
          if ((now - lastUpdate < 150 && value < 1) || !mountedRef.current || controller.signal.aborted) return;
          lastUpdate = now;
          setProgress({ value: Math.min(1, Math.max(0, value)), eta });
        },
      });
      if (controller.signal.aborted) return;
      const fileName = `stasher_${job.slug}_${job.mode}_${Math.max(1, Math.round(total))}s.${result.extension}`;
      downloadBlob(result.blob, fileName);
      const size = `${(result.blob.size / 1048576).toFixed(1)} MB`;
      notify.success(`${fileName} · ${size}`, isRu ? 'Видео готово' : 'Video ready');
    } catch (error) {
      if (cancelledRef.current) notify.info(isRu ? 'Экспорт отменён' : 'Export cancelled', isRu ? 'Визуализатор' : 'Visualizer');
      else if (!isAbortError(error) && mountedRef.current) {
        console.error('Video export failed:', error);
        notify.error(describeExportError(error, isRu), isRu ? 'Экспорт не удался' : 'Export failed');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mountedRef.current) {
        setProgress(null);
        onExportingChange(false);
      }
    }
  };

  const cancel = () => {
    cancelledRef.current = true;
    abortRef.current?.abort();
  };

  const percent = Math.round((progress?.value || 0) * 100);
  const preparing = !progress || progress.value <= 0;
  return (
    <VisualizerSection step={5} title={isRu ? 'Экспорт' : 'Export'} meta={`${prefs.resolution.replace('x', '×')} · ${prefs.fps} fps`} className="vz-export">
      <fieldset className="vz-field" disabled={exporting}>
        <legend className="vz-field-label">{isRu ? 'Длительность' : 'Duration'}</legend>
        <div className="vz-chips">
          {presets.map(item => (
            <button key={item.id} type="button" className="vz-chip" aria-pressed={preset === item.id} disabled={item.disabled} onClick={() => onPrefs({ exportPreset: item.id })}>
              {item.label}{item.hint && <span>{item.hint}</span>}
            </button>
          ))}
          <label className={`vz-chip vz-chip-input ${preset === 'custom' ? 'is-active' : ''}`} aria-current={preset === 'custom' ? 'true' : undefined} onPointerDown={() => onPrefs({ exportPreset: 'custom' })}>
            <span className="vz-chip-input-label">{isRu ? 'Своя' : 'Custom'}</span>
            <input
              type="number"
              min={1}
              max={MAX_EXPORT_SECONDS}
              step={1}
              inputMode="numeric"
              value={customDraft}
              onChange={event => {
                setCustomDraft(event.target.value);
                onPrefs({ exportPreset: 'custom' });
              }}
              onBlur={commitCustom}
              onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
              aria-label={isRu ? 'Своя длительность в секундах' : 'Custom duration in seconds'}
            />
            <span>{isRu ? 'с' : 's'}</span>
          </label>
        </div>
      </fieldset>

      <div className="vz-export-grid">
        <fieldset className="vz-field" disabled={exporting}>
          <legend className="vz-field-label">{isRu ? 'Разрешение' : 'Resolution'}</legend>
          <div className="vz-segmented">
            {RESOLUTIONS.map(item => (
              <button key={item} type="button" aria-pressed={prefs.resolution === item} onClick={() => onPrefs({ resolution: item })}>{item.replace('x', '×')}</button>
            ))}
          </div>
        </fieldset>
        <fieldset className="vz-field" disabled={exporting}>
          <legend className="vz-field-label">{isRu ? 'Частота кадров' : 'Frame rate'}</legend>
          <div className="vz-segmented">
            {([60, 30] as const).map(item => (
              <button key={item} type="button" aria-pressed={prefs.fps === item} onClick={() => onPrefs({ fps: item })}>{item} fps</button>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="vz-field vz-field-row">
        <span className="vz-field-label" id="vz-playhead-label">{isRu ? 'С позиции курсора' : 'Start from playhead'}</span>
        <button type="button" role="switch" aria-checked={prefs.fromPlayhead} aria-labelledby="vz-playhead-label" className="vz-switch" disabled={exporting} onClick={() => onPrefs({ fromPlayhead: !prefs.fromPlayhead })}>
          <span className="vz-switch-knob" aria-hidden="true" />
        </button>
        <span className="vz-field-hint">{prefs.fromPlayhead ? (isRu ? 'Видео начнётся с текущего места' : 'Video starts where the playhead is') : (isRu ? 'Видео начнётся с начала' : 'Video starts from the top')}</span>
      </div>

      {exporting ? (
        <div className="vz-export-progress">
          {/* Announce only at coarse steps; the percent and ETA below change several times a second and stay silent. */}
          <span role="status" style={SR_ONLY}>
            {preparing ? (isRu ? 'Подготовка' : 'Preparing') : `${isRu ? 'Запись' : 'Recording'} ${Math.floor(percent / 25) * 25}%`}
          </span>
          <div className="vz-export-progress-head">
            <span><i className="ti ti-loader-2 vz-spin" aria-hidden="true" />{preparing ? (isRu ? 'Подготовка…' : 'Preparing…') : <>{isRu ? 'Запись' : 'Recording'} <b>{percent}%</b></>}</span>
            <span>{!preparing && progress?.eta != null && Number.isFinite(progress.eta) ? `${isRu ? 'осталось' : 'left'} ~${formatClock(Math.max(0, progress.eta))}` : `${prefs.resolution.replace('x', '×')} · ${prefs.fps} fps`}</span>
          </div>
          <div className={`vz-progress-bar ${preparing ? 'is-indeterminate' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={preparing ? undefined : percent} aria-label={isRu ? 'Прогресс экспорта' : 'Export progress'}>
            <span style={{ width: `${percent}%` }} />
          </div>
          <button ref={cancelBtnRef} type="button" className="pill-btn pill-btn-ghost vz-export-cancel" onClick={cancel}><i className="ti ti-x" aria-hidden="true" />{isRu ? 'Отменить' : 'Cancel'}</button>
        </div>
      ) : (
        <>
          <button ref={exportBtnRef} type="button" className="vz-export-btn" onClick={() => void run()} disabled={!!blockedReason}>
            <i className="ti ti-movie" aria-hidden="true" />
            <span>{isRu ? 'Экспортировать видео' : 'Export video'}</span>
            <small>{formatClock(seconds)}</small>
          </button>
          <p className="vz-hint">
            {blockedReason || (isRu
              ? `Запись идёт в реальном времени (${formatClock(seconds)}) — не сворачивайте окно до конца.`
              : `Recording runs in real time (${formatClock(seconds)}) — keep the window open until it finishes.`)}
          </p>
        </>
      )}
    </VisualizerSection>
  );
};
