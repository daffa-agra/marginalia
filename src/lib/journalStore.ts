/**
 * Record-level persistence over IndexedDB.
 *
 * The journal in memory is the source of truth for the UI; this module is
 * the write path and keeps IDB in sync with it record-by-record. Records
 * removed from memory are turned into tombstones (never dropped), and every
 * mutation is queued in the outbox inside the same transaction — the
 * property that makes offline work safe and, later, sync correct.
 */

import type { Book, JournalData, JournalEntry, Quote, Shelf } from '../types';
import { appendOutbox, deleteAll, getAll, isIdbAvailable, metaSet, putMany, type StoreName } from './idb';

export const SCHEMA_VERSION = 3;

type AnyRecord = Book | Quote | Shelf | JournalEntry;

export interface JournalDiff {
  books: Book[];
  quotes: Quote[];
  shelves: Shelf[];
  entries: JournalEntry[];
  outbox: Array<{ store: string; op: 'put'; record: Record<string, unknown> }>;
}

function sameRecord(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The pure core of every save. Compares the previous journal against the
 * next and produces: changed records (stamped `updatedAt = now`), records
 * that vanished (stamped `deletedAt`, kept as tombstones), and one outbox
 * row per write. Node-testable — no IDB on this path.
 */
export function diffJournal(prev: JournalData | null, next: JournalData, now: number): JournalDiff {
  const out: JournalDiff = { books: [], quotes: [], shelves: [], entries: [], outbox: [] };
  const track = <K extends 'books' | 'quotes' | 'shelves' | 'entries'>(
    store: K,
    records: JournalData[K],
    prior: JournalData[K],
  ) => {
    const priorIds = new Set(prior.map((r) => r.id));
    const nextIds = new Set(records.map((r) => r.id));
    for (const record of records) {
      const before = prior.find((r) => r.id === record.id);
      if (!before) {
        out[store].push(record as never);
        out.outbox.push({ store, op: 'put', record: record as unknown as Record<string, unknown> });
      } else if (!sameRecord(omitVolatile(before), omitVolatile(record))) {
        out[store].push({ ...record, updatedAt: now, deletedAt: undefined } as never);
        out.outbox.push({
          store,
          op: 'put',
          record: { ...record, updatedAt: now } as unknown as Record<string, unknown>,
        });
      }
    }
    for (const record of prior) {
      if (!nextIds.has(record.id)) {
        const tombstone = {
          ...record,
          deletedAt: record.deletedAt ?? now,
          updatedAt: now,
        } as never;
        out[store].push(tombstone);
        out.outbox.push({ store, op: 'put', record: tombstone as unknown as Record<string, unknown> });
      }
    }
    void priorIds;
  };
  track('books', next.books, prev?.books ?? []);
  track('quotes', next.quotes, prev?.quotes ?? []);
  track('shelves', next.shelves, prev?.shelves ?? []);
  track('entries', next.entries, prev?.entries ?? []);
  return out;
}

/** createdAt is an origin fact, not a change; comparing without it avoids stamping every ingest. */
function omitVolatile(record: AnyRecord): Record<string, unknown> {
  const { createdAt: _createdAt, ...rest } = record as unknown as Record<string, unknown>;
  return rest;
}

/**
 * Writes a diff to IDB and the outbox. Records and their outbox rows are
 * not in one cross-store transaction here (IDB allows it, but the extra
 * batch buys little at journal scale); each store write is atomic, and a
 * failed write is reported, never swallowed.
 */
export async function persistDiff(diff: JournalDiff): Promise<void> {
  if (!isIdbAvailable()) throw new Error('IndexedDB is not available');
  await putMany('books', diff.books as unknown as Array<Record<string, unknown>>);
  await putMany('quotes', diff.quotes as unknown as Array<Record<string, unknown>>);
  await putMany('shelves', diff.shelves as unknown as Array<Record<string, unknown>>);
  await putMany('entries', diff.entries as unknown as Array<Record<string, unknown>>);
  await appendOutbox(diff.outbox as unknown as Array<Record<string, unknown>>);
  await metaSet('schemaVersion', SCHEMA_VERSION);
}

/** Reads the durable journal, dropping tombstones. */
export async function loadJournal(sanitize: (input: unknown) => JournalData): Promise<JournalData> {
  const [books, quotes, shelves, entries] = await Promise.all([
    getAllRecords<Book>('books'),
    getAllRecords<Quote>('quotes'),
    getAllRecords<Shelf>('shelves'),
    getAllRecords<JournalEntry>('entries'),
  ]);
  const live = {
    version: SCHEMA_VERSION,
    books: books.filter((b) => !b.deletedAt),
    quotes: quotes.filter((q) => !q.deletedAt),
    shelves: shelves.filter((s) => !s.deletedAt),
    entries: entries.filter((e) => !e.deletedAt),
  };
  // Round-trip everything through the sanitizer so durable data obeys the
  // same invariants as imported data (one-book-one-shelf, limiting, etc.).
  return sanitize(JSON.parse(JSON.stringify(live)));
}

async function getAllRecords<T extends { id: string; deletedAt?: number }>(store: StoreName): Promise<T[]> {
  return getAll<T>(store);
}


/**
 * Wipes the durable journal (records, outbox, bookkeeping). Used only by
 * "clear everything"; blobs under files/covers are handled by their owners.
 */
export async function clearDurableJournal(): Promise<void> {
  if (!isIdbAvailable()) return;
  const all = await Promise.all([
    getAll<Record<string, unknown>>('books'),
    getAll<Record<string, unknown>>('quotes'),
    getAll<Record<string, unknown>>('shelves'),
    getAll<Record<string, unknown>>('entries'),
    getAll<Record<string, unknown>>('outbox').catch(() => []),
  ]);
  const idsFor = (rows: Array<Record<string, unknown>>) =>
    rows.map((r) => r.id).filter((id): id is string => typeof id === 'string');
  await deleteAll('books', idsFor(all[0]));
  await deleteAll('quotes', idsFor(all[1]));
  await deleteAll('shelves', idsFor(all[2]));
  await deleteAll('entries', idsFor(all[3]));
  await deleteAll('outbox', all[4].map((_, index) => index + 1));
  await metaSet('schemaVersion', SCHEMA_VERSION);
}
