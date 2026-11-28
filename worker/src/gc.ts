/**
 * Collecting orphaned objects.
 *
 * The ledger in `book_files` records every object this deployment has written.
 * When a book is deleted its row is marked with `delete_after` rather than being
 * dropped, because dropping it would lose the key and strand the bytes in R2
 * forever — which is the one way to pay for storage nobody uses.
 *
 * This pass does three things, in order:
 *
 *   1. **Expire** — mark rows whose book is gone with a grace deadline.
 *   2. **Collect** — delete the exact object by key, then settle the journal's
 *      running total.
 *   3. **Sweep** — remove rows for objects that were recorded but never landed
 *      (an interrupted PUT), by checking existence with a HEAD.
 *
 * It never lists the bucket. A list is a Class A operation billed against a
 * monthly allowance, and one per cleanup is avoidable when every key is already
 * known exactly.
 *
 * The grace period exists because a delete is undoable in the app for a week. A
 * reader who deletes a book and changes their mind must not have to re-upload.
 */

import type { R2Config } from './r2';
import { presign } from './r2';

/** A deleted book's bytes are kept this long, so the delete stays undoable. */
export const GC_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface GcResult {
  expired: number;
  collected: number;
  swept: number;
  bytesFreed: number;
}

/**
 * Runs the collection pass for every journal past its deadline.
 *
 * Bounded by `limit` so one invocation cannot exceed the Worker's CPU budget: the
 * cron runs daily, so draining a few hundred at a time is plenty.
 */
export async function collectGarbage(
  db: D1Database,
  config: R2Config,
  now = Date.now(),
  limit = 200,
): Promise<GcResult> {
  const result: GcResult = { expired: 0, collected: 0, swept: 0, bytesFreed: 0 };

  // 1. Mark files whose book no longer exists. A book is "gone" when the synced
  //    record carries a tombstone; the client only ever sets that on a delete.
  const orphaned = await db
    .prepare(
      `SELECT f.journal_id, f.book_id, f.sha256, f.size
         FROM book_files f
         JOIN books b ON b.id = f.book_id AND b.journal_id = f.journal_id
        WHERE b.deleted_at IS NOT NULL
          AND f.delete_after IS NULL
        LIMIT ?`,
    )
    .bind(limit)
    .all<{ journal_id: string; book_id: string; sha256: string; size: number }>();

  for (const row of orphaned.results ?? []) {
    await db
      .prepare('UPDATE book_files SET delete_after = ? WHERE journal_id = ? AND book_id = ?')
      .bind(now + GC_GRACE_MS, row.journal_id, row.book_id)
      .run();
    result.expired += 1;
  }

  // 2. Collect the ones whose grace period is over.
  const due = await db
    .prepare(
      `SELECT journal_id, book_id, sha256, size
         FROM book_files
        WHERE delete_after IS NOT NULL AND delete_after <= ?
        LIMIT ?`,
    )
    .bind(now, limit)
    .all<{ journal_id: string; book_id: string; sha256: string; size: number }>();

  for (const row of due.results ?? []) {
    try {
      await deleteObject(config, row.journal_id, row.book_id, row.sha256);
      await db
        .prepare('DELETE FROM book_files WHERE journal_id = ? AND book_id = ?')
        .bind(row.journal_id, row.book_id)
        .run();
      await db
        .prepare(
          `UPDATE journals SET bytes_used = (
             SELECT COALESCE(SUM(size), 0) FROM book_files
              WHERE journal_id = ? AND delete_after IS NULL
           ) WHERE id = ?`,
        )
        .bind(row.journal_id, row.journal_id)
        .run();
      result.collected += 1;
      result.bytesFreed += row.size;
    } catch {
      // Leave the row in place: the next run retries. A failed delete must not
      // clear the ledger entry, or the bytes would be stranded with no record.
    }
  }

  // 3. Sweep rows for uploads that never landed. These are cheap to check and
  //    would otherwise sit in the quota total forever.
  const unconfirmed = await db
    .prepare(
      `SELECT journal_id, book_id, sha256, size
         FROM book_files
        WHERE delete_after IS NULL AND created_at < ?
        LIMIT ?`,
    )
    .bind(now - GC_GRACE_MS, limit)
    .all<{ journal_id: string; book_id: string; sha256: string; size: number }>();

  for (const row of unconfirmed.results ?? []) {
    const exists = await objectExists(config, row.journal_id, row.book_id, row.sha256);
    if (exists) continue;
    await db
      .prepare('DELETE FROM book_files WHERE journal_id = ? AND book_id = ? AND sha256 = ?')
      .bind(row.journal_id, row.book_id, row.sha256)
      .run();
    await db
      .prepare(
        `UPDATE journals SET bytes_used = (
           SELECT COALESCE(SUM(size), 0) FROM book_files
            WHERE journal_id = ? AND delete_after IS NULL
         ) WHERE id = ?`,
      )
      .bind(row.journal_id, row.journal_id)
      .run();
    result.swept += 1;
  }

  return result;
}

/**
 * Clears the auth residue: expired sessions and abandoned sign-in attempts.
 *
 * Neither holds bytes, so this is hygiene rather than cost control — but a
 * session table that only ever grows is a table that outlives its readers.
 * Runs in the same nightly pass as the object collection.
 */
export async function collectSessions(db: D1Database, now = Date.now()): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM oauth_states WHERE created_at < ?').bind(now - 60 * 60 * 1000),
  ]);
}

/** Deletes one object by its exact key. No listing, one Class A operation. */
async function deleteObject(
  config: R2Config,
  journalId: string,
  bookId: string,
  sha256: string,
): Promise<void> {
  const signed = await presign(config, `${keyFor(journalId, bookId, sha256)}`, 'DELETE');
  const response = await fetch(signed.url, { method: 'DELETE' });
  // A 404 means it is already gone, which is the outcome we wanted.
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 delete failed: ${response.status}`);
  }
}

/** Whether an object exists, via a signed HEAD. */
async function objectExists(
  config: R2Config,
  journalId: string,
  bookId: string,
  sha256: string,
): Promise<boolean> {
  const signed = await presign(config, `${keyFor(journalId, bookId, sha256)}`, 'HEAD');
  try {
    const response = await fetch(signed.url, { method: 'HEAD' });
    return response.ok;
  } catch {
    // A network failure is not proof of absence; keep the row.
    return true;
  }
}

function keyFor(journalId: string, bookId: string, sha256: string): string {
  const safe = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '');
  return `marginalia/${safe(journalId)}/books/${safe(bookId)}/${sha256.toLowerCase()}.epub`;
}
