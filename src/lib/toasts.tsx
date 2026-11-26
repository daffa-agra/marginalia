import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  message: string;
  /** Milliseconds before it dismisses itself. */
  duration: number;
  tone: 'neutral' | 'danger';
  action?: ToastAction;
}

let nextId = 1;

/**
 * Small transient feedback channel. One live region for the whole app, so a
 * delete, a copy or a failed save is announced to a screen reader once.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, options: { duration?: number; tone?: Toast['tone']; action?: ToastAction } = {}) => {
      const id = nextId++;
      const toast: Toast = {
        id,
        message,
        duration: options.duration ?? 4000,
        tone: options.tone ?? 'neutral',
        action: options.action,
      };
      setToasts((list) => [...list.slice(-2), toast]);
      if (toast.duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), toast.duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) window.clearTimeout(timer);
      map.clear();
    };
  }, []);

  return { toasts, notify, dismiss };
}

export function ToastRegion({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}): ReactNode {
  return (
    <div className="toast-region" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={toast.tone === 'danger' ? 'toast toast-danger' : 'toast'}>
          <span className="toast-message">{toast.message}</span>
          {toast.action && (
            <button type="button" className="toast-action" onClick={toast.action.onClick}>
              {toast.action.label}
            </button>
          )}
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss message"
            onClick={() => onDismiss(toast.id)}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
              <path
                d="m4 4 8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
