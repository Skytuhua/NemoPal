// Bounded local inspection. Explicit fixtures; never connects a real provider or source.
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

const round = process.argv[2] ?? 'initial';
assert.ok(['initial', 'confirmation'].includes(round));
process.env.VITE_DEV_FIXTURES = 'true';
const server = await createServer({ configFile: resolve('apps/web/vite.config.ts'), server: { port: 5179 } });
const directory = resolve(`tests/ui/artifacts/${round}`);
await mkdir(directory, { recursive: true });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:5179/');
  await page.getByLabel('Document: Demo notes').waitFor();
  await page.getByLabel('Document: Demo notes').fill('Persistent browser draft for the bounded inspection.');
  await page.reload();
  await page.getByLabel('Document: Demo notes').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-draft-editor]')?.value === 'Persistent browser draft for the bounded inspection.');
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => ({ tag: document.activeElement?.tagName, outline: getComputedStyle(document.activeElement).outlineWidth }));
  assert.equal(focus.outline, '3px');
  const desktop = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, center: document.querySelector('.workspace-surface').getBoundingClientRect().width, panels: document.querySelectorAll('[data-panel-type]').length }));
  assert.equal(desktop.panels, 6); assert.ok(desktop.center > desktop.viewport / 2); assert.ok(desktop.width <= desktop.viewport);
  await page.screenshot({ path: `${directory}/01-desktop.png`, fullPage: true });
  const targets = [];
  for (const viewport of [{ width: 375, height: 812 }, { width: 812, height: 375 }]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const nav = page.getByRole('navigation', { name: 'Main surfaces' });
    await nav.getByRole('button', { name: 'Projects', exact: true }).click();
    await page.getByRole('button', { name: /Hackathon demo/ }).waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('Message to Nemo').isVisible(), false);
    await nav.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByLabel('Message to Nemo').waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('Document: Demo notes').isVisible(), false);
    await nav.getByRole('button', { name: 'Workspace', exact: true }).click();
    const sizing = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth, smallTargets: [...document.querySelectorAll('button, select, summary, input:not([type=checkbox])')].filter(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height < 44).map(el => el.textContent) }));
    assert.ok(sizing.width <= sizing.viewport); assert.deepEqual(sizing.smallTargets, []); targets.push(sizing);
    await page.screenshot({ path: `${directory}/${viewport.width === 375 ? '02-mobile' : '03-landscape'}.png`, fullPage: true });
  }
  // Test-only restricted pet event source; no workspace/client/source powers are exposed.
  const pet = await browser.newPage({ viewport: { width: 420, height: 620 }, reducedMotion: 'reduce' });
  await pet.addInitScript(() => {
    window.pet = { invoke: async () => {}, onEvent(listener) { window.__emitPetFixture = listener; return () => {}; } };
  });
  await pet.goto('http://127.0.0.1:5179/?surface=pet');
  await pet.waitForFunction(() => !!window.__emitPetFixture);
  await pet.evaluate(() => window.__emitPetFixture({ type: 'pet_state', projectId: '00000000-0000-4000-8000-000000000001', managerName: 'Nemo · synthetic pet fixture', petPackId: 'original-nemo-v1', state: 'idle', checkIn: null, demoTiming: false, preference: { hidden: false, focus: false, reducedMotion: true, pinnedProjectId: null } }));
  await pet.getByRole('img').waitFor();
  await pet.waitForFunction(() => document.querySelector('img')?.complete && document.querySelector('img')?.naturalWidth > 0);
  assert.equal(await pet.getByRole('img').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await pet.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgba(0, 0, 0, 0)');
  await pet.screenshot({ path: `${directory}/04-pet.png` });
  await pet.close();
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/checks.json`, JSON.stringify({ round, evidence: 'Synthetic local browser only', desktop, focus, targets, consoleErrors: errors, indexedDBReload: 'preserved', petReducedMotion: 'none', nativeGate: 'NOT RUN' }, null, 2));
  console.log(`PASS ${round}: desktop, 375px, landscape, IndexedDB reload, keyboard focus, 44px targets, six panels, reduced-motion pet. ${directory}`);
} finally { await browser?.close(); await server.close(); }
