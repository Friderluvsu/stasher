import React, { useEffect, useRef } from 'react';
import type { NoteEvent } from '../services/api';

interface MiniPianoRollProps {
  notes: NoteEvent[];
  tag: string;
  isPlaying?: boolean;
}

export const MiniPianoRoll: React.FC<MiniPianoRollProps> = ({ notes, tag, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Subtle dark background
    ctx.fillStyle = 'rgba(12, 14, 20, 0.7)';
    ctx.fillRect(0, 0, width, height);

    // Subtle grid lines (4 beats / bars)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += width / 8) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    if (!notes || notes.length === 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
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

    // Tag based note colors
    let noteColor = '#9a90ff'; // Default Purple
    const tagLower = tag.toLowerCase();
    if (tagLower.includes('808') || tagLower.includes('bass')) noteColor = '#ff6b81'; // Red / Coral
    else if (tagLower.includes('kick')) noteColor = '#ff9f43'; // Orange
    else if (tagLower.includes('snare') || tagLower.includes('clap') || tagLower.includes('rim')) noteColor = '#feca57'; // Yellow
    else if (tagLower.includes('hat') || tagLower.includes('perc')) noteColor = '#48dbfb'; // Cyan
    else if (tagLower.includes('chord')) noteColor = '#1dd1a1'; // Emerald
    else if (tagLower.includes('melody') || tagLower.includes('lead')) noteColor = '#a55eea'; // Purple

    // Render notes
    notes.forEach((n) => {
      const x = (n.pos / maxTick) * (width - 6) + 3;
      const noteW = Math.max(3, (n.duration / maxTick) * (width - 6));
      
      // Flip Y axis so higher pitches are at top
      const normalizedPitch = (n.pitch - minPitch) / pitchRange;
      const y = height - normalizedPitch * (height - 8) - 6;
      const noteH = Math.max(3, Math.min(8, (height - 8) / pitchRange));

      const velocity = (n.velocity || 100) / 127;
      ctx.fillStyle = noteColor;
      ctx.globalAlpha = Math.max(0.4, velocity);

      // Draw rounded note block
      ctx.beginPath();
      ctx.roundRect(x, y, noteW, noteH, 2);
      ctx.fill();

      // Active glow if currently playing
      if (isPlaying) {
        ctx.shadowColor = noteColor;
        ctx.shadowBlur = 6;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    });

    ctx.globalAlpha = 1.0;
  }, [notes, tag, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      width={160}
      height={48}
      className={`rounded-lg border border-white/5 transition-all duration-200 ${
        isPlaying ? 'ring-1 ring-[var(--accent)] shadow-[0_0_12px_rgba(154,144,255,0.25)]' : ''
      }`}
    />
  );
};
