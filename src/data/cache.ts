/**
 * Small persistent key/value cache on IndexedDB, usable from the main thread
 * and from workers. Falls back to an in-memory map where IndexedDB isn't
 * available (Node scripts, some private browsing modes).
 */
import { openDB, type IDBPDatabase } from 'idb';

interface Entry<T> {
  value: T;
  savedAt: number;
}

const STORE = 'kv';
let dbPromise: Promise<IDBPDatabase | null> | null = null;
const memory = new Map<string, Entry<unknown>>();

function db(): Promise<IDBPDatabase | null> {
  if (!dbPromise) {
    dbPromise =
      typeof indexedDB === 'undefined'
        ? Promise.resolve(null)
        : openDB('hillfinder', 1, { upgrade: (d) => d.createObjectStore(STORE) }).catch(() => null);
  }
  return dbPromise;
}

export async function cacheGet<T>(key: string, maxAgeMs: number): Promise<T | undefined> {
  const d = await db();
  const entry = (d ? await d.get(STORE, key).catch(() => undefined) : memory.get(key)) as Entry<T> | undefined;
  if (!entry || Date.now() - entry.savedAt > maxAgeMs) return undefined;
  return entry.value;
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  const entry: Entry<T> = { value, savedAt: Date.now() };
  const d = await db();
  if (d) await d.put(STORE, entry, key).catch(() => undefined);
  else memory.set(key, entry);
}

export const DAY = 24 * 3600 * 1000;
