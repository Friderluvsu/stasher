import React, { useState, useRef } from 'react';
import type { SoundItem } from '../services/api';
import { api } from '../services/api';
import { useVaultStore } from '../state/vaultStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { WaveformPreview } from './WaveformPreview';
import { EditItemModal } from './EditItemModal';
import { TagPickerPopover } from './TagPickerPopover';
import { KitPickerPopover } from './KitPickerPopover';
import { notify } from '../state/toastStore';

interface SoundCardProps {
  sound: SoundItem;
}

export const SoundCard: React.FC<SoundCardProps> = ({ sound }) => {
  const { playSound, stopPlayback, currentlyPlayingId, isPlaying, updateItemTag } = useVaultStore();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isKitMenuOpen, setIsKitMenuOpen] = useState(false);
  const [isTagMenuOpen, setIsTagMenuOpen] = useState(false);

  const tagBadgeRef = useRef<HTMLButtonElement>(null);
  const kitButtonRef = useRef<HTMLDivElement>(null);

  const { kits, activeKitId, toggleKitSound } = useVaultStore();
  const language = useInterfaceStore((state) => state.language);
  const isRu = language === 'ru';

  const isCurrentPlaying = isPlaying && currentlyPlayingId === sound.id;
  const activeKit = kits.find((k) => k.id === activeKitId) || kits[0];
  const isInKit = activeKit ? activeKit.sounds.some((s) => s.id === sound.id) : false;

  const cleanTitle = (() => {
    const ch = (sound.channel_name || '').trim();
    const isGenericCh = !ch || /^Channel\s*\d+$/i.test(ch) || ch.toLowerCase() === 'sampler';
    if (!isGenericCh) {
      return ch;
    }
    if (sound.sample_name) {
      return sound.sample_name.replace(/\.(wav|mp3|aif|aiff|flac|ogg)$/i, '');
    }
    return ch || 'Sound';
  })();

  const handleDragStart = (e: React.DragEvent) => {
    (window as any).__stasher_is_internal_drag = true;
    e.dataTransfer.setData('application/x-stasher-internal', 'true');
    const audioUrl = api.getSoundAudioUrl(sound.id);
    const fileName = sound.sample_name || `${cleanTitle}.wav`;
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
      return { background: 'rgba(255, 107, 129, 0.16)', color: '#ff6b81', border: '1px solid rgba(255, 107, 129, 0.35)' };
    }
    if (t.includes('kick')) {
      return { background: 'rgba(255, 159, 67, 0.16)', color: '#ff9f43', border: '1px solid rgba(255, 159, 67, 0.35)' };
    }
    if (t.includes('snare') || t.includes('clap') || t.includes('rim')) {
      return { background: 'rgba(254, 202, 87, 0.16)', color: '#feca57', border: '1px solid rgba(254, 202, 87, 0.35)' };
    }
    if (t.includes('hat') || t.includes('crash')) {
      return { background: 'rgba(72, 219, 251, 0.16)', color: '#48dbfb', border: '1px solid rgba(72, 219, 251, 0.35)' };
    }
    if (t.includes('chord')) {
      return { background: 'rgba(113, 200, 159, 0.16)', color: '#71c89f', border: '1px solid rgba(113, 200, 159, 0.35)' };
    }
    if (t.includes('melody') || t.includes('lead') || t.includes('pluck')) {
      return { background: 'rgba(154, 144, 255, 0.18)', color: 'var(--accent)', border: '1px solid rgba(154, 144, 255, 0.4)' };
    }
    if (t.includes('perc')) {
      return { background: 'rgba(84, 160, 255, 0.16)', color: '#54a0ff', border: '1px solid rgba(84, 160, 255, 0.35)' };
    }
    return { background: 'color-mix(in srgb, var(--text) 8%, transparent)', color: 'var(--muted)', border: '1px solid var(--line)' };
  };

  const tagStyle = getTagStyle(sound.tag);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`glass-card spotlight-card sound-card p-3 px-4 flex items-center gap-3.5 cursor-grab ${
        isCurrentPlaying ? 'border-[#9a90ff]/50 shadow-[0_0_24px_rgba(154,144,255,0.18)]' : ''
      }`}
      style={{
        borderRadius: 'var(--radius-card, 20px)',
      }}
    >
      {/* Drag grip handle */}
      <div className="text-[var(--soft)] opacity-40 hover:opacity-100 flex-shrink-0 cursor-grab transition-opacity" title="Drag to DAW">
        <i className="ti ti-grip-vertical text-lg" aria-hidden="true" />
      </div>

      {/* Play / Stop sample button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          isCurrentPlaying ? stopPlayback() : playSound(sound);
        }}
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all cursor-pointer"
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
            {cleanTitle}
          </span>
          
          {/* Interactive Tag Picker Badge */}
          <div className="relative flex-shrink-0">
            <button
              ref={tagBadgeRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsTagMenuOpen(!isTagMenuOpen);
              }}
              className="text-[10px] font-bold px-2.5 py-[3px] rounded-full inline-flex items-center gap-1 hover:brightness-125 transition-all cursor-pointer"
              style={tagStyle}
              title={isRu ? "Нажмите, чтобы сменить тег" : "Click to change tag"}
            >
              <span>{sound.tag}</span>
              <i className="ti ti-chevron-down text-[8px] opacity-70" />
            </button>

            <TagPickerPopover
              isOpen={isTagMenuOpen}
              onClose={() => setIsTagMenuOpen(false)}
              currentTag={sound.tag}
              anchorEl={tagBadgeRef.current}
              onSelectTag={(newTag) => {
                updateItemTag('sound', sound.id, newTag);
                notify.success(isRu ? `Тег изменен на ${newTag}` : `Tag changed to ${newTag}`, 'StashSound');
              }}
            />
          </div>
        </div>
        <div className="text-[11px] text-[var(--muted)] mt-0.5 truncate flex items-center gap-1.5">
          <span className="font-medium text-[var(--text)] opacity-70">
            {sound.sample_name || sound.channel_name}
          </span>
          <span className="opacity-30">•</span>
          <span className="opacity-80">{sound.project_title}</span>
        </div>
      </div>

      {/* Waveform Graphic */}
      <div className="flex-shrink-0">
        <WaveformPreview soundId={sound.id} tag={sound.tag} isPlaying={isCurrentPlaying} />
      </div>

      {/* Metadata */}
      <div className="text-right text-[11px] font-mono flex-shrink-0">
        {sound.root_note ? (
          <div className="text-[var(--accent)] font-semibold">{sound.root_note}</div>
        ) : (
          <div className="text-[var(--text)] font-semibold">{sound.tag}</div>
        )}
        <div className="text-[var(--muted)] text-[10px] mt-0.5">
          {sound.file_exists ? 'Local WAV' : 'Preview'}
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {/* Kit Split Button: Left (+Кит/В ките), Right (⌄ Dropdown) */}
        <div className="relative inline-flex items-center" ref={kitButtonRef}>
          <div
            className={`inline-flex items-center rounded-full border transition-all ${
              isInKit
                ? 'bg-[var(--accent-soft)] border-[rgba(154,144,255,0.4)] shadow-[0_0_12px_rgba(154,144,255,0.2)]'
                : 'bg-transparent border-[var(--line)] hover:border-white/20 hover:bg-white/[0.04]'
            }`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleKitSound(sound);
                if (!isInKit) notify.success(isRu ? `Добавлено в кит` : `Added to kit`, 'Kit Builder');
              }}
              title={isInKit ? (isRu ? 'Удалить из набора' : 'Remove from kit') : (isRu ? 'Добавить в набор' : 'Add to kit')}
              className={`h-[30px] pl-3 pr-2 inline-flex items-center gap-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                isInKit ? 'text-[var(--accent)]' : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
              type="button"
            >
              <i className={`ti ${isInKit ? 'ti-check' : 'ti-plus'} text-[12px]`} aria-hidden="true" />
              <span>{isInKit ? (isRu ? 'В ките' : 'In Kit') : (isRu ? 'Кит' : 'Kit')}</span>
            </button>

            <div className={`w-[1px] h-[14px] ${isInKit ? 'bg-[rgba(154,144,255,0.3)]' : 'bg-[var(--line)]'}`} />

            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsKitMenuOpen(!isKitMenuOpen);
              }}
              className={`h-[30px] px-2 inline-flex items-center justify-center transition-colors cursor-pointer ${
                isInKit ? 'text-[var(--accent)] hover:text-white' : 'text-[var(--muted)] hover:text-[var(--text)]'
              }`}
              title={isRu ? 'Выбрать набор...' : 'Select kit...'}
              type="button"
            >
              <i className="ti ti-chevron-down text-[10px]" />
            </button>
          </div>

          <KitPickerPopover
            isOpen={isKitMenuOpen}
            onClose={() => setIsKitMenuOpen(false)}
            itemId={sound.id}
            itemType="sound"
            anchorEl={kitButtonRef.current}
          />
        </div>

        {/* Edit Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsEditOpen(true);
          }}
          className="w-[30px] h-[30px] rounded-full grid place-items-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/[0.08] transition-colors cursor-pointer border border-transparent hover:border-[var(--line)]"
          title={isRu ? "Редактировать название и тег" : "Edit Name & Tag"}
          type="button"
        >
          <i className="ti ti-pencil text-[13px]" />
        </button>

        {/* Download WAV Button */}
        <a
          href={api.getSoundAudioUrl(sound.id)}
          download={sound.sample_name || `${cleanTitle}.wav`}
          onClick={(e) => e.stopPropagation()}
          className="w-[30px] h-[30px] rounded-full grid place-items-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/[0.08] transition-colors cursor-pointer border border-transparent hover:border-[var(--line)]"
          title={isRu ? 'Скачать WAV' : 'Download WAV'}
        >
          <i className="ti ti-download text-[13px]" aria-hidden="true" />
        </a>
      </div>

      <EditItemModal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        itemType="sound"
        itemId={sound.id}
        initialName={sound.channel_name || sound.sample_name}
        initialTag={sound.tag}
      />
    </div>
  );
};