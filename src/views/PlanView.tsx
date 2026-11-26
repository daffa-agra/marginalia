import { useMemo } from 'react';
import type { Book } from '../types';
import { STATUS_META } from '../types';
import type { JournalStore } from '../useJournal';
import type { useToasts } from '../lib/toasts';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/icons';
import { forecastQueue, measurePace, queueOf } from '../lib/plan';
import { formatDate } from '../lib/utils';

/**
 * The reading plan: an ordered queue of what to read next.
 *
 * It is a queue, not a schedule. No deadlines, no daily targets — the plan
 * says which book is next, and the page reports how fast you actually move
 * so you can see when the queue would empty without being told to hurry.
 */
export function PlanView({
  store,
  onOpenBook,
  notify,
  onBrowseLibrary,
}: {
  store: JournalStore;
  onOpenBook: (id: string) => void;
  notify: ReturnType<typeof useToasts>['notify'];
  onBrowseLibrary: () => void;
}) {
  const { data } = store;
  const queue = useMemo(() => queueOf(data.books), [data.books]);
  const pace = useMemo(() => measurePace(data.books), [data.books]);
  const forecast = useMemo(() => forecastQueue(data.books, pace), [data.books, pace]);
  const next = queue[0];

  // Unqueued books that are not finished or abandoned are candidates.
  const candidates = useMemo(
    () =>
      data.books.filter(
        (b) =>
          typeof b.queuePosition !== 'number' &&
          b.status !== 'finished' &&
          b.status !== 'abandoned',
      ),
    [data.books],
  );

  return (
    <section className="view" aria-labelledby="plan-title">
      <div className="view-head">
        <div>
          <h1 id="plan-title">Reading plan</h1>
          <p className="muted">
            {queue.length === 0
              ? 'Nothing queued yet.'
              : `${queue.length} book${queue.length === 1 ? '' : 's'} queued, read in order.`}
          </p>
        </div>
        {candidates.length > 0 && (
          <button type="button" className="btn" onClick={onBrowseLibrary}>
            <Icon name="shelf" size={14} /> Add from library
          </button>
        )}
      </div>

      {queue.length === 0 ? (
        <EmptyState
          title="Your plan is empty"
          body="Queue the books you mean to read next. They stay in order until you read them, and nothing here has a deadline."
          action={
            <button type="button" className="btn btn-primary" onClick={onBrowseLibrary}>
              <Icon name="shelf" size={14} /> Choose books
            </button>
          }
        />
      ) : (
        <>
          {next && (
            <div className="plan-next">
              <span className="plan-next-label">
                <Icon name="shelf" size={12} /> Next up
              </span>
              <div className="plan-next-body">
                <div>
                  <button type="button" className="plan-next-title" onClick={() => onOpenBook(next.id)}>
                    {next.title}
                  </button>
                  <p className="muted plan-next-author">
                    {next.author}
                    {next.totalPages ? ` · ${next.totalPages} pages` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    store.updateBook(next.id, {
                      status: 'reading',
                      startedAt: next.startedAt ?? new Date().toISOString().slice(0, 10),
                    });
                    store.unqueueBook(next.id);
                    notify(`Started “${next.title}”`);
                  }}
                >
                  Start reading
                </button>
              </div>
            </div>
          )}

          <div className="stats-panel plan-forecast">
            <h2>At your current pace</h2>
            {forecast.insufficientHistory ? (
              <p className="muted">
                {forecast.queued} book{forecast.queued === 1 ? '' : 's'} queued. Finish a few books and
                this will estimate when the queue empties — measured from your own reading, not a
                target.
              </p>
            ) : (
              <p className="plan-forecast-line">
                <strong className="numeric">{formatDuration(forecast.weeksToClear ?? 0)}</strong> to
                clear the queue
                {forecast.clearBy ? (
                  <>
                    {' '}
                    — around <strong>{formatDate(forecast.clearBy)}</strong>
                  </>
                ) : null}
                <span className="muted">
                  {' '}
                  · {pace.booksPerWeek.toFixed(2)} book{pace.booksPerWeek === 1 ? '' : 's'} a week,
                  from {pace.sampleSize} finished in the last 90 days
                </span>
              </p>
            )}
          </div>

          <ol className="plan-queue" aria-label="Reading plan queue">
            {queue.map((book, index) => (
              <PlanRow
                key={book.id}
                book={book}
                index={index}
                total={queue.length}
                onOpen={() => onOpenBook(book.id)}
                onMove={(dir) => store.moveQueueItem(book.id, dir)}
                onRemove={() => {
                  store.unqueueBook(book.id);
                  notify(`Removed “${book.title}” from the plan`);
                }}
                onStart={() => {
                  store.updateBook(book.id, {
                    status: 'reading',
                    startedAt: book.startedAt ?? new Date().toISOString().slice(0, 10),
                  });
                  store.unqueueBook(book.id);
                  notify(`Started “${book.title}”`);
                }}
              />
            ))}
          </ol>
        </>
      )}

      {candidates.length > 0 && queue.length > 0 && (
        <div className="stats-panel plan-candidates">
          <h2>Not in the plan</h2>
          <ul className="plan-candidate-list">
            {candidates.slice(0, 8).map((book) => (
              <li key={book.id}>
                <span className="plan-candidate-title">{book.title}</span>
                <span className="muted">{book.author}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => {
                    store.queueBook(book.id);
                    notify(`Queued “${book.title}”`);
                  }}
                >
                  <Icon name="plus" size={12} /> Queue
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** "2 weeks", "9 days" — honest units instead of rounding weeks up. */
function formatDuration(weeks: number): string {
  if (weeks <= 0) return 'no time at all';
  if (weeks < 1) {
    const days = Math.max(1, Math.round(weeks * 7));
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (weeks < 2) return 'about a week';
  const rounded = Math.round(weeks);
  return `${rounded} weeks`;
}

function PlanRow({  book,
  index,
  total,
  onOpen,
  onMove,
  onRemove,
  onStart,
}: {
  book: Book;
  index: number;
  total: number;
  onOpen: () => void;
  onMove: (dir: 'up' | 'down') => void;
  onRemove: () => void;
  onStart: () => void;
}) {
  const meta = STATUS_META[book.status];
  return (
    <li className="plan-row">
      <span className="plan-index numeric" aria-hidden="true">
        {index + 1}
      </span>
      <span className={`spine status-${book.status}`} aria-hidden="true" />
      <div className="plan-row-body">
        <button type="button" className="plan-row-title" onClick={onOpen}>
          {book.title}
        </button>
        <p className="muted plan-row-meta">
          {book.author}
          <span className="plan-row-status">
            {' '}
            · <Icon name={meta.icon} size={11} /> {meta.label}
          </span>
        </p>
      </div>
      <div className="plan-row-actions">
        <button
          type="button"
          className="btn btn-ghost btn-small icon-btn"
          aria-label={`Move ${book.title} up`}
          disabled={index === 0}
          onClick={() => onMove('up')}
        >
          <Icon name="chevronDown" size={13} className="flip-up" />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-small icon-btn"
          aria-label={`Move ${book.title} down`}
          disabled={index === total - 1}
          onClick={() => onMove('down')}
        >
          <Icon name="chevronDown" size={13} />
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={onStart}>
          Start
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-small danger-ghost"
          aria-label={`Remove ${book.title} from the plan`}
          onClick={onRemove}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
    </li>
  );
}
