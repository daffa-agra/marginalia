import { useEffect, useState } from 'react';
import { STATUS_ORDER } from '../types';
import type { Book, ReadStatus } from '../types';
import { STATUS_META } from '../types';
import type { JournalStore } from '../useJournal';
import { Modal } from './Modal';
import { parseNonNegativeInt, todayIso } from '../lib/utils';

const COLOR_SWATCHES = [
  '#b4552d', '#3f6f71', '#5b6d8f', '#8f5b6d',
  '#6d7a5b', '#a0703c', '#704f8f', '#4f7a5c',
];

export interface BookFormValues {
  title: string;
  author: string;
  series: string;
  seriesIndex: string;
  status: ReadStatus;
  totalPages: string;
  currentPage: string;
  rating: number | null;
  review: string;
  startedAt: string;
  finishedAt: string;
  genres: string;
  color: string;
}

export function emptyFormValues(): BookFormValues {
  return {
    title: '',
    author: '',
    series: '',
    seriesIndex: '',
    status: 'want-to-read',
    totalPages: '',
    currentPage: '0',
    rating: null,
    review: '',
    startedAt: '',
    finishedAt: '',
    genres: '',
    color: COLOR_SWATCHES[Math.floor(Math.random() * COLOR_SWATCHES.length)],
  };
}

export function formValuesFromBook(book: Book): BookFormValues {
  return {
    title: book.title,
    author: book.author,
    series: book.series ?? '',
    seriesIndex: book.seriesIndex != null ? String(book.seriesIndex) : '',
    status: book.status,
    totalPages: book.totalPages != null ? String(book.totalPages) : '',
    currentPage: String(book.currentPage),
    rating: book.rating ?? null,
    review: book.review ?? '',
    startedAt: book.startedAt ?? '',
    finishedAt: book.finishedAt ?? '',
    genres: book.genres.join(', '),
    color: book.color,
  };
}

function valuesToPatch(values: BookFormValues): Omit<Book, 'id' | 'createdAt'> {
  const totalPages = parseNonNegativeInt(values.totalPages);
  const currentPage = parseNonNegativeInt(values.currentPage) ?? 0;
  return {
    title: values.title.trim(),
    author: values.author.trim() || 'Unknown author',
    series: values.series.trim() || undefined,
    seriesIndex: values.seriesIndex.trim() === '' ? undefined : parseNonNegativeInt(values.seriesIndex),
    status: values.status,
    totalPages,
    currentPage: totalPages ? Math.min(currentPage, totalPages) : currentPage,
    rating: values.rating ?? undefined,
    review: values.review.trim() || undefined,
    startedAt: values.startedAt || undefined,
    finishedAt: values.finishedAt || undefined,
    genres: values.genres
      .split(',')
      .map((g) => g.trim())
      .filter(Boolean),
    color: values.color,
  };
}

export function BookFormModal({
  store,
  book,
  onClose,
  onSaved,
}: {
  store: JournalStore;
  book?: Book;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [values, setValues] = useState<BookFormValues>(() =>
    book ? formValuesFromBook(book) : emptyFormValues(),
  );
  const [error, setError] = useState('');

  const set = <K extends keyof BookFormValues>(key: K, value: BookFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  // Prefill author/color from the most recent book on a fresh add.
  const lastBook = store.data.books[0];
  useEffect(() => {
    if (book || !lastBook) return;
    setValues((v) => ({
      ...v,
      author: v.author || lastBook.author,
      color: v.color || lastBook.color,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!values.title.trim()) {
      setError('Give the book a title.');
      return;
    }
    if (values.status === 'finished' && !values.finishedAt) {
      set('finishedAt', todayIso());
    }
    const patch = valuesToPatch(values);
    if (book) {
      store.updateBook(book.id, patch);
      onSaved(book.id);
    } else {
      const created = store.addBook(patch);
      onSaved(created.id);
    }
  };

  return (
    <Modal title={book ? 'Edit book' : 'Add a book'} onClose={onClose}>
      <form className="form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="bf-title">Title *</label>
          <input
            id="bf-title"
            className="input"
            value={values.title}
            onChange={(e) => set('title', e.target.value)}
            autoFocus
            required
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="bf-author">Author</label>
            <input
              id="bf-author"
              className="input"
              value={values.author}
              onChange={(e) => set('author', e.target.value)}
              placeholder="e.g. Ursula K. Le Guin"
            />
          </div>
          <div className="field">
            <label htmlFor="bf-status">Status</label>
            <select
              id="bf-status"
              className="input select"
              value={values.status}
              onChange={(e) => set('status', e.target.value as ReadStatus)}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="bf-series">Series</label>
            <input
              id="bf-series"
              className="input"
              value={values.series}
              onChange={(e) => set('series', e.target.value)}
              placeholder="e.g. Earthsea"
            />
          </div>
          <div className="field field-small">
            <label htmlFor="bf-series-index"># in series</label>
            <input
              id="bf-series-index"
              className="input"
              type="number"
              min={1}
              value={values.seriesIndex}
              onChange={(e) => set('seriesIndex', e.target.value)}
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field field-small">
            <label htmlFor="bf-pages">Total pages</label>
            <input
              id="bf-pages"
              className="input"
              type="number"
              min={0}
              value={values.totalPages}
              onChange={(e) => set('totalPages', e.target.value)}
            />
          </div>
          <div className="field field-small">
            <label htmlFor="bf-current">Current page</label>
            <input
              id="bf-current"
              className="input"
              type="number"
              min={0}
              value={values.currentPage}
              onChange={(e) => set('currentPage', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="bf-genres">Genres (comma separated)</label>
            <input
              id="bf-genres"
              className="input"
              value={values.genres}
              onChange={(e) => set('genres', e.target.value)}
              placeholder="Fantasy, Adventure"
            />
          </div>
        </div>

        {(values.status === 'reading' || values.status === 'finished' || values.status === 'abandoned') && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="bf-started">Started</label>
              <input
                id="bf-started"
                className="input"
                type="date"
                value={values.startedAt}
                onChange={(e) => set('startedAt', e.target.value)}
              />
            </div>
            {values.status === 'finished' && (
              <div className="field">
                <label htmlFor="bf-finished">Finished</label>
                <input
                  id="bf-finished"
                  className="input"
                  type="date"
                  value={values.finishedAt}
                  onChange={(e) => set('finishedAt', e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {values.status === 'finished' && (
          <div className="field">
            <label id="rating-label">Rating</label>
            <div className="rating-input" role="radiogroup" aria-labelledby="rating-label">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={values.rating === n}
                  aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  className={values.rating && n <= values.rating ? 'star on' : 'star'}
                  onClick={() => set('rating', values.rating === n ? null : n)}
                >
                  {values.rating && n <= values.rating ? '★' : '☆'}
                </button>
              ))}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => set('rating', null)}
                disabled={values.rating == null}
              >
                Clear
              </button>
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="bf-review">Review</label>
          <textarea
            id="bf-review"
            className="input textarea"
            rows={4}
            value={values.review}
            onChange={(e) => set('review', e.target.value)}
            placeholder="What did you think?"
          />
        </div>

        <fieldset className="field">
          <legend>Spine color</legend>
          <div className="swatch-row" role="radiogroup" aria-label="Spine color">
            {COLOR_SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={values.color === c}
                aria-label={`Color ${c}`}
                className={values.color === c ? 'swatch selected' : 'swatch'}
                style={{ backgroundColor: c }}
                onClick={() => set('color', c)}
              />
            ))}
          </div>
        </fieldset>

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
            {book ? 'Save changes' : 'Add book'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
