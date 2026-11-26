/**
 * Where the reader is in a book.
 *
 * Page numbers do not survive a font-size change, and byte offsets do not
 * survive a re-render. What does survive is (chapter index, fraction scrolled
 * through that chapter), so a position is two numbers and the reader restores
 * from them after a reflow.
 */
import type { Book, ReadingPosition } from '../types';

export type { ReadingPosition };

export function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function normalisePosition(
  position: Partial<ReadingPosition> | undefined,
  chapterCount: number,
): ReadingPosition | null {
  if (!position) return null;
  const chapter = Math.max(0, Math.min(chapterCount - 1, Math.floor(position.chapter ?? 0)));
  return {
    chapter,
    fraction: clampFraction(position.fraction ?? 0),
    updatedAt: position.updatedAt ?? Date.now(),
  };
}

/** Overall progress through the book, 0–100. */
export function bookProgress(position: ReadingPosition | null, chapterCount: number): number {
  if (!position || chapterCount === 0) return 0;
  const within = (position.chapter + position.fraction) / chapterCount;
  return Math.round(clampFraction(within) * 100);
}

/** "Chapter 4 of 12" for the reader chrome. */
export function chapterLabel(position: ReadingPosition | null, chapterCount: number): string {
  if (!position || chapterCount === 0) return `1 of ${chapterCount}`;
  return `${position.chapter + 1} of ${chapterCount}`;
}

/** Keeps a book's stored progress roughly in step with the reader. */
export function progressPatch(book: Book, percent: number): Partial<Book> {
  if (!book.totalPages) return {};
  const page = Math.max(0, Math.min(book.totalPages, Math.round((percent / 100) * book.totalPages)));
  return { currentPage: page };
}
