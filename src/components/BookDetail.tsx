import { useEffect, useRef, useState } from 'react';
import type { JournalStore } from '../useJournal';
import type { Book, Quote } from '../types';
import { STATUS_META, STATUS_ORDER, progressPercent } from '../types';
import { daysBetween, formatDate, pagesLeft, pagesSummary, todayIso } from '../lib/utils';
import { Modal } from './Modal';
import { BookFormModal } from './BookFormModal';
import { QuoteList } from './QuoteList';

export function BookDetailView({
  bookId,
  store,
  onBack,
}: {
  bookId: string;
  store: JournalStore;
  onBack: () => void;
}) {
  const book = store.data.books.find((b) => b.id === bookId);
  const [editing, setEditing] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);

  if (!book) {
    return (
      <section className="view">
        <button type="button" className="btn" onClick={onBack}>
          ← Back to library
        </button>
        <p className="muted" style={{ marginTop: '1rem' }}>
          That book is no longer in your journal.
        </p>
      </section>
    );
  }

  const quotes = store.quotesByBook.get(book.id) ?? [];
  const meta = STATUS_META[book.status];
  const pct = progressPercent(book);

  const setStatus = (status: ReadStatusOf) => {
    const patch: Partial<Book> = { status };
    if (status === 'reading' && !book.startedAt) patch.startedAt = todayIso();
    if (status === 'finished') {
      if (!book.startedAt) patch.startedAt = book.startedAt ?? todayIso();
      patch.finishedAt = todayIso();
      if (book.totalPages) patch.currentPage = book.totalPages;
    }
    if (status === 'want-to-read') {
      patch.startedAt = undefined;
      patch.finishedAt = undefined;
    }
    store.updateBook(book.id, patch);
  };

  return (
    <section className="view" aria-labelledby="book-title">
      <button type="button" className="btn back-btn" onClick={onBack}>
        ← Back to library
      </button>

      <div className="book-detail-hero">
        <div className="book-cover" style={{ backgroundColor: book.color }} aria-hidden="true">
          <span className="cover-title">{book.title}</span>
          <span className="cover-author">{book.author}</span>
        </div>
        <div className="book-detail-info">
          <p className={`status-chip chip-${book.status}`}>
            <span aria-hidden="true">{meta.icon}</span> {meta.label}
          </p>
          <h1 id="book-title">{book.title}</h1>
          <p className="book-author">
            {book.author}
            {book.series ? (
              <>
                {' '}
                · {book.series}
                {book.seriesIndex != null ? ` #${book.seriesIndex}` : ''}
              </>
            ) : null}
          </p>
          <div className="book-detail-meta">
            {book.rating ? (
              <span className="rating" aria-label={`Rated ${book.rating} of 5`}>
                <span aria-hidden="true">{'★'.repeat(book.rating)}</span>
                <span aria-hidden="true" className="rating-empty">
                  {'☆'.repeat(5 - book.rating)}
                </span>
              </span>
            ) : null}
            {book.genres.map((g) => (
              <span key={g} className="genre-chip">
                {g}
              </span>
            ))}
          </div>

          {book.status === 'reading' && book.totalPages ? (
            <div className="detail-progress">
              <div
                className="progress-track"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Reading progress"
              >
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="progress-caption muted">
                {pagesSummary(book.currentPage, book.totalPages)} · {pagesLeft(book.currentPage, book.totalPages)} pages to go
              </span>
            </div>
          ) : null}

          <dl className="date-facts">
            {book.startedAt && (
              <div>
                <dt>Started</dt>
                <dd>{formatDate(book.startedAt)}</dd>
              </div>
            )}
            {book.finishedAt && (
              <div>
                <dt>Finished</dt>
                <dd>{formatDate(book.finishedAt)}</dd>
              </div>
            )}
            {book.startedAt && book.finishedAt && (
              <div>
                <dt>Days</dt>
                <dd>{daysBetween(book.startedAt, book.finishedAt)}</dd>
              </div>
            )}
            {book.totalPages ? (
              <div>
                <dt>Pages</dt>
                <dd>{book.totalPages}</dd>
              </div>
            ) : null}
          </dl>

          <div className="detail-actions">
            <div className="status-picker" role="group" aria-label="Set status">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={s === book.status ? 'tab active' : 'tab'}
                  aria-pressed={s === book.status}
                  onClick={() => setStatus(s)}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
            </div>
            <div className="detail-action-row">
              {book.status === 'reading' && (
                <button type="button" className="btn" onClick={() => setProgressOpen(true)}>
                  Update progress
                </button>
              )}
              <button type="button" className="btn" onClick={() => setQuoteOpen(true)}>
                + Add quote
              </button>
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                Edit details
              </button>
            </div>
          </div>
        </div>
      </div>

      {book.review && (
        <div className="review-block">
          <h2>Review</h2>
          <p>{book.review}</p>
        </div>
      )}

      <div className="detail-quotes">
        <h2>Quotes &amp; notes ({quotes.length})</h2>
        <QuoteList
          quotes={quotes}
          store={store}
          showBookTitles={false}
          emptyMessage="No quotes for this book yet — add one, or import highlights from a Play Books notes export."
        />
      </div>

      {progressOpen && <ProgressModal book={book} store={store} onClose={() => setProgressOpen(false)} />}
      {quoteOpen && <QuoteModal book={book} store={store} onClose={() => setQuoteOpen(false)} />}
      {editing && (
        <BookFormModal store={store} book={book} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
      )}
    </section>
  );
}

