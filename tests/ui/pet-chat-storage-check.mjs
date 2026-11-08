import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const server = await createServer({ configFile: resolve('apps/web/vite.config.ts'), server: { port: 0, strictPort: false } });
let browser;
try {
  await server.listen(); browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage(); await page.goto(server.resolvedUrls.local[0]);
  const fixture = '/@fs/' + resolve('tests/ui/pet-chat-storage-fixture.tsx').replaceAll('\\', '/');
  await page.evaluate(async fixture => { await import(fixture); }, fixture);
  const composer = page.getByRole('textbox', { name: 'Message' }); await composer.waitFor();
  await page.evaluate(() => {
    window.originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) { if (key === 'pet-chat:synthetic-owner-project:draft') throw new DOMException('Synthetic full disk', 'QuotaExceededError'); return window.originalPut.call(this, value, key); };
  });
  await composer.fill('Latest old owner draft'); await page.getByRole('alert').waitFor();
  await page.evaluate(() => { const t = window.petStorageTest; t.emit({ ...t.initial, version: 2, visible: false, flushRequestId: '00000000-0000-4000-8000-000000000002' }); });
  await page.waitForFunction(() => window.petStorageTest.acknowledgements.some(a => a.type === 'flushed' && !a.succeeded));
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalPut; const t = window.petStorageTest; t.emit({ ...t.initial, version: 3, visible: false, flushRequestId: '00000000-0000-4000-8000-000000000003' }); });
  await page.waitForFunction(() => window.petStorageTest.acknowledgements.some(a => a.type === 'flushed' && a.flushId.endsWith('003') && a.succeeded));
  assert.equal((await page.evaluate(() => window.petStorageTest.read())).text, 'Latest old owner draft');
  console.log('PASS real IndexedDB sticky write failure and hidden popup retry');
} finally { await browser?.close(); await server.close(); }
