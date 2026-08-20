import React from 'react';
import { useVaultStore } from '../state/vaultStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { notify } from '../state/toastStore';

export const KitBuilder: React.FC = () => {
  const {
    kitName, setKitName, kitSounds, kitPatterns,
    removeKitSound, removeKitPattern, clearKit, exportKit,
    playSound, playPattern, stopPlayback, isPlaying, currentlyPlayingId,
    setActiveTab
  } = useVaultStore();

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

  const handleExport = async () => {
    try {
      await exportKit();
      notify.success(
        isRu ? `Набор "${kitName}" успешно экспортирован в ZIP архив` : `Kit "${kitName}" exported to ZIP successfully`,
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
          padding: '18px 22px',
          borderRadius: 'var(--radius-card)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 20,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 280 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 13,
              background: 'linear-gradient(135deg, #6366f1, #9a90ff, #ec4899)',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              boxShadow: '0 6px 20px rgba(154, 144, 255, 0.25)',
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            <i className="ti ti-archive" />
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--accent)',
              }}
            >
              {isRu ? 'Конструктор Драм-кита' : 'StashSound Drum Kit Builder'}
            </div>
            <div style={{ position: 'relative', marginTop: 4 }}>
              <input
                type="text"
                value={kitName}
                onChange={(e) => setKitName(e.target.value)}
                placeholder={isRu ? 'Название набора (напр. My_Trap_Vault)' : 'Kit Name (e.g. Rio_Vault_Vol1)'}
                className="glass-input"
                style={{
                  height: 34,
                  padding: '0 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  width: 260,
                }}
              />
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {totalItems > 0 && (
            <button className="soft-button" onClick={handleClear} type="button">
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
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button
              className="soft-button"
              onClick={() => setActiveTab('sounds')}
              type="button"
            >
              <i className="ti ti-volume" aria-hidden="true" />
              <span>{isRu ? 'Смотреть звуки' : 'Browse Sounds'}</span>
            </button>
            <button
              className="soft-button"
              onClick={() => setActiveTab('midi')}
              type="button"
            >
              <i className="ti ti-music" aria-hidden="true" />
              <span>{isRu ? 'Смотреть MIDI' : 'Browse MIDIs'}</span>
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Audio Sounds by Category */}
          {categories.map((cat) => {
            if (cat.items.length === 0) return null;
            return (
              <div key={cat.title}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <i className={`ti ${cat.icon}`} style={{ color: cat.color, fontSize: 16 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{cat.title}</span>
                  <span className="navigation-count">{cat.items.length}</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                  {cat.items.map((sound) => {
                    const isPlayingSound = isPlaying && currentlyPlayingId === sound.id;
                    return (
                      <div
                        key={sound.id}
                        className="glass-card spotlight-card kit-card"
                        style={{
                          padding: '10px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          borderRadius: 16,
                        }}
                      >
                        <button
                          onClick={() => isPlayingSound ? stopPlayback() : playSound(sound)}
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            display: 'grid',
                            placeItems: 'center',
                            flexShrink: 0,
                            background: isPlayingSound ? 'var(--accent)' : 'color-mix(in srgb, var(--text) 8%, transparent)',
                            color: isPlayingSound ? '#0b0d13' : 'var(--muted)',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                          type="button"
                          title={isPlayingSound ? 'Stop' : 'Play'}
                        >
                          <i className={`ti ${isPlayingSound ? 'ti-player-stop' : 'ti-volume'}`} style={{ fontSize: 14 }} />
                        </button>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {sound.sample_name || sound.channel_name}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {sound.project_title}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            removeKitSound(sound.id);
                            notify.info(isRu ? 'Семпл удален из набора' : 'Sample removed from kit', 'Kit Builder');
                          }}
                          style={{
                            color: 'var(--soft)',
                            cursor: 'pointer',
                            background: 'none',
                            border: 'none',
                            padding: 4,
                            display: 'grid',
                            placeItems: 'center',
                          }}
                          type="button"
                          title={isRu ? 'Удалить' : 'Remove'}
                        >
                          <i className="ti ti-x" style={{ fontSize: 14 }} />
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
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <i className="ti ti-stack-2" style={{ color: 'var(--accent)', fontSize: 16 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                  {isRu ? 'MIDI и Мелодии' : 'MIDIs & Melodies'}
                </span>
                <span className="navigation-count">{kitPatterns.length}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {kitPatterns.map((pat) => {
                  const isPlayingPat = isPlaying && currentlyPlayingId === pat.id;
                  return (
                    <div
                      key={pat.id}
                      className="glass-card spotlight-card kit-card"
                      style={{
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        borderRadius: 16,
                      }}
                    >
                      <button
                        onClick={() => isPlayingPat ? stopPlayback() : playPattern(pat)}
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0,
                          background: isPlayingPat ? 'var(--accent)' : 'color-mix(in srgb, var(--text) 8%, transparent)',
                          color: isPlayingPat ? '#0b0d13' : 'var(--muted)',
                          border: 'none',
                          cursor: 'pointer',
                        }}
                        type="button"
                        title={isPlayingPat ? 'Stop' : 'Play'}
                      >
                        <i className={`ti ${isPlayingPat ? 'ti-player-stop' : 'ti-player-play'}`} style={{ fontSize: 14 }} />
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {pat.pattern_name}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {pat.channel_name} · {pat.tempo} BPM
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          removeKitPattern(pat.id);
                          notify.info(isRu ? 'Паттерн удален из набора' : 'Pattern removed from kit', 'Kit Builder');
                        }}
                        style={{
                          color: 'var(--soft)',
                          cursor: 'pointer',
                          background: 'none',
                          border: 'none',
                          padding: 4,
                          display: 'grid',
                          placeItems: 'center',
                        }}
                        type="button"
                        title={isRu ? 'Удалить' : 'Remove'}
                      >
                        <i className="ti ti-x" style={{ fontSize: 14 }} />
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
