import { useState } from 'react';
import type { Shelf } from '../types';
import { Icon } from './icons';

/**
 * The shelf picker. One book, one shelf — so this is a radio list, not a set
 * of checkboxes. Unshelved is always present and cannot be removed.
 */
export function ShelfPicker({
  shelves,
  value,
  onChange,
  label = 'Shelf',
  disabled,
}: {
  shelves: Shelf[];
  value: string | undefined;
  onChange: (shelfId: string | undefined) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current = shelves.find((s) => s.id === value);
  const currentName = current?.name ?? 'Unshelved';

  return (
    <div className="shelf-picker">
      <button
        type="button"
        className="shelf-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${currentName}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="shelf" size={14} />
        <span className="shelf-trigger-label">{currentName}</span>
        <Icon name="chevronDown" size={12} className="shelf-trigger-chevron" />
      </button>
      {open && (
        <>
          <div className="shelf-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
          <ul className="shelf-listbox" role="listbox" aria-label={label}>
            <li>
              <button
                type="button"
                role="option"
                aria-selected={!value}
                className={!value ? 'shelf-option active' : 'shelf-option'}
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                }}
              >
                <span>Unshelved</span>
                {!value && <Icon name="check" size={14} />}
              </button>
            </li>
            {shelves.map((shelf) => (
              <li key={shelf.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === shelf.id}
                  className={value === shelf.id ? 'shelf-option active' : 'shelf-option'}
                  onClick={() => {
                    onChange(shelf.id);
                    setOpen(false);
                  }}
                >
                  <span>{shelf.name}</span>
                  {value === shelf.id && <Icon name="check" size={14} />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
