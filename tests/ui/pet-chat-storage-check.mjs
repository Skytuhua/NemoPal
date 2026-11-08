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
  // A failed pending write must be retried even after another owner becomes active.
  await page.evaluate(async () => {
    const t = window.petStorageTest;
    IDBObjectStore.prototype.put = function(value, key) { if (key.endsWith(':pending')) throw new DOMException('Synthetic full disk', 'QuotaExceededError'); return window.originalPut.call(this, value, key); };
    try { await t.store.write('pet-chat:synthetic-owner-project:draft:pending', { text: 'synthetic pending', baseRevision: 0 }); } catch {}
    IDBObjectStore.prototype.put = window.originalPut;
    t.emit({ ...t.initial, version: 4, contextId: '00000000-0000-4000-8000-000000000004', conversation: { ...t.initial.conversation, draftScope: 'synthetic-owner-B' } });
  });
  await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
  await page.evaluate(() => { const t = window.petStorageTest; t.emit({ ...t.initial, version: 5, contextId: '00000000-0000-4000-8000-000000000004', visible: false, flushRequestId: '00000000-0000-4000-8000-000000000005', conversation: { ...t.initial.conversation, draftScope: 'synthetic-owner-B' } }); });
  await page.waitForFunction(() => window.petStorageTest.acknowledgements.some(a => a.flushId?.endsWith('005')));
  const pendingAck = await page.evaluate(() => window.petStorageTest.acknowledgements.find(a => a.flushId?.endsWith('005')).succeeded);
  const pendingText = (await page.evaluate(() => window.petStorageTest.store.read('pet-chat:synthetic-owner-project:draft:pending')))?.text;
  // A failed delete must also replay; a later write wins over a failed delete.
  await page.evaluate(async () => {
    const t = window.petStorageTest; window.originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function(key) { if (key === 'pet-chat:synthetic-owner-project:draft') throw new DOMException('Synthetic full disk', 'QuotaExceededError'); return window.originalDelete.call(this, key); };
    await t.store.write('pet-chat:synthetic-owner-project:draft', { text: 'old', baseRevision: 0 });
    try { await t.store.remove('pet-chat:synthetic-owner-project:draft'); } catch {}
    IDBObjectStore.prototype.delete = window.originalDelete;
    t.emit({ ...t.initial, version: 6, contextId: '00000000-0000-4000-8000-000000000004', visible: false, flushRequestId: '00000000-0000-4000-8000-000000000006', conversation: { ...t.initial.conversation, draftScope: 'synthetic-owner-B' } });
  });
  await page.waitForFunction(() => window.petStorageTest.acknowledgements.some(a => a.flushId?.endsWith('006')));
  const removeAck = await page.evaluate(() => window.petStorageTest.acknowledgements.find(a => a.flushId?.endsWith('006')).succeeded);
  const removedValue = await page.evaluate(() => window.petStorageTest.store.read('pet-chat:synthetic-owner-project:draft'));
  await page.evaluate(async () => {
    const t = window.petStorageTest;
    IDBObjectStore.prototype.delete = function(key) { if (key === 'pet-chat:synthetic-owner-project:draft') throw new DOMException('Synthetic full disk', 'QuotaExceededError'); return window.originalDelete.call(this, key); };
    try { await t.store.remove('pet-chat:synthetic-owner-project:draft'); } catch {}
    IDBObjectStore.prototype.delete = window.originalDelete;
    await t.store.write('pet-chat:synthetic-owner-project:draft', { text: 'newer', baseRevision: 2 });
  });
  assert.equal((await page.evaluate(() => window.petStorageTest.store.read('pet-chat:synthetic-owner-project:draft'))).text, 'newer');
  assert.deepEqual({ pendingAck, pendingText, removeAck, removedValue }, { pendingAck: true, pendingText: 'synthetic pending', removeAck: true, removedValue: undefined });
  console.log('PASS IndexedDB write and delete recovery, quit retry, owner isolation, and newer draft ordering');
} finally { await browser?.close(); await server.close(); }
