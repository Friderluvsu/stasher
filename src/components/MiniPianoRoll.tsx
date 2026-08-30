import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { NoteEvent } from '../services/api';
import { audioEngine } from '../services/audioEngine';

interface MiniPianoRollProps {
  patternId?: number;
  notes: NoteEvent[];
  tempo?: number;
  ppq?: number;
  tag: string;
  isPlaying?: boolean;
  onSeek?: (progress: number) => void;
}

export const MiniPianoRoll: React.FC<MiniPianoRollProps> = ({
  patternId,
  notes,
  tempo = 140,
  ppq = 96,
  tag,
  isPlaying = false,
  onSeek,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Compute note color based on tag
  const getNoteColor = () => {
    const tagLower = (tag || '').toLowerCase();
    if (tagLower.includes('808') || tagLower.includes('bass')) return '#ff6b81';
    if (tagLower.includes('kick')) return '#ff9f43';
    if (tagLower.includes('snare') || tagLower.includes('clap') || tagLower.includes('rim')) return '#feca57';
    if (tagLower.includes('hat') || tagLower.includes('perc')) return '#48dbfb';
    if (tagLower.includes('chord')) return '#1dd1a1';
    if (tagLower.includes('melody') || tagLower.includes('lead') || tagLower.includes('pluck')) return '#a55eea';
    return '#9a90ff';
  };

  const handleSeekAtEvent = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const progress = clickX / rect.width;

      if (onSeek) {
        onSeek(progress);
      } else if (patternId !== undefined) {
        audioEngine.seekPattern(patternId, notes, tempo, ppq, tag, progress, true);
      }
    },
    [onSeek, patternId, notes, tempo, ppq, tag]
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

  // Drawing function
  const renderCanvas = useCallback(
    (progress: number = 0) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      // Background
      ctx.fillStyle = 'rgba(12, 14, 20, 0.85)';
      ctx.fillRect(0, 0, width, height);

      // Grid lines (8 divisions)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += width / 8) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      if (!notes || notes.length === 0) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Empty Pattern', width / 2, height / 2 + 3);
        return;
      }

      const pitches = notes.map((n) => n.pitch);
      const minPitch = Math.min(...pitches) - 1;
      const maxPitch = Math.max(...pitches) + 1;
      const pitchRange = Math.max(12, maxPitch - minPitch);

      let maxTick = Math.max(...notes.map((n) => n.pos + n.duration));
      if (maxTick <= 0) maxTick = 384;

      const noteColor = getNoteColor();

      // Render notes
      notes.forEach((n) => {
        const x = (n.pos / maxTick) * (width - 6) + 3;
        const noteW = Math.max(3, (n.duration / maxTick) * (width - 6));
        const normalizedPitch = (n.pitch - minPitch) / pitchRange;
        const y = height - normalizedPitch * (height - 8) - 6;
        const noteH = Math.max(3, Math.min(8, (height - 8) / pitchRange));

        const velocity = (n.velocity || 100) / 127;
        const isNotePlayed = isPlaying && (n.pos / maxTick) <= progress;

        ctx.fillStyle = noteColor;
        ctx.globalAlpha = isNotePlayed ? Math.min(1.0, velocity + 0.3) : Math.max(0.35, velocity * 0.7);

        ctx.beginPath();
        ctx.roundRect(x, y, noteW, noteH, 2);
        ctx.fill();

        if (isNotePlayed) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      });

      ctx.globalAlpha = 1.0;

      // Draw Played Progress Overlay
      if (isPlaying && progress > 0) {
        const playheadX = progress * width;

        // Subtle gradient highlight for played area
        const grad = ctx.createLinearGradient(0, 0, playheadX, 0);
        grad.addColorStop(0, 'rgba(154, 144, 255, 0.02)');
        grad.addColorStop(1, 'rgba(154, 144, 255, 0.14)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, playheadX, height);

        // Vertical Playhead Line
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = noteColor;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, height);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Glowing playhead indicator handle at top
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(playheadX, 3, 2.5, 0, Math.PI * 2);
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

        // Hover marker
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.beginPath();
        ctx.arc(hoverX, 3, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    [notes, tag, isPlaying, isHovered, hoverX, isDragging]
  );

  // Animation Loop for real-time playhead
  useEffect(() => {
    let animationId: number;

    const tick = () => {
      if (isPlaying && patternId !== undefined) {
        const progress = audioEngine.getPlaybackProgress(patternId);
        renderCanvas(progress);
        animationId = requestAnimationFrame(tick);
      } else {
        renderCanvas(0);
      }
    };

    if (isPlaying) {
      animationId = requestAnimationFrame(tick);
    } else {
      renderCanvas(0);
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [isPlaying, patternId, renderCanvas]);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center select-none group"
      title="Click or drag timeline to seek"
    >
      <canvas
        ref={canvasRef}
        width={180}
        height={48}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`rounded-lg border transition-all duration-200 cursor-pointer ${
          isPlaying
            ? 'border-[var(--accent)] shadow-[0_0_16px_rgba(154,144,255,0.3)] ring-1 ring-[var(--accent)]'
            : 'border-white/10 hover:border-white/25 hover:shadow-[0_0_10px_rgba(255,255,255,0.06)]'
        }`}
      />

      {/* Hover seek cue */}
      {isHovered && (
        <div
          className="absolute -top-5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-[#12141d] text-[var(--accent)] border border-white/10 pointer-events-none shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
        >
          {hoverX !== null ? `Seek ${(hoverX / 180 * 100).toFixed(0)}%` : 'Seek'}
        </div>
      )}
    </div>
  );
};
