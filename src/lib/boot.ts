/**
 * Boot sequence for durable storage: probe IDB, run the v2→v3 migration,
 * then load the journal. Every failure here is reported, never swallowed —
 * a blocked boot must look different from an empty journal.
 */

import type { JournalData } from '../types';
import { openDb, isIdbAvailable, metaGet, metaSet, putMany } from './idb';
import { loadJournal, SCHEMA_VERSION } from './journalStore';
import { sanitizeData } from '../storage';
import { V2_STORAGE_KEY, prepareMigration, commitMigration } from './migrate';

export interface BootResult {
  /** Loaded journal, or null when nothing durable exists yet. */
  data: JournalData | null;
  /** True when storage is unusable (private mode, quota, disabled). */
  blocked: boolean;
  error?: string;
  migratedFrom2: boolean;
}

export async function bootStorage(): Promise<BootResult> {
  if (!isIdbAvailable()) {
    return { data: null, blocked: true, error: 'IndexedDB is not available in this browser', migratedFrom2: false };
  }
  try {
    await openDb();
  } catch (err) {
    return {
      data: null,
      blocked: true,
      error: err instanceof Error ? err.message : 'Could not open IndexedDB',
      migratedFrom2: false,
    };
  }

  let migratedFrom2 = false;
  const version = await metaGet<number>('schemaVersion');
  if (version !== SCHEMA_VERSION) {
    let legacy: string | null = null;
    try {
      legacy = window.localStorage.getItem(V2_STORAGE_KEY);
    } catch {
      legacy = null;
    }
    if (legacy !== null) {
      try {
        const outcome = prepareMigration(legacy);
        if (outcome) {
          await commitMigration(outcome);
          migratedFrom2 = true;
        } else {
          await metaSet('schemaVersion', SCHEMA_VERSION);
        }
      } catch (err) {
        return {
          data: null,
          blocked: true,
          error: err instanceof Error ? err.message : 'Migration from the old journal failed',
          migratedFrom2: false,
        };
      }
    } else {
      await putMany('meta', [{ key: 'schemaVersion', value: SCHEMA_VERSION }]);
    }
  }

  const data = await loadJournal(sanitizeData);
  return { data, blocked: false, migratedFrom2 };
}
