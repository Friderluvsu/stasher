import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useVaultStore } from './state/vaultStore';
import { useInterfaceStore } from './state/interfaceStore';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { PatternCard } from './components/PatternCard';
import { SoundCard } from './components/SoundCard';
import { KitBuilder } from './components/KitBuilder';
import { MidiVisualizer } from './components/MidiVisualizer';
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
    totalPatterns, totalSounds, loadMorePatterns, loadMoreSounds,
    selectedTag,
    selectedProjectId, setSelectedProjectId,
    fetchPatterns, fetchSounds, fetchProjects, fetchKits, seedDemoData,
    startScan, uploadAndScan, isScanning, scanProgress,
    deleteProject,
    selectAllSounds, selectAllPatterns,
    isLoadingPatterns, isLoadingSounds,
    searchQuery,
    allSoundsSelected, allPatternsSelected,
  } = useVaultStore(useShallow((s) => ({
    activeTab: s.activeTab,
    patterns: s.patterns, sounds: s.sounds, projects: s.projects,
    totalPatterns: s.totalPatterns, totalSounds: s.totalSounds,
    loadMorePatterns: s.loadMorePatterns, loadMoreSounds: s.loadMoreSounds,
    selectedTag: s.selectedTag,
    selectedProjectId: s.selectedProjectId, setSelectedProjectId: s.setSelectedProjectId,
    fetchPatterns: s.fetchPatterns, fetchSounds: s.fetchSounds, fetchProjects: s.fetchProjects, fetchKits: s.fetchKits,
    seedDemoData: s.seedDemoData,
    startScan: s.startScan, uploadAndScan: s.uploadAndScan, isScanning: s.isScanning, scanProgress: s.scanProgress,
    deleteProject: s.deleteProject,
    selectAllSounds: s.selectAllSounds, selectAllPatterns: s.selectAllPatterns,
    isLoadingPatterns: s.isLoadingPatterns, isLoadingSounds: s.isLoadingSounds,
    searchQuery: s.searchQuery,
    // Booleans instead of the id arrays: App (and its list) re-renders when "all selected" flips, not on every checkbox.
    allSoundsSelected: s.sounds.length > 0 && s.selectedSoundIds.length === s.sounds.length,
    allPatternsSelected: s.patterns.length > 0 && s.selectedPatternIds.length === s.patterns.length,
  })));

  const { theme, language } = useInterfaceStore();
  const isRu = language === 'ru';

  const [projectToDelete, setProjectToDelete] = useState<ProjectItem | null>(null);
  const [visualizerOpened, setVisualizerOpened] = useState(false);
  // Set during render (not in an effect) so the first visit mounts the visualizer in the same frame.
  if (activeTab === 'visualizer' && !visualizerOpened) setVisualizerOpened(true);


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
    fetchKits();
    audioEngine.preloadSamples();
  }, [fetchPatterns, fetchSounds, fetchProjects, fetchKits]);

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

  const handleDrop = useCallback(async (e: React.DragEvent) => {
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
      const fileName = f.name || '';
      let filePath = '';

      // Electron 32+ removed File.path. webUtils is the supported replacement,
      // but crossing an isolated preload boundary can still reject some File
      // objects. A failed lookup must not abort the whole drop: individual FLP
      // files can always be sent to the upload endpoint as a fallback.
      try {
        filePath = (window as any).electronAPI?.getPathForFile?.(f) || (f as any).path || '';
      } catch (error) {
        console.warn('Could not resolve dropped file path, using upload fallback:', error);
      }

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

    if (validPaths.length === 0 && validFilesToUpload.length === 0) {
      notify.error(
        isRu ? 'Не найдено файлов .flp для импорта' : 'No .flp files found to import',
        'Stasher'
      );
      return;
    }

    try {
      // Upload pathless File objects first. This is the reliable fallback for
      // sandboxed Electron renderers on both macOS and Windows.
      if (validFilesToUpload.length > 0) {
        notify.info(
          isRu ? `Загрузка и сканирование ${validFilesToUpload.length} проектов...` : `Uploading and scanning ${validFilesToUpload.length} projects...`,
          'Stasher'
        );
        await uploadAndScan(validFilesToUpload);
      }

      if (validPaths.length > 0) {
        notify.info(
          isRu ? `Начато сканирование ${validPaths.length} проектов...` : `Started scanning ${validPaths.length} projects...`,
          'Stasher'
        );
        await startScan(validPaths);
      }
    } catch (error) {
      console.error('FLP drop import failed:', error);
      notify.error(
        isRu ? 'Не удалось импортировать .flp проект' : 'Failed to import .flp project',
        'Stasher'
      );
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
  const isFiltered = selectedTag !== 'All' || Boolean(searchQuery.trim()) || selectedProjectId !== null;

  const resetFilters = useCallback(() => {
    const store = useVaultStore.getState();
    if (store.searchQuery) store.setSearchQuery('');
    if (store.selectedProjectId !== null) store.setSelectedProjectId(null);
    if (store.selectedTag !== 'All') store.setSelectedTag('All');
  }, []);

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
                  background: 'color-mix(in srgb, var(--popover-surface) 88%, transparent)',
                  borderRadius: 'var(--radius-panel)',
                  border: '1.5px dashed color-mix(in srgb, var(--text) 35%, transparent)',
                  pointerEvents: 'none',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <i className="ti ti-folder-plus text-4xl text-[var(--muted)] block mb-3" />
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
                    {isRu ? 'Отпустите, чтобы добавить проекты' : 'Drop to add projects'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                    {isRu ? 'Файлы .flp или папки — MIDI и семплы извлекутся сами' : '.flp files or folders — MIDI and samples are extracted automatically'}
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
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                }}
              >
                <i className="ti ti-loader-2 text-[var(--muted)] text-xl animate-spin" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    {isRu ? 'Сканирование проектов…' : 'Scanning projects…'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }} className="truncate">
                    {scanProgress.current_file || (isRu ? 'Чтение проектов…' : 'Reading projects…')}
                    {scanProgress.total > 0 && ` — ${scanProgress.scanned}/${scanProgress.total}`}
                  </div>
                </div>
                {scanProgress.total > 0 && (
                  <div style={{ width: 140, height: 4, borderRadius: 999, background: 'color-mix(in srgb, var(--text) 10%, transparent)', overflow: 'hidden' }}>
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
            {currentProject && activeTab !== 'visualizer' && (
              <div
                className="glass-panel"
                style={{
                  margin: '0 28px 16px',
                  padding: '12px 18px',
                  borderRadius: 'var(--radius-panel)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 14,
                  background: 'var(--panel-strong)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <i className="ti ti-folder text-[var(--muted)] text-lg shrink-0" />
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

            {/* The visualizer stays mounted once opened (hidden on other tabs): leaving the tab used to drop its
                imports, audio and any running export. It ignores the sidebar filters, so its section key is constant. */}
            {visualizerOpened && (
              <SectionTransitionView sectionKey="visualizer" hidden={activeTab !== 'visualizer'}>
                <MidiVisualizer active={activeTab === 'visualizer'} />
              </SectionTransitionView>
            )}
            {activeTab !== 'visualizer' && (
            <SectionTransitionView sectionKey={`${activeTab}:${selectedProjectId || 'all'}:${selectedTag}`}>
              {activeTab === 'kit' ? (
                <KitBuilder />
              ) : activeTab === 'sounds' ? (
                <div className="workspace-content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="page-heading flex items-start justify-between">
                    <div>
                      <div className="title-line">
                        <h1>{isRu ? 'Семплы' : 'Samples'}</h1>
                        <span>{Math.max(totalSounds, sounds.length)}</span>
                      </div>
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
                            allSoundsSelected
                              ? 'ti-checkbox'
                              : 'ti-square-check'
                          } text-sm text-[var(--muted)]`}
                        />
                        <span>
                          {allSoundsSelected
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
                    isLoadingSounds ? null : (
                      <LibraryEmptyState kind="sounds" isFiltered={isFiltered} isRu={isRu} onReset={resetFilters} />
                    )
                  ) : (
                    <>
                      {sounds.map((sound) => (
                        <SoundCard key={sound.id} sound={sound} />
                      ))}
                      <LoadMoreRow items={sounds} total={totalSounds} onLoadMore={loadMoreSounds} isRu={isRu} />
                    </>
                  )}
                </div>
              ) : (
                <div className="workspace-content" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="page-heading flex items-start justify-between">
                    <div>
                      <div className="title-line">
                        <h1>{isRu ? 'MIDI Паттерны' : 'MIDI Patterns'}</h1>
                        <span>{Math.max(totalPatterns, patterns.length)}</span>
                      </div>
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
                            allPatternsSelected
                              ? 'ti-checkbox'
                              : 'ti-square-check'
                          } text-sm text-[var(--muted)]`}
                        />
                        <span>
                          {allPatternsSelected
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
                    isLoadingPatterns ? null : (
                      <LibraryEmptyState kind="patterns" isFiltered={isFiltered} isRu={isRu} onReset={resetFilters} />
                    )
                  ) : (
                    <>
                      {patterns.map((pattern) => (
                        <PatternCard key={pattern.id} pattern={pattern} />
                      ))}
                      <LoadMoreRow items={patterns} total={totalPatterns} onLoadMore={loadMorePatterns} isRu={isRu} />
                    </>
                  )}
                </div>
              )}
            </SectionTransitionView>
            )}
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

interface LoadMoreRowProps {
  items: readonly unknown[];
  total: number;
  onLoadMore: () => Promise<void>;
  isRu: boolean;
}

// Rows arrive a page at a time; the next page starts loading well before the end of the list scrolls into view.
// The button is the fallback when a page failed (the row is then already visible, so the observer will not fire again).
function LoadMoreRow({ items, total, onLoadMore, isRu }: LoadMoreRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const loaded = items.length;
  const hasMore = loaded < total;

  useEffect(() => {
    const row = rowRef.current;
    if (!hasMore || !row) return;
    const root = row.closest('.workspace-scroll-area');
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void onLoadMore();
      },
      { root, rootMargin: '0px 0px 800px 0px' }
    );
    observer.observe(row);
    return () => observer.disconnect();
    // A new list (a page, a refresh, a retag) re-arms the observer: its first report re-checks the row. Without this,
    // a row that appeared while the first fetch was still running (the page request is skipped then) never loaded more.
  }, [hasMore, items, onLoadMore]);

  if (!hasMore) return null;
  return (
    <div ref={rowRef} className="flex items-center justify-center" style={{ padding: '8px 0 16px' }}>
      <button type="button" className="soft-button" style={{ minHeight: 32, fontSize: 12 }} onClick={() => void onLoadMore()}>
        {isRu ? `Показать ещё (${loaded} из ${total})` : `Show more (${loaded} of ${total})`}
      </button>
    </div>
  );
}

interface LibraryEmptyStateProps {
  kind: 'patterns' | 'sounds';
  isFiltered: boolean;
  isRu: boolean;
  onReset: () => void;
}

// An empty filtered view is not an empty vault: say which one it is and offer the way back.
function LibraryEmptyState({ kind, isFiltered, isRu, onReset }: LibraryEmptyStateProps) {
  if (isFiltered) {
    return (
      <div className="glass-card empty-state">
        <div className="empty-state-icon"><i className="ti ti-filter-off" aria-hidden="true" /></div>
        <div>
          <h2>{isRu ? 'Ничего не найдено' : 'Nothing matches'}</h2>
          <p>{isRu ? 'В этой категории, проекте или по этому запросу пусто.' : 'This category, project or search has no results.'}</p>
        </div>
        <button type="button" className="soft-button" style={{ minHeight: 32, fontSize: 12 }} onClick={onReset}>
          {isRu ? 'Показать всё' : 'Show everything'}
        </button>
      </div>
    );
  }
  const isSounds = kind === 'sounds';
  return (
    <div className="glass-card empty-state">
      <div className="empty-state-icon"><i className={`ti ${isSounds ? 'ti-volume' : 'ti-music'}`} aria-hidden="true" /></div>
      <div>
        <h2>
          {isSounds
            ? (isRu ? 'Семплов пока нет' : 'No samples yet')
            : (isRu ? 'MIDI-паттернов пока нет' : 'No MIDI patterns yet')}
        </h2>
        <p>
          {isSounds
            ? (isRu
              ? 'Перетащите проекты FL Studio (.flp) в окно — Stasher извлечёт все семплы, которые в них используются.'
              : 'Drop FL Studio projects (.flp) into the window and Stasher extracts every sample they use.')
            : (isRu
              ? 'Перетащите проекты FL Studio (.flp) в окно — Stasher извлечёт мелодии, аккорды и партии ударных.'
              : 'Drop FL Studio projects (.flp) into the window and Stasher extracts melodies, chords and drum parts.')}
        </p>
      </div>
    </div>
  );
}
