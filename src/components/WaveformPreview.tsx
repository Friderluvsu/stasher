import React, { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';

interface WaveformPreviewProps {
  soundId: number;
  isPlaying: boolean;
  tag: string;
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

export const WaveformPreview: React.FC<WaveformPreviewProps> = ({ soundId, isPlaying, tag }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(peakCache.get(soundId) || null);
  const [isVisible, setIsVisible] = useState(false);

  // Determine colors based on tag
  const getTheme = () => {
    const t = tag.toLowerCase();
    if (t.includes('808') || t === 'bass') return { played: '#f87171', unplayed: 'rgba(248,113,113,0.3)' }; // red-400
    if (t.includes('kick')) return { played: '#fb923c', unplayed: 'rgba(251,146,60,0.3)' }; // orange-400
    if (t.includes('snare') || t.includes('clap') || t.includes('rim')) return { played: '#facc15', unplayed: 'rgba(250,204,21,0.3)' }; // yellow-400
    if (t.includes('hat') || t.includes('crash')) return { played: '#22d3ee', unplayed: 'rgba(34,211,238,0.3)' }; // cyan-400
    if (t.includes('chord')) return { played: '#34d399', unplayed: 'rgba(52,211,153,0.3)' }; // emerald-400
    if (t.includes('melody') || t.includes('lead') || t.includes('pluck')) return { played: '#c084fc', unplayed: 'rgba(192,132,252,0.3)' }; // purple-400
    if (t.includes('perc')) return { played: '#60a5fa', unplayed: 'rgba(96,165,250,0.3)' }; // blue-400
    return { played: '#9ca3af', unplayed: 'rgba(156,163,175,0.3)' }; // gray-400
  };

  // 1. Intersection Observer to only load when visible
  useEffect(() => {
    if (peaks) return; // Already have data

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
        
        // Extract peaks (downsample to 100 bars)
        const numBuckets = 100;
        const channelData = audioBuffer.getChannelData(0); // Left channel
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

        // Normalize
        const maxPeak = Math.max(...extractedPeaks, 0.01);
        const normalized = extractedPeaks.map(p => p / maxPeak);

        if (isMounted) {
          peakCache.set(soundId, normalized);
          setPeaks(normalized);
        }
      } catch (err) {
        console.warn(`Failed to decode waveform for sound ${soundId}:`, err);
        // Fallback fake waveform
        if (isMounted) {
          const fake = new Array(100).fill(0).map(() => Math.random() * 0.5 + 0.1);
          setPeaks(fake);
        }
      }
    };

    loadAudio();
    return () => { isMounted = false; };
  }, [isVisible, soundId, peaks]);

  // 3. Draw on Canvas
  const drawActiveCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    
    const theme = getTheme();
    // In FL studio, waveforms are dense. Let's make bars very thin or just a continuous path.
    // For a 64px wide container, 100 buckets means ~0.6px per bucket. We can just draw lines.
    ctx.clearRect(0, 0, width, height);
    
    // Draw background (unplayed) waveform
    ctx.fillStyle = theme.unplayed;
    const gap = 0;
    const barWidth = width / peaks.length;
    
    ctx.beginPath();
    // Top half
    for (let i = 0; i < peaks.length; i++) {
      const x = i * barWidth;
      const h = Math.max(1, peaks[i] * (height / 2));
      const y = (height / 2) - h;
      ctx.rect(x, y, barWidth, h * 2);
    }
    ctx.fill();

    // Draw active overlay if playing
    if (isPlaying) {
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = theme.played;
      const time = Date.now() / 150;
      ctx.beginPath();
      for (let i = 0; i < peaks.length; i++) {
        const x = i * barWidth;
        const h = Math.max(1, peaks[i] * (height / 2));
        const y = (height / 2) - h;
        // Pulse effect across the waveform
        const wave = (Math.sin(time - i * 0.15) + 1) / 2;
        ctx.globalAlpha = 0.5 + wave * 0.5;
        ctx.rect(x, y, barWidth, h * 2);
      }
      ctx.fill();
      ctx.globalAlpha = 1.0;
      ctx.globalCompositeOperation = 'source-over';
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !peaks) return;

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    
    // Only set width/height if changed to avoid clearing context unnecessarily
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      ctx?.scale(dpr, dpr);
    }

    drawActiveCanvas();
  }, [peaks, isPlaying, tag]);

  // Setup animation loop if playing
  useEffect(() => {
    let animationId: number;
    if (isPlaying && peaks) {
      const render = () => {
        drawActiveCanvas();
        animationId = requestAnimationFrame(render);
      };
      animationId = requestAnimationFrame(render);
    }
    return () => cancelAnimationFrame(animationId);
  }, [isPlaying, peaks]);

  return (
    <div ref={containerRef} className="w-16 h-7 flex items-center justify-center relative flex-shrink-0">
      {!peaks ? (
        // Loading state
        <div className="flex gap-[2px] w-full h-full items-center opacity-20">
          {[1,2,3,4].map(i => (
            <div key={i} className="flex-1 bg-white/40 h-1/3 rounded-full animate-pulse" style={{animationDelay: `${i*0.1}s`}} />
          ))}
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          className="w-full h-full absolute inset-0 block"
          style={{ width: '100%', height: '100%' }}
        />
      )}
    </div>
  );
};
