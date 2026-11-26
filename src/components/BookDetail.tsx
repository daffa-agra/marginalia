import { useEffect, useRef, useState } from 'react';
import type { JournalStore } from '../useJournal';
import type { Book, Quote, ReadStatus } from '../types';
import { progressPercent } from '../types';
import { daysBetween, formatDate, pagesLeft, pagesSummary, todayIso } from '../lib/utils';
import { statusPatch } from '../lib/status';
import type { useToasts } from '../lib/toasts';
import { Modal } from './Modal';
import { BookFormModal } from './BookFormModal';
import { QuoteList } from './QuoteList';
import { InlineAlert, MarginRule } from './EmptyState';
import { Icon } from './icons';
import { RatingStars, StatusMenu } from './StatusMenu';
import { ShelfPicker } from './ShelfPicker';
import { deleteBookBytes } from '../lib/bookFiles';

/** How long a deleted book can be brought back, in ms. */
const UNDO_WINDOW_MS = 10000;

export function BookDetailView({
  bookId,
  store,
  onBack,
  notify,
  onRead,
}: {
  bookId: string;
  store: JournalStore;
  onBack: () => void;
  notify: ReturnType<typeof useToasts>['notify'];
  onRead?: (bookId: string) => void;
}) {
  const book = store.data.books.find((b) => b.id === bookId);
  const [editing, setEditing] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!book) {
    return (
      <section className="view">
        <button type="button" className="btn" onClick={onBack}>
          <Icon name="back" size={14} /> Back to library
        </button>
        <p className="muted" style={{ marginTop: '1rem' }}>
          That book is no longer in your journal.
        </p>
      </section>
    );
  }

  const quotes = store.quotesByBook.get(book.id) ?? [];
  const pct = progressPercent(book);
  const isSample = book.id.startsWith('demo-');

  const setStatus = (status: ReadStatus) => {
    store.updateBook(book.id, statusPatch(book, status, todayIso()));
  };

  return (
    <section className="view" aria-labelledby="book-title">
      <button type="button" className="btn back-btn" onClick={onBack}>
        <Icon name="back" size={14} /> Back to library
      </button>

      <div className="book-detail-hero">
        <div className="book-cover" style={{ backgroundColor: book.color }} aria-hidden="true">
          <span className="cover-title">{book.title}</span>
          <span className="cover-author">{book.author}</span>
        </div>
        <div className="book-detail-info">
          <div className="book-detail-kicker">
            <StatusMenu
              status={book.status}
              onChange={setStatus}
              label={`Status of ${book.title}`}
            />
            {isSample && <span className="sample-tag">Sample</span>}
          </div>
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
            {book.rating ? <RatingStars rating={book.rating} size={15} /> : null}
            {book.genres.map((g) => (
              <span key={g} className="genre-chip">
                {g}
              </span>
            ))}
          </div>

          <div className="shelf-row">
            <span className="shelf-row-label">Shelf</span>
            <ShelfPicker
              shelves={[...store.data.shelves].sort((a, b) => a.sortOrder - b.sortOrder)}
              value={book.shelfId}
              onChange={(next) => {
                store.moveBookToShelf(book.id, next);
                const name = next
                  ? (store.data.shelves.find((s) => s.id === next)?.name ?? 'shelf')
                  : 'Unshelved';
                notify(`Moved to ${name}`);
              }}
              label={`Shelf for ${book.title}`}
            />
            {book.file ? (
              <span className="file-badge">
                <Icon name="shelf" size={12} /> EPUB attached
              </span>
            ) : null}
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
                <div className="progress-fill" style={{ transform: `scaleX(${pct / 100})` }} />
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
                <dd className="numeric">{daysBetween(book.startedAt, book.finishedAt)}</dd>
              </div>
            )}
            {book.totalPages ? (
              <div>
                <dt>Pages</dt>
                <dd className="numeric">{book.totalPages}</dd>
              </div>
            ) : null}
          </dl>

          <div className="detail-actions">
            <div className="detail-action-row">
              {book.file && onRead && (
                <button type="button" className="btn btn-primary" onClick={() => onRead(book.id)}>
                  <Icon name="bookOpen" size={14} /> Continue reading
                </button>
              )}
              {book.status === 'reading' && (
                <button type="button" className="btn" onClick={() => setProgressOpen(true)}>
                  Update progress
                </button>
              )}
              <button type="button" className="btn" onClick={() => setQuoteOpen(true)}>
                <Icon name="plus" size={14} /> Add quote
              </button>
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                <Icon name="edit" size={14} /> Edit details
              </button>
              <button
                type="button"
                className="btn btn-ghost danger-ghost"
                onClick={() => setConfirmDelete(true)}
              >
                <Icon name="trash" size={14} /> Delete book
              </button>
            </div>
          </div>
        </div>
      </div>

      {book.review && (
        <div className="review-block">
          <h2>Review</h2>
          <MarginRule>
            <p>{book.review}</p>
          </MarginRule>
        </div>
      )}

      <div className="detail-quotes">
        <h2>Quotes &amp; notes ({quotes.length})</h2>
        <QuoteList
          quotes={quotes}
          store={store}
          showBookTitles={false}
          notify={notify}
          emptyMessage="No quotes for this book yet — add one, or import highlights from a Play Books notes export."
        />
      </div>

      {progressOpen && <ProgressModal book={book} store={store} onClose={() => setProgressOpen(false)} />}
      {quoteOpen && (
        <QuoteModal book={book} store={store} notify={notify} onClose={() => setQuoteOpen(false)} />
      )}
      {editing && (
        <BookFormModal
          store={store}
          notify={notify}
          book={book}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      )}
      {confirmDelete && (
        <Modal title={`Delete “${book.title}”?`} onClose={() => setConfirmDelete(false)}>
          <p className="confirm-lead">
            This removes the book, its {quotes.length} quote{quotes.length === 1 ? '' : 's'}
            {book.file ? ' and its EPUB file' : ''} from this browser.
          </p>
          <p className="muted">
            You can undo this straight after, from the message that appears. A backup export is the
            only way to recover it later.
          </p>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
              Keep book
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                setConfirmDelete(false);
                const removed = store.deleteBook(book.id);
                onBack();
                if (!removed) return;
                // The bytes stay put until the undo window closes: undoing a
                // delete that already destroyed the EPUB would restore a book
                // claiming a file it can never open.
                let undone = false;
                const timer = window.setTimeout(() => {
                  if (!undone) void deleteBookBytes(book.id).catch(() => undefined);
                }, UNDO_WINDOW_MS);
                notify(`Deleted “${removed.book.title}”`, {
                  duration: UNDO_WINDOW_MS,
                  tone: 'danger',
                  action: {
                    label: 'Undo',
                    onClick: () => {
                      undone = true;
                      window.clearTimeout(timer);
                      store.restoreBook(removed.book, removed.quotes);
                    },
                  },
                });
              }}
            >
              Delete book and quotes
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

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
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number.parseInt(page, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('Enter a page number of 0 or more.');
      return;
    }
    if (book.totalPages && parsed > book.totalPages) {
      setError(`This book has ${book.totalPages} pages.`);
      return;
    }
    const patch: Partial<Book> = { currentPage: parsed };
    if (!book.startedAt) patch.startedAt = todayIso();
    if (book.totalPages && parsed >= book.totalPages) {
      patch.status = 'finished';
      patch.finishedAt = todayIso();
    }
    store.updateBook(book.id, patch);
    onClose();
  };

  return (
    <Modal title="Update progress" onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="prog-page">
            Current page {book.totalPages ? `(of ${book.totalPages})` : ''}
          </label>
          <input
            ref={inputRef}
            id="prog-page"
            className="input numeric"
            type="number"
            min={0}
            max={book.totalPages ?? undefined}
            value={page}
            onChange={(e) => {
              setPage(e.target.value);
              setError('');
            }}
          />
        </div>
        {book.totalPages ? (
          <div className="quick-pages" role="group" aria-label="Jump to percentage">
            {[25, 50, 75, 100].map((p) => {
              const target = Math.round((book.totalPages ?? 0) * (p / 100));
              return (
                <button
                  key={p}
                  type="button"
                  className={String(target) === page ? 'btn btn-small active' : 'btn btn-small'}
                  onClick={() => {
                    setPage(String(target));
                    setError('');
                  }}
                >
                  {p}%
                </button>
              );
            })}
          </div>
        ) : null}
        {error && <InlineAlert>{error}</InlineAlert>}
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
  notify,
}: {
  book: Book;
  store: JournalStore;
  onClose: () => void;
  notify: ReturnType<typeof useToasts>['notify'];
}) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [position, setPosition] = useState('');
  const [error, setError] = useState('');
  const dirty = text.trim() || note.trim() || position.trim();

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
    notify('Quote added');
    onClose();
  };

  const requestClose = () => {
    if (dirty && !window.confirm('Discard this quote? Nothing has been saved.')) return;
    onClose();
  };

  return (
    <Modal title={`Add quote — ${book.title}`} onClose={requestClose}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="q-text">Quote</label>
          <textarea
            id="q-text"
            className="input textarea"
            rows={5}
            value={text}
            autoFocus
            onChange={(e) => {
              setText(e.target.value);
              setError('');
            }}
            placeholder="Paste or type the passage"
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
        {error && <InlineAlert>{error}</InlineAlert>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={requestClose}>
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
