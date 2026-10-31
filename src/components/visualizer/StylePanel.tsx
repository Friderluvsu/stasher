import React from 'react';
import { VisualizerSection } from './Section';
import { DEFAULT_PREFS } from './shared';

interface StylePanelProps {
  isRu: boolean;
  title: string;
  autoTitle: string;
  intensity: number;
  onChange(patch: { title?: string; intensity?: number }): void;
}

export const StylePanel: React.FC<StylePanelProps> = ({ isRu, title, autoTitle, intensity, onChange }) => {
  const isDefault = !title && intensity === DEFAULT_PREFS.intensity;
  return (
    <VisualizerSection
      step={3}
      title={isRu ? 'Оформление' : 'Style'}
      actions={<button type="button" className="vz-link" disabled={isDefault} onClick={() => onChange({ title: '', intensity: DEFAULT_PREFS.intensity })}><i className="ti ti-arrow-back-up" aria-hidden="true" />{isRu ? 'Сбросить' : 'Reset'}</button>}
    >
      <div className="vz-field">
        <label className="vz-field-label" htmlFor="vz-title">{isRu ? 'Название' : 'Title'}</label>
        <input
          id="vz-title"
          className="vz-text-input"
          type="text"
          maxLength={48}
          value={title}
          placeholder={autoTitle}
          onChange={event => onChange({ title: event.target.value })}
          title={isRu ? 'Название бита на видео. Пусто — из имени файла или проекта' : 'Beat name on the video. Empty uses the file or project name'}
        />
      </div>

      <div className="vz-field vz-field-row">
        <label className="vz-field-label" htmlFor="vz-intensity">{isRu ? 'Интенсивность' : 'Intensity'}</label>
        <input
          id="vz-intensity"
          className="vz-range"
          type="range"
          min={.5}
          max={1.5}
          step={.05}
          value={intensity}
          style={{ '--vz-fill': `${(intensity - .5) * 100}%` } as React.CSSProperties}
          onChange={event => onChange({ intensity: Number(event.target.value) })}
          onDoubleClick={() => onChange({ intensity: 1 })}
          aria-valuetext={`${Math.round(intensity * 100)}%`}
          title={isRu ? 'Сила реакции на звук и ноты. Двойной клик — 100%' : 'How hard the look reacts to sound and notes. Double-click resets to 100%'}
        />
        <output className="vz-range-value" htmlFor="vz-intensity">{Math.round(intensity * 100)}%</output>
      </div>
    </VisualizerSection>
  );
};
