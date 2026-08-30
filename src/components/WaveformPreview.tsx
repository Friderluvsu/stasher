import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../services/api';
import { audioEngine } from '../services/audioEngine';

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

export const WaveformPreview: React.FC<WaveformPreviewProps> = ({
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

  // Determine colors based on tag
  const getTheme = useCallback(() => {
    const t = (tag || '').toLowerCase();
    if (t.includes('808') || t === 'bass') return { played: '#ff6b81', unplayed: 'rgba(255,107,129,0.3)', glow: 'rgba(255,107,129,0.6)' };
    if (t.includes('kick')) return { played: '#ff9f43', unplayed: 'rgba(255,159,67,0.3)', glow: 'rgba(255,159,67,0.6)' };
    if (t.includes('snare') || t.includes('clap') || t.includes('rim')) return { played: '#feca57', unplayed: 'rgba(254,202,87,0.3)', glow: 'rgba(254,202,87,0.6)' };
    if (t.includes('hat') || t.includes('crash')) return { played: '#48dbfb', unplayed: 'rgba(72,219,251,0.3)', glow: 'rgba(72,219,251,0.6)' };
    if (t.includes('chord')) return { played: '#1dd1a1', unplayed: 'rgba(29,209,161,0.3)', glow: 'rgba(29,209,161,0.6)' };
    if (t.includes('melody') || t.includes('lead') || t.includes('pluck')) return { played: '#a55eea', unplayed: 'rgba(165,94,234,0.3)', glow: 'rgba(165,94,234,0.6)' };
    if (t.includes('perc')) return { played: '#54a0ff', unplayed: 'rgba(84,160,255,0.3)', glow: 'rgba(84,160,255,0.6)' };
    return { played: '#9a90ff', unplayed: 'rgba(154,144,255,0.3)', glow: 'rgba(154,144,255,0.6)' };
  }, [tag]);

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
          const fake = new Array(80).fill(0).map(() => Math.random() * 0.5 + 0.1);
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

      const theme = getTheme();
      const barWidth = width / peaks.length;
      const playheadX = isPlaying ? progress * width : 0;

      // Draw background / unplayed waveform
      ctx.fillStyle = theme.unplayed;
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

        ctx.fillStyle = theme.played;
        for (let i = 0; i < peaks.length; i++) {
          const x = i * barWidth;
          const h = Math.max(2, peaks[i] * (height / 2 - 2));
          const y = height / 2 - h;
          ctx.fillRect(x, y, Math.max(1, barWidth - 0.5), h * 2);
        }

        // Subtle gradient glow behind played section
        const grad = ctx.createLinearGradient(0, 0, playheadX, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0.01)');
        grad.addColorStop(1, theme.unplayed);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, playheadX, height);

        ctx.restore();

        // Vertical Playhead Line
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = theme.glow;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, height);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Glowing playhead indicator handle at top
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(playheadX, 2.5, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw Hover Indicator Line
      if (isHovered && hoverX !== null && !isDragging) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(hoverX, 0);
        ctx.lineTo(hoverX, height);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.arc(hoverX, 2.5, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    [peaks, getTheme, isPlaying, isHovered, hoverX, isDragging]
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
        const progress = audioEngine.getPlaybackProgress(soundId);
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
      className="w-28 h-8 flex items-center justify-center relative flex-shrink-0 select-none group"
      title="Click or drag waveform to seek"
    >
      {!peaks ? (
        <div className="flex gap-[2px] w-full h-full items-center opacity-20 px-2">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="flex-1 bg-white/40 h-1/2 rounded-full animate-pulse"
              style={{ animationDelay: `${i * 0.08}s` }}
            />
          ))}
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className={`w-full h-full absolute inset-0 block rounded-lg border transition-all duration-200 cursor-pointer ${
            isPlaying
              ? 'border-[var(--accent)] shadow-[0_0_14px_rgba(154,144,255,0.3)] ring-1 ring-[var(--accent)]'
              : 'border-white/10 hover:border-white/25 hover:shadow-[0_0_8px_rgba(255,255,255,0.06)]'
          }`}
          style={{ width: '100%', height: '100%', background: 'rgba(12, 14, 20, 0.85)' }}
        />
      )}

      {/* Hover seek percentage cue */}
      {isHovered && peaks && (
        <div
          className="absolute -top-5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-[#12141d] text-[var(--accent)] border border-white/10 pointer-events-none shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
        >
          {hoverX !== null ? `Seek ${(hoverX / 112 * 100).toFixed(0)}%` : 'Seek'}
        </div>
      )}
    </div>
  );
};
