import React from 'react';
import { useToastStore } from '../state/toastStore';

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          <i
            className={`ti ${
              toast.type === 'success'
                ? 'ti-circle-check'
                : toast.type === 'error'
                ? 'ti-alert-triangle'
                : 'ti-info-circle'
            }`}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            {toast.title && (
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{toast.title}</div>
            )}
            <div style={{ fontSize: 12, color: 'var(--text)', opacity: 0.9 }}>{toast.message}</div>
          </div>
          <button
            className="toast-close"
            onClick={() => removeToast(toast.id)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--muted)',
              cursor: 'pointer',
              padding: 4,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <i className="ti ti-x" style={{ fontSize: 14 }} />
          </button>
        </div>
      ))}
    </div>
  );
};
