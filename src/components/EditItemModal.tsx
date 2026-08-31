import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { api } from '../services/api';
import { useVaultStore } from '../state/vaultStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { notify } from '../state/toastStore';

interface EditItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemType: 'sound' | 'pattern';
  itemId: number;
  initialName: string;
  initialTag: string;
}

const TAGS = [
  '808', 'Kick', 'Snare', 'Clap', 'Hi-Hat', 'Open Hat',
  'Rim', 'Perc', 'Tom', 'Crash', 'Bass', 'Chords',
  'Melody', 'Lead', 'Pluck', 'Vox', 'FX', 'Other'
];

export const EditItemModal: React.FC<EditItemModalProps> = ({
  isOpen, onClose, itemType, itemId, initialName, initialTag
}) => {
  const [name, setName] = useState(initialName);
  const [tag, setTag] = useState(initialTag);
  const [isSaving, setIsSaving] = useState(false);
  const { updateItemInStore } = useVaultStore();
  const language = useInterfaceStore((state) => state.language);
  const isRu = language === 'ru';

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setTag(initialTag);
    }
  }, [isOpen, initialName, initialTag]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (itemType === 'sound') {
        await api.updateSound(itemId, name, tag);
      } else {
        await api.updatePattern(itemId, name, tag);
      }
      updateItemInStore(itemType, itemId, name, tag);
      notify.success(
        isRu ? 'Изменения сохранены' : 'Changes saved',
        itemType === 'sound' ? 'StashSound' : 'MIDI Vault'
      );
      onClose();
    } catch (err) {
      console.error('Failed to update item:', err);
      notify.error(
        isRu ? 'Ошибка при сохранении' : 'Failed to save changes',
        itemType === 'sound' ? 'StashSound' : 'MIDI Vault'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return ReactDOM.createPortal(
    <div
      className="confirm-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999999,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
      onClick={onClose}
    >
      <div 
        className="glass-popover confirm-dialog"
        style={{
          width: 'min(420px, 94vw)',
          padding: '24px',
          borderRadius: 24,
          textAlign: 'left',
          justifyItems: 'stretch',
          position: 'relative',
          zIndex: 1000000,
          background: '#161b26',
          border: '1px solid rgba(255, 255, 255, 0.16)',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'var(--accent-soft)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--accent)',
                fontSize: 18,
              }}
            >
              <i className={itemType === 'sound' ? 'ti ti-volume' : 'ti ti-music'} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                {isRu 
                  ? `Редактировать ${itemType === 'sound' ? 'звук' : 'паттерн'}`
                  : `Edit ${itemType === 'sound' ? 'Sound' : 'Pattern'}`
                }
              </h2>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--muted)' }}>
                {isRu ? 'Измените название или категорию' : 'Update name and category tag'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="icon-button"
            style={{ width: 30, height: 30 }}
            type="button"
            title={isRu ? 'Закрыть' : 'Close'}
          >
            <i className="ti ti-x text-sm" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>
              {isRu ? 'Название' : 'Name'}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="glass-input"
              style={{
                width: '100%',
                height: 38,
                padding: '0 12px',
                fontSize: 13,
                fontWeight: 500,
              }}
              required
              autoFocus
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>
              {isRu ? 'Категория (тег)' : 'Category Tag'}
            </label>
            <select
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              className="glass-input"
              style={{
                width: '100%',
                height: 38,
                padding: '0 12px',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {TAGS.map((t) => (
                <option key={t} value={t} style={{ background: 'var(--panel)', color: 'var(--text)' }}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <button
              type="button"
              onClick={onClose}
              className="soft-button"
              style={{ minHeight: 36, padding: '0 14px', fontSize: 12 }}
              disabled={isSaving}
            >
              {isRu ? 'Отмена' : 'Cancel'}
            </button>
            <button
              type="submit"
              className="run-button"
              style={{ minHeight: 36, padding: '0 16px', fontSize: 12 }}
              disabled={isSaving}
            >
              {isSaving ? <i className="ti ti-loader-2 animate-spin" /> : <i className="ti ti-check" />}
              <span>{isRu ? 'Сохранить' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
