import React, { useState, useRef } from 'react';
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

export const PatternCard: React.FC<PatternCardProps> = ({ pattern }) => {
  const {
    playPattern,
    stopPlayback,
    currentlyPlayingId,
    isPlaying,
    updateItemTag,
    kits,
    activeKitId,
    toggleKitPattern,
    selectedPatternIds,
    toggleSelectPattern,
  } = useVaultStore();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isKitMenuOpen, setIsKitMenuOpen] = useState(false);
  const [isTagMenuOpen, setIsTagMenuOpen] = useState(false);

  const tagBadgeRef = useRef<HTMLButtonElement>(null);
  const kitButtonRef = useRef<HTMLDivElement>(null);

  const language = useInterfaceStore((state) => state.language);
  const isRu = language === 'ru';

  const isCurrentPlaying = isPlaying && currentlyPlayingId === pattern.id;
  const isSelected = selectedPatternIds.includes(pattern.id);
  const activeKit = kits.find((k) => k.id === activeKitId) || kits[0];
  const isInKit = activeKit ? activeKit.patterns.some((p) => p.id === pattern.id) : false;

  const handleDragStart = (e: React.DragEvent) => {
    const ids = isSelected && selectedPatternIds.length > 0 ? selectedPatternIds : [pattern.id];
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

  const tagStyle = getTagStyle(pattern.tag);

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`glass-card spotlight-card pattern-card p-3 px-4 flex items-center gap-3.5 cursor-grab transition-all ${
        isSelected
          ? 'border-[var(--accent)] bg-[rgba(154,144,255,0.12)] shadow-[0_0_24px_rgba(154,144,255,0.22)]'
          : isCurrentPlaying
          ? 'border-[#9a90ff]/50 shadow-[0_0_24px_rgba(154,144,255,0.18)]'
          : ''
      }`}
      style={{
        borderRadius: 'var(--radius-card, 20px)',
      }}
    >
      {/* Checkbox for batch selection */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleSelectPattern(pattern.id);
        }}
        className="flex-shrink-0 cursor-pointer transition-all flex items-center justify-center"
        style={{
          width: 15,
          height: 15,
          borderRadius: 4,
          border: isSelected ? 'none' : '1.5px solid rgba(255,255,255,0.18)',
          background: isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.04)',
        }}
        title={isSelected ? (isRu ? 'Снять выделение' : 'Deselect') : (isRu ? 'Выбрать' : 'Select')}
      >
        {isSelected && (
          <i className="ti ti-check" style={{ fontSize: 10, color: '#0e1017', lineHeight: 1 }} />
        )}
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
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all cursor-pointer"
        style={{
          background: isCurrentPlaying ? 'var(--accent)' : 'color-mix(in srgb, var(--text) 8%, transparent)',
          color: isCurrentPlaying ? '#0b0d13' : 'var(--text)',
          boxShadow: isCurrentPlaying ? '0 0 16px rgba(154,144,255,0.45)' : 'none',
        }}
        type="button"
        title={isCurrentPlaying ? 'Stop playback' : 'Play MIDI preview'}
      >
        <i
          className={`ti ${isCurrentPlaying ? 'ti-player-stop' : 'ti-player-play'}`}
          style={{ fontSize: 16, marginLeft: isCurrentPlaying ? 0 : 2 }}
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
              className="text-[10px] font-bold px-2.5 py-[3px] rounded-full inline-flex items-center gap-1 hover:brightness-125 transition-all cursor-pointer"
              style={tagStyle}
              title={isRu ? "Нажмите, чтобы сменить тег" : "Click to change tag"}
            >
              <span>{pattern.tag}</span>
              <i className="ti ti-chevron-down text-[8px] opacity-70" />
            </button>

            <TagPickerPopover
              isOpen={isTagMenuOpen}
              onClose={() => setIsTagMenuOpen(false)}
              currentTag={pattern.tag}
              anchorEl={tagBadgeRef.current}
              onSelectTag={(newTag) => {
                updateItemTag('pattern', pattern.id, newTag);
                notify.success(isRu ? `Тег изменен на ${newTag}` : `Tag changed to ${newTag}`, 'MIDI Vault');
              }}
            />
          </div>
        </div>
        <div className="text-[11px] text-[var(--muted)] mt-0.5 truncate flex items-center gap-1.5">
          <span className="font-medium text-[var(--text)] opacity-70">{pattern.channel_name}</span>
          <span className="opacity-30">•</span>
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
      <div className="text-right text-[11px] font-mono flex-shrink-0">
        <div className="text-[var(--text)] font-semibold">{pattern.tempo} BPM</div>
        <div className="text-[var(--muted)] text-[10px] mt-0.5">
          {getBarsLabel(pattern.bars, isRu)} · {pattern.key_root}
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
                toggleKitPattern(pattern);
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
          className="w-[30px] h-[30px] rounded-full grid place-items-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/[0.08] transition-colors cursor-pointer border border-transparent hover:border-[var(--line)]"
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
          className="w-[30px] h-[30px] rounded-full grid place-items-center text-[var(--muted)] hover:text-[var(--text)] hover:bg-white/[0.08] transition-colors cursor-pointer border border-transparent hover:border-[var(--line)]"
          title={isRu ? 'Скачать MIDI' : 'Download MIDI'}
        >
          <i className="ti ti-download text-[13px]" aria-hidden="true" />
        </a>
      </div>

      <EditItemModal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        itemType="pattern"
        itemId={pattern.id}
        initialName={pattern.pattern_name}
        initialTag={pattern.tag}
      />
    </div>
  );
};