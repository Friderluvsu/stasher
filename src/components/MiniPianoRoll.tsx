import React, { useEffect, useRef, useState, useCallback, useMemo, memo } from 'react';
import type { NoteEvent } from '../services/api';
import { audioEngine } from '../services/audioEngine';
import { useInterfaceStore } from '../state/interfaceStore';

interface MiniPianoRollProps {
  patternId?: number;
  notes: NoteEvent[];
  tempo?: number;
  ppq?: number;
  tag: string;
  isPlaying?: boolean;
  onSeek?: (progress: number) => void;
}

const WIDTH = 180;
const HEIGHT = 48;

interface NoteRect { x: number; y: number; w: number; h: number; start: number; alpha: number }

// Note geometry depends only on the notes, so it is computed once per pattern, not on every frame or hover.
function layoutNotes(notes: NoteEvent[]): NoteRect[] {
  if (!notes || notes.length === 0) return [];
  let minPitch = Infinity;
  let maxPitch = -Infinity;
  let maxTick = 0;
  for (const n of notes) {
    if (n.pitch < minPitch) minPitch = n.pitch;
    if (n.pitch > maxPitch) maxPitch = n.pitch;
    if (n.pos + n.duration > maxTick) maxTick = n.pos + n.duration;
  }
  minPitch -= 1;
  maxPitch += 1;
  const pitchRange = Math.max(12, maxPitch - minPitch);
  if (maxTick <= 0) maxTick = 384;
  const noteH = Math.max(3, Math.min(8, (HEIGHT - 8) / pitchRange));
  return notes.map((n) => ({
    x: (n.pos / maxTick) * (WIDTH - 6) + 3,
    y: HEIGHT - ((n.pitch - minPitch) / pitchRange) * (HEIGHT - 8) - 6,
    w: Math.max(3, (n.duration / maxTick) * (WIDTH - 6)),
    h: noteH,
    start: n.pos / maxTick,
    alpha: (n.velocity || 100) / 127,
  }));
}

export const MiniPianoRoll: React.FC<MiniPianoRollProps> = memo(({
  patternId,
  notes,
  tempo = 140,
  ppq = 96,
  tag,
  isPlaying = false,
  onSeek,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Redraw when the theme flips: the ink colour is read from CSS.
  const theme = useInterfaceStore((state) => state.theme);
  const isRu = useInterfaceStore((state) => state.language) === 'ru';

  const rects = useMemo(() => layoutNotes(notes), [notes]);

  const handleSeekAtEvent = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const progress = Math.max(0, Math.min(rect.width, clientX - rect.left)) / rect.width;
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
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverX(Math.max(0, Math.min(rect.width, e.clientX - rect.left)) * (WIDTH / rect.width));
    if (isDragging) handleSeekAtEvent(e.clientX);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setHoverX(null);
  };

  const renderCanvas = useCallback(
    (progress: number = 0) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== WIDTH * dpr) {
        canvas.width = WIDTH * dpr;
        canvas.height = HEIGHT * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      const ink = getComputedStyle(canvas).color || '#e6e6e7';

      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.06;
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        const x = Math.round((WIDTH / 8) * i) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, HEIGHT);
        ctx.stroke();
      }

      ctx.fillStyle = ink;
      for (const r of rects) {
        const played = isPlaying && r.start <= progress;
        ctx.globalAlpha = played ? Math.min(1, r.alpha + 0.25) : Math.max(0.28, r.alpha * 0.55);
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, 1.5);
        ctx.fill();
      }

      if (isPlaying && progress > 0) {
        const playheadX = progress * WIDTH;
        ctx.globalAlpha = 0.07;
        ctx.fillRect(0, 0, playheadX, HEIGHT);
        ctx.globalAlpha = 0.9;
        ctx.fillRect(Math.round(playheadX) - 0.5, 0, 1.5, HEIGHT);
      }

      if (hoverX !== null && !isDragging) {
        ctx.globalAlpha = 0.4;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(Math.round(hoverX) + 0.5, 0);
        ctx.lineTo(Math.round(hoverX) + 0.5, HEIGHT);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    },
    // theme is a dependency only to trigger a redraw with the new ink colour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rects, isPlaying, hoverX, isDragging, theme]
  );

  useEffect(() => {
    if (!isPlaying || patternId === undefined) {
      renderCanvas(0);
      return;
    }
    let animationId = 0;
    const tick = () => {
      renderCanvas(audioEngine.getPlaybackProgress('pattern', patternId));
      animationId = requestAnimationFrame(tick);
    };
    animationId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationId);
  }, [isPlaying, patternId, renderCanvas]);

  return (
    <div className="mini-roll" title={isRu ? 'Нажмите или ведите, чтобы перемотать' : 'Click or drag to seek'}>
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        style={{ width: WIDTH, height: HEIGHT }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => setIsDragging(false)}
        onMouseLeave={handleMouseLeave}
        className={`mini-roll-canvas${isPlaying ? ' is-playing' : ''}`}
      />
      {hoverX !== null && <div className="mini-roll-cue">{Math.round((hoverX / WIDTH) * 100)}%</div>}
    </div>
  );
});
