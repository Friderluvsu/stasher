export interface DragItem {
  type: 'sound' | 'pattern';
  id: number;
  ids: number[];
  tag: string;
}

let activeDragItem: DragItem | null = null;
let cleanupTimer: number | null = null;

export const dragService = {
  startDrag(item: DragItem) {
    if (cleanupTimer) {
      window.clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
    // Ensure ids is an array of valid positive integers
    const validIds = Array.isArray(item.ids) && item.ids.length > 0
      ? item.ids.filter((n) => Number.isInteger(n) && n > 0)
      : (Number.isInteger(item.id) && item.id > 0 ? [item.id] : []);

    activeDragItem = {
      type: item.type,
      id: item.id,
      ids: validIds.length > 0 ? validIds : [item.id],
      tag: item.tag,
    };

    (window as any).__stasher_is_internal_drag = true;
    (window as any).__stasher_drag_item = activeDragItem;
  },

  getDragItem(): DragItem | null {
    if (activeDragItem && activeDragItem.ids && activeDragItem.ids.length > 0) {
      return activeDragItem;
    }
    const globalItem = (window as any).__stasher_drag_item;
    if (globalItem && globalItem.ids && globalItem.ids.length > 0) {
      return globalItem;
    }
    return null;
  },

  endDrag() {
    (window as any).__stasher_is_internal_drag = false;
    // Keep activeDragItem for 15 seconds or until dropped, because native Electron drag can last several seconds
    if (cleanupTimer) window.clearTimeout(cleanupTimer);
    cleanupTimer = window.setTimeout(() => {
      activeDragItem = null;
      (window as any).__stasher_drag_item = null;
      cleanupTimer = null;
    }, 15000);
  },

  clearImmediately() {
    if (cleanupTimer) {
      window.clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
    activeDragItem = null;
    (window as any).__stasher_is_internal_drag = false;
    (window as any).__stasher_drag_item = null;
  }
};
