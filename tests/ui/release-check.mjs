import { build, preview } from 'vite';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
// Even an intentional development-fixture environment must not enable release fixtures.
process.env.VITE_DEV_FIXTURES = 'true';
const configFile = resolve('apps/web/vite.config.ts');
await build({ configFile });
const html = await readFile('apps/web/dist/index.html', 'utf8');
assert.ok(html.includes("connect-src 'none'")); assert.ok(!html.includes('unsafe-inline'));
const server = await preview({ configFile, preview: { host: '127.0.0.1', port: 5181, strictPort: true } });
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5181/');
  await page.getByRole('heading', { name: 'Desktop capability unavailable' }).waitFor();
  assert.equal(await page.getByText('Fixture mode · synthetic data · no live model').count(), 0);
  await page.goto('http://127.0.0.1:5181/?surface=pet');
  await page.getByRole('heading', { name: 'Pet unavailable' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS release browser: explicit workspace/pet unavailable without preload, no fixture fallback, strict CSP, no renderer connections.');
} finally { await browser?.close(); await new Promise(resolveClose => server.httpServer.close(resolveClose)); }
