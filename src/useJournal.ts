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
import { reindexAfterRemoval } from './lib/plan';

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
 * Tombstones are how a delete reaches other devices: the record stays in the
 * journal with `deletedAt` set, syncs as an ordinary record, and every view
 * filters it out. This is the one filter between the stored journal and what
 * the reader sees — exporters, import dedupe and the reader all consume the
 * filtered shape, so deleted writing is invisible everywhere, not merely
 * hidden in one list.
 */
function stripTombstones(data: JournalData): JournalData {
  return {
    ...data,
    books: data.books.filter((b) => !b.deletedAt),
    quotes: data.quotes.filter((q) => !q.deletedAt),
    shelves: data.shelves.filter((s) => !s.deletedAt),
  };
}

/**
 * Single store for the journal. Everything the user does goes through
 * these actions; each one saves to localStorage immediately, and a failed
 * write is published to the UI instead of being swallowed.
 *
 * The state holds the whole journal *including tombstones*; `data` — what
 * every view, exporter and the reader consumes — is that journal with
 * tombstones stripped. `rawData` is the sync's input, because a delete is
 * exactly the thing the sync must carry.
 */
export function useJournal() {
  const [journal, setJournal] = useState<JournalData>(() => {
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
    setJournal((current) => {
      const next = updater(current);
      return firstWrite ? withoutSample(next) : next;
    });
    setHasStored(true);
  }, []);

  // Persist the raw journal — tombstones included, or a delete could not sync.
  useEffect(() => {
    if (!hasStored) return;
    saveData(journal);
  }, [journal, hasStored]);

  const persistNow = useCallback(() => {
    setHasStored(true);
    setJournal((current) => {
      saveData(current);
      return current;
    });
  }, []);

  /** The journal as the reader sees it: no tombstones, ever. */
  const data = useMemo(() => stripTombstones(journal), [journal]);

  const addBook = useCallback(
    (input: Omit<Book, 'id' | 'createdAt'>): Book => {
      const now = Date.now();
      const book: Book = { ...input, id: makeId('b'), createdAt: now, updatedAt: now };
      mutate((d) => ({ ...d, books: [book, ...d.books] }));
      return book;
    },
    [mutate],
  );

  const updateBook = useCallback(
    (id: string, patch: Partial<Book>) => {
      mutate((d) => ({
        ...d,
        // `updatedAt` is the clock a sync orders edits by, so the store bumps
        // it on every change rather than trusting each caller to remember.
        books: d.books.map((b) => (b.id === id ? { ...b, ...patch, updatedAt: Date.now() } : b)),
      }));
    },
    [mutate],
  );

  /**
   * Deletes a book and everything written in it.
   *
   * The records are not removed: they become tombstones, so the delete
   * propagates to other devices instead of being overwritten by their next
   * sync. Undo restores them by clearing the tombstone — itself an edit, so a
   * changed mind propagates with the same force as the delete did.
   */
  const deleteBook = useCallback(
    (id: string): { book: Book; quotes: Quote[] } | undefined => {
      const book = journal.books.find((b) => b.id === id);
      if (!book) return undefined;
      const quotes = journal.quotes.filter((q) => q.bookId === id);
      const now = Date.now();
      mutate((d) => {
        // Deleting a queued book must not leave a hole in the plan, or every
        // book behind it keeps a stale position number.
        const remainingQueue = d.books
          .filter((b) => typeof b.queuePosition === 'number' && b.id !== id && !b.deletedAt)
          .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));
        const positions = new Map(remainingQueue.map((b, index) => [b.id, index]));
        return {
          ...d,
          books: d.books.map((b) => {
            if (b.id !== id) {
              const pos = positions.get(b.id);
              return pos === undefined ? b : { ...b, queuePosition: pos };
            }
            return { ...b, deletedAt: now, updatedAt: now };
          }),
          quotes: d.quotes.map((q) =>
            q.bookId === id ? { ...q, deletedAt: now, updatedAt: now } : q,
          ),
        };
      });
      return { book, quotes };
    },
    [journal.books, journal.quotes, mutate],
  );

  /** Puts a deleted book and its quotes back. Used by the undo message. */
  const restoreBook = useCallback(
    (book: Book, quotes: Quote[]) => {
      const now = Date.now();
      mutate((d) => ({
        ...d,
        // Clearing the tombstone is itself an edit: a changed mind must reach
        // other devices with the same force the delete had.
        books: d.books.map((b) =>
          b.id === book.id ? { ...b, ...book, deletedAt: undefined, updatedAt: now } : b,
        ),
        quotes: d.quotes.map((q) => {
          const restored = quotes.find((r) => r.id === q.id);
          return restored ? { ...q, ...restored, deletedAt: undefined, updatedAt: now } : q;
        }),
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
      if (journal.shelves.some((s) => !s.deletedAt && s.name.toLowerCase() === trimmed.toLowerCase())) return null;
      const shelf = makeShelf(trimmed, journal.shelves.length);
      mutate((d) => ({ ...d, shelves: [...d.shelves, shelf] }));
      return shelf;
    },
    [journal.shelves, mutate],
  );

  const renameShelf = useCallback(
    (id: string, name: string): boolean => {
      const trimmed = name.trim();
      if (
        journal.shelves.some(
          (s) => s.id !== id && !s.deletedAt && s.name.toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        return false;
      }
      mutate((d) => ({
        ...d,
        shelves: d.shelves.map((s) =>
          s.id === id ? { ...s, name: trimmed, updatedAt: Date.now() } : s,
        ),
      }));
      return true;
    },
    [journal.shelves, mutate],
  );

  /**
   * Deletes a shelf without touching its books: they fall back to Unshelved,
   * which is the whole point of the partition. The shelf itself becomes a
   * tombstone so the delete reaches other devices.
   */
  const deleteShelf = useCallback(
    (id: string): number => {
      const count = journal.books.filter((b) => b.shelfId === id && !b.deletedAt).length;
      const now = Date.now();
      mutate((d) => ({
        ...d,
        shelves: d.shelves.map((s) =>
          s.id === id ? { ...s, deletedAt: now, updatedAt: now } : s,
        ),
        books: d.books.map((b) =>
          b.shelfId === id && !b.deletedAt
            ? { ...b, shelfId: undefined, updatedAt: now }
            : b,
        ),
      }));
      return count;
    },
    [journal.books, journal.shelves, mutate],
  );

  /** Moves a book to a shelf, or to Unshelved when shelfId is undefined. */
  const moveBookToShelf = useCallback(
    (bookId: string, shelfId: string | undefined) => {
      updateBook(bookId, { shelfId });
    },
    [updateBook],
  );

  const reorderShelves = useCallback(
    (orderedIds: string[]) => {
      const now = Date.now();
      mutate((d) => ({
        ...d,
        shelves: d.shelves.map((s) => {
          const index = orderedIds.indexOf(s.id);
          return index >= 0 ? { ...s, sortOrder: index, updatedAt: now } : s;
        }),
      }));
    },
    [mutate],
  );

  /* ---------------- Book files ---------------- */

  /** Records that an EPUB is attached to a book. Bytes stay in IndexedDB. */
  const attachBookFile = useCallback(
    (bookId: string, file: Book['file']) => {
      updateBook(bookId, { file });
    },
    [updateBook],
  );

  const removeBookFile = useCallback(
    (bookId: string) => {
      updateBook(bookId, { file: undefined });
    },
    [updateBook],
  );

  const addQuotes = useCallback(
    (bookId: string, quotes: Array<Omit<Quote, 'id' | 'createdAt' | 'updatedAt' | 'bookId'>>) => {
      const now = Date.now();
      mutate((d) => ({
        ...d,
        quotes: [
          ...d.quotes,
          ...quotes.map((q) => ({
            ...q,
            bookId,
            id: makeId('q'),
            createdAt: now,
            updatedAt: now,
          })),
        ],
      }));
    },
    [mutate],
  );

  const updateQuote = useCallback(
    (
      id: string,
      patch: Partial<Pick<Quote, 'text' | 'note' | 'position' | 'bookId' | 'anchor' | 'percent'>>,
    ) => {
      const now = Date.now();
      mutate((d) => ({
        ...d,
        // `updatedAt` is what lets a sync decide which of two edits is newer,
        // so it is bumped here rather than left to the caller.
        quotes: d.quotes.map((q) => (q.id === id ? { ...q, ...patch, updatedAt: now } : q)),
      }));
    },
    [mutate],
  );

  /**
   * Deletes a quote as a tombstone, so the delete propagates rather than being
   * resurrected by another device's next sync.
   */
  const deleteQuote = useCallback(
    (id: string): Quote | undefined => {
      const removed = journal.quotes.find((q) => q.id === id);
      const now = Date.now();
      mutate((d) => ({
        ...d,
        quotes: d.quotes.map((q) => (q.id === id ? { ...q, deletedAt: now, updatedAt: now } : q)),
      }));
      return removed;
    },
    [journal.quotes, mutate],
  );

  const restoreQuote = useCallback(
    (quote: Quote) => {
      const now = Date.now();
      mutate((d) => ({
        ...d,
        quotes: d.quotes.map((q) =>
          q.id === quote.id ? { ...q, ...quote, deletedAt: undefined, updatedAt: now } : q,
        ),
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
    setJournal({ version: 1, books: sample.books, quotes: sample.quotes, shelves: [] });
  }, []);

  /* ---------------- Reading plan queue ---------------- */

  /** Adds a book to the end of the reading plan. */
  const queueBook = useCallback(
    (id: string) => {
      mutate((d) => {
        if (d.books.some((b) => b.id === id && b.queuePosition !== undefined)) return d;
        const max = d.books.reduce((m, b) => Math.max(m, b.queuePosition ?? -1), -1);
        return {
          ...d,
          books: d.books.map((b) =>
            b.id === id ? { ...b, queuePosition: max + 1, updatedAt: Date.now() } : b,
          ),
        };
      });
    },
    [mutate],
  );

  const unqueueBook = useCallback(
    (id: string) => {
      mutate((d) => {
        const removed = d.books.find((b) => b.id === id && b.queuePosition !== undefined);
        if (!removed) return d;
        // Removing a queued book must not leave a hole in the plan, or every
        // book behind it keeps a stale position number.
        const queue = d.books
          .filter((b) => b.queuePosition !== undefined && !b.deletedAt)
          .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));
        const index = queue.findIndex((b) => b.id === id);
        const reindexed = new Map(
          reindexAfterRemoval(queue, index).map(({ id: bid, queuePosition }) => [bid, queuePosition]),
        );
        return {
          ...d,
          books: d.books.map((b) => {
            if (b.id === id) return { ...b, queuePosition: undefined, updatedAt: Date.now() };
            const pos = reindexed.get(b.id);
            return pos === undefined ? b : { ...b, queuePosition: pos, updatedAt: Date.now() };
          }),
        };
      });
    },
    [mutate],
  );

  const moveQueueItem = useCallback(
    (id: string, direction: 'up' | 'down') => {
      mutate((d) => {
        const queue = d.books
          .filter((b) => b.queuePosition !== undefined && !b.deletedAt)
          .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));
        const index = queue.findIndex((b) => b.id === id);
        const target = index + (direction === 'up' ? -1 : 1);
        if (index < 0 || target < 0 || target >= queue.length) return d;
        const reordered = [...queue];
        const [item] = reordered.splice(index, 1);
        reordered.splice(target, 0, item);
        const positions = new Map(reordered.map((b, i) => [b.id, i]));
        const now = Date.now();
        return {
          ...d,
          books: d.books.map((b) => {
            const pos = positions.get(b.id);
            return pos === undefined ? b : { ...b, queuePosition: pos, updatedAt: now };
          }),
        };
      });
    },
    [mutate],
  );

  /** Replaces the whole order, for drag-and-drop. */
  const reorderQueue = useCallback(
    (orderedIds: string[]) => {
      const now = Date.now();
      mutate((d) => {
        const positions = new Map(orderedIds.map((id, index) => [id, index]));
        return {
          ...d,
          books: d.books.map((b) => {
            const pos = positions.get(b.id);
            return pos === undefined ? b : { ...b, queuePosition: pos, updatedAt: now };
          }),
        };
      });
    },
    [mutate],
  );

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
    /** The journal as the reader sees it: tombstones stripped. */
    data,
    /** The stored journal, tombstones included — the sync's input. */
    rawData: journal,
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
    queueBook,
    unqueueBook,
    moveQueueItem,
    reorderQueue,
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
