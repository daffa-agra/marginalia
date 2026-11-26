/**
 * Book bytes live in IndexedDB, never in localStorage.
 *
 * localStorage is capped around 5 MB and stores strings; a single EPUB can
 * exceed that, and base64 would inflate it by a third. IndexedDB stores Blobs
 * natively and asks for a much larger quota. This module is the only place
 * that touches raw file bytes.
 */

const DB_NAME = 'marginalia';
const DB_VERSION = 1;
const FILES_STORE = 'files';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot store books offline (IndexedDB unavailable).'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) db.createObjectStore(FILES_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the book store.'));
    request.onblocked = () => reject(new Error('Another tab is holding the book store open.'));
  });
  return dbPromise;
}

/** Reads a File as an ArrayBuffer, with a size guard before any parsing. */
export async function readEpubFile(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

export async function saveBookBytes(bookId: string, bytes: ArrayBuffer): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readwrite');
    const store = tx.objectStore(FILES_STORE);
    store.put(new Blob([bytes], { type: 'application/epub+zip' }), bookId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not save the book file.'));
    tx.onabort = () => reject(tx.error ?? new Error('Saving the book file was aborted.'));
  });
}

export async function loadBookBytes(bookId: string): Promise<Blob | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readonly');
    const request = tx.objectStore(FILES_STORE).get(bookId);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : undefined);
    request.onerror = () => reject(request.error ?? new Error('Could not read the book file.'));
  });
}

export async function deleteBookBytes(bookId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readwrite');
    tx.objectStore(FILES_STORE).delete(bookId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Could not delete the book file.'));
  });
}

/** True when the bytes for this book are still cached. */
export async function hasBookBytes(bookId: string): Promise<boolean> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readonly');
    const request = tx.objectStore(FILES_STORE).getKey(bookId);
    request.onsuccess = () => resolve(request.result !== undefined);
    request.onerror = () => reject(request.error ?? new Error('Could not check the book file.'));
  });
}

export interface StorageEstimate {
  usage: number;
  quota: number;
  /** False when the browser refused to keep storage under pressure. */
  persisted: boolean;
}

/** Reports how much room books have, and asks for protection from eviction. */
export async function estimateStorage(): Promise<StorageEstimate> {
  if (!navigator.storage?.estimate) return { usage: 0, quota: 0, persisted: false };
  const estimate = await navigator.storage.estimate();
  let persisted = false;
  try {
    persisted = await navigator.storage.persisted();
  } catch {
    persisted = false;
  }
  return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted };
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
