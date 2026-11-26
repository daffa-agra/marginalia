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

import type { JournalData } from '../types';
import { API_BASE, isOnline, sync } from './api';
import type { SyncChanges, WireRecord } from './api';
import { gcTombstones, mergeJournals, pendingOf } from './merge';
import type { MergeConflict, Syncable } from './merge';

const STATE_STORAGE = 'marginalia.sync.v1';
const DEVICE_STORAGE = 'marginalia.device.v1';

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncState {
  /** Server revision already absorbed. 0 means "never synced". */
  revision: number;
  lastSyncAt?: number;
  deviceId: string;
  phase: SyncPhase;
  /** Why the last attempt failed, when it did. */
  message?: string;
  /** Unresolved same-millisecond conflicts awaiting the reader's decision. */
  conflicts: MergeConflict[];
}

function readState(): SyncState {
  const empty: SyncState = { revision: 0, deviceId: deviceId(), phase: 'idle', conflicts: [] };
  try {
    const raw = localStorage.getItem(STATE_STORAGE);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    return {
      revision: typeof parsed.revision === 'number' ? parsed.revision : 0,
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
  const books: WireRecord[] = data.books.map((book) => ({
    ...book,
    updatedAt: book.position?.updatedAt ?? book.createdAt,
  }));

  const positions: WireRecord[] = data.books
    .filter((book) => book.position)
    .map((book) => ({
      id: book.id,
      updatedAt: book.position!.updatedAt,
      chapter: book.position!.chapter,
      fraction: book.position!.fraction,
    }));

  return {
    books,
    quotes: data.quotes as unknown as WireRecord[],
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

  const local = toChanges(data);
  const result = await sync({
    since: current.revision,
    changes: {
      books: pendingOf(local.books, current.revision),
      quotes: pendingOf(local.quotes, current.revision),
      shelves: pendingOf(local.shelves, current.revision),
      positions: pendingOf(local.positions, current.revision),
    },
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
 * Folds merged records back into the journal shape.
 *
 * Tombstones are dropped from the visible journal: a record the reader deleted
 * must not reappear just because its tombstone arrived. The tombstone itself
 * stays in the synced collection so the delete keeps propagating.
 */
function fromChanges(merged: MergeInputShape, previous: JournalData): JournalData {
  const live = <T extends Syncable>(records: T[]) => records.filter((r) => !r.deletedAt);

  const positionsByBook = new Map(
    live(merged.positions).map((p) => [
      p.id,
      { chapter: Number((p as unknown as { chapter: number }).chapter) || 0,
        fraction: Number((p as unknown as { fraction: number }).fraction) || 0,
        updatedAt: p.updatedAt },
    ]),
  );

  const books = live(merged.books).map((raw) => {
    const book = raw as unknown as JournalData['books'][number];
    const position = positionsByBook.get(book.id);
    return position ? { ...book, position } : book;
  });

  return {
    version: previous.version,
    books,
    quotes: live(merged.quotes) as unknown as JournalData['quotes'],
    shelves: live(merged.shelves) as unknown as JournalData['shelves'],
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
