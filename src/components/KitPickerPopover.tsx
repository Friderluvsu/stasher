import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useVaultStore } from '../state/vaultStore';
import { useInterfaceStore } from '../state/interfaceStore';

interface KitPickerPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  itemId: number;
  itemType: 'pattern' | 'sound';
  anchorEl?: HTMLElement | null;
}

export const KitPickerPopover: React.FC<KitPickerPopoverProps> = ({
  isOpen,
  onClose,
  itemId,
  itemType,
  anchorEl,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const { kits, toggleKitPattern, toggleKitSound, createKit, patterns, sounds } = useVaultStore();
  const language = useInterfaceStore((state) => state.language);
  const isRu = language === 'ru';
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    if (anchorEl) {
      const rect = anchorEl.getBoundingClientRect();
      const popoverWidth = 220;
      const popoverHeight = 260;

      let top = rect.bottom + 6;
      if (top + popoverHeight > window.innerHeight - 10) {
        top = Math.max(10, rect.top - popoverHeight - 6);
      }

      let left = rect.right - popoverWidth;
      if (left < 10) left = 10;
      if (left + popoverWidth > window.innerWidth - 10) {
        left = window.innerWidth - popoverWidth - 10;
      }

      setCoords({ top, left });
    }

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        (!anchorEl || !anchorEl.contains(e.target as Node))
      ) {
        onClose();
        setIsCreating(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        setIsCreating(false);
      }
    };

    const handleScroll = () => {
      onClose();
      setIsCreating(false);
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

  const currentPattern = itemType === 'pattern' ? patterns.find((p) => p.id === itemId) : null;
  const currentSound = itemType === 'sound' ? sounds.find((s) => s.id === itemId) : null;

  const handleToggle = (kitId: string) => {
    if (itemType === 'pattern' && currentPattern) {
      toggleKitPattern(currentPattern, kitId);
    } else if (itemType === 'sound' && currentSound) {
      toggleKitSound(currentSound, kitId);
    }
  };

  const handleCreateNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const createdId = createKit(newTitle.trim());
    if (itemType === 'pattern' && currentPattern) {
      toggleKitPattern(currentPattern, createdId);
    } else if (itemType === 'sound' && currentSound) {
      toggleKitSound(currentSound, createdId);
    }
    setNewTitle('');
    setIsCreating(false);
    onClose();
  };

  const content = (
    <div
      ref={popoverRef}
      className="glass-popover"
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        width: 220,
        padding: '10px',
        borderRadius: 18,
        zIndex: 999999,
        backgroundColor: '#161b26',
        border: '1px solid rgba(255, 255, 255, 0.16)',
        boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.1)',
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--muted)',
          padding: '2px 6px 6px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          marginBottom: 4,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>{isRu ? 'Добавить в набор' : 'Add to Kit'}</span>
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--soft)', cursor: 'pointer', fontSize: 12 }}
        >
          <i className="ti ti-x" />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 180, overflowY: 'auto' }}>
        {kits.map((k) => {
          const inThisKit = itemType === 'pattern'
            ? k.patterns.some((p) => p.id === itemId)
            : k.sounds.some((s) => s.id === itemId);

          return (
            <button
              key={k.id}
              type="button"
              onClick={() => handleToggle(k.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '7px 9px',
                borderRadius: 8,
                fontSize: 11.5,
                fontWeight: inThisKit ? 700 : 500,
                color: inThisKit ? 'var(--accent)' : 'var(--text)',
                background: inThisKit ? 'var(--accent-soft)' : 'rgba(255, 255, 255, 0.04)',
                border: inThisKit ? '1px solid rgba(154, 144, 255, 0.35)' : '1px solid transparent',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!inThisKit) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.09)';
              }}
              onMouseLeave={(e) => {
                if (!inThisKit) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {k.name}
              </span>
              {inThisKit && <i className="ti ti-check" style={{ color: 'var(--accent)', fontSize: 12 }} />}
            </button>
          );
        })}
      </div>

      <div style={{ height: 1, background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

      {isCreating ? (
        <form onSubmit={handleCreateNew} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px' }}>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder={isRu ? 'Название кита...' : 'Kit name...'}
            className="glass-input"
            style={{ height: 30, padding: '0 8px', fontSize: 11 }}
            autoFocus
            required
          />
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="soft-button"
              style={{ flex: 1, minHeight: 26, fontSize: 10, padding: 0 }}
            >
              {isRu ? 'Отмена' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="run-button"
              style={{ flex: 1, minHeight: 26, fontSize: 10, padding: 0 }}
            >
              {isRu ? 'Создать' : 'Create'}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 8px',
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--accent)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-soft)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <i className="ti ti-plus" />
          <span>{isRu ? 'Создать новый кит' : 'Create New Kit'}</span>
        </button>
      )}
    </div>
  );

  return ReactDOM.createPortal(content, document.body);
};
