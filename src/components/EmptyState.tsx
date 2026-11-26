import type { ReactNode } from 'react';
import { Icon } from './icons';

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-rule" aria-hidden="true" />
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

/** A margin rule: the signature detail, used only beside quoted or reviewed text. */
export function MarginRule({ children }: { children: ReactNode }) {
  return <div className="margin-rule">{children}</div>;
}

export function InlineAlert({
  tone = 'danger',
  children,
}: {
  tone?: 'danger' | 'warning';
  children: ReactNode;
}) {
  return (
    <p className={tone === 'danger' ? 'inline-alert danger' : 'inline-alert warning'} role="alert">
      <Icon name="alert" size={14} />
      <span>{children}</span>
    </p>
  );
}
