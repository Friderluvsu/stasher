import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useVaultStore } from '../state/vaultStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { TagPickerPopover } from './TagPickerPopover';
import { ConfirmDialog } from './ConfirmDialog';
import { notify } from '../state/toastStore';

export const BatchActionBar: React.FC = () => {
  const {
    activeTab,
    sounds,
    patterns,
    selectedSoundIds,
    selectedPatternIds,
    selectAllSounds,
    selectAllPatterns,
    clearSelection,
    batchDeleteSelected,
    batchUpdateTagSelected,
    batchAddSelectedToKit,
    kits,
    activeKitId,
    createKit,
  } = useVaultStore();

  const language = useInterfaceStore((state) => state.language);
  const isRu = language === 'ru';

  const isSounds = activeTab === 'sounds';
  const selectedIds = isSounds ? selectedSoundIds : selectedPatternIds;
  const totalItemsCount = isSounds ? sounds.length : patterns.length;
  const selectedCount = selectedIds.length;

  const [isTagMenuOpen, setIsTagMenuOpen] = useState(false);
  const [isKitMenuOpen, setIsKitMenuOpen] = useState(false);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreatingKit, setIsCreatingKit] = useState(false);
  const [newKitName, setNewKitName] = useState('');
  const [kitMenuCoords, setKitMenuCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const tagButtonRef = useRef<HTMLButtonElement>(null);
  const kitButtonRef = useRef<HTMLButtonElement>(null);
  const kitMenuRef = useRef<HTMLDivElement>(null);

  // Clear selection on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedCount > 0) {
        clearSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCount, clearSelection]);

  // Position Kit Menu Popover above or below button
  useEffect(() => {
    if (!isKitMenuOpen) return;

    if (kitButtonRef.current) {
      const rect = kitButtonRef.current.getBoundingClientRect();
      const popoverWidth = 230;
      const popoverHeight = 240;

      let top = rect.top - popoverHeight - 8;
      if (top < 10) {
        top = rect.bottom + 8;
      }

      let left = rect.left + rect.width / 2 - popoverWidth / 2;
      if (left < 10) left = 10;
      if (left + popoverWidth > window.innerWidth - 10) {
        left = window.innerWidth - popoverWidth - 10;
      }

      setKitMenuCoords({ top, left });
    }

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (
        kitMenuRef.current &&
        !kitMenuRef.current.contains(e.target as Node) &&
        (!kitButtonRef.current || !kitButtonRef.current.contains(e.target as Node))
      ) {
        setIsKitMenuOpen(false);
        setIsCreatingKit(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isKitMenuOpen]);

  if (selectedCount === 0 || activeTab === 'kit') {
    return null;
  }

  const activeKit = kits.find((k) => k.id === activeKitId) || kits[0];

  const handleSelectAllToggle = () => {
    if (isSounds) {
      selectAllSounds();
    } else {
      selectAllPatterns();
    }
  };

  const handleTagSelect = async (tag: string) => {
    setIsTagMenuOpen(false);
    try {
      await batchUpdateTagSelected(tag);
      notify.success(
        isRu
          ? `Группа ${selectedCount} элементов изменена на "${tag}"`
          : `Changed category of ${selectedCount} items to "${tag}"`,
        'Stasher'
      );
    } catch {
      notify.error(
        isRu ? 'Ошибка при смене группы' : 'Failed to update category',
        'Stasher'
      );
    }
  };

  const handleKitSelect = (kitId: string) => {
    setIsKitMenuOpen(false);
    const targetKit = kits.find((k) => k.id === kitId) || activeKit;
    batchAddSelectedToKit(kitId);
    notify.success(
      isRu
        ? `Добавлено ${selectedCount} элементов в кит "${targetKit.name}"`
        : `Added ${selectedCount} items to "${targetKit.name}"`,
      'Kit Builder'
    );
    clearSelection();
  };

  const handleCreateKitAndAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKitName.trim()) return;
    const newId = createKit(newKitName.trim());
    batchAddSelectedToKit(newId);
    notify.success(
      isRu
        ? `Создан кит "${newKitName.trim()}" и добавлено ${selectedCount} элементов`
        : `Created "${newKitName.trim()}" and added ${selectedCount} items`,
      'Kit Builder'
    );
    setNewKitName('');
    setIsCreatingKit(false);
    setIsKitMenuOpen(false);
    clearSelection();
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
      await batchDeleteSelected();
      notify.success(
        isRu ? `Удалено ${selectedCount} элементов` : `Deleted ${selectedCount} items`,
        'Stasher'
      );
    } catch {
      notify.error(
        isRu ? 'Ошибка при удалении элементов' : 'Failed to delete items',
        'Stasher'
      );
    } finally {
      setIsDeleting(false);
      setIsConfirmDeleteOpen(false);
    }
  };

  return (
    <>
      <div
        className="batch-action-bar fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-2 rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200"
        style={{
          background: 'rgba(16, 18, 26, 0.97)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
        }}
      >
        {/* Count Badge */}
        <div className="flex items-center gap-2 pr-2 border-r border-white/10">
          <div
            className="w-6 h-6 rounded-lg grid place-items-center text-xs font-bold"
            style={{ background: 'var(--accent)', color: '#0e1017' }}
          >
            {selectedCount}
          </div>
          <span className="text-xs font-semibold text-[var(--text)] whitespace-nowrap">
            {isRu ? `Выбрано: ${selectedCount}` : `${selectedCount} selected`}
          </span>
        </div>

        {/* Select all toggle */}
        <button
          onClick={handleSelectAllToggle}
          className="soft-button flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-xl transition-all cursor-pointer"
          style={{ minHeight: 30 }}
          type="button"
          title={isRu ? 'Выбрать все / Снять' : 'Select all / Deselect'}
        >
          <i
            className={`ti ${
              selectedCount === totalItemsCount ? 'ti-checkbox' : 'ti-square-check'
            } text-sm text-[var(--accent)]`}
          />
          <span>
            {selectedCount === totalItemsCount
              ? isRu
                ? 'Снять все'
                : 'Deselect All'
              : isRu
              ? `Все (${totalItemsCount})`
              : `All (${totalItemsCount})`}
          </span>
        </button>

        {/* Add to Kit Button */}
        <div className="relative">
          <button
            ref={kitButtonRef}
            onClick={() => setIsKitMenuOpen(!isKitMenuOpen)}
            className="soft-button flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl transition-all cursor-pointer"
            style={{ minHeight: 30 }}
            type="button"
            title={isRu ? 'Добавить выбранное в драм-кит' : 'Add selected to sound kit'}
          >
            <i className="ti ti-folder-plus text-sm text-[var(--accent)]" />
            <span>{isRu ? 'В кит' : 'Add to Kit'}</span>
            <i className="ti ti-chevron-down text-[10px] opacity-60" />
          </button>
        </div>

        {/* Change Group / Tag Button */}
        <div className="relative">
          <button
            ref={tagButtonRef}
            onClick={() => setIsTagMenuOpen(!isTagMenuOpen)}
            className="soft-button flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl transition-all cursor-pointer"
            style={{ minHeight: 30 }}
            type="button"
            title={isRu ? 'Сменить категорию/тег' : 'Change category / tag'}
          >
            <i className="ti ti-tag text-sm text-[var(--accent)]" />
            <span>{isRu ? 'Сменить группу' : 'Change Tag'}</span>
            <i className="ti ti-chevron-down text-[10px] opacity-60" />
          </button>

          <TagPickerPopover
            isOpen={isTagMenuOpen}
            onClose={() => setIsTagMenuOpen(false)}
            currentTag=""
            onSelectTag={handleTagSelect}
            anchorEl={tagButtonRef.current}
          />
        </div>

        {/* Delete Button */}
        <button
          onClick={() => setIsConfirmDeleteOpen(true)}
          className="danger-button flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl transition-all cursor-pointer"
          style={{ minHeight: 30 }}
          type="button"
          title={isRu ? 'Удалить выбранные' : 'Delete selected'}
        >
          <i className="ti ti-trash text-sm" />
          <span>{isRu ? 'Удалить' : 'Delete'}</span>
        </button>

        {/* Cancel / Clear Selection Button */}
        <button
          onClick={clearSelection}
          className="w-7 h-7 rounded-full grid place-items-center text-white/50 hover:text-white hover:bg-white/10 transition-all cursor-pointer ml-1"
          type="button"
          title={isRu ? 'Снять выделение (Esc)' : 'Clear selection (Esc)'}
        >
          <i className="ti ti-x text-sm" />
        </button>
      </div>

      {/* Kit Picker Dropdown Portal */}
      {isKitMenuOpen &&
        ReactDOM.createPortal(
          <div
            ref={kitMenuRef}
            style={{
              position: 'fixed',
              top: kitMenuCoords.top,
              left: kitMenuCoords.left,
              zIndex: 9999,
              width: 230,
              maxHeight: 280,
              background: 'rgba(18, 20, 29, 0.96)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              borderRadius: 16,
              border: '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: '0 16px 36px rgba(0, 0, 0, 0.6), 0 0 20px rgba(154, 144, 255, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              padding: '8px',
              gap: 4,
            }}
          >
            <div className="text-[11px] font-bold text-[var(--muted)] px-2 py-1 tracking-wider uppercase">
              {isRu ? 'Выберите кит' : 'Select Target Kit'}
            </div>

            <div className="flex flex-col gap-1 overflow-y-auto max-h-[160px] pr-1">
              {kits.map((k) => (
                <button
                  key={k.id}
                  onClick={() => handleKitSelect(k.id)}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-left text-[var(--text)] hover:bg-white/10 transition-all cursor-pointer"
                  type="button"
                >
                  <div className="flex items-center gap-2 truncate">
                    <i className="ti ti-package text-sm text-[var(--accent)]" />
                    <span className="truncate font-medium">{k.name}</span>
                  </div>
                  <span className="text-[10px] text-[var(--muted)] shrink-0 ml-2">
                    {k.sounds.length + k.patterns.length}
                  </span>
                </button>
              ))}
            </div>

            <div className="border-t border-white/10 pt-1.5 mt-1">
              {!isCreatingKit ? (
                <button
                  onClick={() => setIsCreatingKit(true)}
                  className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-all cursor-pointer font-semibold"
                  type="button"
                >
                  <i className="ti ti-plus text-sm" />
                  <span>{isRu ? 'Новый кит...' : 'New Kit...'}</span>
                </button>
              ) : (
                <form onSubmit={handleCreateKitAndAdd} className="flex flex-col gap-1.5 p-1">
                  <input
                    type="text"
                    autoFocus
                    value={newKitName}
                    onChange={(e) => setNewKitName(e.target.value)}
                    placeholder={isRu ? 'Название кита' : 'Kit Name'}
                    className="w-full bg-white/5 border border-white/20 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-[var(--accent)]"
                  />
                  <div className="flex gap-1 justify-end">
                    <button
                      type="button"
                      onClick={() => setIsCreatingKit(false)}
                      className="soft-button px-2 py-0.5 text-[11px] rounded"
                    >
                      {isRu ? 'Отмена' : 'Cancel'}
                    </button>
                    <button
                      type="submit"
                      className="px-2 py-0.5 text-[11px] rounded bg-[var(--accent)] text-[#0e1017] font-semibold"
                    >
                      {isRu ? 'Создать' : 'Create'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* Delete Confirmation Modal */}
      <ConfirmDialog
        open={isConfirmDeleteOpen}
        title={isRu ? 'Удалить выбранные элементы?' : 'Delete Selected Items?'}
        message={
          isRu
            ? `Вы собираетесь удалить ${selectedCount} ${
                isSounds ? 'семплов' : 'MIDI-паттернов'
              } из базы данных.\nЭто действие необратимо.`
            : `Are you sure you want to delete ${selectedCount} selected ${
                isSounds ? 'samples' : 'MIDI patterns'
              } from your vault?\nThis cannot be undone.`
        }
        confirmLabel={
          isDeleting
            ? isRu
              ? 'Удаление...'
              : 'Deleting...'
            : isRu
            ? `Удалить (${selectedCount})`
            : `Delete (${selectedCount})`
        }
        cancelLabel={isRu ? 'Отмена' : 'Cancel'}
        danger={true}
        onCancel={() => setIsConfirmDeleteOpen(false)}
        onConfirm={handleDeleteConfirm}
      />
    </>
  );
};
