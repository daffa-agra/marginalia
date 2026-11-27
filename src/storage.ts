import type { Book, JournalData, Quote, ReadStatus, Shelf, TextAnchor } from './types';
import { makeId } from './lib/utils';

const STORAGE_KEY = 'marginalia.journal.v1';
const DATA_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Storage health
 *
 * A journal that lives in one browser has exactly one promise to keep:
 * that it still has your writing tomorrow. Every write goes through
 * saveData, and every failure is published here so the UI can say so
 * instead of looking healthy while the data is gone.
 * ------------------------------------------------------------------ */

export interface StorageHealth {
  /** False once a write has failed or the boot probe failed. */
  writable: boolean;
  /** Unix ms of the last successful write, or null if nothing was saved. */
  lastSavedAt: number | null;
  /** True when the app could not write at boot (private mode, disabled storage). */
  blocked: boolean;
  /** Unix ms of the last failed write, or null. */
  failedAt: number | null;
}

type Listener = (health: StorageHealth) => void;

let health: StorageHealth = {
  writable: true,
  lastSavedAt: null,
  blocked: false,
  failedAt: null,
};
const listeners = new Set<Listener>();

function publish(patch: Partial<StorageHealth>) {
  health = { ...health, ...patch };
  for (const listener of listeners) listener(health);
}

export function subscribeStorageHealth(listener: Listener): () => void {
  listeners.add(listener);
  listener(health);
  return () => {
    listeners.delete(listener);
  };
}

export function getStorageHealth(): StorageHealth {
  return health;
}

/**
 * Boot probe: a real write/read/delete round trip. Catches private mode,
 * quota exhaustion and storage disabled by policy before the user types
 * a word they expect to keep.
 */
export function probeStorage(): boolean {
  try {
    const probeKey = `${STORAGE_KEY}.probe`;
    window.localStorage.setItem(probeKey, '1');
    const roundTrip = window.localStorage.getItem(probeKey) === '1';
    window.localStorage.removeItem(probeKey);
    if (roundTrip) {
      publish({ writable: true, blocked: false });
      return true;
    }
  } catch {
    // Falls through to the blocked state below.
  }
  publish({ writable: false, blocked: true });
  return false;
}

export function emptyData(): JournalData {
  return { version: DATA_VERSION, books: [], quotes: [], shelves: [] };
}

export function loadData(): JournalData {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    publish({ lastSavedAt: health.lastSavedAt });
    return sanitizeData(JSON.parse(raw));
  } catch (err) {
    console.error('Failed to load journal data, starting fresh.', err);
    return emptyData();
  }
}

/** True when the key exists at all — the difference between "new" and "empty". */
export function hasStoredJournal(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Writes the journal. Returns false and publishes the failure instead of
 * swallowing it, so the caller can stop claiming the work is safe.
 */
export function saveData(data: JournalData): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    publish({ writable: true, blocked: false, lastSavedAt: Date.now(), failedAt: null });
    return true;
  } catch (err) {
    console.error('Failed to save journal data.', err);
    publish({ writable: false, failedAt: Date.now() });
    return false;
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

  const rawShelves = Array.isArray(raw.shelves) ? raw.shelves : [];
  out.shelves = rawShelves
    .map((s) => pickShelf(s))
    .filter((s): s is Shelf => s !== null);

  // A book pointing at a shelf that no longer exists falls back to Unshelved,
  // so the one-book-one-shelf partition can never be broken by bad data.
  const shelfIds = new Set(out.shelves.map((s) => s.id));
  out.books = out.books.map((b) =>
    b.shelfId && !shelfIds.has(b.shelfId) ? { ...b, shelfId: undefined } : b,
  );

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
    shelfId: str(raw.shelfId),
    queuePosition: num(raw.queuePosition) != null ? Math.max(0, num(raw.queuePosition)!) : undefined,
    position: pickPosition(raw.position),
    file: pickEpubFile(raw.file),
    createdAt: num(raw.createdAt) ?? Date.now(),
  };
}

/** Restores a stored reading position, dropping anything malformed. */
function pickPosition(value: unknown): Book['position'] {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const chapter = num(raw.chapter);
  const fraction = num(raw.fraction);
  if (chapter == null || fraction == null) return undefined;
  return {
    chapter: Math.max(0, Math.floor(chapter)),
    fraction: Math.max(0, Math.min(1, fraction)),
    updatedAt: num(raw.updatedAt) ?? Date.now(),
  };
}

