import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const server = await createServer({ configFile: resolve('apps/web/vite.config.ts'), server: { port: 5180 } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage(); await page.goto('http://127.0.0.1:5180/');
  const result = await page.evaluate(async () => {
    const { createDraftStore } = await import('/src/features/documents/drafts.ts');
    const store = createDraftStore(), original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) { if (key === 'failed-project') throw new DOMException('Disk full', 'QuotaExceededError'); return original.call(this, value, key); };
    try {
      let rejectedWrite = false, rejectedFlush = false;
      try { await store.write('failed-project', { text: 'Cannot lose this owner draft', baseRevision: 0 }); } catch { rejectedWrite = true; }
      await store.write('other-project', { text: 'A later successful write', baseRevision: 0 });
      try { await store.flush(); } catch { rejectedFlush = true; }
      await store.write('failed-project', { text: 'Recovered owner draft', baseRevision: 0 }).catch(() => {});
      return { rejectedWrite, rejectedFlush };
    } finally { IDBObjectStore.prototype.put = original; }
  });
  assert.deepEqual(result, { rejectedWrite: true, rejectedFlush: true });
  console.log('PASS real IndexedDB: a successful unrelated draft cannot conceal an earlier failed project write.');
} finally { await browser?.close(); await server.close(); }
