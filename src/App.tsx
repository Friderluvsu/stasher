import React, { useEffect, useState, useCallback } from 'react';
import { useVaultStore } from './state/vaultStore';
import { useInterfaceStore } from './state/interfaceStore';
import { useMouseSpotlight } from './hooks/useMouseSpotlight';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { PatternCard } from './components/PatternCard';
import { SoundCard } from './components/SoundCard';
import { KitBuilder } from './components/KitBuilder';
import { SectionTransitionView } from './components/SectionTransitionView';
import { ToastContainer } from './components/ToastContainer';
import { ConfirmDialog } from './components/ConfirmDialog';
import { notify } from './state/toastStore';
import { BatchActionBar } from './components/BatchActionBar';
import { audioEngine } from './services/audioEngine';
import type { ProjectItem } from './services/api';

export default function App() {
  const {
    activeTab,
    patterns, sounds, projects,
    selectedTag,
    selectedProjectId, setSelectedProjectId,
    fetchPatterns, fetchSounds, fetchProjects, seedDemoData,
    startScan, uploadAndScan, isScanning, scanProgress,
    deleteProject,
    selectedSoundIds, selectedPatternIds,
    selectAllSounds, selectAllPatterns
  } = useVaultStore();

  const { theme, language } = useInterfaceStore();
  const isRu = language === 'ru';

  const [projectToDelete, setProjectToDelete] = useState<ProjectItem | null>(null);

  useMouseSpotlight();

  // Manage platform & theme dataset attributes on body & html
  useEffect(() => {
    document.documentElement.lang = language;
    const isMac = navigator.userAgent.includes('Mac') || navigator.platform.includes('Mac');
    document.body.dataset.platform = isMac ? 'darwin' : 'win32';

    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');

    function updateTheme() {
      const effectiveTheme = theme === 'system'
        ? (mediaQuery?.matches ? 'dark' : 'light')
        : theme;
      document.body.dataset.theme = effectiveTheme;
    }

    updateTheme();

    if (theme === 'system' && mediaQuery) {
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', updateTheme);
        return () => mediaQuery.removeEventListener('change', updateTheme);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(updateTheme);
        return () => mediaQuery.removeListener(updateTheme);
      }
    }
  }, [language, theme]);

  useEffect(() => {
    fetchPatterns();
    fetchSounds();
    fetchProjects();
    audioEngine.preloadSamples();
  }, [fetchPatterns, fetchSounds, fetchProjects]);

  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    // If dragging internal items (cards, previews) or marked internal, ignore
    if (
      (window as any).__stasher_is_internal_drag ||
      e.dataTransfer.types.includes('application/x-stasher-internal')
    ) {
      setIsDragOver(false);
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    // Strict protection: Ignore internal card drags
    if (
      (window as any).__stasher_is_internal_drag ||
      e.dataTransfer.types.includes('application/x-stasher-internal')
    ) {
      return;
    }

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    const validPaths: string[] = [];
    const validFilesToUpload: File[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const filePath = (f as any).path || '';
      const fileName = f.name || '';

      // Ignore temp export cache or audio/midi files
      if (filePath.includes('stasher_drag_cache')) continue;
      const lowerName = fileName.toLowerCase();
      const lowerPath = filePath.toLowerCase();
      if (
        lowerName.endsWith('.mid') ||
        lowerName.endsWith('.midi') ||
        lowerName.endsWith('.wav') ||
        lowerName.endsWith('.mp3')
      ) {
        continue;
      }

      // Only accept .flp files or folders
      if (lowerName.endsWith('.flp') || lowerPath.endsWith('.flp') || !fileName.includes('.')) {
        if (filePath) {
          validPaths.push(filePath);
        } else {
          validFilesToUpload.push(f);
        }
      }
    }

    if (validPaths.length > 0) {
      notify.info(
        isRu ? `Начато сканирование ${validPaths.length} проектов...` : `Started scanning ${validPaths.length} projects...`,
        'Stasher'
      );
      startScan(validPaths);
    } else if (validFilesToUpload.length > 0) {
      notify.info(
        isRu ? `Загрузка и сканирование ${validFilesToUpload.length} проектов...` : `Uploading and scanning ${validFilesToUpload.length} projects...`,
        'Stasher'
      );
      uploadAndScan(validFilesToUpload);
    }
  }, [isRu, startScan, uploadAndScan]);

  const handleDeleteConfirm = async () => {
    if (!projectToDelete) return;
    const projName = projectToDelete.title;
    try {
      await deleteProject(projectToDelete.id);
      notify.success(
        isRu ? `Проект "${projName}" успешно удален` : `Project "${projName}" deleted successfully`,
        'Stasher'
      );
    } catch {
      notify.error(isRu ? 'Ошибка при удалении проекта' : 'Failed to delete project', 'Stasher');
    } finally {
      setProjectToDelete(null);
    }
  };

  const currentProject = selectedProjectId ? projects.find((p) => p.id === selectedProjectId) : null;

  return (
    <div className="app-atmosphere">
      <div aria-hidden="true" className="window-drag-region" />

      <div
        className="workspace-frame"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Sidebar />

        <div className="workspace-main">
          <Topbar />

          <div
            className={`workspace-scroll-area ${isDragOver ? 'drop-zone-active' : ''}`}
          >
            {isDragOver && (
              <div
                style={{
                  position: 'absolute',
                  inset: '14px 28px',
                  zIndex: 50,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(154, 144, 255, 0.08)',
                  borderRadius: 'var(--radius-panel)',
                  border: '2px dashed var(--accent)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  pointerEvents: 'none',
                  boxShadow: '0 0 50px rgba(154, 144, 255, 0.25)',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <i className="ti ti-folder-plus text-5xl text-[var(--accent)] block mb-3" />
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>
                    {isRu ? 'Перетащите FL Studio Проекты Сюда' : 'Drop FL Studio Projects Here'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    {isRu ? 'Автоматическое извлечение MIDI и One-Shot семплов из .flp' : 'Drop .flp files or folders to automatically extract MIDI & sounds'}
                  </div>
                </div>
              </div>
            )}

            {isScanning && (
              <div
                className="glass-panel scan-banner"
                style={{
                  margin: '0 28px 16px',
                  padding: '14px 20px',
                  borderRadius: 18,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  background: 'var(--accent-soft)',
                  borderColor: 'rgba(154, 144, 255, 0.35)',
                }}
              >
                <i className="ti ti-loader-2 text-[var(--accent)] text-xl animate-spin" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    {isRu ? 'Сканирование и извлечение данных...' : 'Scanning & Extracting Patterns…'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontFamily: 'monospace' }}>
                    {scanProgress.current_file || (isRu ? 'Чтение проектов…' : 'Reading projects…')}
                    {scanProgress.total > 0 && ` — ${scanProgress.scanned}/${scanProgress.total}`}
                  </div>
                </div>
                {scanProgress.total > 0 && (
                  <div style={{ width: 140, height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        borderRadius: 999,
                        background: 'var(--accent)',
                        width: `${Math.min(100, Math.round((scanProgress.scanned / scanProgress.total) * 100))}%`,
                        transition: 'width 300ms ease',
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Active Project Filter Banner */}
            {currentProject && (
              <div
                className="glass-panel"
                style={{
                  margin: '0 28px 16px',
                  padding: '12px 18px',
                  borderRadius: 16,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 14,
                  background: 'var(--panel-strong)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <i className="ti ti-folder text-[var(--accent)] text-lg shrink-0" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }} className="truncate">
                      {currentProject.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                      {currentProject.tempo} BPM · {currentProject.file_name}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <button
                    className="soft-button"
                    style={{ minHeight: 32, padding: '0 12px', fontSize: 11 }}
                    onClick={() => setSelectedProjectId(null)}
                    type="button"
                  >
                    <i className="ti ti-x" aria-hidden="true" />
                    <span>{isRu ? 'Все проекты' : 'All Projects'}</span>
                  </button>

                  <button
                    className="danger-button"
                    style={{ minHeight: 32, padding: '0 12px', fontSize: 11, borderRadius: 'var(--radius-control)' }}
                    onClick={() => setProjectToDelete(currentProject)}
                    type="button"
                    title={isRu ? 'Удалить этот проект из базы' : 'Delete this project'}
                  >
                    <i className="ti ti-trash" aria-hidden="true" />
                    <span>{isRu ? 'Удалить проект' : 'Delete Project'}</span>
                  </button>
                </div>
              </div>
            )}

            <SectionTransitionView sectionKey={`${activeTab}:${selectedProjectId || 'all'}:${selectedTag}`}>
              {activeTab === 'kit' ? (
                <KitBuilder />
              ) : activeTab === 'sounds' ? (
                <div className="workspace-content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="page-heading flex items-start justify-between">
                    <div>
                      <p className="eyebrow">{isRu ? 'Хранилище аудио' : 'Audio Library'}</p>
                      <div className="title-line">
                        <h1>{isRu ? 'StashSound Семплы' : 'StashSound Samples'}</h1>
                        <span>{sounds.length}</span>
                      </div>
                      <p className="page-description">
                        {isRu
                          ? 'Все ваншоты, 808, кики, снейры, хэты и перкуссия, автоматически извлеченные из ваших FL Studio проектов.'
                          : 'Every drum one-shot, 808, kick, snare, hat, and percussion extracted directly from your FL Studio project files.'}
                      </p>
                    </div>

                    {sounds.length > 0 && (
                      <button
                        onClick={() => selectAllSounds()}
                        className="soft-button flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl transition-all cursor-pointer shrink-0 mt-2"
                        style={{ minHeight: 32 }}
                        type="button"
                        title={isRu ? 'Выбрать все семплы' : 'Select all samples'}
                      >
                        <i
                          className={`ti ${
                            selectedSoundIds.length === sounds.length && sounds.length > 0
                              ? 'ti-checkbox'
                              : 'ti-square-check'
                          } text-sm text-[var(--accent)]`}
                        />
                        <span>
                          {selectedSoundIds.length === sounds.length && sounds.length > 0
                            ? isRu
                              ? 'Снять все'
                              : 'Deselect All'
                            : isRu
                            ? 'Выбрать все'
                            : 'Select All'}
                        </span>
                      </button>
                    )}
                  </div>

                  {sounds.length === 0 && !isScanning ? (
                    <div
                      className="glass-card"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '60px 24px',
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
                          fontSize: 28,
                        }}
                      >
                        <i className="ti ti-volume" />
                      </div>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                          {isRu ? 'Аудиосемплы не найдены' : 'No Audio Samples Found'}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4, maxWidth: 400, lineHeight: '1.5' }}>
                          {isRu
                            ? 'Перетащите FL Studio проекты (.flp) в окно, чтобы извлечь все используемые барабанные ваншоты и звуки.'
                            : 'Drag & drop your FL Studio projects to extract all 808s, kicks, snares, and drum samples.'}
                        </div>
                      </div>
                      
                    </div>
                  ) : (
                    sounds.map((sound) => (
                      <SoundCard key={sound.id} sound={sound} />
                    ))
                  )}
                </div>
              ) : (
                <div className="workspace-content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="page-heading flex items-start justify-between">
                    <div>
                      <p className="eyebrow">{isRu ? 'MIDI Хранилище' : 'MIDI Vault'}</p>
                      <div className="title-line">
                        <h1>{isRu ? 'MIDI Паттерны' : 'MIDI Patterns'}</h1>
                        <span>{patterns.length}</span>
                      </div>
                      <p className="page-description">
                        {isRu
                          ? 'Мелодии, аккорды, бас-линии и драм-паттерны с поддержкой прямого drag-and-drop в FL Studio, Ableton и любую DAW.'
                          : 'Melodies, chord progressions, 808 slides, and drum grooves with instant drag-and-drop to your DAW.'}
                      </p>
                    </div>

                    {patterns.length > 0 && (
                      <button
                        onClick={() => selectAllPatterns()}
                        className="soft-button flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl transition-all cursor-pointer shrink-0 mt-2"
                        style={{ minHeight: 32 }}
                        type="button"
                        title={isRu ? 'Выбрать все паттерны' : 'Select all patterns'}
                      >
                        <i
                          className={`ti ${
                            selectedPatternIds.length === patterns.length && patterns.length > 0
                              ? 'ti-checkbox'
                              : 'ti-square-check'
                          } text-sm text-[var(--accent)]`}
                        />
                        <span>
                          {selectedPatternIds.length === patterns.length && patterns.length > 0
                            ? isRu
                              ? 'Снять все'
                              : 'Deselect All'
                            : isRu
                            ? 'Выбрать все'
                            : 'Select All'}
                        </span>
                      </button>
                    )}
                  </div>

                  {patterns.length === 0 && !isScanning ? (
                    <div
                      className="glass-card"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '60px 24px',
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
                          fontSize: 28,
                        }}
                      >
                        <i className="ti ti-music" />
                      </div>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                          {isRu ? 'Ваше MIDI Хранилище пусто' : 'Your MIDI Vault is Empty'}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4, maxWidth: 400, lineHeight: '1.5' }}>
                          {isRu
                            ? 'Перетащите файлы проектов (.flp) в окно, чтобы извлечь все партии мелодий, аккордов и ударных.'
                            : 'Drag & drop your FL Studio project files (.flp) to extract every melody, chord progression, and 808 roll.'}
                        </div>
                      </div>
                      
                    </div>
                  ) : (
                    patterns.map((pattern) => (
                      <PatternCard key={pattern.id} pattern={pattern} />
                    ))
                  )}
                </div>
              )}
            </SectionTransitionView>
          </div>
        </div>
      </div>

      <BatchActionBar />

      {/* Confirm Delete Project Dialog */}
      <ConfirmDialog
        open={Boolean(projectToDelete)}
        title={isRu ? 'Удалить проект?' : 'Delete Project?'}
        message={
          isRu
            ? `Вы уверены, что хотите удалить проект "${projectToDelete?.title}"?\nВсе извлеченные из него MIDI-паттерны и семплы будут удалены из базы данных.`
            : `Are you sure you want to delete "${projectToDelete?.title}"?\nAll extracted MIDI patterns and samples will be removed from your vault.`
        }
        confirmLabel={isRu ? 'Удалить' : 'Delete'}
        cancelLabel={isRu ? 'Отмена' : 'Cancel'}
        danger={true}
        onCancel={() => setProjectToDelete(null)}
        onConfirm={handleDeleteConfirm}
      />

      <ToastContainer />
    </div>
  );
}
