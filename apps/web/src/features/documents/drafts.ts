export interface LocalDraft { text: string; baseRevision: number; conflict?: string }
export interface DraftStore {
  read(key: string): Promise<LocalDraft | undefined>;
  write(key: string, draft: LocalDraft): Promise<void>;
  remove(key: string): Promise<void>;
  flush(): Promise<void>;
}

/** Non-secret project drafts only. Tokens never enter renderer storage. */
export function createDraftStore(): DraftStore {
  let database: Promise<IDBDatabase> | undefined;
  let tail = Promise.resolve();
  let failure: unknown;
  function open() {
    return database ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(new Error('Draft storage unavailable. Keep this window open and copy your work.')); return; }
      const request = indexedDB.open('living-playbooks-drafts-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Cannot open draft storage. Keep this window open and copy your work.'));
      request.onblocked = () => reject(new Error('Draft storage is blocked by another window.'));
    });
  }
  async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', mode), request = operation(tx.objectStore('drafts'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('Draft could not be persisted. Keep this window open and copy your work.'));
    });
  }
  function queue(operation: () => Promise<unknown>): Promise<void> {
    const task = tail.then(operation).then(() => { failure = undefined; });
    tail = task.catch(error => { failure = error; });
    return task;
  }
  return {
    async read(key) { await tail; return transaction<LocalDraft | undefined>('readonly', store => store.get(key)); },
    write: (key, value) => queue(() => transaction('readwrite', store => store.put(value, key))),
    remove: key => queue(() => transaction('readwrite', store => store.delete(key))),
    async flush() { await tail; if (failure) throw failure; },
  };
}
