import React, { useState } from 'react';
import { useVaultStore } from '../state/vaultStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { notify } from '../state/toastStore';
import { ConfirmDialog } from './ConfirmDialog';
import type { ProjectItem } from '../services/api';

const TAG_ICONS: Record<string, string> = {
  All: 'ti-disc',
  '808': 'ti-flame',
  Kick: 'ti-circle-dot',
  Snare: 'ti-circle-dashed',
  Clap: 'ti-hand-click',
  'Hi-Hat': 'ti-sparkles',
  'Open Hat': 'ti-ripple',
  Chords: 'ti-stack-2',
  Melody: 'ti-music',
  Lead: 'ti-wand',
  Pluck: 'ti-guitar-pick',
  Bass: 'ti-wave-sine',
  Perc: 'ti-brand-beats',
  Rim: 'ti-target',
  Vox: 'ti-microphone-2',
  FX: 'ti-bolt',
  Other: 'ti-dots',
};

const CATEGORIES = [
  'All', '808', 'Kick', 'Snare', 'Clap', 'Hi-Hat', 'Open Hat',
  'Chords', 'Melody', 'Lead', 'Pluck', 'Bass', 'Perc', 'Rim', 'Vox', 'FX', 'Other'
];

export const Sidebar: React.FC = () => {
  const {
    activeTab,
    selectedTag, setSelectedTag,
    totalPatterns, totalSounds,
    patternTagCounts, soundTagCounts,
    projects, selectedProjectId, setSelectedProjectId,
    deleteProject
  } = useVaultStore();

  const language = useInterfaceStore((state) => state.language);
  const isRu = language === 'ru';

  const [projectToDelete, setProjectToDelete] = useState<ProjectItem | null>(null);

  const isSoundsTab = activeTab === 'sounds';
  const tagCounts = isSoundsTab ? soundTagCounts : patternTagCounts;
  const total = isSoundsTab ? totalSounds : totalPatterns;

  const sectionLabel = activeTab === 'sounds'
    ? (isRu ? 'Категории звуков' : 'Sound Categories')
    : activeTab === 'kit'
    ? (isRu ? 'Навигация набора' : 'Kit Navigation')
    : (isRu ? 'Категории MIDI' : 'MIDI Categories');

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

  return (
    <>
      <aside className="sidebar glass-panel">
        {/* Brand Header */}
        <div className="brand-row">
          <div className="brand-icon-box">
            <i className="ti ti-stack-2" />
          </div>
          <span>STASHER</span>
          <span className="plan-badge">PRO</span>
        </div>

        {/* Navigation list */}
        <nav className="side-navigation" aria-label="Categories">
          <span className="side-navigation-label">{sectionLabel}</span>

          {CATEGORIES.map((cat) => {
            const count = cat === 'All' ? total : (tagCounts[cat] || 0);
            const isActive = selectedTag === cat && selectedProjectId === null;
            const displayLabel = cat === 'All' ? (isRu ? 'Все' : 'All') : cat;
            return (
              <button
                key={cat}
                className={isActive ? 'is-active' : ''}
                onClick={() => { setSelectedProjectId(null); setSelectedTag(cat); }}
                type="button"
                title={displayLabel}
              >
                <i className={`ti ${TAG_ICONS[cat] || 'ti-dots'}`} aria-hidden="true" />
                <span>{displayLabel}</span>
                {count > 0 && <span className="navigation-count">{count}</span>}
              </button>
            );
          })}

          {/* Projects subsection */}
          {projects.length > 0 && (
            <>
              <span className="side-navigation-label" style={{ marginTop: 12 }}>
                {isRu ? 'Проекты FLP' : 'FLP Projects'}
              </span>
              {projects.map((proj) => {
                const isActive = selectedProjectId === proj.id;
                return (
                  <div
                    key={proj.id}
                    className={`group relative flex items-center w-full rounded-[12px] transition-all ${
                      isActive ? 'bg-[var(--panel-strong)] border border-[var(--line)]' : 'hover:bg-white/[0.04]'
                    }`}
                    style={{ minHeight: 38 }}
                  >
                    <button
                      className="flex-1 min-w-0 flex items-center gap-2.5 px-2.5 text-left bg-transparent border-0 cursor-pointer"
                      onClick={() => setSelectedProjectId(isActive ? null : proj.id)}
                      type="button"
                      title={proj.title}
                      style={{ color: isActive ? 'var(--text)' : 'var(--muted)', fontSize: '13.5px', fontWeight: 500 }}
                    >
                      <i className="ti ti-folder text-[17px] shrink-0" aria-hidden="true" />
                      <span className="truncate flex-1">{proj.title}</span>
                    </button>

                    <div className="flex items-center gap-1 pr-2 shrink-0">
                      <span className="navigation-count shrink-0">{proj.tempo}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setProjectToDelete(proj);
                        }}
                        className="w-6 h-6 rounded-md grid place-items-center bg-transparent border-0 cursor-pointer text-[var(--soft)] hover:text-[var(--danger)] hover:bg-[rgba(255,135,144,0.15)] opacity-0 group-hover:opacity-100 transition-all"
                        type="button"
                        title={isRu ? 'Удалить проект' : 'Delete project'}
                      >
                        <i className="ti ti-trash text-[13px]" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </nav>

        {/* Pinned Settings Button at bottom */}
        <button
          className="side-settings"
          type="button"
          onClick={() => notify.info(isRu ? 'Stasher Studio Pro v1.0.0 (Все функции активны)' : 'Stasher Studio Pro v1.0.0 (All features active)', 'Settings')}
          title={isRu ? 'Настройки' : 'Settings'}
        >
          <i className="ti ti-settings" aria-hidden="true" />
          <span>{isRu ? 'Настройки' : 'Settings'}</span>
        </button>
      </aside>

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
    </>
  );
};
