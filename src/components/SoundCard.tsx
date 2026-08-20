import React from 'react';
import type { SoundItem } from '../services/api';
import { api } from '../services/api';
import { useVaultStore } from '../state/vaultStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { WaveformPreview } from './WaveformPreview';
import { notify } from '../state/toastStore';

interface SoundCardProps {
  sound: SoundItem;
}

export const SoundCard: React.FC<SoundCardProps> = ({ sound }) => {
  const { playSound, stopPlayback, currentlyPlayingId, isPlaying, kitSounds, toggleKitSound } = useVaultStore();
  const language = useInterfaceStore((state) => state.language);
  const isRu = language === 'ru';

  const isCurrentPlaying = isPlaying && currentlyPlayingId === sound.id;
  const isInKit = kitSounds.some((s) => s.id === sound.id);

  const handleDragStart = (e: React.DragEvent) => {
    (window as any).__stasher_is_internal_drag = true;
    e.dataTransfer.setData('application/x-stasher-internal', 'true');
    const audioUrl = api.getSoundAudioUrl(sound.id);
    const fileName = sound.sample_name || `sound_${sound.id}.wav`;
    e.dataTransfer.setData('DownloadURL', `audio/wav:${fileName}:${audioUrl}`);
    e.dataTransfer.setData('text/plain', audioUrl);

    if ((window as any).electronAPI?.startDrag) {
      e.preventDefault();
      (window as any).electronAPI.startDrag({
        type: 'sound',
        id: sound.id,
        fileName,
        samplePath: sound.sample_path,
      });
    }
  };

  const handleDragEnd = () => {
    (window as any).__stasher_is_internal_drag = false;
  };

  const getTagStyle = (tag: string) => {
    const t = tag.toLowerCase();
    if (t.includes('808') || t === 'bass') {
      return { background: 'rgba(255, 107, 129, 0.14)', color: '#ff6b81', border: '1px solid rgba(255, 107, 129, 0.3)' };
    }
    if (t.includes('kick')) {
      return { background: 'rgba(255, 159, 67, 0.14)', color: '#ff9f43', border: '1px solid rgba(255, 159, 67, 0.3)' };
    }
    if (t.includes('snare') || t.includes('clap') || t.includes('rim')) {
      return { background: 'rgba(254, 202, 87, 0.14)', color: '#feca57', border: '1px solid rgba(254, 202, 87, 0.3)' };
    }
    if (t.includes('hat') || t.includes('crash')) {
      return { background: 'rgba(72, 219, 251, 0.14)', color: '#48dbfb', border: '1px solid rgba(72, 219, 251, 0.3)' };
    }
    if (t.includes('chord')) {
      return { background: 'rgba(113, 200, 159, 0.14)', color: '#71c89f', border: '1px solid rgba(113, 200, 159, 0.3)' };
    }
    if (t.includes('melody') || t.includes('lead') || t.includes('pluck')) {
      return { background: 'rgba(154, 144, 255, 0.16)', color: 'var(--accent)', border: '1px solid rgba(154, 144, 255, 0.35)' };
    }
    if (t.includes('perc')) {
      return { background: 'rgba(84, 160, 255, 0.14)', color: '#54a0ff', border: '1px solid rgba(84, 160, 255, 0.3)' };
    }
    return { background: 'color-mix(in srgb, var(--text) 8%, transparent)', color: 'var(--muted)', border: '1px solid var(--line)' };
  };

  const tagStyle = getTagStyle(sound.tag);

  const handleKitToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleKitSound(sound);
    if (!isInKit) {
      notify.success(
        isRu ? `Семпл "${sound.sample_name || sound.channel_name}" добавлен в кит` : `Sample "${sound.sample_name || sound.channel_name}" added to kit`,
        'Kit Builder'
      );
    }
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`glass-card spotlight-card sound-card p-3 px-4 flex items-center gap-3.5 cursor-grab ${
        isCurrentPlaying ? 'border-[#9a90ff]/50 shadow-[0_0_24px_rgba(154,144,255,0.18)]' : ''
      }`}
      style={{
        borderRadius: 'var(--verse-card-radius, 20px)',
      }}
    >
      {/* Drag grip handle */}
      <div className="text-[var(--soft)] opacity-40 hover:opacity-100 flex-shrink-0 cursor-grab transition-opacity" title="Drag to DAW">
        <i className="ti ti-grip-vertical text-lg" aria-hidden="true" />
      </div>

      {/* Play / Stop sample button with working Tabler icons */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          isCurrentPlaying ? stopPlayback() : playSound(sound);
        }}
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
        style={{
          background: isCurrentPlaying ? 'var(--accent)' : 'color-mix(in srgb, var(--text) 8%, transparent)',
          color: isCurrentPlaying ? '#0b0d13' : 'var(--text)',
          boxShadow: isCurrentPlaying ? '0 0 16px rgba(154,144,255,0.45)' : 'none',
        }}
        type="button"
        title={isCurrentPlaying ? 'Stop playback' : 'Play audio sample'}
      >
        <i
          className={`ti ${isCurrentPlaying ? 'ti-player-stop' : 'ti-volume'}`}
          style={{ fontSize: 16 }}
          aria-hidden="true"
        />
      </button>

      {/* Sample Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[var(--text)] truncate">
            {sound.sample_name || sound.channel_name}
          </span>
          <span
            className="text-[10px] font-bold px-2 py-[2px] rounded-full flex-shrink-0"
            style={tagStyle}
          >
            {sound.tag}
          </span>
        </div>
        <div className="text-[11px] text-[var(--muted)] mt-0.5 truncate">
          <span>{sound.channel_name}</span>
          <span className="opacity-40 mx-1.5">•</span>
          <span className="opacity-80">{sound.project_title}</span>
        </div>
      </div>

      {/* Preview Graphic (Waveform) */}
      <div className="flex-shrink-0">
        <WaveformPreview soundId={sound.id} tag={sound.tag} isPlaying={isCurrentPlaying} />
      </div>

      {/* Metadata */}
      <div className="text-right text-[11px] font-mono flex-shrink-0">
        <div className="text-[var(--text)] font-semibold">
          {sound.file_size ? `${Math.round(sound.file_size / 1024)} KB` : 'One-Shot'}
        </div>
        <div className="text-[var(--muted)] text-[10px] mt-0.5">
          {sound.project_tempo ? `${sound.project_tempo} BPM` : 'Sample'}
        </div>
      </div>

      {/* Add to Custom Sound Kit Button */}
      <button
        onClick={handleKitToggle}
        title={isInKit ? (isRu ? 'Удалить из набора' : 'Remove from kit') : (isRu ? 'Добавить в набор' : 'Add to kit')}
        className={`h-[32px] px-3 rounded-full inline-flex items-center gap-1.5 flex-shrink-0 text-[11px] font-semibold transition-all ${
          isInKit
            ? 'bg-[var(--accent-soft)] text-[var(--accent)] border border-[rgba(154,144,255,0.4)]'
            : 'bg-transparent text-[var(--muted)] border border-[var(--line)] hover:text-[var(--text)] hover:border-white/20'
        }`}
        type="button"
      >
        <i className={`ti ${isInKit ? 'ti-check' : 'ti-plus'} text-[13px]`} aria-hidden="true" />
        <span>{isInKit ? (isRu ? 'В ките' : 'In Kit') : (isRu ? 'Кит' : 'Kit')}</span>
      </button>

      {/* Direct audio download */}
      <a
        href={api.getSoundAudioUrl(sound.id)}
        download={sound.sample_name || `sound_${sound.id}.wav`}
        onClick={(e) => e.stopPropagation()}
        className="w-[32px] h-[32px] rounded-full grid place-items-center flex-shrink-0 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-strong)] transition-colors"
        title={isRu ? 'Скачать WAV' : 'Download WAV'}
      >
        <i className="ti ti-download text-[15px]" aria-hidden="true" />
      </a>
    </div>
  );
};
