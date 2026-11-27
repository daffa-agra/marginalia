export type ReadStatus = 'want-to-read' | 'reading' | 'finished' | 'abandoned';

import type { TextAnchor } from './lib/anchors';

export type { TextAnchor };

/** Where the reader left off in a book. Chapter index plus a fraction within it. */
export interface ReadingPosition {
  chapter: number;
  fraction: number;
  updatedAt: number;
}

/**
 * A shelf is a grouping you create — a drawer, not a tag.
 * A book belongs to at most one shelf, so shelves partition the library.
 */
export interface Shelf {
  id: string;
  name: string;
  /** Manual order of the shelves themselves. */
  sortOrder: number;
  createdAt: number;
}

/** The shelf id every book carries when it is on no shelf of its own. */
export const UNSHELVED = 'unshelved';

export interface EpubFile {
  kind: 'epub';
  fileName: string;
  size: number;
  /** Where the bytes live right now. */
  storage: 'local';
  /** SHA-256 of the bytes once they have been uploaded to the library bucket. */
  sha256?: string;
  /** Unix ms of the successful upload. */
  uploadedAt?: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  /** Books of the same series share a group name. */
  series?: string;
  /** Order within the series, 1-based. */
  seriesIndex?: number;
  /** Publisher, read from the EPUB or filled from a web metadata lookup. */
  publisher?: string;
  /** Year the edition was first published. */
  publishedYear?: number;
  /** ISBN-13 preferred, ISBN-10 accepted. */
  isbn?: string;
  /** URL of the cover image, from a web metadata lookup. */
  coverUrl?: string;
  /** Unix ms of the last successful web metadata lookup. */
  metadataAt?: number;
  status: ReadStatus;
  totalPages?: number;
  currentPage: number;
  /** 1–5. */
  rating?: number;
  review?: string;
  /** YYYY-MM-DD. */
  startedAt?: string;
  /** YYYY-MM-DD. */
  finishedAt?: string;
  genres: string[];
  color: string;
  /** At most one shelf. Absent means Unshelved. */
  shelfId?: string;
  /**
   * Position in the reading plan queue, 0-based. Absent means the book is not
   * queued. A queue book is one you intend to read next, in this order.
   */
  queuePosition?: number;
  /** Where the reader left off. Survives font changes and re-renders. */
  position?: ReadingPosition;
  /** Present once an EPUB has been attached to this book. */
  file?: EpubFile;
  /** Unix ms when the book was added to the journal. */
  createdAt: number;
}

export interface Quote {
  id: string;
  bookId: string;
  text: string;
  note?: string;
  /** Play Books usually reports a % position. */
  position?: string;
  /**
   * Where the passage is in the book, for a quote taken from the reader.
   *
   * Deliberately not a page number: this has to survive a font change, a window
   * resize and a reload, none of which a page survives. See `lib/anchors.ts`.
   */
  anchor?: TextAnchor;
  /** Progress through the book when the quote was taken, 0–1. */
  percent?: number;
  /** Unix ms. */
  createdAt: number;
  /** Unix ms. Bumped on every edit, so a sync can order writes. */
  updatedAt: number;
  /** Unix ms. A tombstone: the record was deleted and the delete must sync. */
  deletedAt?: number;
}

export interface JournalData {
  version: number;
  books: Book[];
  quotes: Quote[];
  shelves: Shelf[];
}

export const STATUS_META: Record<
  ReadStatus,
  { label: string; plural: string; icon: 'statusWant' | 'statusReading' | 'statusFinished' | 'statusAbandoned' }
> = {
  'want-to-read': { label: 'Want to read', plural: 'Want to read', icon: 'statusWant' },
  reading: { label: 'Reading', plural: 'Reading', icon: 'statusReading' },
  finished: { label: 'Finished', plural: 'Finished', icon: 'statusFinished' },
  abandoned: { label: 'Abandoned', plural: 'Abandoned', icon: 'statusAbandoned' },
};

export const STATUS_ORDER: ReadStatus[] = [
  'reading',
  'want-to-read',
  'finished',
  'abandoned',
];

export const RATING_MAX = 5;

export function isReadStatus(value: unknown): value is ReadStatus {
  return (
    value === 'want-to-read' ||
    value === 'reading' ||
    value === 'finished' ||
    value === 'abandoned'
  );
}

export function formatStatus(status: ReadStatus): string {
  return STATUS_META[status].label;
}

export function progressPercent(book: Book): number {
  if (!book.totalPages || book.totalPages <= 0) return 0;
  const pct = (book.currentPage / book.totalPages) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
