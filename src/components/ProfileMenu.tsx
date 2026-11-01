import React, { useEffect, useRef } from 'react';
import type { InterfaceLanguage, InterfaceTheme } from '../state/interfaceStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { notify } from '../state/toastStore';

type FolderAccess = { name: string; granted: boolean };

type DesktopBridge = {
  platform?: string;
  requestFolderAccess?(): Promise<FolderAccess[]>;
  openFullDiskAccess?(): Promise<boolean>;
};

const FOLDER_NAMES_RU: Record<string, string> = {
  Documents: 'Документы',
  Downloads: 'Загрузки',
  Desktop: 'Рабочий стол',
  Music: 'Музыка',
};

type ProfileMenuProps = {
  open: boolean;
  onClose(): void;
};

export const ProfileMenu: React.FC<ProfileMenuProps> = ({ open, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { language, theme, caffeinate, setLanguage, setTheme, setCaffeinate } = useInterfaceStore();

  useEffect(() => {
    if (!open) return undefined;

    function closeOnPointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest('.profile-button')) return;
      if (!containerRef.current?.contains(target as Node)) onClose();
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('pointerdown', closeOnPointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [onClose, open]);

  function chooseLanguage(nextLanguage: InterfaceLanguage) {
    setLanguage(nextLanguage);
    notify.info(nextLanguage === 'ru' ? 'Язык изменен на Русский' : 'Language changed to English', 'Stasher');
  }

  function chooseTheme(nextTheme: InterfaceTheme) {
    setTheme(nextTheme);
  }

  function toggleCaffeinate(enabled: boolean) {
    setCaffeinate(enabled);
    notify.success(
      enabled
        ? language === 'ru' ? 'Режим бодрствования включен' : 'Caffeinate enabled'
        : language === 'ru' ? 'Режим бодрствования выключен' : 'Caffeinate disabled',
      'Stasher'
    );
  }

  const isRu = language === 'ru';
  const bridge = (window as unknown as { electronAPI?: DesktopBridge }).electronAPI;
  // Only macOS asks for folder access; Windows and the browser dev build need nothing here.
  const canRequestAccess = bridge?.platform === 'darwin' && typeof bridge.requestFolderAccess === 'function';

  async function requestFolderAccess() {
    if (!bridge?.requestFolderAccess) return;
    try {
      const results = await bridge.requestFolderAccess();
      const denied = results.filter((item) => !item.granted).map((item) => (isRu ? FOLDER_NAMES_RU[item.name] || item.name : item.name));
      if (!denied.length) {
        notify.success(isRu ? 'Доступ к папкам выдан' : 'Folder access granted', 'Stasher');
      } else {
        notify.error(
          isRu
            ? `Нет доступа: ${denied.join(', ')}. Разрешите в Системных настройках → Конфиденциальность → Файлы и папки.`
            : `No access: ${denied.join(', ')}. Allow it in System Settings → Privacy → Files and Folders.`,
          'Stasher'
        );
      }
    } catch {
      notify.error(isRu ? 'Не удалось запросить доступ' : 'Could not request access', 'Stasher');
    }
  }

  async function openFullDiskAccess() {
    const opened = await bridge?.openFullDiskAccess?.().catch(() => false);
    if (opened) {
      notify.info(isRu ? 'Включите Stasher в списке «Полный доступ к диску»' : 'Turn on Stasher in the Full Disk Access list', 'Stasher');
    } else {
      notify.error(isRu ? 'Не удалось открыть Системные настройки' : 'Could not open System Settings', 'Stasher');
    }
  }

  return (
    <div className="profile-menu-anchor" ref={containerRef}>
      <div
        aria-hidden={!open}
        aria-label={isRu ? 'Настройки интерфейса' : 'Interface Settings'}
        className={`profile-menu glass-popover${open ? ' is-open' : ''}`}
        role="dialog"
      >
        <div className="profile-menu-heading">
          <span className="avatar-mini" aria-hidden="true">
            <i className="ti ti-user" />
          </span>
          <div className="profile-menu-user">
            <div className="profile-menu-name">
              <strong>Stasher Studio</strong>
              <span className="plan-badge">PRO</span>
            </div>
            <span>{isRu ? 'Настройки интерфейса' : 'Interface settings'}</span>
          </div>
        </div>

        <div className="subscription-summary">
          <span>
            <i className="ti ti-rosette-discount-check" aria-hidden="true" />
            {isRu ? 'Подписка' : 'Subscription'}
          </span>
          <strong>{isRu ? 'Бессрочная лицензия' : 'Lifetime Pro'}</strong>
        </div>

        <div className="profile-menu-section">
          <span className="profile-menu-label">{isRu ? 'Язык интерфейса' : 'Language'}</span>
          <div className="profile-segments">
            {(['ru', 'en'] as const).map((value) => (
              <button
                aria-pressed={language === value}
                className={language === value ? 'is-active' : ''}
                key={value}
                onClick={() => chooseLanguage(value)}
                type="button"
              >
                {value.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="profile-menu-section">
          <span className="profile-menu-label">{isRu ? 'Тема оформления' : 'Theme'}</span>
          <div className="profile-segments">
            <button
              aria-pressed={theme === 'light'}
              className={theme === 'light' ? 'is-active' : ''}
              onClick={() => chooseTheme('light')}
              type="button"
            >
              <i className="ti ti-sun" aria-hidden="true" />
              {isRu ? 'Светлая' : 'Light'}
            </button>
            <button
              aria-pressed={theme === 'dark'}
              className={theme === 'dark' ? 'is-active' : ''}
              onClick={() => chooseTheme('dark')}
              type="button"
            >
              <i className="ti ti-moon" aria-hidden="true" />
              {isRu ? 'Темная' : 'Dark'}
            </button>
            <button
              aria-pressed={theme === 'system'}
              className={theme === 'system' ? 'is-active' : ''}
              onClick={() => chooseTheme('system')}
              type="button"
            >
              <i className="ti ti-device-desktop" aria-hidden="true" />
              {isRu ? 'Авто' : 'Auto'}
            </button>
          </div>
        </div>

        <div className="profile-menu-section">
          <span className="profile-menu-label">{isRu ? 'Режим бодрствования' : 'Keep awake'}</span>
          <div className="profile-segments">
            <button
              aria-pressed={!caffeinate}
              className={!caffeinate ? 'is-active' : ''}
              onClick={() => toggleCaffeinate(false)}
              type="button"
            >
              <i className="ti ti-moon-off" aria-hidden="true" />
              {isRu ? 'Выкл' : 'Off'}
            </button>
            <button
              aria-pressed={caffeinate}
              className={caffeinate ? 'is-active' : ''}
              onClick={() => toggleCaffeinate(true)}
              type="button"
            >
              <i className="ti ti-coffee" aria-hidden="true" />
              {isRu ? 'Вкл' : 'On'}
            </button>
          </div>
        </div>

        {canRequestAccess ? (
          <div className="profile-menu-section">
            <span className="profile-menu-label">{isRu ? 'Доступ к файлам' : 'File access'}</span>
            <div className="profile-segments">
              <button onClick={() => void requestFolderAccess()} type="button">
                <i className="ti ti-folder-check" aria-hidden="true" />
                {isRu ? 'Папки' : 'Folders'}
              </button>
              <button onClick={() => void openFullDiskAccess()} type="button">
                <i className="ti ti-shield-lock" aria-hidden="true" />
                {isRu ? 'Весь диск' : 'Full disk'}
              </button>
            </div>
          </div>
        ) : null}

        <button
          className="profile-menu-action"
          onClick={() => {
            onClose();
            notify.info(isRu ? 'Все функции Pro активированы' : 'All Pro features active', 'Stasher');
          }}
          type="button"
        >
          <i className="ti ti-key" aria-hidden="true" />
          <span>{isRu ? 'Лицензия Pro' : 'License Key'}</span>
          <i className="ti ti-chevron-right" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};
