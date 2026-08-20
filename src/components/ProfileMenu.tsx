import React, { useEffect, useRef } from 'react';
import type { InterfaceLanguage, InterfaceTheme } from '../state/interfaceStore';
import { useInterfaceStore } from '../state/interfaceStore';
import { notify } from '../state/toastStore';

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
