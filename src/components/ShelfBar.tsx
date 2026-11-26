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
  onAddShelf: (name: string) => void;
  onRenameShelf: (id: string, name: string) => void;
  onDeleteShelf: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const ordered = [...shelves].sort((a, b) => a.sortOrder - b.sortOrder);

  const commitCreate = () => {
    const name = draft.trim();
    if (name) onAddShelf(name);
    setDraft('');
    setCreating(false);
  };

  const commitRename = (id: string) => {
    const name = renameDraft.trim();
    if (name) onRenameShelf(id, name);
    setRenamingId(null);
    setRenameDraft('');
  };

  return (
    <div className="shelf-bar">
      <div className="shelf-tabs" role="tablist" aria-label="Shelves">
        <button
          type="button"
          role="tab"
          aria-selected={active === 'all'}
          className={active === 'all' ? 'shelf-tab active' : 'shelf-tab'}
          onClick={() => onChange('all')}
        >
          All <span className="shelf-tab-count numeric">{total}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === 'unshelved'}
          className={active === 'unshelved' ? 'shelf-tab active' : 'shelf-tab'}
          onClick={() => onChange('unshelved')}
        >
          Unshelved <span className="shelf-tab-count numeric">{unshelvedCount}</span>
        </button>
        {ordered.map((shelf) =>
          renamingId === shelf.id ? (
            <span key={shelf.id} className="shelf-tab-editing">
              <input
                className="input input-inline"
                value={renameDraft}
                autoFocus
                aria-label={`Rename ${shelf.name}`}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => commitRename(shelf.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(shelf.id);
                  if (e.key === 'Escape') {
                    setRenamingId(null);
                    setRenameDraft('');
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
                className={active === shelf.id ? 'shelf-tab active' : 'shelf-tab'}
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
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitCreate}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCreate();
              if (e.key === 'Escape') {
                setCreating(false);
                setDraft('');
              }
            }}
          />
        ) : (
          <button type="button" className="shelf-add" onClick={() => setCreating(true)}>
            <Icon name="plus" size={12} /> New shelf
          </button>
        )}
      </div>
    </div>
  );
}
