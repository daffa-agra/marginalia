/**
 * A thin promise wrapper over IndexedDB — the Phase 0 storage layer.
 *
 * All durable journal state lives in one database, `marginalia`. Record
 * stores keep tombstones (deletedAt), so deletes can later propagate to
 * other devices without resurrection; the outbox records every mutation
 * so offline work survives a reconnect unsupported by anything else.
 */

export type StoreName =
  | 'books'
  | 'quotes'
  | 'shelves'
  | 'entries'
  | 'files'
  | 'covers'
  | 'outbox'
  | 'meta';

export const DB_NAME = 'marginalia';
export const DB_VERSION = 1;
export const RECORD_STORES: StoreName[] = ['books', 'quotes', 'shelves', 'entries'];

let dbPromise: Promise<IDBDatabase> | null = null;

export function isIdbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function openDb(): Promise<IDBDatabase> {
  if (!isIdbAvailable()) return Promise.reject(new Error('IndexedDB is not available'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('quotes')) {
        db.createObjectStore('quotes', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('shelves')) {
        db.createObjectStore('shelves', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('entries')) {
        db.createObjectStore('entries', { keyPath: 'id' });
      }
      // files and covers are blob stores keyed by book id out-of-line,
      // matching lib/bookFiles.ts so both writers share one database.
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files');
      }
      if (!db.objectStoreNames.contains('covers')) {
        db.createObjectStore('covers');
      }
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB open blocked by another connection'));
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Writes every record in one transaction: either all land or none do. */
export async function putMany(store: StoreName, records: Array<Record<string, unknown>>): Promise<void> {
  if (records.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const record of records) os.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  return requestToPromise(tx.objectStore(store).getAll() as IDBRequest<T[]>);
}

export async function get<T>(store: StoreName, id: string | number): Promise<T | undefined> {
  const db = await openDb();
  const tx = db.transaction(store, 'readonly');
  return requestToPromise(tx.objectStore(store).get(id) as IDBRequest<T | undefined>);
}

export async function deleteAll(store: StoreName, ids: Array<string | number>): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const id of ids) os.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function metaGet<T>(key: string): Promise<T | undefined> {
  const row = await get<{ key: string; value: T }>('meta', key);
  return row?.value;
}

export async function metaSet(key: string, value: unknown): Promise<void> {
  await putMany('meta', [{ key, value } as unknown as Record<string, unknown>]);
}

/** Appends pending mutations next to the data write; flushed by Phase 4 sync. */
export async function appendOutbox(records: Array<Record<string, unknown>>): Promise<void> {
  if (records.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('outbox', 'readwrite');
    const os = tx.objectStore('outbox');
    for (const record of records) os.add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
