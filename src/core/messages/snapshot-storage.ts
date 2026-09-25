/**
 * Storage adapter for the conversation snapshot (T4A).
 *
 * Why an adapter: the snapshot layer must be testable WITHOUT the Chrome
 * API and swappable later (IndexedDB, sync storage, export/import). The
 * production default stays chrome.storage.local — unchanged behavior.
 *
 * Contract:
 *  - `read` returns the stored value or `undefined` — never throws for a
 *    missing key; storage failures throw SnapshotStorageError (callers
 *    map that to null / {ok:false} — fail closed),
 *  - `write` is a SINGLE operation over a single key: payload
 *    serialization happens BEFORE the assignment, so a failing write
 *    leaves the previous value fully intact (atomic per key),
 *  - values round-trip through JSON exactly like chrome.storage
 *    serializes them (deep copy in, deep copy out — no aliasing of the
 *    caller's objects).
 */

export interface SnapshotStorageAdapter {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
}

export class SnapshotStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotStorageError';
  }
}

export interface MemorySnapshotStorage extends SnapshotStorageAdapter {
  /** Deep copy of the current contents — test inspection only. */
  dump(): Record<string, unknown>;
}

function deepCopy(value: unknown): unknown {
  // JSON round trip mirrors chrome.storage serialization semantics:
  // the caller's object graph is never shared with the store.
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export function createMemorySnapshotStorage(
  initial: Readonly<Record<string, unknown>> = {},
): MemorySnapshotStorage {
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(initial)) {
    data[key] = deepCopy(initial[key]);
  }

  return {
    // Deliberately non-async: the serialization + assignment below is one
    // synchronous step, so a failing write CANNOT leave a partial value.
    read(key: string): Promise<unknown> {
      if (!Object.prototype.hasOwnProperty.call(data, key)) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(deepCopy(data[key]));
    },

    write(key: string, value: unknown): Promise<void> {
      // Serialize FIRST — if serialization fails, the store is untouched
      // (the atomicity guarantee; a half-written snapshot is impossible).
      const serialized: string | undefined = JSON.stringify(value);
      if (typeof serialized !== 'string') {
        throw new SnapshotStorageError('Value is not serializable.');
      }
      data[key] = JSON.parse(serialized);
      return Promise.resolve();
    },

    dump(): Record<string, unknown> {
      return deepCopy(data) as Record<string, unknown>;
    },
  };
}

type LocalStorageArea = typeof chrome.storage.local;

function chromeArea(): LocalStorageArea {
  try {
    // ReferenceError (no chrome in Node) becomes SnapshotStorageError —
    // callers fail closed instead of crashing.
    return chrome.storage.local;
  } catch {
    throw new SnapshotStorageError('chrome.storage.local is unavailable.');
  }
}

/**
 * Production adapter over chrome.storage.local. Construction never
 * touches chrome; failures surface from read/write as
 * SnapshotStorageError.
 */
export function createChromeSnapshotStorage(): SnapshotStorageAdapter {
  return {
    async read(key: string): Promise<unknown> {
      try {
        const area = chromeArea();
        const result = await area.get(key);
        return result[key];
      } catch (error) {
        if (error instanceof SnapshotStorageError) {
          throw error;
        }
        throw new SnapshotStorageError(
          error instanceof Error ? error.message : String(error),
        );
      }
    },

    async write(key: string, value: unknown): Promise<void> {
      try {
        const area = chromeArea();
        // Single key, single set() call — chrome applies it atomically;
        // a throwing call leaves the previous value in place.
        await area.set({ [key]: value });
      } catch (error) {
        if (error instanceof SnapshotStorageError) {
          throw error;
        }
        throw new SnapshotStorageError(
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  };
}
