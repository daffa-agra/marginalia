/**
 * Server-side merge.
 *
 * The client runs the same rules locally; this is the authority. Keeping the
 * logic identical in both places matters because the client merges optimistic
 * state before the server confirms, and a disagreement between them would
 * surface as a record that flickers back and forth between devices.
 *
 * Rules (mirrors src/lib/merge.ts):
 *   1. newer `updatedAt` wins
 *   2. a tombstone competes on the same field, so deletes propagate
 *   3. an identical-millisecond tie keeps the server's row and reports it
 *
 * The server never deletes a row for a tombstone: the row stays with
 * `deleted_at` set, because that tombstone is how the delete reaches a device
 * that has been offline.
 */

export interface Syncable {
  id: string;
  updatedAt: number;
  deletedAt?: number;
  /** Records are JSON objects; the extra fields are what gets stored. */
  [key: string]: unknown;
}

export interface MergeOutcome<T extends Syncable> {
  /** Records to write, in the order they were decided. */
  writes: T[];
  /** Ties where the incoming body differs and the stored one was kept. */
  conflicts: Array<{ kind: string; id: string }>;
}

/** Decides whether an incoming record should replace the stored one. */
export function shouldReplace(
  stored: Syncable | undefined,
  incoming: Syncable,
): 'replace' | 'keep' | 'conflict' {
  if (!stored) return 'replace';
  if (incoming.updatedAt > stored.updatedAt) return 'replace';
  if (incoming.updatedAt < stored.updatedAt) return 'keep';
  // Same millisecond: the stored row stands, and the difference is reported so
  // the client can offer both bodies rather than silently dropping one.
  return 'conflict';
}

/** Stable, order-independent identity for a record body. */
export function bodyKey(record: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(record)
      .filter((k) => k !== 'updatedAt')
      .sort()
      .map((k) => [k, record[k]]),
  );
}

export function mergeCollection<T extends Syncable>(
  kind: string,
  stored: ReadonlyMap<string, T>,
  incoming: readonly T[],
): MergeOutcome<T> {
  const writes: T[] = [];
  const conflicts: Array<{ kind: string; id: string }> = [];

  for (const record of incoming) {
    const existing = stored.get(record.id);
    const decision = shouldReplace(existing, record);
    if (decision === 'replace') {
      writes.push(record);
      continue;
    }
    if (decision === 'conflict' && existing) {
      // Agreement is not a conflict.
      if (bodyKey(existing) !== bodyKey(record)) conflicts.push({ kind, id: record.id });
    }
  }

  return { writes, conflicts };
}

/**
 * Shapes a record for storage.
 *
 * The client's shape is the source of truth; the columns are extracted from it
 * so the server can index and filter without parsing JSON on every read.
 */
export function toRow(
  kind: string,
  journalId: string,
  record: Record<string, unknown>,
): { sql: string; params: unknown[] } {
  const id = String(record.id);
  const updatedAt = Number(record.updatedAt) || Date.now();
  const deletedAt = typeof record.deletedAt === 'number' ? record.deletedAt : null;

  if (kind === 'positions') {
    return {
      sql: `INSERT INTO positions (journal_id, book_id, chapter, fraction, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(journal_id, book_id) DO UPDATE SET
              chapter = excluded.chapter,
              fraction = excluded.fraction,
              updated_at = excluded.updated_at
            WHERE excluded.updated_at > positions.updated_at`,
      params: [
        journalId,
        id,
        Number(record.chapter) || 0,
        Number(record.fraction) || 0,
        updatedAt,
      ],
    };
  }

  const table = kind === 'books' ? 'books' : kind === 'quotes' ? 'quotes' : 'shelves';
  if (table === 'shelves') {
    // Shelves use a *composite* identity with the journal, because a shelf id is
    // only unique within one journal. Two journals can each have a shelf called
    // "s1", and a global primary key would make the second one silently fail to
    // insert — the row exists, so the conflict target matches another journal's
    // row and the `updated_at` guard rejects the write. That is what happened:
    // shelves appeared to save and never came back.
    return {
      sql: `INSERT INTO shelves (id, journal_id, name, sort_order, created_at, updated_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id, journal_id) DO UPDATE SET
              name = excluded.name, sort_order = excluded.sort_order,
              updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
            WHERE excluded.updated_at > shelves.updated_at`,
      params: [
        id,
        journalId,
        String(record.name ?? ''),
        Number(record.sortOrder) || 0,
        Number(record.createdAt) || updatedAt,
        updatedAt,
        deletedAt,
      ],
    };
  }

  // Books and quotes keep the whole record as JSON, with the filtered columns
  // pulled out beside it.
  const columns =
    table === 'books'
      ? { shelf_id: (record.shelfId as string | undefined) ?? null }
      : { book_id: String(record.bookId ?? '') };

  const names = Object.keys(columns);
  const placeholders = names.map(() => '?').join(', ');
  const updates = names.map((n) => `${n} = excluded.${n}`).join(', ');

  return {
    sql: `INSERT INTO ${table} (id, journal_id, ${names.join(', ')}, data, updated_at, deleted_at)
          VALUES (?, ?, ${placeholders}, ?, ?, ?)
          ON CONFLICT(id, journal_id) DO UPDATE SET
            ${updates}, data = excluded.data,
            updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
          WHERE excluded.updated_at > ${table}.updated_at`,
    params: [id, journalId, ...Object.values(columns), JSON.stringify(record), updatedAt, deletedAt],
  };
}
