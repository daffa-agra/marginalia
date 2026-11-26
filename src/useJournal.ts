import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Book, JournalData, Quote, Shelf } from './types';
import {
  loadData,
  saveData,
  hasStoredJournal,
  probeStorage,
  getStorageHealth,
  subscribeStorageHealth,
  makeShelf,
  type StorageHealth,
} from './storage';
import { sampleData } from './sampleData';
import { makeId } from './lib/utils';

const SAMPLE_PREFIX = 'demo-';

function isSample(data: JournalData): boolean {
  return (
    data.books.some((b) => b.id.startsWith(SAMPLE_PREFIX)) ||
    data.quotes.some((q) => q.id.startsWith('demo-quote-'))
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
  const [data, setData] = useState<JournalData>(() => {
    if (hasStoredJournal()) return loadData();
    // First launch only: an in-memory sample so no screen starts empty.
    // It is never written to storage unless the reader chooses to keep it.
    const sample = sampleData();
    return { version: 1, books: sample.books, quotes: sample.quotes, shelves: [] };
  });
  const [hasStored, setHasStored] = useState(() => hasStoredJournal());
  const [health, setHealth] = useState<StorageHealth>(() => {
    probeStorage();
    return getStorageHealth();
  });
  const hasStoredRef = useRef(hasStored);
  hasStoredRef.current = hasStored;

  useEffect(() => subscribeStorageHealth(setHealth), []);

  /** Any edit turns the sample shelf into a real journal, minus the sample. */
  const mutate = useCallback((updater: (current: JournalData) => JournalData) => {
    const firstWrite = !hasStoredRef.current;
    setData((current) => {
      const next = updater(current);
      return firstWrite ? withoutSample(next) : next;
    });
    setHasStored(true);
  }, []);

  // Persist only once there is a journal of the reader's own.
  useEffect(() => {
    if (!hasStored) return;
    saveData(data);
  }, [data, hasStored]);

  const persistNow = useCallback(() => {
    setHasStored(true);
    setData((current) => {
      saveData(current);
      return current;
    });
  }, []);

  const addBook = useCallback(
    (input: Omit<Book, 'id' | 'createdAt'>): Book => {
      const book: Book = { ...input, id: makeId('b'), createdAt: Date.now() };
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
    (name: string): Shelf | null => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      // Two shelves with the same name are indistinguishable in the bar, and
      // "move to Reading" would be a coin flip. Reject rather than allow it.
      if (data.shelves.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) return null;
      const shelf = makeShelf(trimmed, data.shelves.length);
      mutate((d) => ({ ...d, shelves: [...d.shelves, shelf] }));
      return shelf;
    },
    [data.shelves, mutate],
  );

  const renameShelf = useCallback(
    (id: string, name: string): boolean => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      if (
        data.shelves.some(
          (s) => s.id !== id && s.name.toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        return false;
      }
      mutate((d) => ({
        ...d,
        shelves: d.shelves.map((s) => (s.id === id ? { ...s, name: trimmed } : s)),
      }));
      return true;
    },
    [data.shelves, mutate],
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
    (bookId: string, quotes: Array<Omit<Quote, 'id' | 'createdAt' | 'bookId'>>) => {
      mutate((d) => ({
        ...d,
        quotes: [
          ...d.quotes,
          ...quotes.map((q) => ({
            ...q,
            bookId,
            id: makeId('q'),
            createdAt: Date.now(),
          })),
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
    const sample = sampleData();
    setHasStored(false);
    setData({ version: 1, books: sample.books, quotes: sample.quotes, shelves: [] });
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
