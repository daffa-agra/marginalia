/**
 * Merging two versions of a journal.
 *
 * This is the one piece of the sync that can destroy writing if it is wrong, so
 * it is a pure function with no network, no clock and no storage: everything it
 * needs is in its arguments, and every branch is reachable from a test.
 *
 * The rules, in the order they are applied:
 *
 *   1. Only one side has the record  → take it, tombstones included. This is
 *      what makes a delete and a create propagate.
 *   2. One side is a tombstone       → the later timestamp wins. A delete after
 *      an edit deletes; an edit after a delete resurrects, because the user
 *      demonstrably wrote afterwards.
 *   3. Both sides are live           → the newer `updatedAt` wins.
 *   4. Identical timestamps          → two devices edited in the same
 *      millisecond. Neither body is discarded: the local one is kept and the
 *      remote one is reported as a conflict, to be shown to the reader rather
 *      than resolved silently.
 *
 * The final rule is the important one. A "last write wins" tie-break that drops
 * the loser is indistinguishable, from the reader's point of view, from the app
 * eating a note. Reporting it costs one line of UI and keeps trust.
 */

/** The minimum every synced record must carry. */
export interface Syncable {
  id: string;
  updatedAt: number;
  deletedAt?: number;
}

export interface MergeConflict {
  kind: string;
  id: string;
  /** The body that lost the tie-break, kept so it can be offered. */
  local: unknown;
  remote: unknown;
}

export interface MergeOutcome<T> {
  merged: T[];
  /** Records where both sides changed independently. */
  conflicts: MergeConflict[];
  /** How many records this side won, for the status line. */
  stats: { added: number; updated: number; unchanged: number; conflicts: number };
}

function isDeleted(record: Syncable): boolean {
  return typeof record.deletedAt === 'number';
}

/** Whether two records carry the same content, ignoring field order. */
function sameBody(a: Syncable, b: Syncable): boolean {
  // `undefined` values are absent values: a record whose optional field was
  // set to undefined and one that never had the key are the same record. A
  // JSON round trip through the server drops the keys entirely, so comparing
  // them literally would report every echoed record as a conflict.
  const normalise = (value: Syncable) =>
    JSON.stringify(
      Object.keys(value)
        .filter((k) => k !== 'updatedAt' && (value as unknown as Record<string, unknown>)[k] !== undefined)
        .sort()
        .map((k) => [k, (value as unknown as Record<string, unknown>)[k]]),
    );
  return normalise(a) === normalise(b);
}

/**
 * Merges one collection.
 *
 * `local` and `remote` are both full snapshots of the collection, not deltas:
 * the caller sends its whole state and receives the whole state back, which
 * makes the merge idempotent and safe to retry after a dropped connection.
 */
export function mergeCollection<T extends Syncable>(
  kind: string,
  local: readonly T[],
  remote: readonly T[],
): MergeOutcome<T> {
  const byId = new Map<string, T>();
  for (const record of local) byId.set(record.id, record);

  const conflicts: MergeConflict[] = [];
  const stats = { added: 0, updated: 0, unchanged: 0, conflicts: 0 };

  for (const incoming of remote) {
    const existing = byId.get(incoming.id);

    // 1. Only the remote side has it.
    if (!existing) {
      byId.set(incoming.id, incoming);
      stats.added += 1;
      continue;
    }

    const localDeleted = isDeleted(existing);
    const remoteDeleted = isDeleted(incoming);

    // 2. A tombstone on either side: the later timestamp decides, so a delete
    //    propagates and a later edit can still bring the record back.
    if (localDeleted || remoteDeleted) {
      if (incoming.updatedAt > existing.updatedAt) {
        byId.set(incoming.id, incoming);
        stats.updated += 1;
      } else {
        stats.unchanged += 1;
      }
      continue;
    }

    // 3. Both live: the newer edit wins.
    if (incoming.updatedAt > existing.updatedAt) {
      byId.set(incoming.id, incoming);
      stats.updated += 1;
      continue;
    }
    if (incoming.updatedAt < existing.updatedAt) {
      stats.unchanged += 1;
      continue;
    }

    // 4. Same millisecond. Keep local, report the remote so nothing is lost —
    //    but only if the two bodies actually differ. Two devices that touched a
    //    record in the same millisecond and wrote the same thing have agreed,
    //    and troubling the reader about it would train them to ignore the
    //    notice when it matters.
    if (sameBody(existing, incoming)) {
      stats.unchanged += 1;
      continue;
    }
    conflicts.push({ kind, id: incoming.id, local: existing, remote: incoming });
    stats.conflicts += 1;
  }

  return { merged: [...byId.values()], conflicts, stats };
}

/** Everything a merge touches, so one call can do the whole journal. */
export interface MergeInput {
  books: Syncable[];
  quotes: Syncable[];
  shelves: Syncable[];
  positions: Syncable[];
}

export interface MergeResult {
  changes: MergeInput;
  conflicts: MergeConflict[];
  stats: { added: number; updated: number; unchanged: number; conflicts: number };
}

const COLLECTIONS = ['books', 'quotes', 'shelves', 'positions'] as const;

/** Merges every collection in one pass. */
export function mergeJournals(local: MergeInput, remote: MergeInput): MergeResult {
  const changes = {} as MergeInput;
  const conflicts: MergeConflict[] = [];
  const stats = { added: 0, updated: 0, unchanged: 0, conflicts: 0 };

  for (const kind of COLLECTIONS) {
    const outcome = mergeCollection(kind, local[kind] ?? [], remote[kind] ?? []);
    changes[kind] = outcome.merged;
    conflicts.push(...outcome.conflicts);
    stats.added += outcome.stats.added;
    stats.updated += outcome.stats.updated;
    stats.unchanged += outcome.stats.unchanged;
    stats.conflicts += outcome.stats.conflicts;
  }

  return { changes, conflicts, stats };
}

/**
 * Records that must be pushed to the server: everything changed since the last
 * acknowledged revision, plus tombstones.
 *
 * A tombstone is only dropped once every device has acknowledged a revision past
 * it, which the server tracks. Locally the rule is simpler and safer: keep it
 * until the server has it.
 */
export function pendingOf<T extends Syncable>(records: readonly T[], since: number): T[] {
  return records.filter((record) => record.updatedAt > since);
}

/**
 * Drops tombstones that are old enough to be unrecoverable.
 *
 * Ninety days is deliberately long: it only has to exceed the time a device can
 * plausibly be offline before it is considered abandoned, and a shorter window
 * turns a long holiday into a resurrection bug.
 */
export function gcTombstones<T extends Syncable>(records: readonly T[], now: number, days = 90): T[] {
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return records.filter((record) => !isDeleted(record) || (record.deletedAt ?? 0) > cutoff);
}
