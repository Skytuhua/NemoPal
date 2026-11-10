export interface LocalDraft { text: string; baseRevision: number; conflict?: string }
export interface DraftStore {
  read(key: string): Promise<LocalDraft | undefined>;
  write(key: string, draft: LocalDraft): Promise<void>;
  remove(key: string): Promise<void>;
  flush(): Promise<void>;
  retryFailed?(): Promise<void>;
}

/** Non-secret project drafts only. Tokens never enter renderer storage. */
export function createDraftStore(): DraftStore {
  let database: Promise<IDBDatabase> | undefined;
  let tail = Promise.resolve();
  const failures = new Map<string, { error: unknown; operation: () => Promise<unknown>; version: number }>();
  const versions = new Map<string, number>();
  function open() {
    if (database) return database;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error('Draft storage unavailable. Keep this window open and copy your work.')); return; }
      const request = indexedDB.open('living-playbooks-drafts-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Cannot open draft storage. Keep this window open and copy your work.'));
      request.onblocked = () => reject(new Error('Draft storage is blocked by another window.'));
    });
    database = attempt;
    void attempt.catch(() => { if (database === attempt) database = undefined; });
    return attempt;
  }
  async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', mode), request = operation(tx.objectStore('drafts'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('Draft could not be persisted. Keep this window open and copy your work.'));
    });
  }
  function queue(key: string, operation: () => Promise<unknown>): Promise<void> {
    const version = (versions.get(key) ?? 0) + 1;
    versions.set(key, version);
    const task = tail.then(operation).then(() => { failures.delete(key); });
    tail = task.catch(error => { failures.set(key, { error, operation, version }); });
    return task;
  }
  async function drain() {
    let observed: Promise<void>;
    do { observed = tail; await observed; } while (observed !== tail);
  }
  async function flush() {
    let observed: Promise<void>;
    do { observed = tail; await observed; } while (observed !== tail);
    if (failures.size) throw failures.values().next().value!.error;
  }
  return {
    async read(key) { await tail; return transaction<LocalDraft | undefined>('readonly', store => store.get(key)); },
    write: (key, value) => { const snapshot = { ...value }; return queue(key, () => transaction('readwrite', store => store.put(snapshot, key))); },
    remove: key => queue(key, () => transaction('readwrite', store => store.delete(key))),
    flush,
    async retryFailed() {
      await drain();
      const retries = [...failures].filter(([key, failure]) => versions.get(key) === failure.version)
        .map(([key, failure]) => queue(key, failure.operation));
      await Promise.allSettled(retries);
      await flush();
    },
  };
}
