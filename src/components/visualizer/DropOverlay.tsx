import React from 'react';
import { createPortal } from 'react-dom';

export const DropOverlay: React.FC<{ isRu: boolean }> = ({ isRu }) => createPortal(
  <div className="vz-drop-overlay" aria-hidden="true">
    <div className="vz-drop-card">
      <span className="vz-drop-icon"><i className="ti ti-drag-drop" /></span>
      <strong>{isRu ? 'Отпустите, чтобы визуализировать' : 'Drop to visualize'}</strong>
      <span>{isRu ? 'Файлы откроются в визуализаторе и не попадут в хранилище' : 'Files open in the visualizer and are not added to the vault'}</span>
      <div className="vz-drop-kinds">
        <span><i className="ti ti-file-music" />FLP · MIDI <em>{isRu ? '→ партии' : '→ parts'}</em></span>
        <span><i className="ti ti-headphones" />MP3 · WAV · M4A · OGG · FLAC <em>{isRu ? '→ звук' : '→ audio'}</em></span>
      </div>
    </div>
  </div>,
  document.body,
);
