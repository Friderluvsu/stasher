import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useVaultStore } from '../state/vaultStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { notify } from '../state/toastStore';

export const KitBuilder: React.FC = () => {
  const {
    kits, activeKitId, setActiveKit, createKit, deleteKit, setKitName,
    removeKitSound, removeKitPattern, clearKit, exportKit,
    playSound, playPattern, stopPlayback, isPlaying, currentlyPlayingId,
    setActiveTab
  } = useVaultStore();

  const [isKitSelectorOpen, setIsKitSelectorOpen] = useState(false);
  const [isCreatingKit, setIsCreatingKit] = useState(false);
  const [newKitTitle, setNewKitTitle] = useState('');
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const kitSelectorBtnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isKitSelectorOpen) return;

    if (kitSelectorBtnRef.current) {
      const rect = kitSelectorBtnRef.current.getBoundingClientRect();
      setDropdownCoords({
        top: rect.bottom + 6,
        left: Math.max(12, Math.min(window.innerWidth - 250, rect.left)),
      });
    }

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        (!kitSelectorBtnRef.current || !kitSelectorBtnRef.current.contains(e.target as Node))
      ) {
        setIsKitSelectorOpen(false);
        setIsCreatingKit(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsKitSelectorOpen(false);
        setIsCreatingKit(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isKitSelectorOpen]);

  const activeKit = kits.find((k) => k.id === activeKitId) || kits[0] || { id: 'default', name: 'My_StashSound_Kit', sounds: [], patterns: [] };
  const kitSounds = activeKit?.sounds || [];
  const kitPatterns = activeKit?.patterns || [];

  const language = useInterfaceStore((state) => state.language);
  const isRu = language === 'ru';

  const totalItems = kitSounds.length + kitPatterns.length;

  const categories = [
    { title: isRu ? '808s и Бас' : '808s & Bass', filter: (s: any) => ['808', 'Bass'].includes(s.tag), items: kitSounds.filter(s => ['808', 'Bass'].includes(s.tag)), icon: 'ti-flame', color: '#ff6b81' },
    { title: isRu ? 'Кики (Kicks)' : 'Kicks', filter: (s: any) => s.tag === 'Kick', items: kitSounds.filter(s => s.tag === 'Kick'), icon: 'ti-circle-dot', color: '#ff9f43' },
    { title: isRu ? 'Снейры и Клепы' : 'Snares & Claps', filter: (s: any) => ['Snare', 'Clap', 'Rim'].includes(s.tag), items: kitSounds.filter(s => ['Snare', 'Clap', 'Rim'].includes(s.tag)), icon: 'ti-hand-click', color: '#feca57' },
    { title: isRu ? 'Хэты (Hi-Hats)' : 'Hi-Hats', filter: (s: any) => ['Hi-Hat', 'Open Hat'].includes(s.tag), items: kitSounds.filter(s => ['Hi-Hat', 'Open Hat'].includes(s.tag)), icon: 'ti-sparkles', color: '#48dbfb' },
    { title: isRu ? 'Перкуссия и FX' : 'Percs & FX', filter: (s: any) => ['Perc', 'Vox', 'FX'].includes(s.tag), items: kitSounds.filter(s => ['Perc', 'Vox', 'FX'].includes(s.tag)), icon: 'ti-brand-beats', color: '#54a0ff' },
    { title: isRu ? 'Инструменты и Мелодии' : 'Instruments & Melodies', filter: (s: any) => ['Chords', 'Melody', 'Lead', 'Pluck', 'Other'].includes(s.tag), items: kitSounds.filter(s => ['Chords', 'Melody', 'Lead', 'Pluck', 'Other'].includes(s.tag)), icon: 'ti-music', color: '#a55eea' },
  ];

  const handleQuickCreate = () => {
    const nextNum = kits.length + 1;
    const name = isRu ? `Набор ${nextNum}` : `Kit ${nextNum}`;
    const newId = createKit(name);
    notify.success(isRu ? `Создан "${name}"` : `Created "${name}"`, 'Kit Builder');
    setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 50);
  };

  const handleCreateNewKit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKitTitle.trim()) return;
    createKit(newKitTitle.trim());
    notify.success(isRu ? `Кит "${newKitTitle.trim()}" создан` : `Kit "${newKitTitle.trim()}" created`, 'Kit Builder');
    setNewKitTitle('');
    setIsCreatingKit(false);
    setIsKitSelectorOpen(false);
  };

  const handleExport = async () => {
    try {
      await exportKit();
      notify.success(
        isRu ? `Набор "${activeKit.name || 'Kit'}" успешно экспортирован в ZIP архив` : `Kit "${activeKit.name || 'Kit'}" exported to ZIP successfully`,
        'Kit Builder'
      );
    } catch (e: any) {
      notify.error(e?.message || (isRu ? 'Ошибка при экспорте набора' : 'Export failed'), 'Kit Builder');
    }
  };

  const handleClear = () => {
    clearKit();
    notify.info(isRu ? 'Набор очищен' : 'Kit cleared', 'Kit Builder');
  };

  return (
    <div className="workspace-content" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Kit Configuration Panel */}
      <div
        className="glass-panel"
        style={{
          padding: '16px 20px',
          borderRadius: 'var(--radius-panel, 24px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 280 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: 'linear-gradient(135deg, #6366f1, #9a90ff, #ec4899)',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              boxShadow: '0 6px 20px rgba(154, 144, 255, 0.25)',
              fontSize: 22,
              flexShrink: 0,
            }}
          >
            <i className="ti ti-archive" />
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--accent)',
              }}
            >
              {isRu ? 'Конструктор Драм-кита' : 'Drum Kit Builder'}
            </div>
            <div style={{ position: 'relative', marginTop: 4, display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Kit Switcher Dropdown Button */}
              <button
                ref={kitSelectorBtnRef}
                type="button"
                onClick={() => setIsKitSelectorOpen(!isKitSelectorOpen)}
                className="glass-input inline-flex items-center justify-between gap-2 px-3 text-xs font-semibold"
                style={{ height: 36, minWidth: 120, cursor: 'pointer' }}
                title={isRu ? 'Выбрать или переключить набор' : 'Select or switch kit'}
              >
                <span className="truncate flex items-center gap-1.5">
                  <i className="ti ti-folders text-xs opacity-70" />
                  <span>{activeKit.name || (isRu ? 'Без названия' : 'Untitled')}</span>
                </span>
                <i className="ti ti-chevron-down text-[10px] opacity-70" />
              </button>

              {/* Kit Name Editor Input - allows completely clearing text */}
              <input
                ref={nameInputRef}
                type="text"
                value={activeKit?.name ?? ''}
                onChange={(e) => setKitName(activeKitId, e.target.value)}
                onBlur={() => {
                  if (!activeKit?.name?.trim()) {
                    setKitName(activeKitId, isRu ? 'Мой Драм Кит' : 'My Drum Kit');
                  }
                }}
                placeholder={isRu ? 'Название набора...' : 'Kit Name...'}
                className="glass-input"
                style={{
                  height: 36,
                  padding: '0 12px',
                  fontSize: 13,
                  fontWeight: 600,
                  width: 190,
                }}
              />

              {/* Quick "+ Новый кит" button */}
              <button
                type="button"
                onClick={handleQuickCreate}
                className="soft-button"
                style={{ height: 36, padding: '0 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                title={isRu ? 'Создать новый пустой набор' : 'Create new empty kit'}
              >
                <i className="ti ti-plus text-xs" />
                <span>{isRu ? 'Новый кит' : 'New Kit'}</span>
              </button>

              {kits.length > 1 && (
                <button
                  onClick={() => {
                    deleteKit(activeKitId);
                    notify.info(isRu ? 'Набор удален' : 'Kit deleted', 'Kit Builder');
                  }}
                  className="icon-button"
                  style={{ width: 36, height: 36, borderRadius: 'var(--radius-control)' }}
                  title={isRu ? 'Удалить этот набор' : 'Delete Kit'}
                  type="button"
                >
                  <i className="ti ti-trash" style={{ color: 'var(--danger, #ff4757)' }} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {totalItems > 0 && (
            <button
              className="soft-button"
              onClick={handleClear}
              style={{ minHeight: 38, padding: '0 14px' }}
              type="button"
            >
              <i className="ti ti-trash" aria-hidden="true" />
              <span>{isRu ? 'Очистить' : 'Clear Kit'}</span>
            </button>
          )}

          <button
            className={totalItems > 0 ? 'run-button' : 'soft-button'}
            onClick={handleExport}
            disabled={totalItems === 0}
            style={{
              opacity: totalItems === 0 ? 0.6 : 1,
              cursor: totalItems === 0 ? 'not-allowed' : 'pointer',
              minHeight: 38,
              padding: '0 18px',
            }}
            type="button"
          >
            <i className="ti ti-download" aria-hidden="true" />
            <span>{isRu ? 'Экспорт Драм-кита (.ZIP)' : 'Export Kit (.ZIP)'}</span>
          </button>
        </div>
      </div>

      {/* Portal Dropdown for Kit Switcher */}
      {isKitSelectorOpen && ReactDOM.createPortal(
        <div
          ref={popoverRef}
          className="glass-popover"
          style={{
            position: 'fixed',
            left: dropdownCoords.left,
            top: dropdownCoords.top,
            width: 240,
            padding: '10px',
            borderRadius: 18,
            zIndex: 999999,
            backgroundColor: '#161b26',
            border: '1px solid rgba(255, 255, 255, 0.16)',
            boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
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
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{isRu ? 'Мои наборы' : 'My Kits'}</span>
            <span style={{ fontSize: 10, color: 'var(--soft)' }}>{kits.length}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 200, overflowY: 'auto' }}>
            {kits.map((k) => {
              const count = k.sounds.length + k.patterns.length;
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => {
                    setActiveKit(k.id);
                    setIsKitSelectorOpen(false);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: k.id === activeKitId ? 700 : 500,
                    color: k.id === activeKitId ? 'var(--accent)' : 'var(--text)',
                    background: k.id === activeKitId ? 'var(--accent-soft)' : 'rgba(255, 255, 255, 0.03)',
                    border: k.id === activeKitId ? '1px solid rgba(154, 144, 255, 0.35)' : '1px solid transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (k.id !== activeKitId) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                  }}
                  onMouseLeave={(e) => {
                    if (k.id !== activeKitId) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {k.name}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--soft)', marginLeft: 8, flexShrink: 0 }}>
                    {count} {isRu ? 'эл.' : 'items'}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ height: 1, background: 'rgba(255, 255, 255, 0.08)', margin: '4px 0' }} />

          {isCreatingKit ? (
            <form onSubmit={handleCreateNewKit} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px' }}>
              <input
                type="text"
                value={newKitTitle}
                onChange={(e) => setNewKitTitle(e.target.value)}
                placeholder={isRu ? 'Название кита...' : 'Kit name...'}
                className="glass-input"
                style={{ height: 32, padding: '0 8px', fontSize: 11 }}
                autoFocus
                required
              />
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  onClick={() => setIsCreatingKit(false)}
                  className="soft-button"
                  style={{ flex: 1, minHeight: 28, fontSize: 10, padding: 0 }}
                >
                  {isRu ? 'Отмена' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="run-button"
                  style={{ flex: 1, minHeight: 28, fontSize: 10, padding: 0 }}
                >
                  {isRu ? 'Создать' : 'Create'}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsCreatingKit(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 10px',
                borderRadius: 8,
                fontSize: 12,
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
        </div>,
        document.body
      )}

      {totalItems === 0 ? (
        <div
          className="glass-card"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '70px 24px',
            textAlign: 'center',
            gap: 16,
            borderRadius: 'var(--radius-panel, 24px)',
          }}
        >
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 18,
              background: 'var(--accent-soft)',
              display: 'grid',
              placeItems: 'center',
              boxShadow: '0 12px 30px rgba(154, 144, 255, 0.15)',
              color: 'var(--accent)',
              fontSize: 30,
            }}
          >
            <i className="ti ti-box" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
              {isRu ? 'Ваш пользовательский кит пуст' : 'Your Custom Kit is Empty'}
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--muted)',
                marginTop: 6,
                maxWidth: 420,
                lineHeight: '1.6',
              }}
            >
              {isRu
                ? 'Откройте вкладку "StashSound" или "MIDI Паттерны" и нажмите кнопку "Кит" на нужных звуках, чтобы собрать персональный FL Studio пак.'
                : 'Browse your StashSound audio samples or MIDI Patterns and click the "Kit" button to add them here for one-click ZIP packaging.'}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button
              onClick={() => setActiveTab('sounds')}
              className="soft-button"
              style={{ minHeight: 38, padding: '0 16px' }}
              type="button"
            >
              <i className="ti ti-volume" aria-hidden="true" />
              <span>{isRu ? 'Смотреть звуки' : 'Browse Sounds'}</span>
            </button>
            <button
              onClick={() => setActiveTab('midi')}
              className="soft-button"
              style={{ minHeight: 38, padding: '0 16px' }}
              type="button"
            >
              <i className="ti ti-music" aria-hidden="true" />
              <span>{isRu ? 'Смотреть MIDI' : 'Browse MIDI'}</span>
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
          {categories.map((cat, idx) => {
            if (cat.items.length === 0) return null;
            return (
              <div
                key={idx}
                className="glass-card"
                style={{
                  padding: 16,
                  borderRadius: 'var(--radius-card, 20px)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        background: `color-mix(in srgb, ${cat.color} 15%, transparent)`,
                        color: cat.color,
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 14,
                      }}
                    >
                      <i className={`ti ${cat.icon}`} />
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                      {cat.title}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: 'var(--field)',
                      color: 'var(--muted)',
                    }}
                  >
                    {cat.items.length}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {cat.items.map((sound: any) => {
                    const isCurPlaying = isPlaying && currentlyPlayingId === sound.id;
                    const cleanTitle = (sound.channel_name || '').trim() || sound.sample_name || 'Sound';
                    return (
                      <div
                        key={sound.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          borderRadius: 10,
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid rgba(255, 255, 255, 0.05)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                          <button
                            type="button"
                            onClick={() => (isCurPlaying ? stopPlayback() : playSound(sound))}
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: '50%',
                              background: isCurPlaying ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)',
                              color: isCurPlaying ? '#000' : 'var(--text)',
                              border: 'none',
                              cursor: 'pointer',
                              display: 'grid',
                              placeItems: 'center',
                              fontSize: 12,
                              flexShrink: 0,
                            }}
                          >
                            <i className={`ti ${isCurPlaying ? 'ti-player-stop' : 'ti-volume'}`} />
                          </button>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 500,
                              color: 'var(--text)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {cleanTitle}
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeKitSound(sound.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--soft)',
                            cursor: 'pointer',
                            padding: 4,
                            fontSize: 13,
                          }}
                          title={isRu ? 'Удалить из набора' : 'Remove from kit'}
                        >
                          <i className="ti ti-x" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* MIDI Patterns in Kit */}
          {kitPatterns.length > 0 && (
            <div
              className="glass-card"
              style={{
                padding: 16,
                borderRadius: 'var(--radius-card, 20px)',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: 'rgba(154, 144, 255, 0.15)',
                      color: 'var(--accent)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 14,
                    }}
                  >
                    <i className="ti ti-music" />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    {isRu ? 'MIDI Паттерны' : 'MIDI Patterns'}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 10,
                    background: 'var(--field)',
                    color: 'var(--muted)',
                  }}
                >
                  {kitPatterns.length}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {kitPatterns.map((pat: any) => {
                  const isCurPlaying = isPlaying && currentlyPlayingId === pat.id;
                  return (
                    <div
                      key={pat.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        borderRadius: 10,
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                        <button
                          type="button"
                          onClick={() => (isCurPlaying ? stopPlayback() : playPattern(pat))}
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: '50%',
                            background: isCurPlaying ? 'var(--accent)' : 'rgba(255, 255, 255, 0.08)',
                            color: isCurPlaying ? '#000' : 'var(--text)',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: 12,
                            flexShrink: 0,
                          }}
                        >
                          <i className={`ti ${isCurPlaying ? 'ti-player-stop' : 'ti-player-play'}`} />
                        </button>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: 'var(--text)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {pat.pattern_name}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => removeKitPattern(pat.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--soft)',
                          cursor: 'pointer',
                          padding: 4,
                          fontSize: 13,
                        }}
                        title={isRu ? 'Удалить из набора' : 'Remove from kit'}
                      >
                        <i className="ti ti-x" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
