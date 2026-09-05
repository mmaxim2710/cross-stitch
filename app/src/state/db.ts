import type { Pattern, StoredProgress } from '../types';

const NAME = 'cross-stitch';
const VERSION = 1;
const PATTERNS = 'patterns';
const PROGRESS = 'progress';

let handle: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  if (handle) return handle;
  handle = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PATTERNS)) db.createObjectStore(PATTERNS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PROGRESS)) db.createObjectStore(PROGRESS, { keyPath: 'patternId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return handle;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const db = {
  putPattern: (p: Pattern) => run(PATTERNS, 'readwrite', (s) => s.put(p)),
  getPattern: (id: string) => run<Pattern | undefined>(PATTERNS, 'readonly', (s) => s.get(id)),
  allPatterns: () => run<Pattern[]>(PATTERNS, 'readonly', (s) => s.getAll()),
  deletePattern: (id: string) => run(PATTERNS, 'readwrite', (s) => s.delete(id)),

  putProgress: (p: StoredProgress) => run(PROGRESS, 'readwrite', (s) => s.put(p)),
  getProgress: (patternId: string) => run<StoredProgress | undefined>(PROGRESS, 'readonly', (s) => s.get(patternId)),
  allProgress: () => run<StoredProgress[]>(PROGRESS, 'readonly', (s) => s.getAll()),
};

/**
 * Safari evicts IndexedDB after seven days of not visiting the site; the rule does
 * not apply to an app added to the home screen, and a persisted grant rules out
 * eviction under storage pressure too. Best effort — the answer is never awaited on.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
