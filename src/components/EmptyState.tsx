import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  copy?: string;
  actions?: ReactNode;
  tone?: 'accent' | 'sage' | 'plum';
}

export function EmptyState({ icon, title, copy, actions, tone = 'accent' }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className={`empty-icon ${tone === 'accent' ? '' : tone}`}>{icon}</div>
      <div className="empty-title">{title}</div>
      {copy ? <div className="empty-copy">{copy}</div> : null}
      {actions ? <div className="empty-actions">{actions}</div> : null}
    </div>
  );
}
