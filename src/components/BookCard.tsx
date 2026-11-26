import { progressPercent } from '../types';
import type { Book, ReadStatus } from '../types';
import { pagesLeft, pagesSummary } from '../lib/utils';
import { Icon } from './icons';
import { RatingStars, StatusMenu } from './StatusMenu';

export function BookCard({
  book,
  quoteCount,
  onOpen,
  onStatusChange,
}: {
  book: Book;
  quoteCount: number;
  onOpen: () => void;
  onStatusChange: (next: ReadStatus) => void;
}) {
  const pct = progressPercent(book);
  const showProgress = book.status === 'reading' && book.totalPages;
  const isSample = book.id.startsWith('demo-');

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
            <StatusMenu compact status={book.status} onChange={onStatusChange} label={`Status of ${book.title}`} />
            {book.rating ? <RatingStars rating={book.rating} /> : null}
            {isSample && <span className="sample-tag">Sample</span>}
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
                <div className="progress-fill" style={{ transform: `scaleX(${pct / 100})` }} />
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
        <button type="button" className="btn btn-ghost btn-small" onClick={onOpen}>
          Open
        </button>
        {quoteCount > 0 && (
          <span className="quote-count" title={`${quoteCount} quotes`}>
            <Icon name="quote" size={12} />
            <span className="numeric">{quoteCount}</span>
          </span>
        )}
      </div>
    </article>
  );
}
