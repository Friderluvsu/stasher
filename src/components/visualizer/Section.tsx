import React from 'react';

interface VisualizerSectionProps {
  step: number;
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const VisualizerSection: React.FC<VisualizerSectionProps> = ({ step, title, meta, actions, className = '', children }) => {
  const headingId = `vz-section-${step}`;
  return (
    <section className={`vz-panel glass-card ${className}`} aria-labelledby={headingId}>
      <header className="vz-panel-head">
        <span className="vz-step" aria-hidden="true">{String(step).padStart(2, '0')}</span>
        <h2 id={headingId}>{title}</h2>
        {meta !== undefined && <span className="vz-panel-meta">{meta}</span>}
        {actions && <div className="vz-panel-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
};
