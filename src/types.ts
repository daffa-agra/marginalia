export type ReadStatus = 'want-to-read' | 'reading' | 'finished' | 'abandoned';

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
  /** Unix ms. */
  createdAt: number;
}

export interface JournalData {
  version: number;
  books: Book[];
  quotes: Quote[];
}

export const STATUS_META: Record<
  ReadStatus,
  { label: string; plural: string; icon: string }
> = {
  'want-to-read': { label: 'Want to read', plural: 'Want to read', icon: '○' },
  reading: { label: 'Reading', plural: 'Reading', icon: '◐' },
  finished: { label: 'Finished', plural: 'Finished', icon: '●' },
  abandoned: { label: 'Abandoned', plural: 'Abandoned', icon: '×' },
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
