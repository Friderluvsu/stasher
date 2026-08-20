import { useEffect } from 'react';

export function useMouseSpotlight() {
  useEffect(() => {
    let rafId: number;

    function handleMouseMove(e: MouseEvent) {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const clientX = e.clientX;
        const clientY = e.clientY;

        const targets = document.querySelectorAll<HTMLElement>(
          'button, input, textarea, select, .glass-panel, .glass-card, .spotlight-card, .pattern-card, .sound-card, .kit-card, .side-navigation button, .workspace-switcher button, .profile-segments button, .soft-button, .run-button, .pill-btn, .icon-button, .profile-menu-action'
        );

        targets.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const distanceX = Math.max(rect.left - clientX, 0, clientX - rect.right);
          const distanceY = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
          const distance = Math.hypot(distanceX, distanceY);

          if (distance < 200) {
            const x = clientX - rect.left;
            const y = clientY - rect.top;
            el.style.setProperty('--mouse-x', `${x}px`);
            el.style.setProperty('--mouse-y', `${y}px`);
            el.style.setProperty('--spotlight-opacity', '1');
          } else {
            el.style.setProperty('--spotlight-opacity', '0');
          }
        });
      });
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(rafId);
    };
  }, []);
}
