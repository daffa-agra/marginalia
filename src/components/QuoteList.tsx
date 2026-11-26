import { useEffect, useRef, useState } from 'react';
import type { Quote } from '../types';
import type { JournalStore } from '../useJournal';
import type { useToasts } from '../lib/toasts';
import { Icon } from './icons';
import { InlineAlert } from './EmptyState';

/** Quotation marks should hang outside the text block for better rag. */
function useHangingQuotes() {
  const ref = useRef<HTMLQuoteElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const text = el.textContent ?? '';
    if (/^["'\u201c\u2018]/.test(text)) el.classList.add('hang');
  }, []);
  return ref;
}

/** A short, unambiguous name for a quote's actions. */
function quoteName(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length > 48 ? `${clean.slice(0, 48)}…` : clean;
}

export function QuoteCard({
  quote,
  store,
  bookTitle,
  notify,
}: {
  quote: Quote;
  store: JournalStore;
  bookTitle?: string;
  notify: ReturnType<typeof useToasts>['notify'];
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(quote.text);
  const [note, setNote] = useState(quote.note ?? '');
  const [error, setError] = useState('');
  const ref = useHangingQuotes();

  const save = () => {
    if (!text.trim()) {
      setError('A quote cannot be empty.');
      return;
    }
    store.updateQuote(quote.id, { text: text.trim(), note: note.trim() || undefined });
    notify('Quote updated');
    setEditing(false);
  };

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(quote.text);
      notify('Quote copied to the clipboard');
    } catch {
      notify('Could not access the clipboard — select the text and copy it manually', {
        tone: 'danger',
      });
    }
  };

  const remove = () => {
    const removed = store.deleteQuote(quote.id);
    if (!removed) return;
    notify('Quote deleted', {
      duration: 7000,
      tone: 'danger',
      action: { label: 'Undo', onClick: () => store.restoreQuote(removed) },
    });
  };

  if (editing) {
    return (
      <figure className="quote-card editing">
        <label className="visually-hidden" htmlFor={`qt-${quote.id}`}>
          Quote text
        </label>
        <textarea
          id={`qt-${quote.id}`}
          className="input textarea"
          value={text}
          rows={4}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
        />
        <label className="visually-hidden" htmlFor={`qn-${quote.id}`}>
          Note
        </label>
        <input
          id={`qn-${quote.id}`}
          className="input"
          value={note}
          placeholder="Your note"
          onChange={(e) => setNote(e.target.value)}
        />
        {error && <InlineAlert>{error}</InlineAlert>}
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-small"
            onClick={() => {
              setText(quote.text);
              setNote(quote.note ?? '');
              setError('');
              setEditing(false);
            }}
          >
            Cancel
          </button>
          <button type="button" className="btn btn-small btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </figure>
    );
  }

  return (
    <figure className="quote-card">
      <blockquote ref={ref} className="quote-text">
        <p>{quote.text}</p>
      </blockquote>
      {quote.note && <figcaption className="quote-note">{quote.note}</figcaption>}
      <div className="quote-meta">
        {bookTitle && <span className="quote-book">{bookTitle}</span>}
        {quote.position && <span className="muted"> · {quote.position}</span>}
      </div>
      <div className="quote-actions">
        <button
          type="button"
          className="btn btn-ghost btn-small"
          aria-label={`Edit quote: ${quoteName(quote.text)}`}
          onClick={() => setEditing(true)}
        >
          <Icon name="edit" size={14} /> Edit
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          aria-label={`Copy quote: ${quoteName(quote.text)}`}
          onClick={copy}
        >
          <Icon name="copy" size={14} /> Copy
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-small danger-ghost"
          aria-label={`Delete quote: ${quoteName(quote.text)}`}
          onClick={remove}
        >
          <Icon name="trash" size={14} /> Delete
        </button>
      </div>
    </figure>
  );
}

/** Two-column masonry-ish layout using CSS columns. */
export function QuoteList({
  quotes,
  store,
  showBookTitles = false,
  titleById,
  notify,
  emptyMessage = 'No quotes yet — add one from a book, or import from Play Books.',
}: {
  quotes: Quote[];
  store: JournalStore;
  showBookTitles?: boolean;
  titleById?: Map<string, string>;
  notify: ReturnType<typeof useToasts>['notify'];
  emptyMessage?: string;
}) {
  const [filter, setFilter] = useState('');

  const visible = quotes.filter((q) => {
    if (!filter.trim()) return true;
    const needle = filter.toLowerCase();
    const title = showBookTitles && titleById ? (titleById.get(q.bookId) ?? '') : '';
    return (
      q.text.toLowerCase().includes(needle) ||
      (q.note ?? '').toLowerCase().includes(needle) ||
      title.toLowerCase().includes(needle)
    );
  });

  return (
    <div>
      {quotes.length > 3 && (
        <div className="quotes-toolbar">
          <label className="visually-hidden" htmlFor="quote-filter">
            Filter quotes
          </label>
          <input
            id="quote-filter"
            type="search"
            className="input search-input"
            placeholder="Filter quotes"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}
      {visible.length === 0 ? (
        <p className="muted empty-quotes">{filter ? 'No quotes match.' : emptyMessage}</p>
      ) : (
        <div className="quote-columns">
          {visible.map((q) => (
            <QuoteCard
              key={q.id}
              quote={q}
              store={store}
              notify={notify}
              bookTitle={showBookTitles ? titleById?.get(q.bookId) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
