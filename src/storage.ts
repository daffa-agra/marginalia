import type { Book, JournalData, Quote, ReadStatus } from './types';

const STORAGE_KEY = 'marginalia.journal.v1';
const DATA_VERSION = 1;

export function emptyData(): JournalData {
  return { version: DATA_VERSION, books: [], quotes: [] };
}

export function loadData(): JournalData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    return sanitizeData(JSON.parse(raw));
  } catch (err) {
    console.error('Failed to load journal data, starting fresh.', err);
    return emptyData();
  }
}

export function saveData(data: JournalData): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Failed to save journal data.', err);
  }
}

/**
 * Accepts untrusted parsed JSON and produces a well-formed JournalData,
 * dropping anything malformed. Extra/unknown fields are ignored by pick().
 */
export function sanitizeData(input: unknown): JournalData {
  const out = emptyData();
  if (!input || typeof input !== 'object') return out;
  const raw = input as Record<string, unknown>;

  const rawBooks = Array.isArray(raw.books) ? raw.books : [];
  out.books = rawBooks
    .map((b) => pickBook(b))
    .filter((b): b is JournalData['books'][number] => b !== null);

  const rawQuotes = Array.isArray(raw.quotes) ? raw.quotes : [];
  const bookIds = new Set(out.books.map((b) => b.id));
  out.quotes = rawQuotes
    .map((q) => pickQuote(q))
    .filter((q): q is JournalData['quotes'][number] => q !== null)
    .filter((q) => bookIds.has(q.bookId));

  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function date(v: unknown): string | undefined {
  const s = str(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

function pickBook(b: unknown): Book | null {
  if (!b || typeof b !== 'object') return null;
  const raw = b as Record<string, unknown>;
  const id = str(raw.id);
  const title = str(raw.title);
  if (!id || !title) return null;
  const genres = Array.isArray(raw.genres)
    ? raw.genres.filter((g): g is string => typeof g === 'string')
    : [];
  const status: ReadStatus =
    raw.status === 'want-to-read' ||
    raw.status === 'reading' ||
    raw.status === 'finished' ||
    raw.status === 'abandoned'
      ? raw.status
      : 'want-to-read';
  const rating = num(raw.rating);
  return {
    id,
    title,
    author: str(raw.author) ?? 'Unknown author',
    series: str(raw.series),
    seriesIndex: num(raw.seriesIndex),
    status,
    totalPages: num(raw.totalPages),
    currentPage: Math.max(0, num(raw.currentPage) ?? 0),
    rating: rating != null && rating >= 1 && rating <= 5 ? Math.round(rating) : undefined,
    review: str(raw.review),
    startedAt: date(raw.startedAt),
    finishedAt: date(raw.finishedAt),
    genres,
    color: str(raw.color) ?? '#b4552d',
    createdAt: num(raw.createdAt) ?? Date.now(),
  };
}

function pickQuote(q: unknown): Quote | null {
  if (!q || typeof q !== 'object') return null;
  const raw = q as Record<string, unknown>;
  const id = str(raw.id);
  const bookId = str(raw.bookId);
  const text = str(raw.text);
  if (!id || !bookId || !text) return null;
  return {
    id,
    bookId,
    text,
    note: str(raw.note),
    position: str(raw.position),
    createdAt: num(raw.createdAt) ?? Date.now(),
  };
}

/**
 * Merge an incoming (e.g. imported) journal into the current one.
 * Existing books/quotes win by id; the rest are appended.
 */
export function mergeData(current: JournalData, incoming: JournalData): JournalData {
  const bookIds = new Set(current.books.map((b) => b.id));
  const quoteIds = new Set(current.quotes.map((q) => q.id));
  return {
    version: DATA_VERSION,
    books: [
      ...current.books,
      ...incoming.books.filter((b) => !bookIds.has(b.id)),
    ],
    quotes: [
      ...current.quotes,
      ...incoming.quotes.filter((q) => !quoteIds.has(q.id)),
    ],
  };
}