type ReadStatusOf = Book['status'];

function ProgressModal({
  book,
  store,
  onClose,
}: {
  book: Book;
  store: JournalStore;
  onClose: () => void;
}) {
  const [page, setPage] = useState(String(book.currentPage));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.select(), []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number.parseInt(page, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const next = book.totalPages ? Math.min(parsed, book.totalPages) : parsed;
    const patch: Partial<Book> = { currentPage: next };
    if (!book.startedAt) patch.startedAt = todayIso();
    if (book.totalPages && next >= book.totalPages) {
      patch.status = 'finished';
      patch.finishedAt = todayIso();
    }
    store.updateBook(book.id, patch);
    onClose();
  };

  return (
    <Modal title="Update progress" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="prog-page">
            Current page {book.totalPages ? `(of ${book.totalPages})` : ''}
          </label>
          <input
            ref={inputRef}
            id="prog-page"
            className="input"
            type="number"
            min={0}
            max={book.totalPages ?? undefined}
            value={page}
            onChange={(e) => setPage(e.target.value)}
          />
        </div>
        {book.totalPages ? (
          <div className="quick-pages" role="group" aria-label="Quick set">
            {[25, 50, 75, 100].map((p) => {
              const target = Math.round((book.totalPages ?? 0) * (p / 100));
              return (
                <button key={p} type="button" className="btn btn-ghost" onClick={() => setPage(String(target))}>
                  {p}%
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save progress
          </button>
        </div>
      </form>
    </Modal>
  );
}

function QuoteModal({
  book,
  store,
  onClose,
}: {
  book: Book;
  store: JournalStore;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [position, setPosition] = useState('');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setError('Write or paste the quote first.');
      return;
    }
    const quote: Partial<Quote> & { text: string } = { text: text.trim() };
    quote.note = note.trim() || undefined;
    quote.position = position.trim() || undefined;
    store.addQuotes(book.id, [quote as { text: string; note?: string; position?: string }]);
    onClose();
  };

  return (
    <Modal title={`Add quote — ${book.title}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="q-text">Quote *</label>
          <textarea
            id="q-text"
            className="input textarea"
            rows={5}
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            placeholder="“Paste or type the passage here…”"
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="q-note">Your note</label>
            <input id="q-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="field field-small">
            <label htmlFor="q-pos">Position</label>
            <input
              id="q-pos"
              className="input"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="42% or p. 118"
            />
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save quote
          </button>
        </div>
      </form>
    </Modal>
  );
}
