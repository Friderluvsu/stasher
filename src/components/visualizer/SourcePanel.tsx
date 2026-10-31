import React, { memo, useMemo } from 'react';
import type { PatternItem } from '../../services/api';
import { VisualizerSection } from './Section';
import { notesWord, partsWord, shortPatternName, type ReadableError, type SourceGroup } from './shared';

interface SourcePanelProps {
  isRu: boolean;
  groups: SourceGroup[];
  selected: Set<number>;
  duplicates: Set<number>;
  colors: Map<number, string>;
  expanded: Set<string>;
  query: string;
  libraryState: 'loading' | 'ready' | 'error';
  importing: string[];
  error: ReadableError | null;
  onQuery(value: string): void;
  onToggleExpanded(id: string): void;
  onTogglePart(id: number): void;
  onSelectGroup(group: SourceGroup, all: boolean): void;
  onRemoveGroup(group: SourceGroup): void;
  onClearSelection(): void;
  onOpenFiles(): void;
  onRetryLibrary(): void;
  onDismissError(): void;
  onRetryImport(files: File[]): void;
}

const PartRow = memo<{ part: PatternItem; checked: boolean; duplicate: boolean; color: string; isRu: boolean; onToggle(id: number): void }>(({ part, checked, duplicate, color, isRu, onToggle }) => {
  const patternName = shortPatternName(part);
  const count = part.notes?.length || part.note_count || 0;
  return (
    <button type="button" role="checkbox" aria-checked={checked} className={`vz-part ${checked ? 'is-checked' : ''} ${duplicate ? 'is-duplicate' : ''}`} onClick={() => onToggle(part.id)} title={part.pattern_name}>
      <span className="vz-check" aria-hidden="true"><i className="ti ti-check" /></span>
      <span className="vz-dot" style={{ background: color }} aria-hidden="true" />
      <span className="vz-part-text">
        <strong>{part.channel_name || part.pattern_name}</strong>
        {patternName && <small>{patternName}</small>}
      </span>
      {duplicate && <span className="vz-badge is-dup" title={isRu ? 'Те же ноты, что у этого канала в другом паттерне — в лупе не нужен' : 'Same notes as this channel in another pattern — not needed in a loop'}>{isRu ? 'дубль' : 'dup'}</span>}
      {part.tag && <span className="vz-badge">{part.tag}</span>}
      <span className="vz-part-count" title={`${count} ${notesWord(count, isRu)}`}>{count}</span>
    </button>
  );
});

