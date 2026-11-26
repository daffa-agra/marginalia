export type ReadStatus = 'want-to-read' | 'reading' | 'finished' | 'abandoned';

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
  /** Unix ms of the last edit (renames reorder across devices). */
  updatedAt: number;
  /** Set when deleted; its books fall back to Unshelved. */
  deletedAt?: number;
}

/** The shelf id every book carries when it is on no shelf of its own. */
export const UNSHELVED = 'unshelved';

export interface EpubFile {
  kind: 'epub';
  fileName: string;
  size: number;
  /** Where the bytes live right now. */
  storage: 'local' | 'local-only' | 'r2';
  /** Content hash; makes uploads to the server idempotent. */
  sha256?: string;
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
  /** Present once an EPUB has been attached to this book. */
  file?: EpubFile;
  /** Unix ms when the book was added to the journal. */
  createdAt: number;
  /** Unix ms of the last edit; sync compares this, never createdAt. */
  updatedAt: number;
  /** Set when deleted; the row is kept as a tombstone so deletes propagate. */
  deletedAt?: number;
}

export interface Quote {
  id: string;
  bookId: string;
  text: string;
  note?: string;
  /** Play Books usually reports a % position. */
  position?: string;
  /** Unix ms. */
  createdAt: number;
  /** Unix ms of the last edit. */
  updatedAt: number;
  /** Set when deleted; kept as a tombstone for sync. */
  deletedAt?: number;
}

/** A journal entry — the free-form writing the journal is about. */
export interface JournalEntry {
  id: string;
  /** Absent means a loose-leaf entry, not attached to a book. */
  bookId?: string;
  text: string;
  /** YYYY-MM-DD. */
  onDate?: string;
  page?: number;
  /** EPUB CFI anchor when written from the reader. */
  cfi?: string;
  percent?: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface JournalData {
  version: number;
  books: Book[];
  quotes: Quote[];
  shelves: Shelf[];
  /** Loose-leaf and book-attached journal writing (v3). */
  entries: JournalEntry[];
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
