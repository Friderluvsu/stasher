import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useInterfaceStore } from '../state/interfaceStore';
import { canonicalTag, filterTags, tagIcon } from '../utils/tags';

const GRID_COLUMNS = 3;
const MENU_WIDTH = 300;
const EDGE = 12;

interface TagGridProps {
  tags: string[];
  currentTag: string;
  highlighted?: number;
  onPick: (tag: string) => void;
  onHover?: (index: number) => void;
}

/** The 3-column tag grid shared by the picker popover and the edit dialog. */
export const TagGrid: React.FC<TagGridProps> = ({ tags, currentTag, highlighted = -1, onPick, onHover }) => {
  const current = canonicalTag(currentTag);
  return (
    <div className="tag-grid" role="listbox">
      {tags.map((tag, index) => {
        const isCurrent = Boolean(currentTag) && tag === current;
        return (
          <button
            key={tag}
            type="button"
            role="option"
            aria-selected={isCurrent}
            className={`tag-option${isCurrent ? ' is-current' : ''}${index === highlighted ? ' is-highlighted' : ''}`}
            onClick={() => onPick(tag)}
            onMouseEnter={() => onHover?.(index)}
          >
            <i className={`ti ${tagIcon(tag)}`} aria-hidden="true" />
            <span>{tag}</span>
            {isCurrent && <i className="ti ti-check" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
};

/** Arrow-key movement inside a grid of `count` items laid out in GRID_COLUMNS columns. */
export function moveInGrid(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  const from = index < 0 ? 0 : index;
  switch (key) {
    case 'ArrowRight': return Math.min(count - 1, from + 1);
    case 'ArrowLeft': return Math.max(0, from - 1);
    case 'ArrowDown': return index < 0 ? 0 : Math.min(count - 1, from + GRID_COLUMNS);
    case 'ArrowUp': return Math.max(0, from - GRID_COLUMNS);
    default: return null;
  }
}

interface TagPickerPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  currentTag: string;
  onSelectTag: (tag: string) => void;
  anchorEl?: HTMLElement | null;
}

export const TagPickerPopover: React.FC<TagPickerPopoverProps> = ({
  isOpen,
  onClose,
  currentTag,
  onSelectTag,
  anchorEl,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isRu = useInterfaceStore((state) => state.language) === 'ru';
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(-1);

  const tags = useMemo(() => filterTags(query), [query]);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setHighlighted(-1);
  }, [isOpen]);

  // Typing narrows the list; the first match is ready for Enter.
  useEffect(() => {
    setHighlighted(query.trim() ? 0 : -1);
  }, [query]);

  // Place against the real rendered height so the menu never spills off-screen.
  useLayoutEffect(() => {
    if (!isOpen || !popoverRef.current) return;
    const height = popoverRef.current.offsetHeight;
    const rect = anchorEl?.getBoundingClientRect();
    if (!rect) {
      setCoords({ top: Math.max(EDGE, (window.innerHeight - height) / 2), left: Math.max(EDGE, (window.innerWidth - MENU_WIDTH) / 2) });
      return;
    }
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - EDGE) top = Math.max(EDGE, rect.top - height - 6);
    const left = Math.min(Math.max(EDGE, rect.left), window.innerWidth - MENU_WIDTH - EDGE);
    setCoords({ top, left });
  }, [isOpen, anchorEl, tags.length]);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus({ preventScroll: true });

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target) || anchorEl?.contains(target)) return;
      onClose();
    };
    // Escape belongs to the menu while it is open: it must not also clear the batch selection or close a dialog behind it.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const handleScroll = (e: Event) => {
      if (popoverRef.current?.contains(e.target as Node)) return;
      onClose();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [isOpen, onClose, anchorEl]);

  if (!isOpen) return null;

  const pick = (tag: string) => {
    onClose();
    if (canonicalTag(tag) !== canonicalTag(currentTag)) onSelectTag(tag);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const next = moveInGrid(e.key, highlighted, tags.length);
    if (next !== null) {
      e.preventDefault();
      setHighlighted(next);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const tag = tags[highlighted >= 0 ? highlighted : 0];
      if (tag) pick(tag);
    }
  };

  return ReactDOM.createPortal(
    <div
      ref={popoverRef}
      className="glass-popover tag-menu"
      style={{
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        // opacity, not visibility: a visibility-hidden input cannot take focus on the first open.
        opacity: coords ? 1 : 0,
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={isRu ? 'Категория' : 'Category'}
    >
      <label className="tag-menu-search">
        <i className="ti ti-search" aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={isRu ? 'Найти категорию' : 'Find a category'}
          aria-label={isRu ? 'Найти категорию' : 'Find a category'}
          spellCheck={false}
        />
        <kbd>Enter</kbd>
      </label>

      {tags.length > 0 ? (
        <TagGrid tags={tags} currentTag={currentTag} highlighted={highlighted} onPick={pick} onHover={setHighlighted} />
      ) : (
        <div className="tag-menu-empty">{isRu ? 'Нет такой категории' : 'No matching category'}</div>
      )}
    </div>,
    document.body
  );
};
