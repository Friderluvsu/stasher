import React, { useEffect, useRef, useState, useCallback, memo } from 'react';
import { api } from '../services/api';
import { audioEngine } from '../services/audioEngine';
import { useInterfaceStore } from '../state/interfaceStore';

interface WaveformPreviewProps {
  soundId: number;
  isPlaying: boolean;
  tag: string;
  onSeek?: (progress: number) => void;
}

// Shared audio context for decoding
let sharedAudioCtx: AudioContext | null = null;
const getAudioCtx = () => {
  if (!sharedAudioCtx) {
    sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return sharedAudioCtx;
};

// Global cache to prevent re-fetching and re-decoding
const peakCache = new Map<number, number[]>();

export const WaveformPreview: React.FC<WaveformPreviewProps> = memo(({
  soundId,
  isPlaying,
  tag,
  onSeek,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(peakCache.get(soundId) || null);
  const [isVisible, setIsVisible] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Drawn in the text colour (read from CSS); the theme is a dependency only to redraw when it flips.
  const theme = useInterfaceStore((state) => state.theme);
  const isRu = useInterfaceStore((state) => state.language) === 'ru';

  // 1. Intersection Observer to only load when visible
  useEffect(() => {
    if (peaks) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '50px' }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [peaks]);

  // 2. Fetch and decode audio
  useEffect(() => {
    if (!isVisible || peaks) return;

    let isMounted = true;
    const loadAudio = async () => {
      try {
        const url = api.getSoundAudioUrl(soundId);
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();

        const ctx = getAudioCtx();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        // Extract peaks (downsample to 80 buckets)
        const numBuckets = 80;
        const channelData = audioBuffer.getChannelData(0);
        const blockSize = Math.floor(channelData.length / numBuckets);
        const extractedPeaks = new Array(numBuckets).fill(0);

        for (let i = 0; i < numBuckets; i++) {
          let min = 1.0;
          let max = -1.0;
          for (let j = 0; j < blockSize; j++) {
            const sample = channelData[i * blockSize + j];
            if (sample < min) min = sample;
            if (sample > max) max = sample;
          }
          extractedPeaks[i] = Math.max(Math.abs(min), Math.abs(max));
        }

        const maxPeak = Math.max(...extractedPeaks, 0.01);
        const normalized = extractedPeaks.map((p) => p / maxPeak);

        if (isMounted) {
          peakCache.set(soundId, normalized);
          setPeaks(normalized);
        }
      } catch (err) {
        console.warn(`Failed to decode waveform for sound ${soundId}:`, err);
        if (isMounted) {
          // A flat line says "no waveform" honestly; random bars looked like real audio.
          const fake = new Array(80).fill(0.06);
          setPeaks(fake);
        }
      }
    };

    loadAudio();
    return () => {
      isMounted = false;
    };
  }, [isVisible, soundId, peaks]);

  // 3. Draw on Canvas
  const renderCanvas = useCallback(
    (progress: number = 0) => {
      const canvas = canvasRef.current;
      if (!canvas || !peaks) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;

      ctx.clearRect(0, 0, width, height);

      const ink = getComputedStyle(canvas).color || '#e6e6e7';
      const barWidth = width / peaks.length;
      const playheadX = isPlaying ? progress * width : 0;

      // Draw background / unplayed waveform
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.32;
      for (let i = 0; i < peaks.length; i++) {
        const x = i * barWidth;
        const h = Math.max(2, peaks[i] * (height / 2 - 2));
        const y = height / 2 - h;
        ctx.fillRect(x, y, Math.max(1, barWidth - 0.5), h * 2);
      }

      // Draw played waveform overlay
      if (isPlaying && progress > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, playheadX, height);
        ctx.clip();

        ctx.globalAlpha = 0.95;
        for (let i = 0; i < peaks.length; i++) {
          const x = i * barWidth;
          const h = Math.max(2, peaks[i] * (height / 2 - 2));
          const y = height / 2 - h;
          ctx.fillRect(x, y, Math.max(1, barWidth - 0.5), h * 2);
        }

        ctx.restore();

        ctx.globalAlpha = 0.9;
        ctx.fillRect(Math.round(playheadX) - 0.5, 0, 1.5, height);
      }

      // Draw Hover Indicator Line
      if (isHovered && hoverX !== null && !isDragging) {
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(hoverX, 0);
        ctx.lineTo(hoverX, height);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [peaks, theme, isPlaying, isHovered, hoverX, isDragging]
  );

  // Setup HiDPI Canvas Scaling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      ctx?.scale(dpr, dpr);
    }

    renderCanvas(0);
  }, [peaks, renderCanvas]);

  // Setup animation loop if playing
  useEffect(() => {
    let animationId: number;
    if (isPlaying && peaks) {
      const tick = () => {
        const progress = audioEngine.getPlaybackProgress('sound', soundId);
        renderCanvas(progress);
        animationId = requestAnimationFrame(tick);
      };
      animationId = requestAnimationFrame(tick);
    } else {
      renderCanvas(0);
    }
    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [isPlaying, soundId, peaks, renderCanvas]);

  const handleSeekAtEvent = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const progress = clickX / rect.width;

      if (onSeek) {
        onSeek(progress);
      } else {
        audioEngine.seekSound(soundId, tag, progress);
      }
    },
    [onSeek, soundId, tag]
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDragging(true);
    handleSeekAtEvent(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    setHoverX(x);

    if (isDragging) {
      handleSeekAtEvent(e.clientX);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setIsHovered(false);
    setHoverX(null);
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  return (
    <div
      ref={containerRef}
      className="wave-preview w-28 h-8"
      title={isRu ? 'Нажмите или ведите, чтобы перемотать' : 'Click or drag to seek'}
    >
      {!peaks ? (
        <div className="w-full h-full rounded-md" style={{ background: 'color-mix(in srgb, var(--text) 4%, transparent)' }} />
      ) : (
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className={`absolute inset-0${isPlaying ? ' is-playing' : ''}`}
          style={{ width: '100%', height: '100%' }}
        />
      )}

      {isHovered && peaks && hoverX !== null && (
        <div className="mini-roll-cue">{Math.round((hoverX / 112) * 100)}%</div>
      )}
    </div>
  );
});
