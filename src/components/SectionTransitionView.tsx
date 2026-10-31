import React, { type ReactNode } from 'react';

type SectionTransitionViewProps = {
  sectionKey: string;
  children: ReactNode;
  /** Keeps the section mounted but out of view (display: none replays the enter animation when it returns). */
  hidden?: boolean;
};

export function SectionTransitionView({ sectionKey, children, hidden = false }: SectionTransitionViewProps) {
  return (
    <div className="section-cielrose-wrapper" style={hidden ? { display: 'none' } : undefined}>
      <div className="section-cielrose-container is-entering-cielrose" key={sectionKey}>
        {children}
      </div>
    </div>
  );
}
