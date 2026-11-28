/**
 * The cloud copy of a book file is the one write that used to be
 * fire-and-forget: the journal queues and retries, but an EPUB upload that
 * failed, or lost its tab before finishing, left the record without a
 * `sha256` — and a book without a `sha256` can never be fetched by another
 * device. The bytes existed on one machine only, permanently.
 *
 * This module gives book bytes the same contract the journal has: a failed
 * upload is a *queued* change, not a lost one. The queue is a list of book
 * ids; the bytes themselves already live in IndexedDB under those ids, so
 * persisting anything heavier would be a second copy, not a queue.
 */

import type { Book } from '../types';
import type { ApiResult } from './api';

const KEY = 'marginalia.uploads.v1';

function read(): string[] {
  try {
    const raw = (globalThis as { localStorage?: Storage }).localStorage?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string' && id.length > 0);
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Losing the queue costs the retry, not the bytes: IndexedDB still has
    // the file, and a later add re-enqueues.
  }
}

/** Book ids whose cloud copy is still owed. */
export function pendingUploads(): string[] {
  return read();
}

export function enqueueUpload(bookId: string): void {
  const ids = read();
  if (!ids.includes(bookId)) write([...ids, bookId]);
}

export function dequeueUpload(bookId: string): void {
  const ids = read();
  if (ids.includes(bookId)) write(ids.filter((id) => id !== bookId));
}

export function clearUploads(): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.removeItem(KEY);
  } catch {
    // Nothing to recover.
  }
}

/**
 * Books that have a file record but no content hash: added offline, added on
 * a device whose upload died, or added before uploads were queued at all.
 * These are swept into the queue so a repaired connection repairs the library.
 */
export function missingUploads(books: readonly Book[]): string[] {
  return books
    .filter((book) => book.file && !book.file.sha256)
    .map((book) => book.id);
}

export interface UploadRun {
  /** Uploaded and recorded: the record now carries the sha256 other devices fetch by. */
  uploaded: string[];
  /** Attempted but failed; they stay queued for the next pass. */
  failed: string[];
  /** Dropped from the queue: already uploaded, gone, or with no local bytes. */
  skipped: string[];
}

export interface UploadDeps {
  loadBytes: (bookId: string) => Promise<Blob | undefined>;
  upload: (bookId: string, bytes: ArrayBuffer) => Promise<ApiResult<{ sha256: string }>>;
  onUploaded: (bookId: string, sha256: string) => void;
}

/**
 * Works through the queue, one book at a time.
 *
 * The deps keep this testable: the function holds no network, no IndexedDB and
 * no store — a smoke suite drives it entirely through fakes. A book the
 * journal no longer has (deleted here or on another device) is dropped rather
 * than retried forever, and so is a book whose bytes are missing: this device
 * has nothing to upload, and the device that does still has it queued.
 */
export async function processUploadQueue(
  books: readonly Book[],
  deps: UploadDeps,
  queue: readonly string[] = pendingUploads(),
): Promise<UploadRun> {
  const byId = new Map(books.map((b) => [b.id, b]));
  const run: UploadRun = { uploaded: [], failed: [], skipped: [] };

  for (const bookId of queue) {
    const book = byId.get(bookId);

    if (!book || book.deletedAt) {
      dequeueUpload(bookId);
      run.skipped.push(bookId);
      continue;
    }
    if (book.file?.sha256) {
      // Already uploaded — the record carries the hash another device reads.
      dequeueUpload(bookId);
      run.skipped.push(bookId);
      continue;
    }

    let bytes: ArrayBuffer;
    try {
      const blob = await deps.loadBytes(bookId);
      if (!blob) {
        dequeueUpload(bookId);
        run.skipped.push(bookId);
        continue;
      }
      bytes = await blob.arrayBuffer();
    } catch {
      // Unreadable bytes are not a network problem; retrying would only burn
      // quota signings. The file record stays, so the reader still shows the
      // honest "not backed up" state.
      dequeueUpload(bookId);
      run.skipped.push(bookId);
      continue;
    }

    try {
      const result = await deps.upload(bookId, bytes);
      if (!result.ok) {
        run.failed.push(bookId);
        continue;
      }
      deps.onUploaded(bookId, result.data.sha256);
      dequeueUpload(bookId);
      run.uploaded.push(bookId);
    } catch {
      run.failed.push(bookId);
    }
  }

  return run;
}
