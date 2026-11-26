import { useState } from 'react';
import type { Shelf } from '../types';
import { Icon } from './icons';

export type ShelfFilter = 'all' | 'unshelved' | string;

/**
 * The shelf bar. Behaves like a row of drawers: All, Unshelved, then each
 * shelf, with the count on every one so the partition is visible.
 */
export function ShelfBar({
  shelves,
  counts,
  total,
  unshelvedCount,
  active,
  onChange,
  onAddShelf,
  onRenameShelf,
  onDeleteShelf,
}: {
  shelves: Shelf[];
  counts: Map<string, number>;
  total: number;
  unshelvedCount: number;
  active: ShelfFilter;
  onChange: (next: ShelfFilter) => void;
  onAddShelf: (name: string) => boolean;
  onRenameShelf: (id: string, name: string) => boolean;
  onDeleteShelf: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [error, setError] = useState('');

  const ordered = [...shelves].sort((a, b) => a.sortOrder - b.sortOrder);

  const commitCreate = () => {
    const name = draft.trim();
    if (!name) {
      setDraft('');
      setCreating(false);
      return;
    }
    const created = onAddShelf(name);
    if (!created) {
      setError(`There is already a shelf called “${name}”.`);
      return;
    }
    setError('');
    setDraft('');
    setCreating(false);
  };

  const commitRename = (id: string) => {
    const name = renameDraft.trim();
    if (!name) {
      setRenamingId(null);
      setRenameDraft('');
      return;
    }
    const ok = onRenameShelf(id, name);
    if (!ok) {
      setError(`There is already a shelf called “${name}”.`);
      return;
    }
    setError('');
    setRenamingId(null);
    setRenameDraft('');
  };

  /** Roving tabindex: one tab stop for the whole shelf bar. */
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = ordered.length + 2; // All + Unshelved + shelves
    let next = index + 1;
    if (event.key === 'ArrowLeft') next = index - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs - 1;
    next = Math.max(0, Math.min(tabs - 1, next));
    const group = event.currentTarget.closest('.shelf-tabs');
    const buttons = group?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  };

  return (
    <div className="shelf-bar">
      <div className="shelf-tabs" role="tablist" aria-label="Shelves">
        <button
          type="button"
          role="tab"
          aria-selected={active === 'all'}
          tabIndex={active === 'all' ? 0 : -1}
          className={active === 'all' ? 'shelf-tab active' : 'shelf-tab'}
          onKeyDown={(e) => onTabKeyDown(e, 0)}
          onClick={() => onChange('all')}
        >
          All <span className="shelf-tab-count numeric">{total}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === 'unshelved'}
          tabIndex={active === 'unshelved' ? 0 : -1}
          className={active === 'unshelved' ? 'shelf-tab active' : 'shelf-tab'}
          onKeyDown={(e) => onTabKeyDown(e, 1)}
          onClick={() => onChange('unshelved')}
        >
          Unshelved <span className="shelf-tab-count numeric">{unshelvedCount}</span>
        </button>
        {ordered.map((shelf, index) =>
          renamingId === shelf.id ? (
            <span key={shelf.id} className="shelf-tab-editing">
              <input
                className="input input-inline"
                value={renameDraft}
                autoFocus
                aria-label={`Rename ${shelf.name}`}
                onChange={(e) => {
                  setRenameDraft(e.target.value);
                  setError('');
                }}
                onBlur={() => commitRename(shelf.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(shelf.id);
                  if (e.key === 'Escape') {
                    setRenamingId(null);
                    setRenameDraft('');
                    setError('');
                  }
                }}
              />
            </span>
          ) : (
            <span key={shelf.id} className="shelf-tab-wrap">
              <button
                type="button"
                role="tab"
                aria-selected={active === shelf.id}
                tabIndex={active === shelf.id ? 0 : -1}
                className={active === shelf.id ? 'shelf-tab active' : 'shelf-tab'}
                onKeyDown={(e) => onTabKeyDown(e, index + 2)}
                onClick={() => onChange(shelf.id)}
              >
                {shelf.name} <span className="shelf-tab-count numeric">{counts.get(shelf.id) ?? 0}</span>
              </button>
              <span className="shelf-tab-actions">
                <button
                  type="button"
                  className="shelf-mini"
                  aria-label={`Rename shelf ${shelf.name}`}
                  onClick={() => {
                    setRenamingId(shelf.id);
                    setRenameDraft(shelf.name);
                  }}
                >
                  <Icon name="edit" size={12} />
                </button>
                <button
                  type="button"
                  className="shelf-mini danger-ghost"
                  aria-label={`Delete shelf ${shelf.name}`}
                  onClick={() => onDeleteShelf(shelf.id)}
                >
                  <Icon name="trash" size={12} />
                </button>
              </span>
            </span>
          ),
        )}
        {creating ? (
          <input
            className="input input-inline"
            value={draft}
            autoFocus
            placeholder="Shelf name"
            aria-label="New shelf name"
            onChange={(e) => {
              setDraft(e.target.value);
              setError('');
            }}
            onBlur={commitCreate}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCreate();
              if (e.key === 'Escape') {
                setCreating(false);
                setDraft('');
                setError('');
              }
            }}
          />
        ) : (
          <button type="button" className="shelf-add" onClick={() => setCreating(true)}>
            <Icon name="plus" size={12} /> New shelf
          </button>
        )}
      </div>
      {error && (
        <p className="shelf-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
