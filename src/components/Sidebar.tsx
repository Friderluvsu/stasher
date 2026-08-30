import React, { useState, useCallback } from 'react';
import { useVaultStore } from '../state/vaultStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { notify } from '../state/toastStore';
import { ConfirmDialog } from './ConfirmDialog';
import { api } from '../services/api';
import { dragService } from '../services/dragService';
import type { ProjectItem } from '../services/api';

const TAG_ICONS: Record<string, string> = {
  All: 'ti-category',
  '808': 'ti-flame',
  Kick: 'ti-circle-dot',
  Snare: 'ti-circle-dashed',
  Clap: 'ti-hand-stop',
  'Hi-Hat': 'ti-sparkles',
  'Open Hat': 'ti-ripple',
  Rim: 'ti-crosshair',
  Perc: 'ti-grain',
  Tom: 'ti-circles',
  Crash: 'ti-sun',
  Bass: 'ti-wave-sine',
  Chords: 'ti-piano',
  Melody: 'ti-music',
  Lead: 'ti-wand',
  Pluck: 'ti-guitar-pick',
  Vox: 'ti-microphone',
  FX: 'ti-bolt',
  Other: 'ti-dots',
};

const CATEGORIES = [
  'All', '808', 'Kick', 'Snare', 'Clap', 'Hi-Hat', 'Open Hat',
  'Rim', 'Perc', 'Tom', 'Crash', 'Bass', 'Chords', 'Melody',
  'Lead', 'Pluck', 'Vox', 'FX', 'Other'
];

export const Sidebar: React.FC = () => {
  const {
    activeTab,
    selectedTag, setSelectedTag,
    totalPatterns, totalSounds,
    patternTagCounts, soundTagCounts,
    projects, selectedProjectId, setSelectedProjectId,
    deleteProject,
    fetchSounds,
    fetchPatterns
  } = useVaultStore();

  const language = useInterfaceStore((state) => state.language);
  const isRu = language === 'ru';

  const [projectToDelete, setProjectToDelete] = useState<ProjectItem | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);

  const isSoundsTab = activeTab === 'sounds';
  const tagCounts = isSoundsTab ? soundTagCounts : patternTagCounts;
  const total = isSoundsTab ? totalSounds : totalPatterns;

  const sectionLabel = activeTab === 'sounds'
    ? (isRu ? 'Категории звуков' : 'Sound Categories')
    : activeTab === 'kit'
    ? (isRu ? 'Навигация набора' : 'Kit Navigation')
    : (isRu ? 'Категории MIDI' : 'MIDI Categories');

  const handleCategoryDragOver = useCallback((e: React.DragEvent, cat: string) => {
    if (cat === 'All') return;
    const isInternal =
      dragService.getDragItem() !== null ||
      Boolean((window as any).__stasher_is_internal_drag) ||
      e.dataTransfer.types.includes('application/x-stasher-internal') ||
      e.dataTransfer.types.length > 0;

    if (isInternal) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setDragOverCategory(cat);
    }
  }, []);

  const handleCategoryDragLeave = useCallback((e: React.DragEvent, cat: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverCategory((prev) => (prev === cat ? null : prev));
    }
  }, []);

  const handleCategoryDrop = useCallback(
    async (e: React.DragEvent, targetCat: string) => {
      if (targetCat === 'All') return;
      e.preventDefault();
      e.stopPropagation();
      setDragOverCategory(null);

      const dragItem = dragService.getDragItem();
      const itemType =
        dragItem?.type ||
        (e.dataTransfer.getData('application/x-stasher-item-type') as 'sound' | 'pattern') ||
        (activeTab === 'sounds' ? 'sound' : 'pattern');

      let ids: number[] = dragItem?.ids || [];
      if (ids.length === 0 && dragItem?.id) {
        ids = [dragItem.id];
      }

      if (ids.length === 0) {
        const idsJson = e.dataTransfer.getData('application/x-stasher-item-ids');
        if (idsJson) {
          try {
            const parsed = JSON.parse(idsJson);
            if (Array.isArray(parsed)) {
              ids = parsed.map(Number).filter((n) => Number.isInteger(n) && n > 0);
            }
          } catch {}
        }
      }

      if (ids.length === 0) {
        const singleId = Number(
          e.dataTransfer.getData('application/x-stasher-item-id')
        );
        if (Number.isInteger(singleId) && singleId > 0) ids = [singleId];
      }

      ids = ids.filter((n) => Number.isInteger(n) && n > 0);

      if (ids.length === 0) {
        console.warn('No items found to drop');
        return;
      }

      try {
        const { batchUpdateItemsTag } = useVaultStore.getState();
        await batchUpdateItemsTag(itemType, ids, targetCat);

        if (itemType === 'sound' || activeTab === 'sounds') {
          notify.success(
            isRu
              ? `Перемещено в группу "${targetCat}": ${ids.length} ${
                  ids.length === 1 ? 'семпл' : 'семплов'
                }`
              : `Assigned ${ids.length} sample(s) to "${targetCat}"`,
            'StashSound'
          );
        } else {
          notify.success(
            isRu
              ? `Перемещено в группу "${targetCat}": ${ids.length} ${
                  ids.length === 1 ? 'паттерн' : 'паттернов'
                }`
              : `Assigned ${ids.length} pattern(s) to "${targetCat}"`,
            'MIDI Vault'
          );
        }
      } catch (err) {
        console.error('Failed to change tag via drag and drop:', err);
        notify.error(
          isRu ? 'Ошибка при смене группы' : 'Failed to assign category',
          'Stasher'
        );
      } finally {
        dragService.clearImmediately();
      }
    },
    [isRu, activeTab]
  );

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
            const isDropTarget = dragOverCategory === cat;
            const displayLabel = cat === 'All' ? (isRu ? 'Все' : 'All') : cat;
            return (
              <button
                key={cat}
                className={`${isActive ? 'is-active' : ''} ${
                  isDropTarget
                    ? 'ring-2 ring-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-[0_0_18px_rgba(154,144,255,0.4)] scale-[1.03] z-10'
                    : ''
                }`}
                onClick={() => { setSelectedProjectId(null); setSelectedTag(cat); }}
                onDragOver={(e) => handleCategoryDragOver(e, cat)}
                onDragLeave={(e) => handleCategoryDragLeave(e, cat)}
                onDrop={(e) => handleCategoryDrop(e, cat)}
                type="button"
                title={
                  cat === 'All'
                    ? displayLabel
                    : isRu
                    ? `Категория ${displayLabel} (перетащите сюда для смены группы)`
                    : `Category ${displayLabel} (drag & drop here to assign)`
                }
              >
                <i className={`ti ${TAG_ICONS[cat] || 'ti-dots'} pointer-events-none`} aria-hidden="true" />
                <span className="pointer-events-none">{displayLabel}</span>
                {isDropTarget ? (
                  <i className="ti ti-corner-down-left text-xs text-[var(--accent)] animate-pulse pointer-events-none" />
                ) : count > 0 ? (
                  <span className="navigation-count pointer-events-none">{count}</span>
                ) : null}
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