function pickEpubFile(value: unknown): Book['file'] {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const fileName = str(raw.fileName);
  const size = num(raw.size);
  if (!fileName || size == null || size < 0) return undefined;
  const sha256 = typeof raw.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(raw.sha256)
    ? raw.sha256.toLowerCase()
    : undefined;
  const uploadedAt = num(raw.uploadedAt);
  return {
    kind: 'epub',
    fileName,
    size,
    storage: 'local',
    sha256,
    ...(uploadedAt != null && sha256 ? { uploadedAt } : {}),
  };
}

function pickShelf(s: unknown): Shelf | null {
  if (!s || typeof s !== 'object') return null;
  const raw = s as Record<string, unknown>;
  const id = str(raw.id);
  const name = str(raw.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    sortOrder: num(raw.sortOrder) ?? 0,
    createdAt: num(raw.createdAt) ?? Date.now(),
  };
}

/** Coerces an untrusted anchor, or drops it rather than trusting its shape. */
function pickAnchor(value: unknown): TextAnchor | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const chapter = num(raw.chapter);
  const start = str(raw.start);
  const end = str(raw.end);
  const text = str(raw.text);
  if (chapter === undefined || chapter < 0 || !start || !end || !text) return undefined;
  // A path is "0.3.1@42"; anything else cannot be resolved, so it is not kept.
  const valid = (path: string) => /^\d+(\.\d+)*@\d+$/.test(path);
  if (!valid(start) || !valid(end)) return undefined;
  return {
    chapter: Math.floor(chapter),
    start,
    end,
    text,
    prefix: str(raw.prefix),
    suffix: str(raw.suffix),
  };
}

function pickQuote(q: unknown): Quote | null {
  if (!q || typeof q !== 'object') return null;
  const raw = q as Record<string, unknown>;
  const id = str(raw.id);
  const bookId = str(raw.bookId);
  const text = str(raw.text);
  if (!id || !bookId || !text) return null;
  const createdAt = num(raw.createdAt) ?? Date.now();
  const percent = num(raw.percent);
  return {
    id,
    bookId,
    text,
    note: str(raw.note),
    position: str(raw.position),
    anchor: pickAnchor(raw.anchor),
    percent: typeof percent === 'number' && Number.isFinite(percent)
      ? Math.max(0, Math.min(1, percent))
      : undefined,
    createdAt,
    updatedAt: num(raw.updatedAt) ?? createdAt,
    deletedAt: num(raw.deletedAt),
  };
}

/**
 * Merge an incoming (e.g. imported) journal into the current one.
 * Existing books/quotes win by id; the rest are appended.
 */
export function mergeData(current: JournalData, incoming: JournalData): JournalData {
  const bookIds = new Set(current.books.map((b) => b.id));
  const quoteIds = new Set(current.quotes.map((q) => q.id));
  // Older exports (and hand-written files) predate shelves entirely.
  const currentShelves = Array.isArray(current.shelves) ? current.shelves : [];
  const incomingShelves = Array.isArray(incoming.shelves) ? incoming.shelves : [];
  const shelfIds = new Set(currentShelves.map((s) => s.id));
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
    shelves: [...currentShelves, ...incomingShelves.filter((s) => !shelfIds.has(s.id))],
  };
}

/** A new shelf with a stable id and the next sort position. */
export function makeShelf(name: string, sortOrder: number): Shelf {
  return { id: makeId('s'), name: name.trim(), sortOrder, createdAt: Date.now() };
}

export const STORAGE_KEY_FOR_TESTS = STORAGE_KEY;

/* ------------------------------------------------------------------ *
 * Reader settings
 *
 * Kept separately from the journal: they are device preferences, not
 * content, so they do not belong in an export or in a sync payload.
 * ------------------------------------------------------------------ */

const READER_KEY = 'marginalia.reader.v1';

export function loadReaderSettings(): unknown {
  try {
    const raw = window.localStorage.getItem(READER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveReaderSettings(settings: unknown): boolean {
  try {
    window.localStorage.setItem(READER_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
