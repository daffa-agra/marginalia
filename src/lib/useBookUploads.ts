import { useEffect, useRef } from 'react';
import type { JournalData } from '../types';
import { loadBookBytes } from './bookFiles';
import {
  enqueueUpload,
  missingUploads,
  pendingUploads,
  processUploadQueue,
} from './bookUploadQueue';
import { uploadBookBytes } from './api';

/**
 * Drains the book-upload queue on the same beats the journal syncs on:
 * at start-up, when the connection returns, when the tab becomes visible,
 * and every minute while it is open.
 *
 * The journal's catch-up only moves records; this hook is what moves the
 * bytes those records promise. Without it, a book added offline — or whose
 * upload lost the race against a closed tab — stayed local forever, and no
 * other device could ever fetch it.
 */
export function useBookUploads(
  data: JournalData,
  updateBook: (id: string, patch: Partial<JournalData['books'][number]>) => void,
): void {
  const dataRef = useRef(data);
  dataRef.current = data;
  const updateRef = useRef(updateBook);
  updateRef.current = updateBook;
  /** One drain at a time; overlapping passes would upload the same book twice. */
  const running = useRef(false);
  const timer = useRef<number | null>(null);

  const drain = async () => {
    if (running.current) return;
    running.current = true;
    try {
      // Sweep first: books whose upload died before the queue existed, or
      // whose add ran offline, owe a cloud copy without being in the queue.
      for (const id of missingUploads(dataRef.current.books)) enqueueUpload(id);
      if (pendingUploads().length === 0) return;
      await processUploadQueue(dataRef.current.books, {
        loadBytes: loadBookBytes,
        upload: uploadBookBytes,
        onUploaded: (bookId, sha256) => {
          const book = dataRef.current.books.find((b) => b.id === bookId);
          if (!book?.file) return;
          updateRef.current(bookId, { file: { ...book.file, sha256, uploadedAt: Date.now() } });
        },
      });
    } catch {
      // A failed pass leaves everything queued; the next trigger tries again.
    } finally {
      running.current = false;
    }
  };

  /** A queued book from a previous session uploads without waiting a minute. */
  useEffect(() => {
    void drain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* A change in the library (a new upload, a synced record) schedules a drain. */
  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void drain();
    }, 2500);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Reconnect, re-focus, and a slow periodic catch-up, as the journal does. */
  useEffect(() => {
    const EVERY = 60_000;
    const interval = window.setInterval(() => void drain(), EVERY);
    const online = () => void drain();
    const visible = () => {
      if (document.visibilityState === 'visible') void drain();
    };
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
