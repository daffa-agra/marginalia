import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { STATUS_META } from '../types';
import type { ReadStatus } from '../types';
import { STATUS_MENU_ORDER } from '../lib/status';
import { Icon } from './icons';

/**
 * Status menu. The label and the action come from the same list, so the
 * button can never promise one state and apply another.
 */
export function StatusMenu({
  status,
  onChange,
  label = 'Set status',
  compact = false,
  disabled,
}: {
  status: ReadStatus;
  onChange: (next: ReadStatus) => void;
  label?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const meta = STATUS_META[status];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  return (
    <div className="status-menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={compact ? 'status-trigger compact' : 'status-trigger'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${label}: ${meta.label}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={meta.icon} />
        <span className="status-trigger-label">{meta.label}</span>
        <Icon name="chevronDown" className="status-trigger-chevron" />
      </button>
      {open && (
        <div className="status-popover" role="menu" id={menuId} aria-label={label}>
          {STATUS_MENU_ORDER.map((value) => {
            const item = STATUS_META[value];
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={value === status}
                className={value === status ? 'status-option active' : 'status-option'}
                onClick={() => {
                  setOpen(false);
                  if (value !== status) onChange(value);
                }}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {value === status && <Icon name="check" className="status-option-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Rating stars rendered from the authored icon set rather than text glyphs. */
export function RatingStars({ rating, size = 14 }: { rating: number; size?: number }): ReactNode {
  return (
    <span className="rating" aria-label={`Rated ${rating} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Icon
          key={n}
          name="star"
          size={size}
          className={n <= rating ? 'star-icon on' : 'star-icon off'}
        />
      ))}
    </span>
  );
}
