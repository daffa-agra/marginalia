/**
 * The sync engine.
 *
 * Local-first, in the literal sense: the journal in localStorage is the truth
 * for reading and writing, and this module is what reconciles it with the
 * server when the server happens to be reachable. Nothing here blocks, and
 * nothing here loses a write.
 *
 * The pieces:
 *
 *   revision   the server revision this device has already absorbed. Everything
 *              newer is what it still owes or still needs.
 *   outbox     not a queue of operations but a *state*: the device's own
 *              records carry `updatedAt`, so "what do I owe?" is a query, not a
 *              log. A dropped connection cannot lose the intent to push.
 *   merge      `lib/merge.ts`, which is pure and tested. This module only moves
 *              data in and out of it.
 *
 * A failed sync is therefore not an error state, it is a queued state: the app
 * behaves exactly as it does offline, and the difference surfaces as a count.
 */

import type { Book, JournalData } from '../types';
import { API_BASE, hello, isOnline, sync } from './api';
import type { SyncChanges, WireRecord } from './api';
import { gcTombstones, mergeJournals, pendingOf } from './merge';
import type { MergeConflict, Syncable } from './merge';

const STATE_STORAGE = 'marginalia.sync.v1';
const DEVICE_STORAGE = 'marginalia.device.v1';

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  /** Server revision already absorbed. 0 means "never synced". */
  revision: number;
  /**
   * The newest client timestamp this device has pushed, in client-clock
   * milliseconds. The push filter must run in THIS domain: the server's
   * revision is a small counter, and comparing it against client timestamps
   * (1.7e12 > 3, always) made every sync re-push the entire journal.
   */
  pushedAt: number;
  lastSyncAt?: number;
  deviceId: string;
  phase: SyncPhase;
  /** Why the last attempt failed, when it did. */
  message?: string;
  /** Unresolved same-millisecond conflicts awaiting the reader's decision. */
  conflicts: MergeConflict[];
}

function readState(): SyncState {
  const empty: SyncState = { revision: 0, pushedAt: 0, deviceId: deviceId(), phase: 'idle', conflicts: [] };
  try {
    const raw = localStorage.getItem(STATE_STORAGE);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    return {
      revision: typeof parsed.revision === 'number' ? parsed.revision : 0,
      pushedAt: typeof parsed.pushedAt === 'number' ? parsed.pushedAt : 0,
      lastSyncAt: parsed.lastSyncAt,
      deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : empty.deviceId,
      phase: 'idle',
      conflicts: Array.isArray(parsed.conflicts) ? (parsed.conflicts as MergeConflict[]) : [],
    };
  } catch {
    return empty;
  }
}

function writeState(state: SyncState): void {
  try {
    localStorage.setItem(
      STATE_STORAGE,
      JSON.stringify({
        revision: state.revision,
        pushedAt: state.pushedAt,
        lastSyncAt: state.lastSyncAt,
        deviceId: state.deviceId,
        // Conflicts are persisted so a reload does not silently drop them.
        conflicts: state.conflicts,
      }),
    );
  } catch {
    // Losing the revision costs a re-sync, not data.
  }
}

/** A stable id for this browser, so a same-ms tie can be attributed. */
export function deviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_STORAGE);
    if (existing && /^[A-Za-z0-9-]{8,64}$/.test(existing)) return existing;
  } catch {
    // Fall through and create one.
  }
  let id: string;
  try {
    id = crypto.randomUUID();
  } catch {
    id = `dev-${Math.random().toString(36).slice(2, 12)}`;
  }
  try {
    localStorage.setItem(DEVICE_STORAGE, id);
  } catch {
    // Not fatal; an unstable id only affects tie attribution.
  }
  return id;
}

/* ── turning the journal into sync records ── */

/**
 * Everything that syncs, in the shape the server expects.
 *
 * Positions are derived from books rather than stored twice: a `ReadingPosition`
 * is already `{chapter, fraction, updatedAt}`, so it becomes its own record
 * keyed by book id, and one canonical copy stays in the book. That keeps the
 * "two sources of truth" problem out of the design.
 */
export function toChanges(data: JournalData): SyncChanges {
  // Sample books are a welcome, never content: they exist only in memory
  // until the reader writes something real, and syncing them would turn a
  // demo into server-side data that then propagates to every device.
  const books: WireRecord[] = data.books
    .filter((book) => !book.id.startsWith('demo-'))
    .map((book) => ({
      ...book,
      // The record's own edit clock. A book with no updatedAt predates the
      // sync-aware store, so createdAt is the honest fallback.
      updatedAt: book.updatedAt ?? book.position?.updatedAt ?? book.createdAt,
    }));

  const positions: WireRecord[] = books.flatMap((book) => {
    const pos = book.position as Book['position'] | undefined;
    return pos
      ? [{ id: book.id, updatedAt: pos.updatedAt, chapter: pos.chapter, fraction: pos.fraction }]
      : [];
  });

  return {
    books,
    quotes: (data.quotes as unknown as WireRecord[]).filter(
      (q) => typeof q.id === 'string' && !q.id.startsWith('demo-'),
    ),
    positions,
    shelves: data.shelves as unknown as WireRecord[],
  };
}

