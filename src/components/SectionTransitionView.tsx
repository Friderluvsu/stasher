import React, { type ReactNode } from 'react';

type SectionTransitionViewProps = {
  sectionKey: string;
  children: ReactNode;
};

export function SectionTransitionView({ sectionKey, children }: SectionTransitionViewProps) {
  return (
    <div className="section-cielrose-wrapper">
      <div className="section-cielrose-container is-entering-cielrose" key={sectionKey}>
        {children}
      </div>
    </div>
  );
}
