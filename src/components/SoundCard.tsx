import React, { useState, useRef, memo, useCallback } from 'react';
import type { SoundItem } from '../services/api';
import { api } from '../services/api';
import { useVaultStore } from '../state/vaultStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { WaveformPreview } from './WaveformPreview';
import { EditItemModal } from './EditItemModal';
import { TagPickerPopover } from './TagPickerPopover';
import { KitPickerPopover } from './KitPickerPopover';
import { notify } from '../state/toastStore';
import { dragService } from '../services/dragService';
import { tagIcon } from '../utils/tags';

interface SoundCardProps {
  sound: SoundItem;
}

// Same narrow subscriptions as PatternCard: a row re-renders only when its own state changes.
export const SoundCard: React.FC<SoundCardProps> = memo(({ sound }) => {
  const playSound = useVaultStore((s) => s.playSound);
  const stopPlayback = useVaultStore((s) => s.stopPlayback);
  const updateItemTag = useVaultStore((s) => s.updateItemTag);
  const toggleKitSound = useVaultStore((s) => s.toggleKitSound);
  const toggleSelectSound = useVaultStore((s) => s.toggleSelectSound);
  const isCurrentPlaying = useVaultStore((s) => s.isPlaying && s.currentlyPlayingKind === 'sound' && s.currentlyPlayingId === sound.id);
  const isSelected = useVaultStore((s) => s.selectedSoundIds.includes(sound.id));
  const hasSelection = useVaultStore((s) => s.selectedSoundIds.length > 0);
  const isInKit = useVaultStore((s) => {
    const kit = s.kits.find((k) => k.id === s.activeKitId) || s.kits[0];
    return kit ? kit.sounds.some((x) => x.id === sound.id) : false;
  });
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isKitMenuOpen, setIsKitMenuOpen] = useState(false);
  const [isTagMenuOpen, setIsTagMenuOpen] = useState(false);

  const tagBadgeRef = useRef<HTMLButtonElement>(null);
  const kitButtonRef = useRef<HTMLDivElement>(null);

  const language = useInterfaceStore((state) => state.language);
  const isRu = language === 'ru';

  const closeTagMenu = useCallback(() => setIsTagMenuOpen(false), []);
  const closeKitMenu = useCallback(() => setIsKitMenuOpen(false), []);
  const closeEdit = useCallback(() => setIsEditOpen(false), []);

  const handleTagChange = async (newTag: string) => {
    try {
      await updateItemTag('sound', sound.id, newTag);
      notify.success(isRu ? `Категория: ${newTag}` : `Category: ${newTag}`, 'StashSound');
    } catch {
      notify.error(isRu ? 'Категория не сохранилась. Попробуйте ещё раз.' : 'Category was not saved. Try again.', 'StashSound');
    }
  };

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
    const selected = useVaultStore.getState().selectedSoundIds;
    const ids = isSelected && selected.length > 0 ? selected : [sound.id];
    dragService.startDrag({
      type: 'sound',
      id: sound.id,
      ids,
      tag: sound.tag,
    });

    e.dataTransfer.setData('application/x-stasher-internal', 'true');
    e.dataTransfer.setData('application/x-stasher-item-type', 'sound');
    e.dataTransfer.setData('application/x-stasher-item-id', String(sound.id));
    e.dataTransfer.setData('application/x-stasher-item-ids', JSON.stringify(ids));

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
        tag: sound.tag,
      });
    }
  };

  const handleDragEnd = () => {
    dragService.endDrag();
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={(e) => {
        // Once something is selected, a plain click on the row toggles it: faster than aiming for the checkbox.
        if (hasSelection && !(e.target as HTMLElement).closest('button, a, canvas')) toggleSelectSound(sound.id);
      }}
      className={`group glass-card sound-card p-3 px-4 flex items-center gap-3.5 cursor-grab ${
        isSelected ? 'is-selected' : isCurrentPlaying ? 'is-playing' : ''
      }`}
    >
      {/* Checkbox for batch selection */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleSelectSound(sound.id);
        }}
        className={`row-check${isSelected ? ' is-checked' : ''}`}
        aria-pressed={isSelected}
        title={isSelected ? (isRu ? 'Снять выделение' : 'Deselect') : (isRu ? 'Выбрать' : 'Select')}
      >
        {isSelected && <i className="ti ti-check" aria-hidden="true" />}
      </button>

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
        className={`row-play${isCurrentPlaying ? ' is-active' : ''}`}
        type="button"
        title={isCurrentPlaying ? (isRu ? 'Остановить' : 'Stop') : (isRu ? 'Прослушать' : 'Play')}
      >
        <i className={`ti ${isCurrentPlaying ? 'ti-player-stop' : 'ti-volume'}`} aria-hidden="true" />
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
              className="tag-chip"
              aria-haspopup="dialog"
              aria-expanded={isTagMenuOpen}
              title={isRu ? 'Сменить категорию' : 'Change category'}
            >
              <i className={`ti ${tagIcon(sound.tag)}`} aria-hidden="true" />
              <span>{sound.tag}</span>
              <i className="ti ti-chevron-down tag-chip-caret" aria-hidden="true" />
            </button>

            <TagPickerPopover
              isOpen={isTagMenuOpen}
              onClose={closeTagMenu}
              currentTag={sound.tag}
              anchorEl={tagBadgeRef.current}
              onSelectTag={handleTagChange}
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
      <div className="text-right text-[11px] tabular-nums flex-shrink-0 min-w-[64px]">
        {sound.root_note ? (
          <div className="text-[var(--text)] font-semibold">{sound.root_note}</div>
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
          <div className={`kit-split${isInKit ? ' is-in-kit' : ''}`}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleKitSound(sound);
                if (!isInKit) notify.success(isRu ? `Добавлено в кит` : `Added to kit`, 'Kit Builder');
              }}
              title={isInKit ? (isRu ? 'Удалить из набора' : 'Remove from kit') : (isRu ? 'Добавить в набор' : 'Add to kit')}
              style={{ padding: '0 8px 0 11px' }}
              type="button"
            >
              <i className={`ti ${isInKit ? 'ti-check' : 'ti-plus'} text-[12px]`} aria-hidden="true" />
              <span>{isInKit ? (isRu ? 'В ките' : 'In Kit') : (isRu ? 'Кит' : 'Kit')}</span>
            </button>

            <div className="kit-split-divider" />

            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsKitMenuOpen(!isKitMenuOpen);
              }}
              style={{ padding: '0 8px' }}
              title={isRu ? 'Выбрать набор...' : 'Select kit...'}
              type="button"
            >
              <i className="ti ti-chevron-down text-[10px]" />
            </button>
          </div>

          <KitPickerPopover
            isOpen={isKitMenuOpen}
            onClose={closeKitMenu}
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
          className="row-action"
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
          className="row-action"
          title={isRu ? 'Скачать WAV' : 'Download WAV'}
        >
          <i className="ti ti-download text-[13px]" aria-hidden="true" />
        </a>
      </div>

      <EditItemModal
        isOpen={isEditOpen}
        onClose={closeEdit}
        itemType="sound"
        itemId={sound.id}
        initialName={cleanTitle}
        initialTag={sound.tag}
      />
    </div>
  );
});
