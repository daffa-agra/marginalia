import { useMemo, useState } from 'react';
import { STATUS_ORDER, progressPercent } from '../types';
import type { Book, ReadStatus } from '../types';
import type { JournalStore } from '../useJournal';
import { BookCard } from '../components/BookCard';
import { EmptyState } from '../components/EmptyState';
import { SearchFilterBar } from '../components/SearchFilterBar';
import { ShelfBar } from '../components/ShelfBar';
import type { ShelfFilter } from '../components/ShelfBar';
import { UploadBookModal } from '../components/UploadBookModal';
import { statusPatch } from '../lib/status';
import { todayIso } from '../lib/utils';
import { Icon } from '../components/icons';
import type { useToasts } from '../lib/toasts';

export function LibraryView({
  store,
  onOpenBook,
  notify,
}: {
  store: JournalStore;
  onOpenBook: (id: string) => void;
  notify: ReturnType<typeof useToasts>['notify'];
}) {
  const { data } = store;
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ReadStatus | 'all'>('all');
  const [genreFilter, setGenreFilter] = useState<string>('all');
  const [sort, setSort] = useState<'recent' | 'title' | 'author' | 'rating' | 'progress'>('recent');
  const [shelfFilter, setShelfFilter] = useState<ShelfFilter>('all');
  const [adding, setAdding] = useState(false);

  const genres = useMemo(() => {
    const set = new Set<string>();
    for (const b of data.books) for (const g of b.genres) set.add(g);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [data.books]);

  const counts = useMemo(() => {
    const map = new Map<ReadStatus, number>(STATUS_ORDER.map((s) => [s, 0]));
    for (const b of data.books) map.set(b.status, (map.get(b.status) ?? 0) + 1);
    return map;
  }, [data.books]);

  const shelfCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of data.books) {
      if (b.shelfId) map.set(b.shelfId, (map.get(b.shelfId) ?? 0) + 1);
    }
    return map;
  }, [data.books]);

  const unshelvedCount = useMemo(
    () => data.books.filter((b) => !b.shelfId).length,
    [data.books],
  );

  const books = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = data.books.filter((b) => {
      if (shelfFilter === 'unshelved' && b.shelfId) return false;
      if (shelfFilter !== 'all' && shelfFilter !== 'unshelved' && b.shelfId !== shelfFilter) return false;
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
  }, [data.books, query, statusFilter, genreFilter, sort, shelfFilter]);

  const setStatus = (book: Book, next: ReadStatus) => {
    store.updateBook(book.id, statusPatch(book, next, todayIso()));
  };

  const activeShelfName =
    shelfFilter === 'all'
      ? null
      : shelfFilter === 'unshelved'
        ? 'Unshelved'
        : (data.shelves.find((s) => s.id === shelfFilter)?.name ?? null);

  const shelfIsEmpty =
    shelfFilter !== 'all' &&
    shelfFilter !== 'unshelved' &&
    (shelfCounts.get(shelfFilter) ?? 0) === 0;

  const heading = activeShelfName ?? 'Library';

  return (
    <section className="view" aria-labelledby="library-title">
      <div className="view-head">
        <div>
          <h1 id="library-title">{heading}</h1>
          <p className="muted">
            {data.books.length === 0
              ? 'Your shelves are empty.'
              : `${data.books.length} book${data.books.length === 1 ? '' : 's'} in your journal.`}
          </p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} /> Add book
        </button>
      </div>

      <ShelfBar
        shelves={data.shelves}
        counts={shelfCounts}
        total={data.books.length}
        unshelvedCount={unshelvedCount}
        active={shelfFilter}
        onChange={setShelfFilter}
        onAddShelf={(name) => {
          const shelf = store.addShelf(name);
          notify(`Created the shelf “${shelf.name}”`);
        }}
        onRenameShelf={(id, name) => store.renameShelf(id, name)}
        onDeleteShelf={(id) => {
          const shelf = data.shelves.find((s) => s.id === id);
          const moved = shelfCounts.get(id) ?? 0;
          const confirmed = window.confirm(
            moved > 0
              ? `Delete the shelf “${shelf?.name}”? Its ${moved} book${moved === 1 ? '' : 's'} will move to Unshelved, not be deleted.`
              : `Delete the shelf “${shelf?.name}”?`,
          );
          if (!confirmed) return;
          store.deleteShelf(id);
          if (shelfFilter === id) setShelfFilter('all');
          notify(`Deleted the shelf “${shelf?.name ?? ''}”`);
        }}
      />

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
        shelfIsEmpty ? (
          <EmptyState
            title={`${activeShelfName} is empty`}
            body="Move a book here from its book page, or add a new one straight onto this shelf."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                <Icon name="plus" size={14} /> Add a book
              </button>
            }
          />
        ) : (
          <EmptyState
            title={data.books.length === 0 ? 'No books yet' : 'Nothing matches'}
            body={
              data.books.length === 0
                ? 'Add a book from an EPUB, or by hand. It lands on a shelf you choose.'
                : 'Try a different shelf, search, status, or genre filter.'
            }
            action={
              data.books.length === 0 ? (
                <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                  <Icon name="plus" size={14} /> Add your first book
                </button>
              ) : (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setQuery('');
                    setStatusFilter('all');
                    setGenreFilter('all');
                    setShelfFilter('all');
                  }}
                >
                  Clear filters
                </button>
              )
            }
          />
        )
      ) : (
        <ul className="book-grid" role="list">
          {books.map((book) => (
            <li key={book.id}>
              <BookCard
                book={book}
                quoteCount={store.quotesByBook.get(book.id)?.length ?? 0}
                onOpen={() => onOpenBook(book.id)}
                onStatusChange={(next) => setStatus(book, next)}
              />
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <UploadBookModal
          store={store}
          notify={notify}
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            onOpenBook(id);
          }}
        />
      )}
    </section>
  );
}
