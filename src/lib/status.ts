import type { Book, ReadStatus } from '../types';

/**
 * The one status model. Every surface that changes a book's status goes
 * through here, so dates and page position can never drift between the
 * shelf, the detail page and the edit form.
 */
export function statusPatch(book: Book, next: ReadStatus, today: string): Partial<Book> {
  switch (next) {
    case 'want-to-read':
      return { status: next, startedAt: undefined, finishedAt: undefined };
    case 'reading':
      return {
        status: next,
        startedAt: book.startedAt ?? today,
        finishedAt: undefined,
      };
    case 'finished':
      return {
        status: next,
        startedAt: book.startedAt ?? today,
        finishedAt: today,
        ...(book.totalPages ? { currentPage: book.totalPages } : {}),
      };
    case 'abandoned':
      return { status: next, finishedAt: undefined };
  }
}

/** Order the status menu shows. Reading first: it is what a reader usually needs. */
export const STATUS_MENU_ORDER: ReadStatus[] = ['reading', 'want-to-read', 'finished', 'abandoned'];
