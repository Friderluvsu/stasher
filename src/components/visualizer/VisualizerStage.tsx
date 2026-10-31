import React, { useEffect, useMemo, useRef } from 'react';
import { formatClock, positionLabel, type VisualizerScene } from '../../utils/visualizerScene';
import { barsWord, type Arrangement, type PlaybackTicker } from './shared';

const SEEK_STEPS = 10000;
export type StageStatus = 'demo' | 'scene' | 'audio';

interface VisualizerStageProps {
  isRu: boolean;
  stageRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  canvasSize: [number, number];
  ticker: PlaybackTicker;
  status: StageStatus;
  scene: VisualizerScene | null;
  visualSeconds: number;
  timelineSeconds: number;
  overview: Float32Array | null;
  playing: boolean;
  canPlay: boolean;
  analysing: boolean;
  exporting: boolean;
  fullscreen: boolean;
  arrangement: Arrangement;
  songAvailable: boolean;
  songBlocked: boolean;
  modeName: string;
  onTogglePlay(): void;
  onSeek(seconds: number): void;
  onArrangement(value: Arrangement): void;
  onToggleFullscreen(): void;
  onOpenFiles(): void;
  onOpenAudio(): void;
}

const setText = (element: HTMLElement | null, text: string) => {
  if (element && element.textContent !== text) element.textContent = text;
};

