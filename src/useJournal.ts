import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book, JournalData, Quote, Shelf } from './types';
import {
  makeShelf,
  getStorageHealth,
  subscribeStorageHealth,
  publishStorageHealth,
  type StorageHealth,
} from './storage';
import { bootStorage } from './lib/boot';
import { clearDurableJournal, diffJournal, persistDiff, type JournalDiff } from './lib/journalStore';
import { isIdbAvailable } from './lib/idb';
import { sampleData } from './sampleData';
import { makeId } from './lib/utils';

const SAMPLE_PREFIX = 'demo-';

function isSample(data: JournalData): boolean {
  return (
    data.books.some((b) => b.id.startsWith(SAMPLE_PREFIX)) ||
    data.quotes.some((q) => q.id.startsWith('demo-quote-'))
  );
}

/** v3 records always carry sync bookkeeping, even for samples. */
function withStamps(d: JournalData): JournalData {
  const ensure = <T extends { createdAt: number; updatedAt?: number; deletedAt?: number }>(r: T): T =>
    r.updatedAt != null ? r : ({ ...r, updatedAt: r.createdAt } as T);
  return {
    ...d,
    books: d.books.map(ensure),
    quotes: d.quotes.map(ensure),
    shelves: d.shelves.map(ensure),
    entries: d.entries.map(ensure),
  };
}

function diffIsEmpty(diff: JournalDiff): boolean {
  return (
    diff.books.length === 0 &&
    diff.quotes.length === 0 &&
    diff.shelves.length === 0 &&
    diff.entries.length === 0
  );
}

/**
 * Sample books are a welcome, not content. The moment the journal becomes
 * real, they are dropped unless the reader explicitly keeps them.
 */
function withoutSample(data: JournalData): JournalData {
  return {
    ...data,
    books: data.books.filter((b) => !b.id.startsWith(SAMPLE_PREFIX)),
    quotes: data.quotes.filter((q) => !q.id.startsWith('demo-quote-')),
  };
}

/**
 * Single store for the journal. Everything the user does goes through
 * these actions; each one saves to localStorage immediately, and a failed
 * write is published to the UI instead of being swallowed.
 */
