/**
 * The reading plan.
 *
 * A plan is an ordered queue: the books you intend to read next, in the order
 * you intend to read them. It is deliberately undated — a queue is a promise
 * about sequence, not about dates, and adding deadlines to it would turn a
 * pleasure into a backlog.
 *
 * What the queue *can* honestly say is how fast you move through one. That is
 * measured from real finished books, not assumed.
 */
import type { Book } from '../types';

/** Books queued in reading order. */
export function queueOf(books: Book[]): Book[] {
  return books
    .filter((b) => typeof b.queuePosition === 'number')
    .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));
}

/** Next positions for a queue after a book is removed from `removedIndex`. */
export function reindexAfterRemoval(queue: Book[], removedIndex: number): Array<{ id: string; queuePosition: number }> {
  return queue
    .map((book, index) => ({ book, index }))
    .filter(({ index }) => index !== removedIndex)
    .map(({ book }, index) => ({ id: book.id, queuePosition: index }));
}

/** The book at the head of the queue, if any. */
export function nextUp(books: Book[]): Book | undefined {
  return queueOf(books)[0];
}

export interface ReadingPace {
  /** Whole books finished per week, from the last 90 days of finished books. */
  booksPerWeek: number;
  /** Completed books the figure is derived from. */
  sampleSize: number;
  /** Whether there is enough history to say anything at all. */
  confident: boolean;
}

/**
 * Measured pace. Uses the last 90 days of finished books so an old reading
 * binge does not flatter the present. Below three finished books we refuse to
 * call it a pace — a forecast from one book is a guess wearing a number.
 */
export function measurePace(books: Book[], now = Date.now()): ReadingPace {
  const windowDays = 90;
  const since = now - windowDays * 86_400_000;
  const recent = books.filter((b) => {
    if (b.status !== 'finished' || !b.finishedAt) return false;
    const finished = new Date(`${b.finishedAt}T00:00:00`).getTime();
    return Number.isFinite(finished) && finished >= since;
  });
  const booksPerWeek = (recent.length / windowDays) * 7;
  return {
    booksPerWeek,
    sampleSize: recent.length,
    confident: recent.length >= 3,
  };
}

export interface QueueForecast {
  /** Books currently queued. */
  queued: number;
  /** Weeks to clear the queue, or null when pace is unknown. */
  weeksToClear: number | null;
  /** Human date the queue would clear, or null. */
  clearBy: string | null;
  /** True when there is not enough history to forecast. */
  insufficientHistory: boolean;
}

export function forecastQueue(
  books: Book[],
  pace: ReadingPace,
  now = new Date(),
): QueueForecast {
  const queued = queueOf(books).length;
  if (queued === 0) {
    return { queued: 0, weeksToClear: 0, clearBy: null, insufficientHistory: false };
  }
  if (!pace.confident || pace.booksPerWeek <= 0) {
    return { queued, weeksToClear: null, clearBy: null, insufficientHistory: true };
  }
  const weeks = queued / pace.booksPerWeek;
  const clearDate = new Date(now.getTime() + weeks * 7 * 86_400_000);
  return {
    queued,
    weeksToClear: weeks,
    clearBy: clearDate.toISOString().slice(0, 10),
    insufficientHistory: false,
  };
}
