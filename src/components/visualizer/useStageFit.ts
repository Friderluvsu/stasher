import { useLayoutEffect, type RefObject } from 'react';

// Space kept free under the stage so its rounded edge never touches the window border.
const BOTTOM_GAP = 16;
const MAX_CANVAS_HEIGHT = 820;
const MIN_CANVAS_HEIGHT = 300;

/**
 * Sizes the 9:16 canvas from the viewport so the whole stage (header row, canvas, seek bar, transport and
 * shortcut hints) is on screen when the page is opened at scroll 0. It publishes the result as `--vz-canvas-h`
 * on the page element; the stylesheet turns it into the canvas width and the stage column width.
 *
 * The budget is the distance from the top of the layout at scroll 0 to the bottom of the scroller. The layout is
 * not sticky, so `rect.top + scrollTop` is stable while scrolling. The stage chrome (everything except the
 * canvas) is measured from the DOM, so a taller seek bar or a wrapped transport row is accounted for.
 */
export function useStageFit(pageRef: RefObject<HTMLElement | null>, enabled: boolean): void {
  useLayoutEffect(() => {
    const page = pageRef.current;
    if (!page || !enabled) return;
    const layout = page.querySelector<HTMLElement>('.vz-layout');
    const stage = page.querySelector<HTMLElement>('.vz-stage');
    const frame = page.querySelector<HTMLElement>('.vz-canvas-frame');
    const heading = page.querySelector<HTMLElement>('.vz-heading');
    if (!layout || !stage || !frame) return;
    const scroller = page.closest<HTMLElement>('.workspace-scroll-area');
    let raf = 0;
    let last = 0;

    const measure = () => {
      raf = 0;
      const scrollTop = scroller?.scrollTop ?? window.scrollY;
      const bottom = Math.min(window.innerHeight, scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight);
      const room = bottom - (layout.getBoundingClientRect().top + scrollTop) - BOTTOM_GAP;
      const style = getComputedStyle(stage);
      const box = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      // Stacked layout: canvas beside the controls, so only the stage padding sits above and below it.
      const chrome = style.display === 'grid' ? box : Math.max(box, stage.getBoundingClientRect().height - frame.getBoundingClientRect().height);
      const height = Math.round(Math.min(MAX_CANVAS_HEIGHT, Math.max(MIN_CANVAS_HEIGHT, room - chrome)));
      if (Number.isFinite(height) && Math.abs(height - last) >= 1) {
        last = height;
        page.style.setProperty('--vz-canvas-h', `${height}px`);
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };

    measure();
    const observer = new ResizeObserver(schedule);
    for (const element of [page, stage, heading, scroller]) if (element) observer.observe(element);
    window.addEventListener('resize', schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(raf);
      page.style.removeProperty('--vz-canvas-h');
    };
  }, [pageRef, enabled]);
}
