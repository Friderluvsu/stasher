import React, { useState, useRef, memo, useCallback } from 'react';
import type { PatternItem } from '../services/api';
import { api } from '../services/api';
import { useVaultStore } from '../state/vaultStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { MiniPianoRoll } from './MiniPianoRoll';
import { EditItemModal } from './EditItemModal';
import { TagPickerPopover } from './TagPickerPopover';
import { KitPickerPopover } from './KitPickerPopover';
import { notify } from '../state/toastStore';
import { generateMidiBase64 } from '../utils/midiBuilder';
import { tagIcon } from '../utils/tags';

import { dragService } from '../services/dragService';

interface PatternCardProps {
  pattern: PatternItem;
}

function getBarsLabel(bars: number, isRu: boolean): string {
  if (!isRu) return `${bars} ${bars === 1 ? 'bar' : 'bars'}`;
  if (bars === 1) return '1 такт';
  if (bars >= 2 && bars <= 4) return `${bars} такта`;
  return `${bars} тактов`;
}

// Rows subscribe to the few store fields they render, so playback, selection or scan progress
// elsewhere does not re-render (and redraw the piano roll of) every row in the list.
export const PatternCard: React.FC<PatternCardProps> = memo(({ pattern }) => {
  const playPattern = useVaultStore((s) => s.playPattern);
  const stopPlayback = useVaultStore((s) => s.stopPlayback);
  const updateItemTag = useVaultStore((s) => s.updateItemTag);
  const toggleKitPattern = useVaultStore((s) => s.toggleKitPattern);
  const toggleSelectPattern = useVaultStore((s) => s.toggleSelectPattern);
  const isCurrentPlaying = useVaultStore((s) => s.isPlaying && s.currentlyPlayingKind === 'pattern' && s.currentlyPlayingId === pattern.id);
  const isSelected = useVaultStore((s) => s.selectedPatternIds.includes(pattern.id));
  const hasSelection = useVaultStore((s) => s.selectedPatternIds.length > 0);
  const isInKit = useVaultStore((s) => {
    const kit = s.kits.find((k) => k.id === s.activeKitId) || s.kits[0];
    return kit ? kit.patterns.some((p) => p.id === pattern.id) : false;
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
      await updateItemTag('pattern', pattern.id, newTag);
      notify.success(isRu ? `Категория: ${newTag}` : `Category: ${newTag}`, 'MIDI Vault');
    } catch {
      notify.error(isRu ? 'Категория не сохранилась. Попробуйте ещё раз.' : 'Category was not saved. Try again.', 'MIDI Vault');
    }
  };

  const handleDragStart = (e: React.DragEvent) => {
    const selected = useVaultStore.getState().selectedPatternIds;
    const ids = isSelected && selected.length > 0 ? selected : [pattern.id];
    dragService.startDrag({
      type: 'pattern',
      id: pattern.id,
      ids,
      tag: pattern.tag,
    });

    e.dataTransfer.setData('application/x-stasher-internal', 'true');
    e.dataTransfer.setData('application/x-stasher-item-type', 'pattern');
    e.dataTransfer.setData('application/x-stasher-item-id', String(pattern.id));
    e.dataTransfer.setData('application/x-stasher-item-ids', JSON.stringify(ids));

    const fileName = `${(pattern.pattern_name || 'pattern').replace(/[^a-zA-Z0-9_-]/g, '_')}_${pattern.tag}.mid`;
    const midiUrl = api.getMidiUrl(pattern.id);
    e.dataTransfer.setData('DownloadURL', `audio/midi:${fileName}:${midiUrl}`);
    e.dataTransfer.setData('text/plain', midiUrl);

    if ((window as any).electronAPI?.startDrag) {
      e.preventDefault();
      try {
        const base64Data = generateMidiBase64(
          pattern.notes || [],
          pattern.tempo || 140,
          pattern.ppq || 96,
          pattern.pattern_name || 'Pattern'
        );
        (window as any).electronAPI.startDrag({
          type: 'midi',
          patternId: pattern.id,
          fileName,
          base64Data,
        });
      } catch (err) {
        console.error('generateMidiBase64 error:', err);
      }
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
        if (hasSelection && !(e.target as HTMLElement).closest('button, a, canvas')) toggleSelectPattern(pattern.id);
      }}
      className={`group glass-card pattern-card p-3 px-4 flex items-center gap-3.5 cursor-grab ${
        isSelected ? 'is-selected' : isCurrentPlaying ? 'is-playing' : ''
      }`}
    >
      {/* Checkbox for batch selection */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleSelectPattern(pattern.id);
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

      {/* Play/Stop Button with working Tabler icons */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          isCurrentPlaying ? stopPlayback() : playPattern(pattern);
        }}
        className={`row-play${isCurrentPlaying ? ' is-active' : ''}`}
        type="button"
        title={isCurrentPlaying ? (isRu ? 'Остановить' : 'Stop') : (isRu ? 'Прослушать' : 'Play')}
      >
        <i
          className={`ti ${isCurrentPlaying ? 'ti-player-stop' : 'ti-player-play'}`}
          style={{ marginLeft: isCurrentPlaying ? 0 : 2 }}
          aria-hidden="true"
        />
      </button>

      {/* Pattern Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[var(--text)] truncate">
            {pattern.pattern_name}
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
              <i className={`ti ${tagIcon(pattern.tag)}`} aria-hidden="true" />
              <span>{pattern.tag}</span>
              <i className="ti ti-chevron-down tag-chip-caret" aria-hidden="true" />
            </button>

            <TagPickerPopover
              isOpen={isTagMenuOpen}
              onClose={closeTagMenu}
              currentTag={pattern.tag}
              anchorEl={tagBadgeRef.current}
              onSelectTag={handleTagChange}
            />
          </div>
        </div>
        <div className="text-[11px] text-[var(--muted)] mt-0.5 truncate flex items-center gap-1.5">
          {/* FL often names the pattern after its channel; don't print the same word twice. */}
          {pattern.channel_name && pattern.channel_name !== pattern.pattern_name && (
            <>
              <span className="font-medium text-[var(--text)] opacity-70">{pattern.channel_name}</span>
              <span className="opacity-30">•</span>
            </>
          )}
          <span className="opacity-80">{pattern.project_title}</span>
        </div>
      </div>

      {/* Mini Piano Roll graphic with timeline seek & scrub */}
      <div className="flex-shrink-0">
        <MiniPianoRoll
          patternId={pattern.id}
          notes={pattern.notes}
          tempo={pattern.tempo}
          ppq={pattern.ppq}
          tag={pattern.tag}
          isPlaying={isCurrentPlaying}
        />
      </div>

      {/* Metadata */}
      {/* Fixed width: a content-sized column shifted the mini roll from row to row ("· C#m" vs "· —"). */}
      <div className="text-right text-[11px] tabular-nums flex-shrink-0 w-[88px] whitespace-nowrap">
        <div className="text-[var(--text)] font-semibold">{pattern.tempo} BPM</div>
        <div className="text-[var(--muted)] text-[10px] mt-0.5">
          {getBarsLabel(pattern.bars, isRu)} · {pattern.key_root}
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
                toggleKitPattern(pattern);
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
            itemId={pattern.id}
            itemType="pattern"
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

        {/* Download MIDI Button */}
        <a
          href={api.getMidiUrl(pattern.id)}
          download={`${pattern.pattern_name || 'pattern'}.mid`}
          onClick={(e) => e.stopPropagation()}
          className="row-action"
          title={isRu ? 'Скачать MIDI' : 'Download MIDI'}
        >
          <i className="ti ti-download text-[13px]" aria-hidden="true" />
        </a>
      </div>

      <EditItemModal
        isOpen={isEditOpen}
        onClose={closeEdit}
        itemType="pattern"
        itemId={pattern.id}
        initialName={pattern.pattern_name}
        initialTag={pattern.tag}
      />
    </div>
  );
});
