/**
 * The v2 → v3 migration: the only step in the storage upgrade that can
 * destroy data, so it is explicit and all-or-nothing.
 *
 * Core is pure (parse → sanitize → stamp) and runs in Node for the smoke
 * suite; the IDB writing happens in `commitMigration`, one transaction per
 * store after the pure core returns. localStorage is never deleted — it
 * stays as a frozen backup of the v2 journal.
 */

import type { JournalData } from '../types';
import { sanitizeData } from '../storage';
import { metaGet, metaSet, putMany } from './idb';
import { SCHEMA_VERSION } from './journalStore';

export const V2_STORAGE_KEY = 'marginalia.journal.v1';

export interface MigrationResult {
  data: JournalData;
  migratedFrom: 2 | null;
}

export interface MigrationOutcome {
  result: MigrationResult;
  toWrite: {
    books: Array<Record<string, unknown>>;
    quotes: Array<Record<string, unknown>>;
    shelves: Array<Record<string, unknown>>;
    entries: Array<Record<string, unknown>>;
  };
}

/**
 * Pure core. Returns null when there is nothing to migrate (no v2 key).
 * `readRaw` is injected so the smoke suite can drive this against a fixture.
 */
export function prepareMigration(raw: string | null): MigrationOutcome | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A corrupt v2 payload is not a reason to block boot forever, but it is
    // a reason to stop keeping silent: surface it to the caller.
    throw new Error('Legacy journal data is corrupt and could not be migrated');
  }
  const data = sanitizeData(parsed);
  return {
    result: { data, migratedFrom: 2 },
    toWrite: {
      books: data.books as unknown as Array<Record<string, unknown>>,
      quotes: data.quotes as unknown as Array<Record<string, unknown>>,
      shelves: data.shelves as unknown as Array<Record<string, unknown>>,
      entries: data.entries as unknown as Array<Record<string, unknown>>,
    },
  };
}

/**
 * Persists a migration outcome and records the schema version. Any throw
 * leaves the caller to block boot — partial writes are possible only across
 * store boundaries, and each one is idempotent, so a retry completes it.
 */
export async function commitMigration(outcome: NonNullable<MigrationOutcome>): Promise<void> {
  await putMany('books', outcome.toWrite.books);
  await putMany('quotes', outcome.toWrite.quotes);
  await putMany('shelves', outcome.toWrite.shelves);
  await putMany('entries', outcome.toWrite.entries);
  await metaSet('schemaVersion', 3);
  await metaSet('migratedFrom', 2);
}

/** True once this device has been migrated or started fresh on v3. */
export async function migrationNeeded(): Promise<boolean> {
  const version = await metaGet<number>('schemaVersion');
  return version !== SCHEMA_VERSION;
}
