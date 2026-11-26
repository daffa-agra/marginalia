import { STATUS_META, progressPercent } from '../types';
import type { Book } from '../types';
import { pagesLeft, pagesSummary } from '../lib/utils';

export function BookCard({
  book,
  quoteCount,
  onOpen,
  onAdvanceStatus,
}: {
  book: Book;
  quoteCount: number;
  onOpen: () => void;
  onAdvanceStatus: () => void;
}) {
  const meta = STATUS_META[book.status];
  const pct = progressPercent(book);
  const showProgress = book.status === 'reading' && book.totalPages;

  return (
    <article className={`book-card status-${book.status}`}>
      <div className="book-card-main">
        <span className={`spine status-${book.status}`} aria-hidden="true" />
        <div className="book-card-body">
          <button type="button" className="book-link" onClick={onOpen}>
            {book.title}
          </button>
          <p className="book-author">
            {book.author}
            {book.series ? (
              <span className="muted">
                {' '}
                · {book.series}
                {book.seriesIndex != null ? ` #${book.seriesIndex}` : ''}
              </span>
            ) : null}
          </p>
          <div className="book-meta-row">
            <span className={`status-chip chip-${book.status}`}>
              <span aria-hidden="true">{meta.icon}</span> {meta.label}
            </span>
            {book.rating ? (
              <span className="rating" aria-label={`Rated ${book.rating} of 5`}>
                <span aria-hidden="true">{'★'.repeat(book.rating)}</span>
                <span aria-hidden="true" className="rating-empty">
                  {'☆'.repeat(5 - book.rating)}
                </span>
              </span>
            ) : null}
          </div>
          {showProgress ? (
            <div className="progress-wrap">
              <div
                className="progress-track"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${book.title} progress`}
              >
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="progress-caption muted">
                {pagesSummary(book.currentPage, book.totalPages)} · {pagesLeft(book.currentPage, book.totalPages)} to go
              </span>
            </div>
          ) : null}
          {book.genres.length > 0 && (
            <p className="genre-row">
              {book.genres.slice(0, 3).map((g) => (
                <span key={g} className="genre-chip">
                  {g}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
      <div className="book-card-foot">
        <button type="button" className="btn btn-ghost" onClick={onOpen}>
          Open
        </button>
        <button type="button" className="btn btn-ghost" onClick={onAdvanceStatus}>
          Move to {STATUS_META[nextStatus(book.status)].label.toLowerCase()}
        </button>
        {quoteCount > 0 && (
          <span className="quote-count" title={`${quoteCount} quotes`}>
            ❝ {quoteCount}
          </span>
        )}
      </div>
    </article>
  );
}

function nextStatus(status: Book['status']): Book['status'] {
  switch (status) {
    case 'want-to-read':
      return 'reading';
    case 'reading':
      return 'finished';
    case 'finished':
      return 'want-to-read';
    case 'abandoned':
      return 'reading';
  }
}