export const SourcePanel: React.FC<SourcePanelProps> = ({
  isRu, groups, selected, duplicates, colors, expanded, query, libraryState, importing, error,
  onQuery, onToggleExpanded, onTogglePart, onSelectGroup, onRemoveGroup, onClearSelection, onOpenFiles, onRetryLibrary, onDismissError, onRetryImport,
}) => {
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(() => groups.map(group => {
    if (!needle || group.source.name.toLowerCase().includes(needle)) return { group, parts: group.parts };
    return { group, parts: group.parts.filter(part => `${part.channel_name} ${part.pattern_name} ${part.tag}`.toLowerCase().includes(needle)) };
  }).filter(item => item.parts.length), [groups, needle]);
  const imported = filtered.filter(item => item.group.source.kind !== 'vault');
  const vault = filtered.filter(item => item.group.source.kind === 'vault');
  const totalParts = groups.reduce((sum, group) => sum + group.parts.length, 0);
  const vaultTotal = groups.filter(group => group.source.kind === 'vault').length;

  const renderGroup = ({ group, parts }: { group: SourceGroup; parts: PatternItem[] }) => {
    const { source } = group;
    const open = expanded.has(source.id) || (!!needle && parts.length > 0);
    const selectedCount = group.parts.reduce((sum, part) => sum + (selected.has(part.id) ? 1 : 0), 0);
    const kindLabel = source.kind === 'flp' ? 'FLP' : source.kind === 'midi' ? 'MIDI' : (isRu ? 'БАЗА' : 'VAULT');
    return (
      <div key={source.id} className={`vz-group ${open ? 'is-open' : ''} ${selectedCount ? 'has-selection' : ''}`}>
        <div className="vz-group-head">
          <button type="button" className="vz-group-toggle" aria-expanded={open} onClick={() => onToggleExpanded(source.id)}>
            <i className="ti ti-chevron-right vz-chevron" aria-hidden="true" />
            <span className={`vz-kind is-${source.kind}`}>{kindLabel}</span>
            <span className="vz-group-name" title={source.name}>{source.name}</span>
            {source.song && <i className="ti ti-timeline vz-group-song" title={isRu ? 'Найден плейлист FL Studio — доступен режим «Песня»' : 'FL Studio playlist found — Song mode available'} aria-label={isRu ? 'есть плейлист' : 'has playlist'} />}
            <span className="vz-group-meta">{Math.round(source.tempo)} BPM · {selectedCount ? `${selectedCount}/` : ''}{group.parts.length}</span>
          </button>
          <div className="vz-group-actions">
            <button type="button" className="vz-link" onClick={() => onSelectGroup(group, true)} title={isRu ? 'Выбрать все партии, кроме дублей' : 'Select every part except duplicates'} aria-label={`${isRu ? 'Выбрать все' : 'Select all'}: ${source.name}`}>{isRu ? 'Все' : 'All'}</button>
            <button type="button" className="vz-link" onClick={() => onSelectGroup(group, false)} disabled={!selectedCount} aria-label={`${isRu ? 'Снять выбор' : 'Select none'}: ${source.name}`}>{isRu ? 'Снять' : 'None'}</button>
            {source.kind !== 'vault' && (
              <button type="button" className="vz-icon-btn" onClick={() => onRemoveGroup(group)} aria-label={`${isRu ? 'Убрать' : 'Remove'} ${source.name}`} title={isRu ? 'Убрать из визуализатора' : 'Remove from visualizer'}>
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        {open && (
          <div className="vz-parts" role="group" aria-label={source.name}>
            {parts.map(part => <PartRow key={part.id} part={part} checked={selected.has(part.id)} duplicate={duplicates.has(part.id)} color={colors.get(part.id) || 'var(--soft)'} isRu={isRu} onToggle={onTogglePart} />)}
          </div>
        )}
      </div>
    );
  };

  return (
    <VisualizerSection
      step={1}
      title={isRu ? 'Источник' : 'Source'}
      meta={selected.size ? `${selected.size} / ${totalParts}` : totalParts ? `${totalParts} ${partsWord(totalParts, isRu)}` : undefined}
    >
      <button type="button" className="vz-dropzone" onClick={onOpenFiles}>
        <span className="vz-dropzone-icon" aria-hidden="true"><i className="ti ti-file-music" /></span>
        <span className="vz-dropzone-text">
          <strong>{isRu ? 'Открыть FLP, MIDI или аудио' : 'Open FLP, MIDI or audio'}</strong>
          <small>{isRu ? 'Можно несколько файлов сразу — или перетащите их в окно' : 'Several files at once — or drop them anywhere in the window'}</small>
        </span>
        <i className="ti ti-plus vz-dropzone-plus" aria-hidden="true" />
      </button>

      {importing.map((name, index) => (
        <div key={`${name}-${index}`} className="vz-notice is-busy" role="status"><i className="ti ti-loader-2 vz-spin" aria-hidden="true" /><div><strong>{isRu ? 'Читаем файл…' : 'Reading file…'}</strong><span>{name}</span></div></div>
      ))}

      {error && (
        <div className="vz-notice is-error" role="alert">
          <i className={`ti ${error.offline ? 'ti-plug-connected-x' : 'ti-alert-triangle'}`} aria-hidden="true" />
          <div><strong>{error.title}</strong>{error.detail && <span>{error.detail}</span>}</div>
          {!!error.retry?.length && <button type="button" className="vz-link" onClick={() => onRetryImport(error.retry!)}><i className="ti ti-refresh" aria-hidden="true" />{isRu ? 'Повторить' : 'Retry'}</button>}
          <button type="button" className="vz-icon-btn" onClick={onDismissError} aria-label={isRu ? 'Скрыть ошибку' : 'Dismiss error'}><i className="ti ti-x" aria-hidden="true" /></button>
        </div>
      )}

      <div className="vz-search glass-input">
        <i className="ti ti-search" aria-hidden="true" />
        <input type="search" value={query} onChange={event => onQuery(event.target.value)} placeholder={isRu ? 'Поиск партий, каналов, тегов…' : 'Search parts, channels, tags…'} aria-label={isRu ? 'Поиск партий' : 'Search parts'} />
        {query && <button type="button" className="vz-icon-btn" onClick={() => onQuery('')} aria-label={isRu ? 'Очистить поиск' : 'Clear search'}><i className="ti ti-x" aria-hidden="true" /></button>}
      </div>

      {selected.size > 0 && (
        <div className="vz-selection">
          <span><b>{selected.size}</b> {isRu ? `${partsWord(selected.size, true)} в сцене` : `${partsWord(selected.size, false)} in the scene`}</span>
          <button type="button" className="vz-link" onClick={onClearSelection}>{isRu ? 'Снять выбор' : 'Clear selection'}</button>
        </div>
      )}

      <div className="vz-groups">
        {imported.length > 0 && <p className="vz-groups-label">{isRu ? 'Файлы' : 'Files'}</p>}
        {imported.map(renderGroup)}

        {(vault.length > 0 || libraryState !== 'ready') && <p className="vz-groups-label">{isRu ? 'Хранилище' : 'Vault'}{vaultTotal > 0 && <span>{vaultTotal}</span>}</p>}
        {libraryState === 'loading' && (
          <div className="vz-skeleton" role="status" aria-label={isRu ? 'Загружаем хранилище' : 'Loading vault'}>
            {[0, 1, 2, 3].map(index => <span key={index} style={{ animationDelay: `${index * 90}ms` }} />)}
          </div>
        )}
        {libraryState === 'error' && (
          <div className="vz-notice is-error">
            <i className="ti ti-plug-connected-x" aria-hidden="true" />
            <div><strong>{isRu ? 'Хранилище недоступно' : 'Vault is unavailable'}</strong><span>{isRu ? 'Движок Stasher не отвечает. Файлы FLP/MIDI можно открыть и без хранилища.' : 'The Stasher engine is not responding. You can still open MIDI and audio files.'}</span></div>
            <button type="button" className="vz-link" onClick={onRetryLibrary}>{isRu ? 'Повторить' : 'Retry'}</button>
          </div>
        )}
        {vault.map(renderGroup)}

        {libraryState === 'ready' && !groups.length && (
          <p className="vz-empty">{isRu ? 'Партий пока нет. Откройте FLP или MIDI — или просканируйте проекты во вкладке MIDI.' : 'No parts yet. Open an FLP or MIDI file — or scan projects in the MIDI tab.'}</p>
        )}
        {needle && groups.length > 0 && !filtered.length && <p className="vz-empty">{isRu ? `Ничего не найдено по «${query.trim()}»` : `Nothing matches “${query.trim()}”`}</p>}
      </div>
    </VisualizerSection>
  );
};
