import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { api } from '../services/api';
import { useVaultStore } from '../state/vaultStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { notify } from '../state/toastStore';
import { TAGS, canonicalTag } from '../utils/tags';
import { TagGrid } from './TagPickerPopover';

interface EditItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemType: 'sound' | 'pattern';
  itemId: number;
  initialName: string;
  initialTag: string;
}

export const EditItemModal: React.FC<EditItemModalProps> = ({
  isOpen, onClose, itemType, itemId, initialName, initialTag
}) => {
  const [name, setName] = useState(initialName);
  const [tag, setTag] = useState(canonicalTag(initialTag));
  const [isSaving, setIsSaving] = useState(false);
  const updateItemInStore = useVaultStore((state) => state.updateItemInStore);
  const isRu = useInterfaceStore((state) => state.language) === 'ru';

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setTag(canonicalTag(initialTag));
    }
  }, [isOpen, initialName, initialTag]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSaving) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSaving, onClose]);

  if (!isOpen) return null;

  const trimmedName = name.trim();
  const isDirty = trimmedName !== initialName.trim() || tag !== canonicalTag(initialTag);
  const source = itemType === 'sound' ? 'StashSound' : 'MIDI Vault';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedName) return;
    if (!isDirty) {
      onClose();
      return;
    }
    setIsSaving(true);
    try {
      if (itemType === 'sound') {
        await api.updateSound(itemId, trimmedName, tag);
      } else {
        await api.updatePattern(itemId, trimmedName, tag);
      }
      updateItemInStore(itemType, itemId, trimmedName, tag);
      notify.success(isRu ? 'Изменения сохранены' : 'Changes saved', source);
      onClose();
    } catch (err) {
      console.error('Failed to update item:', err);
      notify.error(
        isRu ? 'Не удалось сохранить. Проверьте, что движок Stasher запущен, и попробуйте ещё раз.' : 'Could not save. Check that the Stasher engine is running and try again.',
        source
      );
    } finally {
      setIsSaving(false);
    }
  };

  return ReactDOM.createPortal(
    <div
      className="confirm-overlay"
      style={{ zIndex: 999999 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose();
      }}
    >
      <form
        className="confirm-dialog edit-dialog"
        onSubmit={handleSave}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-item-title"
      >
        <div className="edit-dialog-header">
          <h2 id="edit-item-title">
            {itemType === 'sound'
              ? (isRu ? 'Семпл' : 'Sample')
              : (isRu ? 'Паттерн' : 'Pattern')}
          </h2>
          <button
            onClick={onClose}
            className="row-action"
            style={{ opacity: 1 }}
            type="button"
            aria-label={isRu ? 'Закрыть' : 'Close'}
            title={isRu ? 'Закрыть (Esc)' : 'Close (Esc)'}
          >
            <i className="ti ti-x" />
          </button>
        </div>

        <label className="edit-field">
          <span>{isRu ? 'Название' : 'Name'}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            className="glass-input"
            required
            autoFocus
            spellCheck={false}
          />
        </label>

        <div className="edit-field">
          <span>{isRu ? 'Категория' : 'Category'}</span>
          <TagGrid tags={[...TAGS]} currentTag={tag} onPick={setTag} />
        </div>

        <div className="edit-dialog-actions">
          <span className="edit-dialog-hint">
            {isRu ? 'Enter — сохранить, Esc — отмена' : 'Enter to save, Esc to cancel'}
          </span>
          <button type="button" onClick={onClose} className="soft-button" disabled={isSaving}>
            {isRu ? 'Отмена' : 'Cancel'}
          </button>
          <button type="submit" className="run-button" disabled={isSaving || !trimmedName}>
            {isSaving && <i className="ti ti-loader-2 animate-spin" aria-hidden="true" />}
            <span>{isRu ? 'Сохранить' : 'Save'}</span>
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
};
