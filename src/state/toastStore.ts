import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info';

export type ToastMessage = {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
};

type ToastState = {
  toasts: ToastMessage[];
  addToast(toast: Omit<ToastMessage, 'id'>): void;
  removeToast(id: string): void;
};

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast(toast) {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }));
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, 4000);
  },
  removeToast(id) {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

export const notify = {
  success(message: string, title?: string) {
    useToastStore.getState().addToast({ type: 'success', message, title });
  },
  error(message: string, title?: string) {
    useToastStore.getState().addToast({ type: 'error', message, title });
  },
  info(message: string, title?: string) {
    useToastStore.getState().addToast({ type: 'info', message, title });
  },
};