export const VisualizerStage: React.FC<VisualizerStageProps> = ({
  isRu, stageRef, canvasRef, canvasSize, ticker, status, scene, visualSeconds, timelineSeconds, overview, playing, canPlay, analysing, exporting,
  fullscreen, arrangement, songAvailable, songBlocked, modeName, onTogglePlay, onSeek, onArrangement, onToggleFullscreen, onOpenFiles, onOpenAudio,
}) => {
  const seekWrapRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const positionRef = useRef<HTMLElement>(null);
  const scrubbingRef = useRef(false);

  const markers = useMemo(() => {
    if (!scene?.markers?.length || timelineSeconds <= 0 || visualSeconds <= 0) return [];
    const result: number[] = [];
    for (const marker of [...scene.markers].sort((a, b) => a - b)) {
      const x = marker * visualSeconds / timelineSeconds;
      if (x <= .003 || x >= .997 || (result.length && x - result[result.length - 1] < .008)) continue;
      result.push(x);
    }
    return result;
  }, [scene, visualSeconds, timelineSeconds]);

  const overviewBars = useMemo(() => overview ? Array.from(overview, (value, index) => {
    const height = 3 + Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 21;
    return <rect key={index} x={index + .2} y={(24 - height) / 2} width={.6} height={height} rx={.3} />;
  }) : null, [overview]);

  useEffect(() => ticker.subscribe(seconds => {
    const ratio = timelineSeconds > 0 ? Math.min(1, Math.max(0, seconds / timelineSeconds)) : 0;
    seekWrapRef.current?.style.setProperty('--vz-progress', ratio.toFixed(5));
    const clock = formatClock(seconds);
    setText(timeRef.current, clock);
    const seek = seekRef.current;
    if (seek) {
      if (!scrubbingRef.current) seek.value = String(Math.round(ratio * SEEK_STEPS));
      const valueText = `${clock} / ${formatClock(timelineSeconds)}`;
      if (seek.getAttribute('aria-valuetext') !== valueText) seek.setAttribute('aria-valuetext', valueText);
    }
    if (scene && visualSeconds > 0) {
      const label = positionLabel(scene, (seconds % visualSeconds) / visualSeconds);
      setText(positionRef.current, `${label.bar}.${label.beat}`);
    } else setText(positionRef.current, '—');
  }), [ticker, timelineSeconds, scene, visualSeconds]);

  const statusLabel = status === 'demo' ? (isRu ? 'Демо' : 'Demo') : status === 'audio' ? (isRu ? 'Аудио' : 'Audio') : scene?.kind === 'song' ? (isRu ? 'Песня' : 'Song') : (isRu ? 'Луп' : 'Loop');
  const bars = scene ? Math.max(1, Math.round(scene.bars)) : 0;
  const barsLabel = bars ? `${bars} ${barsWord(bars, isRu)}` : '';
  const endScrub = () => { scrubbingRef.current = false; };

  return (
    <div ref={stageRef} className={`vz-stage ${fullscreen ? 'is-fullscreen' : ''}`} aria-label={isRu ? 'Сцена визуализатора' : 'Visualizer stage'} role="region">
      <div className="vz-stage-bar">
        <span className={`vz-live ${playing ? 'is-live' : ''}`}><span className="vz-live-dot" aria-hidden="true" />{statusLabel}</span>
        {barsLabel && <span className="vz-stage-chip">{barsLabel}</span>}
        <span className="vz-stage-chip vz-stage-chip-look" title={modeName}>{modeName}</span>
        {analysing && <span className="vz-stage-chip is-busy"><i className="ti ti-loader-2 vz-spin" aria-hidden="true" />{isRu ? 'Анализ' : 'Analysing'}</span>}
        {exporting && <span className="vz-stage-chip is-rec"><span className="vz-rec-dot" aria-hidden="true" />REC</span>}
        <span className="vz-stage-ratio" aria-hidden="true">9:16</span>
        <button type="button" className="vz-stage-icon" onClick={onToggleFullscreen} aria-pressed={fullscreen} aria-label={fullscreen ? (isRu ? 'Выйти из полноэкранного режима' : 'Exit fullscreen') : (isRu ? 'Во весь экран' : 'Fullscreen')} title={`${fullscreen ? (isRu ? 'Свернуть' : 'Exit fullscreen') : (isRu ? 'Во весь экран' : 'Fullscreen')} · F`}>
          <i className={`ti ${fullscreen ? 'ti-minimize' : 'ti-maximize'}`} aria-hidden="true" />
        </button>
      </div>

      <div className={`vz-canvas-frame ${canPlay ? 'is-interactive' : ''}`}>
        <canvas ref={canvasRef} width={canvasSize[0]} height={canvasSize[1]} className="vz-canvas" role="img" aria-label={`${isRu ? 'Визуализация' : 'Visual'}: ${modeName}`} onClick={canPlay ? onTogglePlay : undefined} />
        {status === 'demo' && (
          <div className="vz-attract">
            <div className="vz-attract-card">
              <span className="vz-attract-icon" aria-hidden="true"><i className="ti ti-music-plus" /></span>
              <strong>{isRu ? 'Перетащите FLP, MIDI или аудио' : 'Drop an FLP, MIDI or audio file'}</strong>
              <span>{isRu ? 'Или отметьте партии из хранилища. Сейчас играет демо-сцена.' : 'Or tick parts from your vault. A demo scene is playing now.'}</span>
              <div className="vz-attract-actions">
                <button type="button" className="vz-cta" onClick={onOpenFiles}><i className="ti ti-upload" aria-hidden="true" />{isRu ? 'Открыть файлы' : 'Open files'}</button>
                <button type="button" className="vz-cta is-ghost" onClick={onOpenAudio}><i className="ti ti-headphones" aria-hidden="true" />{isRu ? 'Аудио' : 'Audio'}</button>
              </div>
            </div>
          </div>
        )}
        {analysing && status !== 'scene' && (
          <div className="vz-canvas-busy" role="status"><i className="ti ti-loader-2 vz-spin" aria-hidden="true" />{isRu ? 'Анализируем частоты…' : 'Analysing frequencies…'}</div>
        )}
        {!playing && canPlay && <span className="vz-canvas-hint" aria-hidden="true"><i className="ti ti-player-play" /></span>}
      </div>

      <div className="vz-transport">
        <div ref={seekWrapRef} className={`vz-seek ${canPlay ? '' : 'is-disabled'} ${overviewBars ? 'has-overview' : ''}`}>
          <div className="vz-seek-track" aria-hidden="true">
            {overviewBars ? (
              <>
                <svg className="vz-seek-wave" viewBox={`0 0 ${overviewBars.length} 24`} preserveAspectRatio="none">{overviewBars}</svg>
                <svg className="vz-seek-wave is-played" viewBox={`0 0 ${overviewBars.length} 24`} preserveAspectRatio="none">{overviewBars}</svg>
              </>
            ) : <span className="vz-seek-fill" />}
            {markers.map(x => <span key={x} className="vz-seek-marker" style={{ left: `${x * 100}%` }} />)}
          </div>
          <input
            ref={seekRef}
            className="vz-seek-input"
            type="range"
            min={0}
            max={SEEK_STEPS}
            step={1}
            defaultValue={0}
            disabled={!canPlay}
            aria-label={isRu ? 'Позиция воспроизведения' : 'Playback position'}
            onPointerDown={() => { scrubbingRef.current = true; }}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
            onBlur={endScrub}
            onChange={event => onSeek(Number(event.target.value) / SEEK_STEPS * timelineSeconds)}
          />
        </div>
        <div className="vz-transport-row">
          <button type="button" className="vz-play" onClick={onTogglePlay} disabled={!canPlay} aria-label={playing ? (isRu ? 'Пауза' : 'Pause') : (isRu ? 'Воспроизвести' : 'Play')} title={`${playing ? (isRu ? 'Пауза' : 'Pause') : (isRu ? 'Играть' : 'Play')} · Space`}>
            <i className={`ti ${playing ? 'ti-player-pause' : 'ti-player-play'}`} aria-hidden="true" />
          </button>
          <div className="vz-readout">
            <span className="vz-time"><span ref={timeRef}>0:00</span><span className="vz-time-total"> / {formatClock(timelineSeconds)}</span></span>
            <span className="vz-readout-sub">
              <span title={isRu ? 'Такт.доля' : 'Bar.beat'}>{isRu ? 'Такт' : 'Bar'} <b ref={positionRef}>—</b></span>
              {scene && <span><b>{Math.round(scene.tempo)}</b> BPM</span>}
            </span>
          </div>
          {(songAvailable || songBlocked) && (
            <div className="vz-segmented is-dark" role="group" aria-label={isRu ? 'Режим аранжировки' : 'Arrangement mode'}>
              <button type="button" aria-pressed={arrangement === 'loop'} onClick={() => onArrangement('loop')} title={isRu ? 'Выбранные партии играют вместе по кругу' : 'Selected parts play together in a loop'}>
                <i className="ti ti-repeat" aria-hidden="true" />{isRu ? 'Луп' : 'Loop'}
              </button>
              <button type="button" aria-pressed={arrangement === 'song'} disabled={!songAvailable} onClick={() => onArrangement('song')} title={songAvailable ? (isRu ? 'Партии идут по плейлисту FL Studio' : 'Parts follow the FL Studio playlist') : (isRu ? 'Песня доступна для партий одного FLP' : 'Song mode needs parts from one FLP')}>
                <i className="ti ti-timeline" aria-hidden="true" />{isRu ? 'Песня' : 'Song'}
              </button>
            </div>
          )}
        </div>
        <p className="vz-shortcuts">
          <span><kbd>Space</kbd>{isRu ? 'пуск' : 'play'}</span>
          <span><kbd>←</kbd><kbd>→</kbd>{isRu ? 'такт' : 'bar'}</span>
          <span><kbd>[</kbd><kbd>]</kbd>{isRu ? 'стиль' : 'look'}</span>
          <span><kbd>F</kbd>{isRu ? 'экран' : 'fullscreen'}</span>
        </p>
      </div>
    </div>
  );
};
