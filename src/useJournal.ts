import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Book, JournalData, Quote } from './types';
import { loadData, saveData } from './storage';
import { sampleData } from './sampleData';import { makeId } from './lib/utils';

/**
 * Single store for the journal. Everything the user does goes through
 * these actions; each one saves to localStorage immediately.
 */
export function useJournal() {
  const [data, setData] = useState<JournalData>(() => {
    const loaded = loadData();
    const hasUserContent =
      loaded.books.some((b) => !b.id.startsWith('demo-')) ||
      loaded.quotes.some((q) => !q.id.startsWith('demo-quote-'));
    if (hasUserContent || loaded.books.length > 0) return loaded;
    // First launch: in-memory sample so screens are never empty.
    const sample = sampleData();
    return { version: loaded.version, books: sample.books, quotes: sample.quotes };
  });
  const [hasSaved, setHasSaved] = useState(() => {
    try {
      return window.localStorage.getItem('marginalia.journal.v1') !== null;
    } catch {
      return false;
    }
  });

  // Persist only once the user has real content of their own.
  useEffect(() => {
    if (!hasSaved) return;
    saveData(data);
  }, [data, hasSaved]);

  const startPersisting = useCallback(() => setHasSaved(true), []);

  const persistNow = useCallback(() => {
    setHasSaved(true);
    setData((current) => {
      saveData(current);
      return current;
    });
  }, []);

  const addBook = useCallback(
    (input: Omit<Book, 'id' | 'createdAt'>): Book => {
      const book: Book = { ...input, id: makeId('b'), createdAt: Date.now() };
      startPersisting();
      setData((d) => ({ ...d, books: [book, ...d.books] }));
      return book;
    },
    [startPersisting],
  );

  const updateBook = useCallback(
    (id: string, patch: Partial<Book>) => {
      startPersisting();
      setData((d) => ({
        ...d,
        books: d.books.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      }));
    },
    [startPersisting],
  );

  const deleteBook = useCallback(
    (id: string) => {
      startPersisting();
      setData((d) => ({
        ...d,
        books: d.books.filter((b) => b.id !== id),
        quotes: d.quotes.filter((q) => q.bookId !== id),
      }));
    },
    [startPersisting],
  );

  const addQuotes = useCallback(
    (bookId: string, quotes: Array<Omit<Quote, 'id' | 'createdAt' | 'bookId'>>) => {
      startPersisting();
      setData((d) => ({
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
    [startPersisting],
  );

  const updateQuote = useCallback(
    (id: string, patch: Partial<Pick<Quote, 'text' | 'note' | 'position' | 'bookId'>>) => {
      startPersisting();
      setData((d) => ({
        ...d,
        quotes: d.quotes.map((q) => (q.id === id ? { ...q, ...patch } : q)),
      }));
    },
    [startPersisting],
  );

  const deleteQuote = useCallback(
    (id: string) => {
      startPersisting();
      setData((d) => ({ ...d, quotes: d.quotes.filter((q) => q.id !== id) }));
    },
    [startPersisting],
  );

  const replaceAll = useCallback(
    (next: JournalData) => {
      startPersisting();
      setData(next);
    },
    [startPersisting],
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
    data,
    quotesByBook,
    isDemo: !hasSaved,
    addBook,
    updateBook,
    deleteBook,
    addQuotes,
    updateQuote,
    deleteQuote,
    replaceAll,
    persistNow,
    clearAll: useCallback(() => {
      try {
        window.localStorage.removeItem('marginalia.journal.v1');
      } catch {
        // Ignore storage failures; resetting in memory is enough.
      }
      const sample = sampleData();
      setHasSaved(false);
      setData({ version: 1, books: sample.books, quotes: sample.quotes });
    }, []),
  };
}

export type JournalStore = ReturnType<typeof useJournal>;
