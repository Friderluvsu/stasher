import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

type ConfirmDialogProps = {
  cancelLabel: string;
  confirmLabel: string;
  message: string;
  open: boolean;
  title: string;
  danger?: boolean;
  onCancel(): void;
  onConfirm(): void;
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  cancelLabel,
  confirmLabel,
  message,
  open,
  title,
  danger = true,
  onCancel,
  onConfirm,
}) => {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
      if (event.key === 'Enter') onConfirm();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel, onConfirm, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="confirm-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div aria-modal="true" className="confirm-dialog glass-popover" role="alertdialog">
        <span className="confirm-icon" aria-hidden="true">
          <i className="ti ti-alert-triangle" />
        </span>
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="confirm-actions">
          <button className="soft-button" onClick={onCancel} type="button">
            {cancelLabel}
          </button>
          <button
            autoFocus
            className={danger ? 'danger-button' : 'run-button'}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
