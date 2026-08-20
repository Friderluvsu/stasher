import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type InterfaceTheme = 'light' | 'dark' | 'system';
export type InterfaceLanguage = 'ru' | 'en';

type InterfaceState = {
  theme: InterfaceTheme;
  language: InterfaceLanguage;
  caffeinate: boolean;
  setTheme(theme: InterfaceTheme): void;
  setLanguage(language: InterfaceLanguage): void;
  setCaffeinate(caffeinate: boolean): void;
};

function preferredTheme(): InterfaceTheme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const useInterfaceStore = create<InterfaceState>()(
  persist(
    (set) => ({
      theme: 'dark',
      language: 'ru',
      caffeinate: false,
      setTheme(theme) {
        set({ theme });
      },
      setLanguage(language) {
        set({ language });
      },
      setCaffeinate(caffeinate) {
        set({ caffeinate });
      },
    }),
    {
      name: 'stasher-interface-preferences',
    },
  ),
);
