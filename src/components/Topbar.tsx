import React, { useState } from 'react';
import { useVaultStore } from '../state/vaultStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { ProfileMenu } from './ProfileMenu';
import { notify } from '../state/toastStore';

export const Topbar: React.FC = () => {
  const {
    activeTab, setActiveTab,
    searchQuery, setSearchQuery,
    seedDemoData, totalPatterns, totalSounds,
    kitSounds, kitPatterns,
  } = useVaultStore();

  const language = useInterfaceStore((state) => state.language);
  const isRu = language === 'ru';
  const [profileOpen, setProfileOpen] = useState(false);

  const totalKitItems = kitSounds.length + kitPatterns.length;

  const handleSeed = async () => {
    await seedDemoData();
    notify.success(isRu ? 'Демо-семплы и MIDI успешно загружены' : 'Demo samples & MIDIs loaded successfully', 'Stasher');
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
          className={activeTab === 'kit' ? 'is-active' : ''}
          onClick={() => setActiveTab('kit')}
          type="button"
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
      <button
        className="soft-button"
        onClick={handleSeed}
        type="button"
        style={{ minHeight: 34, padding: '0 14px', fontSize: 12, whiteSpace: 'nowrap', flexShrink: 0 }}
        title={isRu ? 'Загрузить тестовые данные' : 'Load demo data'}
      >
        <i className="ti ti-sparkles" style={{ color: 'var(--accent)' }} aria-hidden="true" />
        <span>{isRu ? 'Демо FLP' : 'Load Demos'}</span>
      </button>

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