/** How many records this device is still holding for the server. */
export function pendingCount(data: JournalData, revision: number): number {
  const changes = toChanges(data);
  return (
    pendingOf(changes.books, revision).length +
    pendingOf(changes.quotes, revision).length +
    pendingOf(changes.shelves, revision).length +
    pendingOf(changes.positions, revision).length
  );
}

/* ── the sync itself ── */

export interface SyncOutcome {
  state: SyncState;
  /** The journal with remote changes folded in, or null when nothing changed. */
  data: JournalData | null;
}

/**
 * Pushes what this device owes and absorbs what it is missing.
 *
 * `onState` is called before and after the request so the UI can show progress;
 * a failed attempt resolves rather than throwing, because being offline is a
 * normal state for a local-first app.
 */
export async function runSync(
  data: JournalData,
  onState?: (state: SyncState) => void,
): Promise<SyncOutcome> {
  const current = readState();

  if (!isOnline()) {
    const offline: SyncState = { ...current, phase: 'offline', message: 'Offline — changes are kept on this device' };
    onState?.(offline);
    return { state: offline, data: null };
  }

  const syncing: SyncState = { ...current, phase: 'syncing', message: undefined };
  onState?.(syncing);

  // A journal that has never been registered gets 401 from /api/sync forever:
  // the endpoint resolves the journal without creating it. /api/hello IS the
  // registrar, so a first-ever sync (pushedAt 0, revision 0) says hello first.
  // Cheap — one extra request on the very first sync only.
  if (current.revision === 0 && current.pushedAt === 0) {
    await hello();
  }

  const local = toChanges(data);
  // The push filter runs in the client-clock domain: `pushedAt` is the newest
  // timestamp this device has already sent, so nothing is re-pushed forever,
  // and nothing owed is skipped. Tombstones are records like any other.
  const books = pendingOf(local.books, current.pushedAt);
  const quotes = pendingOf(local.quotes, current.pushedAt);
  const shelves = pendingOf(local.shelves, current.pushedAt);
  const positions = pendingOf(local.positions, current.pushedAt);
  const pushing = [...books, ...quotes, ...shelves, ...positions].reduce(
    (max, r) => Math.max(max, r.updatedAt),
    current.pushedAt,
  );

  const result = await sync({
    since: current.revision,
    changes: { books, quotes, shelves, positions },
    deviceId: current.deviceId,
  });

  if (!result.ok) {
    const failed: SyncState = {
      ...current,
      phase: result.error.offline ? 'offline' : 'error',
      message: result.error.message,
    };
    writeState(failed);
    onState?.(failed);
    return { state: failed, data: null };
  }

  const remote = result.data.changes as MergeInputShape;
  const merged = mergeJournals(local as unknown as MergeInputShape, remote);

  const next: SyncState = {
    revision: result.data.revision,
    pushedAt: pushing,
    lastSyncAt: Date.now(),
    deviceId: current.deviceId,
    phase: 'idle',
    conflicts: [...current.conflicts, ...merged.conflicts],
  };
  writeState(next);
  onState?.(next);

  // Only hand back a new journal when the merge actually changed something, so
  // a no-op sync does not cause a re-render storm or a pointless write.
  const changed =
    merged.stats.added > 0 || merged.stats.updated > 0 || merged.conflicts.length > 0;
  if (!changed) return { state: next, data: null };

  return { state: next, data: fromChanges(merged.changes as MergeInputShape, data) };
}

interface MergeInputShape {
  books: WireRecord[];
  quotes: WireRecord[];
  shelves: WireRecord[];
  positions: WireRecord[];
}

/**
 * Folds merged records back into the journal.
 *
 * The store's `data` strips tombstones for display, so this returns the whole
 * merged set *including tombstones* — a delete that arrived from another
 * device must be kept, or the record would resurrect on the next sync. The
 * store owns the visible/live distinction; this layer just carries records.
 */
function fromChanges(merged: MergeInputShape, previous: JournalData): JournalData {
  const positionsByBook = new Map(
    merged.positions.map((p) => [
      p.id,
      { chapter: Number((p as unknown as { chapter: number }).chapter) || 0,
        fraction: Number((p as unknown as { fraction: number }).fraction) || 0,
        updatedAt: p.updatedAt },
    ]),
  );

  const books = merged.books.map((raw) => {
    const book = raw as unknown as JournalData['books'][number];
    const position = positionsByBook.get(book.id);
    return position ? { ...book, position } : book;
  });

  return {
    version: previous.version,
    books,
    quotes: merged.quotes as unknown as JournalData['quotes'],
    shelves: merged.shelves as unknown as JournalData['shelves'],
  };
}

/* ── reading state for the UI ── */

export function loadSyncState(): SyncState {
  return readState();
}

/** Records the reader's decision on a conflict, so it stops being reported. */
export function resolveConflict(id: string): SyncState {
  const state = readState();
  const next: SyncState = { ...state, conflicts: state.conflicts.filter((c) => c.id !== id) };
  writeState(next);
  return next;
}

/** Runs tombstone GC against the local journal. Cheap; called after a sync. */
export function collectGarbage(data: JournalData, now = Date.now()): JournalData {
  return {
    ...data,
    books: gcTombstones(data.books as unknown as Syncable[], now) as unknown as JournalData['books'],
    quotes: gcTombstones(data.quotes as unknown as Syncable[], now) as unknown as JournalData['quotes'],
  };
}

/** Configured API base, so a Settings screen can show where data goes. */
export function apiBase(): string {
  return API_BASE;
}
