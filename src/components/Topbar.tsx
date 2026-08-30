import React, { useState } from 'react';
import { useVaultStore } from '../state/vaultStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { ProfileMenu } from './ProfileMenu';
import { notify } from '../state/toastStore';

export const Topbar: React.FC = () => {
  const {
    activeTab, setActiveTab,
    searchQuery, setSearchQuery,
     totalPatterns, totalSounds,
    kits, activeKitId,
  } = useVaultStore();

  const language = useInterfaceStore((state) => state.language);
  const isRu = language === 'ru';
  const [profileOpen, setProfileOpen] = useState(false);

  const activeKit = kits.find(k => k.id === activeKitId) || kits[0];
  const totalKitItems = (activeKit?.sounds.length || 0) + (activeKit?.patterns.length || 0);

  
  const [isKitDropTarget, setIsKitDropTarget] = useState(false);

  const handleKitDragOver = (e: React.DragEvent) => {
    const isInternal =
      (window as any).__stasher_is_internal_drag ||
      (window as any).__stasher_drag_item ||
      e.dataTransfer.types.includes('application/x-stasher-internal');

    if (isInternal) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setIsKitDropTarget(true);
    }
  };

  const handleKitDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsKitDropTarget(false);
  };

  const handleKitDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsKitDropTarget(false);

    const internalItem = (window as any).__stasher_drag_item;
    const itemType = internalItem?.type || e.dataTransfer.getData('application/x-stasher-item-type');
    const ids: number[] = internalItem?.ids || [];

    const { sounds, patterns, toggleKitSound, toggleKitPattern } = useVaultStore.getState();

    if (itemType === 'sound') {
      const itemsToAdd = sounds.filter((s) => ids.includes(s.id));
      itemsToAdd.forEach((s) => toggleKitSound(s));
      notify.success(
        isRu ? `Добавлено в кит: ${itemsToAdd.length} семплов` : `Added ${itemsToAdd.length} samples to kit`,
        'Kit Builder'
      );
    } else if (itemType === 'pattern') {
      const itemsToAdd = patterns.filter((p) => ids.includes(p.id));
      itemsToAdd.forEach((p) => toggleKitPattern(p));
      notify.success(
        isRu ? `Добавлено в кит: ${itemsToAdd.length} паттернов` : `Added ${itemsToAdd.length} patterns to kit`,
        'Kit Builder'
      );
    }
  };

  return (
    <header className="topbar">
      {/* Workspace Switcher Tabs — exact Verse style */}
      <div className="workspace-switcher" style={{ marginRight: 'auto' }} aria-label="Workspace">
        <button
          className={activeTab === 'midi' ? 'is-active' : ''}
          onClick={() => setActiveTab('midi')}
          type="button"
        >
          <i className="ti ti-music" aria-hidden="true" />
          <span>{isRu ? 'MIDI Паттерны' : 'MIDI Patterns'}</span>
          <span className="navigation-count">{totalPatterns}</span>
        </button>

        <button
          className={activeTab === 'sounds' ? 'is-active' : ''}
          onClick={() => setActiveTab('sounds')}
          type="button"
        >
          <i className="ti ti-volume" aria-hidden="true" />
          <span>StashSound</span>
          <span className="navigation-count">{totalSounds}</span>
        </button>

        <button
          className={`${activeTab === 'kit' ? 'is-active' : ''} ${
            isKitDropTarget
              ? 'ring-2 ring-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] scale-105 shadow-[0_0_16px_rgba(154,144,255,0.4)]'
              : ''
          }`}
          onClick={() => setActiveTab('kit')}
          onDragOver={handleKitDragOver}
          onDragLeave={handleKitDragLeave}
          onDrop={handleKitDrop}
          type="button"
          title={isRu ? 'Кит Билдер (перетащите сюда для добавления в кит)' : 'Kit Builder (drop here to add to kit)'}
        >
          <i className="ti ti-archive" aria-hidden="true" />
          <span>{isRu ? 'Кит Билдер' : 'Kit Builder'}</span>
          {totalKitItems > 0 && (
            <span
              className="navigation-count"
              style={{ background: 'var(--accent)', color: '#0b0d13', fontWeight: 700 }}
            >
              {totalKitItems}
            </span>
          )}
        </button>
      </div>

      {/* Search Input (visible on MIDI & Sounds tabs) */}
      {activeTab !== 'kit' && (
        <div style={{ position: 'relative', width: 260, flexShrink: 0 }}>
          <i
            className="ti ti-search"
            style={{
              position: 'absolute',
              left: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--soft)',
              fontSize: 15,
              pointerEvents: 'none',
            }}
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              activeTab === 'sounds'
                ? (isRu ? 'Поиск по звукам…' : 'Search sounds…')
                : (isRu ? 'Поиск паттернов…' : 'Search patterns…')
            }
            className="glass-input"
            style={{
              width: '100%',
              height: 34,
              paddingLeft: 34,
              paddingRight: 12,
              fontSize: 12,
              fontWeight: 500,
            }}
          />
        </div>
      )}

      {/* Demos Button */}
      

      {/* Circular Profile Button */}
      <button
        aria-expanded={profileOpen}
        aria-label={isRu ? 'Профиль и настройки' : 'Profile & Settings'}
        className="profile-button"
        onClick={() => setProfileOpen((curr) => !curr)}
        type="button"
      >
        <i className="ti ti-user-circle" aria-hidden="true" />
      </button>

      <ProfileMenu open={profileOpen} onClose={() => setProfileOpen(false)} />
    </header>
  );
};
