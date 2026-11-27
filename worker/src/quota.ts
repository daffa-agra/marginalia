/**
 * Keeping file storage inside the free tier.
 *
 * R2 gives 10 GB of stored bytes free, with zero egress and generous operation
 * allowances. Egress being free removes the usual "someone hammers the CDN" cost
 * risk, so only two things can actually cost money here:
 *
 *   1. **Storage growth.** Bytes that accumulate past 10 GB.
 *   2. **Orphans.** Objects nobody references, which are paid for monthly and
 *      forever because nothing ever deletes them.
 *
 * Both are handled by keeping a ledger of exactly what exists and a per-journal
 * running total, so a quota check is one row read and a cleanup is an exact key —
 * never a bucket listing, which would itself be a billable Class A operation.
 *
 * The numbers are deliberately conservative. A personal library is tens of books,
 * not thousands, and refusing an upload with a clear message is a far better
 * outcome than a surprise at the end of the month.
 */

/**
 * Total bytes this deployment will store.
 *
 * The free allowance is 10 GB-month. Staying at half of it leaves room for the
 * measurement to be wrong, for a month to be long, and for the extra copies that
 * appear from retried uploads — while still being far more than a personal
 * library needs (~2,000–5,000 EPUBs at a typical 2–5 MB).
 */
export const TOTAL_STORAGE_BUDGET = 5 * 1024 * 1024 * 1024;

/**
 * Per-journal cap.
 *
 * One journal cannot consume the whole budget: a single scripted client would
 * otherwise be able to fill it, and the reader would have no idea why uploads
 * stopped. 2 GB is roughly a thousand books.
 */
export const PER_JOURNAL_BUDGET = 2 * 1024 * 1024 * 1024;

/** Per-book cap, matching the client's EPUB guard. */
export const MAX_BOOK_BYTES = 100 * 1024 * 1024;

/** How long a deleted book's object waits before the cron removes it. */
export const GC_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** Signed URLs per journal per hour, uploads and reads together. Retries need slack; a loop does not. */
export const UPLOAD_SIGNINGS_PER_HOUR = 120;

export interface QuotaDecision {
  allowed: boolean;
  /** Why it was refused, phrased for the reader. */
  reason?: string;
  /** Whether the refusal is permanent (size) or temporary (rate). */
  retryable?: boolean;
}

/**
 * Whether one more file of `size` bytes fits.
 *
 * Checks the journal's own budget, the deployment budget, and the per-book cap.
 * The caller supplies the totals it already had to read for auth, so this adds no
 * queries of its own.
 */
export function checkQuota(input: {
  size: number;
  journalBytes: number;
  totalBytes: number;
}): QuotaDecision {
  const { size, journalBytes, totalBytes } = input;

  if (!Number.isFinite(size) || size <= 0) {
    return { allowed: false, reason: 'The book size is not valid.', retryable: false };
  }
  if (size > MAX_BOOK_BYTES) {
    const mb = Math.round(MAX_BOOK_BYTES / 1024 / 1024);
    return { allowed: false, reason: `Books are limited to ${mb} MB.`, retryable: false };
  }
  if (journalBytes + size > PER_JOURNAL_BUDGET) {
    return {
      allowed: false,
      reason:
        'This journal has reached its storage limit. Delete a book to make room — deleting one frees its space after a week.',
      retryable: false,
    };
  }
  if (totalBytes + size > TOTAL_STORAGE_BUDGET) {
    return {
      allowed: false,
      reason: 'Book storage is full. Reading and syncing still work; nothing you have written is affected.',
      retryable: true,
    };
  }
  return { allowed: true };
}

/**
 * Whether a URL signing (upload or read) may happen now.
 *
 * A signing request costs a Worker invocation and nothing on R2, but an
 * unbounded loop of them is still a way to burn the daily request allowance and
 * to fill storage with objects nobody reads. The window is an hour.
 */
export function checkRate(input: {
  signingsThisHour: number;
  windowStartedAt: number;
  now: number;
}): QuotaDecision {
  const windowMs = 60 * 60 * 1000;
  if (input.now - input.windowStartedAt >= windowMs) return { allowed: true };
  if (input.signingsThisHour >= UPLOAD_SIGNINGS_PER_HOUR) {
    return {
      allowed: false,
      reason: 'Too many uploads in the last hour. Try again shortly.',
      retryable: true,
    };
  }
  return { allowed: true };
}

/**
 * Bytes to release when a book's file goes away.
 *
 * Clamped at zero: a negative running total would let a later upload exceed the
 * budget, so an accounting glitch must fail closed rather than open.
 */
export function afterRelease(journalBytes: number, size: number): number {
  return Math.max(0, journalBytes - Math.max(0, size));
}

/** Whether an object key belongs to this journal, for a delete safety check. */
export function keyBelongsToJournal(key: string, journalId: string): boolean {
  const safe = journalId.replace(/[^A-Za-z0-9_-]/g, '');
  return key.startsWith(`marginalia/${safe}/books/`);
}
