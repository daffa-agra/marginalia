import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

/**
 * The composer for a marginal note.
 *
 * Deliberately not a modal: a reader writes about a sentence while looking at
 * it, so the passage stays visible above the composer and the page is never
 * covered. Desktop puts it in the right margin, over the page edge, using the
 * same inked rule as the journal; on a narrow screen it becomes a sheet.
 */
export function MarginComposer({
  quote,
  initialNote = '',
  onSave,
  onDelete,
  onClose,
}: {
  /** The passage being annotated, already extracted from the book. */
  quote: string;
  /** The existing note when editing, so the composer opens on what was written. */
  initialNote?: string;
  onSave: (note: string) => void;
  /** Omitted when creating a new note. */
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState(initialNote);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      // The convention in every notes app: save without reaching for the mouse.
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onSave(note.trim());
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [note, onSave, onClose]);

  return (
    <aside className="margin-composer" aria-label="Annotate this passage">
      <div className="margin-composer-head">
        <span className="margin-composer-title">Note in the margin</span>
        <button type="button" className="reader-icon-btn" aria-label="Close note" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <blockquote className="margin-composer-quote">{quote}</blockquote>

      <label className="margin-composer-field">
        <span className="visually-hidden">Your note</span>
        <textarea
          ref={ref}
          value={note}
          rows={5}
          placeholder="What did you notice?"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      <div className="margin-composer-actions">
        <button type="button" className="btn btn-small btn-quiet" onClick={onClose}>
          Cancel
        </button>
        {onDelete && (
          <button type="button" className="btn btn-small btn-quiet danger" onClick={onDelete}>
            Delete
          </button>
        )}
        <button type="button" className="btn btn-small btn-primary" onClick={() => onSave(note.trim())}>
          Save note
        </button>
      </div>
      <p className="margin-composer-hint muted">
        <kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves
      </p>
    </aside>
  );
}

/**
 * The floating toolbar that appears over a selection.
 *
 * Positioned in the app's coordinate space rather than the book's, so it is not
 * clipped by the reading frame and cannot be scrolled away from its selection.
 */
export function SelectionToolbar({
  x,
  y,
  onQuote,
  onNote,
  onCopy,
}: {
  x: number;
  y: number;
  onQuote: () => void;
  onNote: () => void;
  onCopy: () => void;
}) {
  return (
    <div
      className="selection-toolbar"
      role="toolbar"
      aria-label="Actions for this passage"
      style={{ left: `${x}px`, top: `${y}px` }}
      // Keep the selection alive: a mousedown that lands here would clear it
      // before the button's click handler ran.
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" onClick={onNote}>
        <Icon name="quote" size={13} /> Note
      </button>
      <button type="button" onClick={onQuote}>
        <Icon name="bookmark" size={13} /> Quote
      </button>
      <button type="button" onClick={onCopy}>
        Copy
      </button>
    </div>
  );
}
