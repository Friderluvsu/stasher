import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useInterfaceStore } from '../state/interfaceStore';

interface TagPickerPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  currentTag: string;
  onSelectTag: (tag: string) => void;
  anchorEl?: HTMLElement | null;
}

interface TagConfig {
  name: string;
  color: string;
  bg: string;
}

const TAG_CONFIGS: TagConfig[] = [
  { name: '808', color: '#ff6b81', bg: 'rgba(255, 107, 129, 0.22)' },
  { name: 'Kick', color: '#ff9f43', bg: 'rgba(255, 159, 67, 0.22)' },
  { name: 'Snare', color: '#feca57', bg: 'rgba(254, 202, 87, 0.22)' },
  { name: 'Clap', color: '#feca57', bg: 'rgba(254, 202, 87, 0.22)' },
  { name: 'Hi-Hat', color: '#48dbfb', bg: 'rgba(72, 219, 251, 0.22)' },
  { name: 'Open Hat', color: '#48dbfb', bg: 'rgba(72, 219, 251, 0.22)' },
  { name: 'Rim', color: '#feca57', bg: 'rgba(254, 202, 87, 0.22)' },
  { name: 'Perc', color: '#54a0ff', bg: 'rgba(84, 160, 255, 0.22)' },
  { name: 'Tom', color: '#ff9f43', bg: 'rgba(255, 159, 67, 0.22)' },
  { name: 'Crash', color: '#48dbfb', bg: 'rgba(72, 219, 251, 0.22)' },
  { name: 'Bass', color: '#ff6b81', bg: 'rgba(255, 107, 129, 0.22)' },
  { name: 'Chords', color: '#71c89f', bg: 'rgba(113, 200, 159, 0.22)' },
  { name: 'Melody', color: '#9a90ff', bg: 'rgba(154, 144, 255, 0.24)' },
  { name: 'Lead', color: '#9a90ff', bg: 'rgba(154, 144, 255, 0.24)' },
  { name: 'Pluck', color: '#9a90ff', bg: 'rgba(154, 144, 255, 0.24)' },
  { name: 'Vox', color: '#1dd1a1', bg: 'rgba(29, 209, 161, 0.22)' },
  { name: 'FX', color: '#ff9ff3', bg: 'rgba(255, 159, 243, 0.22)' },
  { name: 'Other', color: '#8a92a1', bg: 'rgba(138, 146, 161, 0.22)' },
];

export const TagPickerPopover: React.FC<TagPickerPopoverProps> = ({
  isOpen,
  onClose,
  currentTag,
  onSelectTag,
  anchorEl,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const language = useInterfaceStore((state) => state.language);
  const isRu = language === 'ru';
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!isOpen) return;

    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      const popoverWidth = 330;
      const popoverHeight = 270;

      let top = rect.bottom + 6;
      if (top + popoverHeight > window.innerHeight - 12) {
        top = Math.max(12, rect.top - popoverHeight - 6);
      }

      let left = rect.left;
      if (left + popoverWidth > window.innerWidth - 12) {
        left = window.innerWidth - popoverWidth - 12;
      }
      if (left < 12) left = 12;

      setCoords({ top, left });
    }

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        (!anchorEl || !anchorEl.contains(e.target as Node))
      ) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleScroll = () => {
      onClose();
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen, onClose, anchorEl]);

  if (!isOpen) return null;

  const content = (
    <div
      ref={popoverRef}
      className="glass-popover"
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        width: 330,
        padding: '12px',
        borderRadius: 20,
        zIndex: 999999,
        backgroundColor: '#161b26',
        border: '1px solid rgba(255, 255, 255, 0.16)',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.1)',
        pointerEvents: 'auto',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '2px 4px 10px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--muted)',
          }}
        >
          {isRu ? 'Сменить категорию' : 'Select Category'}
        </span>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--soft)',
            cursor: 'pointer',
            padding: 2,
            display: 'grid',
            placeItems: 'center',
            fontSize: 13,
          }}
          title={isRu ? 'Закрыть' : 'Close'}
        >
          <i className="ti ti-x" />
        </button>
      </div>

      {/* Grid of tags: 3 columns x 6 rows -> All 18 tags perfectly visible without scrolling */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
        }}
      >
        {TAG_CONFIGS.map((t) => {
          const isSelected = currentTag.toLowerCase() === t.name.toLowerCase();
          return (
            <button
              key={t.name}
              type="button"
              onClick={() => {
                onSelectTag(t.name);
                onClose();
              }}
              style={{
                height: 31,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '0 8px',
                borderRadius: 9,
                fontSize: 11,
                fontWeight: isSelected ? 700 : 500,
                color: isSelected ? '#ffffff' : 'var(--text)',
                background: isSelected ? t.bg : 'rgba(255, 255, 255, 0.05)',
                border: isSelected ? `1px solid ${t.color}` : '1px solid rgba(255, 255, 255, 0.08)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.16)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                }
              }}
            >
              {/* Color dot */}
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: t.color,
                  boxShadow: isSelected ? `0 0 8px ${t.color}` : 'none',
                  flexShrink: 0,
                }}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {t.name}
              </span>
              {isSelected && (
                <i className="ti ti-check" style={{ fontSize: 10, color: t.color, flexShrink: 0 }} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
};
