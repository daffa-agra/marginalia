/**
 * The merge rules (READER-DESIGN §8.2). Pure functions, no Workers API, so
 * the exact same rules are testable in Node and reusable client-side.
 *
 * - Only-one-side → take it (tombstones included).
 * - Tombstone vs live → later timestamp wins, so deletes propagate.
 * - Both edited → newer updatedAt wins; an identical-millisecond tie keeps
 *   both bodies, and the loser is appended to `conflicts[]`.
 */

export interface SyncRecord {
  id: string;
  updatedAt: number;
  deletedAt?: number | null;
  [key: string]: unknown;
}

export interface MergeOutcome<Rec extends SyncRecord> {
  /** Winning versions, keyed by id — what lands in the store. */
  winners: Map<string, Rec>;
  /** Same-millisecond edits that both survived; the UI surfaces these. */
  conflicts: Array<{ id: string; kept: Rec; loser: Rec }>;
  /** Ids that changed relative to `current` — the outbox delta. */
  changedIds: Set<string>;
}

export function mergeRecords<Rec extends SyncRecord>(
  current: Iterable<Rec>,
  incoming: Iterable<Rec>,
): MergeOutcome<Rec> {
  const winners = new Map<string, Rec>();
  for (const record of current) winners.set(record.id, record);

  const conflicts: Array<{ id: string; kept: Rec; loser: Rec }> = [];
  const changedIds = new Set<string>();

  for (const remote of incoming) {
    const local = winners.get(remote.id);
    if (!local) {
      winners.set(remote.id, remote);
      changedIds.add(remote.id);
      continue;
    }
    if ((local.updatedAt ?? 0) > (remote.updatedAt ?? 0)) continue;
    if ((local.updatedAt ?? 0) < (remote.updatedAt ?? 0)) {
      winners.set(remote.id, remote);
      changedIds.add(remote.id);
      continue;
    }
    // Identical millisecond: prefer this device's own edit, keep the loser
    // in the conflict list — nothing is discarded without a decision.
    conflicts.push({ id: remote.id, kept: local, loser: remote });
  }
  return { winners, conflicts, changedIds };
}

/**
 * The server-side upsert: local row wins unless the incoming row is strictly
 * newer. Expressed as SQL in the D1 batch; kept here in JS for the tests.
 */
export function shouldUpsert(currentUpdatedAt: number, incomingUpdatedAt: number): boolean {
  return incomingUpdatedAt > currentUpdatedAt;
}
