import { useMemo, useState } from 'react';
import { STATUS_ORDER, progressPercent } from '../types';
import type { Book, ReadStatus } from '../types';
import type { JournalStore } from '../useJournal';
import { BookCard } from '../components/BookCard';
import { BookFormModal } from '../components/BookFormModal';
import { EmptyState } from '../components/EmptyState';
import { SearchFilterBar } from '../components/SearchFilterBar';

export function LibraryView({ store, onOpenBook }: { store: JournalStore; onOpenBook: (id: string) => void }) {
  const { data } = store;
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ReadStatus | 'all'>('all');
  const [genreFilter, setGenreFilter] = useState<string>('all');
  const [sort, setSort] = useState<'recent' | 'title' | 'author' | 'rating' | 'progress'>('recent');
  const [adding, setAdding] = useState(false);

  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const b of data.books) for (const g of b.genres) set.add(g);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [data.books]);

  const books = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = data.books.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (genreFilter !== 'all' && !b.genres.includes(genreFilter)) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        (b.series ?? '').toLowerCase().includes(q) ||
        b.genres.some((g) => g.toLowerCase().includes(q))
      );
    });
    const byString = (get: (b: Book) => string) => (a: Book, c: Book) =>
      get(a).localeCompare(get(c));
    switch (sort) {
      case 'title':
        list = [...list].sort(byString((b) => b.title));
        break;
      case 'author':
        list = [...list].sort(byString((b) => b.author));
        break;
      case 'rating':
        list = [...list].sort(
          (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.title.localeCompare(b.title),
        );
        break;
      case 'progress':
        list = [...list].sort(
          (a, b) => progressPercent(b) - progressPercent(a) || a.title.localeCompare(b.title),
        );
        break;
      default:
        list = [...list].sort((a, b) => b.createdAt - a.createdAt);
    }
    return list;
  }, [data.books, query, statusFilter, genreFilter, sort]);

  const counts = useMemo(() => {
    const map = new Map<ReadStatus, number>(STATUS_ORDER.map((s) => [s, 0]));
    for (const b of data.books) map.set(b.status, (map.get(b.status) ?? 0) + 1);
    return map;
  }, [data.books]);

  return (
    <section className="view" aria-labelledby="library-title">
      <div className="view-head">
        <div>
          <h1 id="library-title">Library</h1>
          <p className="muted">
            {data.books.length === 0
              ? 'Your shelves are empty.'
              : `${data.books.length} book${data.books.length === 1 ? '' : 's'} in your journal.`}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          + Add book
        </button>
      </div>

      <SearchFilterBar
        query={query}
        onQuery={setQuery}
        status={statusFilter}
        onStatus={setStatusFilter}
        genre={genreFilter}
        genres={genres}
        onGenre={setGenreFilter}
        sort={sort}
        onSort={setSort}
        counts={counts}
        total={data.books.length}
      />

      {books.length === 0 ? (
        <EmptyState
          icon="❧"
          title={data.books.length === 0 ? 'No books yet' : 'Nothing matches'}
          body={
            data.books.length === 0
              ? 'Add your first book to start the journal — or drag a Play Books notes export onto this page to import highlights.'
              : 'Try a different search, status, or genre filter.'
          }
          action={
            data.books.length === 0 ? (
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                Add your first book
              </button>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setQuery('');
                  setStatusFilter('all');
                  setGenreFilter('all');
                }}
              >
                Clear filters
              </button>
            )
          }
        />
      ) : (
        <ul className="book-grid" role="list">
          {books.map((book) => (
            <li key={book.id}>
              <BookCard
                book={book}
                quoteCount={store.quotesByBook.get(book.id)?.length ?? 0}
                onOpen={() => onOpenBook(book.id)}
                onAdvanceStatus={() => {
                  const next =
                    STATUS_ORDER[(STATUS_ORDER.indexOf(book.status) + 1) % STATUS_ORDER.length];
                  store.updateBook(book.id, nextStatusPatch(book, next));
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <BookFormModal store={store} onClose={() => setAdding(false)} onSaved={() => setAdding(false)} />
      )}
    </section>
  );
}

function nextStatusPatch(book: Book, next: ReadStatus): Partial<Book> {
  if (next === 'reading' && !book.startedAt) {
    return { status: next, startedAt: new Date().toISOString().slice(0, 10) };
  }
  if (next === 'finished') {
    return {
      status: next,
      finishedAt: new Date().toISOString().slice(0, 10),
      currentPage: book.totalPages ?? book.currentPage,
    };
  }
  return { status: next };
}