export function useJournal() {
  // First launch only: an in-memory sample so no screen starts empty.
  // It is never written to storage unless the reader chooses to keep it.
  const [data, setData] = useState<JournalData>(() => {
    const sample = sampleData();
    return { version: 3, books: sample.books, quotes: sample.quotes, shelves: [], entries: [] };
  });
  const [hasStored, setHasStored] = useState(false);
  const [booted, setBooted] = useState(false);
  const [health, setHealth] = useState<StorageHealth>(getStorageHealth);
  const hasStoredRef = useRef(hasStored);
  hasStoredRef.current = hasStored;
  const persistedRef = useRef<JournalData | null>(null);
  const persistSeqRef = useRef(0);

  useEffect(() => subscribeStorageHealth(setHealth), []);

  // Boot: migration (if any) + load from IndexedDB. Runs once.
  useEffect(() => {
    let cancelled = false;
    // Ask for durable storage once: without it the browser may evict cached
    // books after a while. A denial is not an error; the UI notes it.
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      navigator.storage.persist().catch(() => {});
    }
    bootStorage()
      .then((result) => {
        if (cancelled) return;
        setBooted(true);
        if (result.blocked) {
          publishStorageHealth({ writable: false, blocked: true, failedAt: Date.now() });
          return;
        }
        if (result.error) {
          console.error('Storage boot reported an error.', result.error);
        }
        if (result.data && (result.data.books.length || result.data.quotes.length || result.data.shelves.length || result.data.entries.length)) {
          setHasStored(true);
          persistedRef.current = result.data;
          setData(withStamps(result.data));
          publishStorageHealth({ writable: true, blocked: false, lastSavedAt: Date.now() });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setBooted(true);
        console.error('Failed to load journal from IndexedDB.', err);
        publishStorageHealth({ writable: false, blocked: true, failedAt: Date.now() });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Any edit turns the sample shelf into a real journal, minus the sample. */
  const mutate = useCallback((updater: (current: JournalData) => JournalData) => {
    const firstWrite = !hasStoredRef.current;
    setData((current) => {
      const next = updater(current);
      return firstWrite ? withoutSample(withStamps(next)) : next;
    });
    setHasStored(true);
  }, []);

  // Persist: a record-level diff against what is already durable. A failed
  // write is published to the UI instead of being swallowed.
  useEffect(() => {
    if (!hasStored || !isIdbAvailable()) return;
    const seq = ++persistSeqRef.current;
    const diff = diffJournal(persistedRef.current, data, Date.now());
    if (diffIsEmpty(diff)) return;
    persistDiff(diff)
      .then(() => {
        if (seq !== persistSeqRef.current) return;
        persistedRef.current = data;
        publishStorageHealth({ writable: true, blocked: false, lastSavedAt: Date.now(), failedAt: null });
      })
      .catch((err) => {
        console.error('Failed to save journal data.', err);
        publishStorageHealth({ writable: false, failedAt: Date.now() });
      });
  }, [data, hasStored]);

  const persistNow = useCallback(() => {
    setHasStored(true);
    const diff = diffJournal(persistedRef.current, data, Date.now());
    if (diffIsEmpty(diff)) return;
    persistDiff(diff)
      .then(() => {
        persistedRef.current = data;
        publishStorageHealth({ writable: true, blocked: false, lastSavedAt: Date.now() });
      })
      .catch((err) => {
        console.error('Failed to save journal data.', err);
        publishStorageHealth({ writable: false, failedAt: Date.now() });
      });
  }, [data]);

  const addBook = useCallback(
    (input: Omit<Book, 'id' | 'createdAt' | 'updatedAt'>): Book => {
      const book: Book = { ...input, id: makeId('b'), createdAt: Date.now(), updatedAt: Date.now() };
      mutate((d) => ({ ...d, books: [book, ...d.books] }));
      return book;
    },
    [mutate],
  );

  const updateBook = useCallback(
    (id: string, patch: Partial<Book>) => {
      mutate((d) => ({
        ...d,
        books: d.books.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      }));
    },
    [mutate],
  );

  /** Removes a book and its quotes, handing both back so the caller can offer an undo. */
  const deleteBook = useCallback(
    (id: string): { book: Book; quotes: Quote[] } | undefined => {
      const book = data.books.find((b) => b.id === id);
      if (!book) return undefined;
      const quotes = data.quotes.filter((q) => q.bookId === id);
      mutate((d) => ({
        ...d,
        books: d.books.filter((b) => b.id !== id),
        quotes: d.quotes.filter((q) => q.bookId !== id),
      }));
      return { book, quotes };
    },
    [data.books, data.quotes, mutate],
  );

  /** Puts a deleted book and its quotes back. Used by the undo message. */
  const restoreBook = useCallback(
    (book: Book, quotes: Quote[]) => {
      mutate((d) => ({
        ...d,
        books: d.books.some((b) => b.id === book.id) ? d.books : [...d.books, book],
        quotes: [
          ...d.quotes,
          ...quotes.filter((q) => !d.quotes.some((existing) => existing.id === q.id)),
        ],
      }));
    },
    [mutate],
  );

  /* ---------------- Shelves ---------------- */

  const addShelf = useCallback(
    (name: string): Shelf => {
      const shelf = makeShelf(name, data.shelves.length);
      mutate((d) => ({ ...d, shelves: [...d.shelves, shelf] }));
      return shelf;
    },
    [data.shelves.length, mutate],
  );

  const renameShelf = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      mutate((d) => ({
        ...d,
        shelves: d.shelves.map((s) => (s.id === id ? { ...s, name: trimmed } : s)),
      }));
    },
    [mutate],
  );

  /**
   * Deletes a shelf without touching its books: they fall back to Unshelved,
   * which is the whole point of the partition.
   */
  const deleteShelf = useCallback(
    (id: string): number => {
      const count = data.books.filter((b) => b.shelfId === id).length;
      mutate((d) => ({
        ...d,
        shelves: d.shelves.filter((s) => s.id !== id),
        books: d.books.map((b) => (b.shelfId === id ? { ...b, shelfId: undefined } : b)),
      }));
      return count;
    },
    [data.books, mutate],
  );

  /** Moves a book to a shelf, or to Unshelved when shelfId is undefined. */
  const moveBookToShelf = useCallback(
    (bookId: string, shelfId: string | undefined) => {
      mutate((d) => ({
        ...d,
        books: d.books.map((b) => (b.id === bookId ? { ...b, shelfId } : b)),
      }));
    },
    [mutate],
  );

  const reorderShelves = useCallback(
    (orderedIds: string[]) => {
      mutate((d) => ({
        ...d,
        shelves: d.shelves.map((s) => {
          const index = orderedIds.indexOf(s.id);
          return index >= 0 ? { ...s, sortOrder: index } : s;
        }),
      }));
    },
    [mutate],
  );

  /* ---------------- Book files ---------------- */

  /** Records that an EPUB is attached to a book. Bytes stay in IndexedDB. */
  const attachBookFile = useCallback(
    (bookId: string, file: Book['file']) => {
      mutate((d) => ({
        ...d,
        books: d.books.map((b) => (b.id === bookId ? { ...b, file } : b)),
      }));
    },
    [mutate],
  );

  const removeBookFile = useCallback(
    (bookId: string) => {
      mutate((d) => ({
        ...d,
        books: d.books.map((b) => (b.id === bookId ? { ...b, file: undefined } : b)),
      }));
    },
    [mutate],
  );

  const addQuotes = useCallback(
    (bookId: string, quotes: Array<Omit<Quote, 'id' | 'createdAt' | 'updatedAt' | 'bookId'>>) => {
      mutate((d) => ({
        ...d,
        quotes: [
          ...d.quotes,
          ...quotes.map((q) => {
            const now = Date.now();
            return {
              ...q,
              bookId,
              id: makeId('q'),
              createdAt: now,
              updatedAt: now,
            };
          }),
        ],
      }));
    },
    [mutate],
  );

  const updateQuote = useCallback(
    (id: string, patch: Partial<Pick<Quote, 'text' | 'note' | 'position' | 'bookId'>>) => {
      mutate((d) => ({
        ...d,
        quotes: d.quotes.map((q) => (q.id === id ? { ...q, ...patch } : q)),
      }));
    },
    [mutate],
  );

  /** Removes a quote and hands it back so the caller can offer an undo. */
  const deleteQuote = useCallback(
    (id: string): Quote | undefined => {
      const removed = data.quotes.find((q) => q.id === id);
      mutate((d) => ({ ...d, quotes: d.quotes.filter((q) => q.id !== id) }));
      return removed;
    },
    [data.quotes, mutate],
  );

  const restoreQuote = useCallback(
    (quote: Quote) => {
      mutate((d) => ({
        ...d,
        quotes: d.quotes.some((q) => q.id === quote.id) ? d.quotes : [...d.quotes, quote],
      }));
    },
    [mutate],
  );

  const replaceAll = useCallback(
    (next: JournalData) => {
      mutate(() => next);
    },
    [mutate],
  );

  const clearAll = useCallback(() => {
    try {
      window.localStorage.removeItem('marginalia.journal.v1');
    } catch {
      // Ignore storage failures; resetting in memory is enough.
    }
    clearDurableJournal().catch((err) => console.error('Failed to clear durable journal.', err));
    const sample = sampleData();
    setHasStored(false);
    persistedRef.current = null;
    setData({ version: 3, books: sample.books, quotes: sample.quotes, shelves: [], entries: [] });
  }, []);

  const quotesByBook = useMemo(() => {
    const map = new Map<string, Quote[]>();
    for (const q of data.quotes) {
      const list = map.get(q.bookId) ?? [];
      list.push(q);
      map.set(q.bookId, list);
    }
    return map;
  }, [data.quotes]);

  return {
    data,
    booted,
    persisted: hasStored,
    quotesByBook,
    isDemo: !hasStored && isSample(data),
    health,
    addBook,
    updateBook,
    deleteBook,
    restoreBook,
    addShelf,
    renameShelf,
    deleteShelf,
    moveBookToShelf,
    reorderShelves,
    attachBookFile,
    removeBookFile,
    addQuotes,
    updateQuote,
    deleteQuote,
    restoreQuote,
    replaceAll,
    persistNow,
    clearAll,
    retrySave: persistNow,
  };
}

export type JournalStore = ReturnType<typeof useJournal>;
