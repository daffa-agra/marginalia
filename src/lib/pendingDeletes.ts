/**
 * Pending deletes.
 *
 * An undo is only honest if it survives a refresh. A delete is recorded here
 * until its undo window closes, so reloading the page still offers the undo
 * instead of silently finalising the deletion.
 */
import type { Book, Quote } from '../types';

const KEY = 'marginalia.pending-delete.v1';

export interface PendingDelete {
  book: Book;
  quotes: Quote[];
  /** Unix ms when the undo window closes. */
  expiresAt: number;
}

function read(): PendingDelete[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(
      (entry): entry is PendingDelete =>
        entry && entry.book && Array.isArray(entry.quotes) && typeof entry.expiresAt === 'number' && entry.expiresAt > now,
    );
  } catch {
    return [];
  }
}

function write(entries: PendingDelete[]): void {
  try {
    if (entries.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // A failure here only costs the ability to undo after a refresh.
  }
}

export function addPendingDelete(entry: PendingDelete): void {
  write([...read(), entry]);
}

export function removePendingDelete(bookId: string): void {
  write(read().filter((e) => e.book.id !== bookId));
}

export function listPendingDeletes(): PendingDelete[] {
  const entries = read();
  // Prune anything that expired while the page was closed.
  if (entries.length !== read().length) write(entries);
  return entries;
}
