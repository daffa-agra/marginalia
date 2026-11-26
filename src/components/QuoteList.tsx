import { useEffect, useRef, useState } from 'react';
import type { Quote } from '../types';
import type { JournalStore } from '../useJournal';

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

export function QuoteCard({
  quote,
  store,
  bookTitle,
}: {
  quote: Quote;
  store: JournalStore;
  bookTitle?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(quote.text);
  const [note, setNote] = useState(quote.note ?? '');
  const ref = useHangingQuotes();

  const save = () => {
    store.updateQuote(quote.id, { text: text.trim(), note: note.trim() || undefined });
    setEditing(false);
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
          onChange={(e) => setText(e.target.value)}
        />
        <label className="visually-hidden" htmlFor={`qn-${quote.id}`}>
          Note
        </label>
        <input
          id={`qn-${quote.id}`}
          className="input"
          value={note}
          placeholder="Your note (optional)"
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save}>
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
      {quote.note && <figcaption className="quote-note">— {quote.note}</figcaption>}
      <div className="quote-meta">
        {bookTitle && <span className="quote-book">{bookTitle}</span>}
        {quote.position && <span className="muted"> · {quote.position}</span>}
      </div>
      <div className="quote-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => navigator.clipboard?.writeText(quote.text)}
        >
          Copy
        </button>
        <button
          type="button"
          className="btn btn-ghost danger"
          onClick={() => store.deleteQuote(quote.id)}
        >
          Delete
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
  emptyMessage = 'No quotes yet — add one below or import from Play Books.',
}: {
  quotes: Quote[];
  store: JournalStore;
  showBookTitles?: boolean;
  titleById?: Map<string, string>;
  emptyMessage?: string;
}) {
  const [filter, setFilter] = useState('');

  const visible = quotes.filter((q) => {
    if (!filter.trim()) return true;
    const needle = filter.toLowerCase();
    const title = showBookTitles && titleById ? (titleById.get(q.bookId) ?? '') : '';
    return q.text.toLowerCase().includes(needle) || (q.note ?? '').toLowerCase().includes(needle) || title.toLowerCase().includes(needle);
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
            placeholder="Filter quotes…"
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
            <QuoteCard key={q.id} quote={q} store={store} bookTitle={showBookTitles ? titleById?.get(q.bookId) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
