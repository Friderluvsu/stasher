import React, { useEffect, useMemo, useRef } from 'react';
import { getAudioOverview, type AudioAnalysis } from '../../services/audioAnalysis';
import { formatClock } from '../../utils/visualizerScene';
import { VisualizerSection } from './Section';
import { fileExtension, type PlaybackTicker } from './shared';

interface AudioPanelProps {
  isRu: boolean;
  file: File | null;
  analysis: AudioAnalysis | null;
  analysing: boolean;
  locked?: boolean;
  ticker: PlaybackTicker;
  onPick(): void;
  onRemove(): void;
  onSeek(seconds: number): void;
}

const BARS = 120;

export const AudioPanel: React.FC<AudioPanelProps> = ({ isRu, file, analysis, analysing, locked = false, ticker, onPick, onRemove, onSeek }) => {
  const playedRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLSpanElement>(null);
  const peaks = useMemo(() => {
    if (!analysis) return [];
    try {
      return Array.from(getAudioOverview(analysis, BARS), value => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
    } catch {
      return [];
    }
  }, [analysis]);
  const duration = analysis?.durationSeconds || 0;

  useEffect(() => {
    if (!duration) return;
    return ticker.subscribe(seconds => {
      const ratio = ((seconds % duration) + duration) % duration / duration;
      if (playedRef.current) playedRef.current.style.clipPath = `inset(0 ${(100 - ratio * 100).toFixed(2)}% 0 0)`;
      if (headRef.current) headRef.current.style.transform = `translateX(${(ratio * 100).toFixed(2)}%)`;
    });
  }, [ticker, duration]);

  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!duration || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))) * duration);
  };

  const bars = peaks.map((value, index) => {
    const height = Math.max(1.2, value * 30);
    return <rect key={index} x={index + .18} y={(32 - height) / 2} width={.64} height={height} rx={.32} />;
  });

  return (
    <VisualizerSection
      step={4}
      title={isRu ? 'Звук' : 'Audio'}
      meta={analysing ? (isRu ? 'анализ…' : 'analysing…') : file ? fileExtension(file.name) || 'AUDIO' : (isRu ? 'без звука' : 'silent')}
    >
      {!file ? (
        <button type="button" className="vz-dropzone is-compact" onClick={onPick} disabled={locked}>
          <span className="vz-dropzone-icon" aria-hidden="true"><i className="ti ti-headphones" /></span>
          <span className="vz-dropzone-text">
            <strong>{isRu ? 'Добавить аудио бита' : 'Add the beat audio'}</strong>
            <small>MP3 · WAV · M4A · OGG · FLAC</small>
          </span>
          <i className="ti ti-plus vz-dropzone-plus" aria-hidden="true" />
        </button>
      ) : (
        <div className={`vz-audio ${analysing ? 'is-busy' : ''}`}>
          <div className="vz-audio-head">
            <span className="vz-audio-icon" aria-hidden="true"><i className={`ti ${analysing ? 'ti-loader-2 vz-spin' : 'ti-music'}`} /></span>
            <span className="vz-audio-text">
              <strong title={file.name}>{file.name}</strong>
              <small>{analysing ? (isRu ? 'Анализируем частоты…' : 'Analysing frequencies…') : `${formatClock(duration)} · ${(file.size / 1048576).toFixed(1)} MB`}</small>
            </span>
            <button type="button" className="vz-icon-btn" onClick={onPick} disabled={locked} aria-label={isRu ? 'Заменить аудио' : 'Replace audio'} title={isRu ? 'Заменить' : 'Replace'}><i className="ti ti-replace" aria-hidden="true" /></button>
            <button type="button" className="vz-icon-btn" onClick={onRemove} disabled={locked} aria-label={isRu ? 'Убрать аудио' : 'Remove audio'} title={isRu ? 'Убрать' : 'Remove'}><i className="ti ti-trash" aria-hidden="true" /></button>
          </div>
          {analysing ? (
            <div className="vz-wave is-loading" aria-hidden="true" />
          ) : peaks.length > 0 && (
            <div className="vz-wave" onPointerDown={seekFromPointer} title={isRu ? 'Клик — перейти к месту' : 'Click to seek'} aria-hidden="true">
              <svg className="vz-wave-base" viewBox={`0 0 ${BARS} 32`} preserveAspectRatio="none">{bars}</svg>
              <div ref={playedRef} className="vz-wave-played" style={{ clipPath: 'inset(0 100% 0 0)' }}>
                <svg viewBox={`0 0 ${BARS} 32`} preserveAspectRatio="none">{bars}</svg>
              </div>
              <span ref={headRef} className="vz-wave-head"><span /></span>
            </div>
          )}
        </div>
      )}
      <p className="vz-hint">
        {isRu
          ? 'Звук управляет светом и движением, а в видео ложится дорожкой. Без него ролик будет беззвучным.'
          : 'Audio drives light and motion and becomes the soundtrack of the video. Without it the video is silent.'}
      </p>
    </VisualizerSection>
  );
};
