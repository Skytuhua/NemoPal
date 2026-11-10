import { afterEach, expect, test, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { createDraftStore } from '../../apps/web/src/features/documents/drafts';

// A controlled IndexedDB boundary: the real store owns the queue and failure bookkeeping.
function controlledDatabase() {
  const transactions: Array<{ finish(ok: boolean): void; key: string; value?: unknown; remove: boolean }> = [];
  const values = new Map<string, unknown>();
  const db = {
    transaction() {
      const tx: { oncomplete?: () => void; onabort?: () => void; onerror?: () => void; objectStore(): unknown } = {
        objectStore() {
          const request = { result: undefined as unknown };
          const enqueue = (key: string, value?: unknown, remove = false) => {
            transactions.push({ key, value, remove, finish(ok) {
              if (!ok) { tx.onabort?.(); return; }
              if (remove) values.delete(key); else values.set(key, value);
              tx.oncomplete?.();
            } });
            return request;
          };
          return { put: (value: unknown, key: string) => enqueue(key, value), delete: (key: string) => enqueue(key, undefined, true), get: (key: string) => { request.result = values.get(key); queueMicrotask(() => tx.oncomplete?.()); return request; } };
        },
      };
      return tx;
    },
  };
  vi.stubGlobal('indexedDB', { open() { const request = { result: db, onsuccess: undefined as undefined | (() => void) }; queueMicrotask(() => request.onsuccess?.()); return request; } });
  return { transactions, values };
}
afterEach(() => vi.unstubAllGlobals());

test('flush waits for a successor and reports its failure after an older write fails', async () => {
  const db = controlledDatabase(), store = createDraftStore();
  const first = store.write('owner-A', { text: 'old', baseRevision: 1 }).catch(() => {});
  await waitFor(() => expect(db.transactions).toHaveLength(1));
  let settled = false;
  const flush = store.flush().then(() => { settled = true; }, error => { settled = true; throw error; });
  const successor = store.write('owner-A', { text: 'latest', baseRevision: 2 }).catch(() => {});
  db.transactions[0]!.finish(false);
  await first;
  await waitFor(() => expect(db.transactions).toHaveLength(2));
  expect(settled).toBe(false);
  db.transactions[1]!.finish(false);
  await successor;
  await expect(flush).rejects.toThrow(/persisted/);
  await expect(store.flush()).rejects.toThrow(/persisted/);
});

test('flush drains a removal queued while an earlier write is pending', async () => {
  const db = controlledDatabase(), store = createDraftStore();
  const write = store.write('owner-A', { text: 'sent', baseRevision: 1 });
  await waitFor(() => expect(db.transactions).toHaveLength(1));
  let settled = false;
  const flush = store.flush().then(() => { settled = true; });
  const remove = store.remove('owner-A');
  db.transactions[0]!.finish(true);
  await write;
  await waitFor(() => expect(db.transactions).toHaveLength(2));
  expect(settled).toBe(false);
  db.transactions[1]!.finish(true);
  await remove; await flush;
  expect(db.values.has('owner-A')).toBe(false);
});
