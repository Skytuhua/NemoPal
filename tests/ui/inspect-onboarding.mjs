// One batched inspection and, when needed, one confirmation. Synthetic headless UI only.
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const round = process.argv[2] ?? 'initial';
assert.ok(['initial', 'confirmation'].includes(round));
const directory = resolve(`.impeccable/review/${round}`);
await mkdir(directory, { recursive: true });
process.env.VITE_DEV_FIXTURES = 'true';
const server = await createServer({
  configFile: resolve('apps/web/vite.config.ts'),
  server: { port: 0 },
  plugins: [{ name: 'test-only-empty-account', configureServer(vite) {
    vite.middlewares.use('/__ui_empty', async (_request, response, next) => {
      try {
        const entry = `/@fs/${resolve('tests/ui/onboarding-harness.tsx').replaceAll('\\', '/')}`;
        const html = await vite.transformIndexHtml('/__ui_empty', `<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="/src/favicon.svg"><title>Synthetic first use</title></head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>`);
        response.setHeader('Content-Type', 'text/html'); response.end(html);
      } catch (error) { next(error); }
    });
  } }],
});
let browser;
const checks = [], errors = [];
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  async function capture(name, viewport) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => scrollTo(0, 0));
    const result = await page.evaluate(() => {
      const visible = element => !!element.getBoundingClientRect().width && !!element.getBoundingClientRect().height && getComputedStyle(element).visibility !== 'hidden';
      const smallTargets = [...document.querySelectorAll('button, select, summary, input:not([type=checkbox])')].filter(element => visible(element) && element.getBoundingClientRect().height < 44).map(element => element.textContent);
      const overflow = [...document.querySelectorAll('body *')].filter(element => visible(element) && element.getBoundingClientRect().right > innerWidth + 1).map(element => ({ tag: element.tagName, className: element.className, width: element.getBoundingClientRect().width, text: element.textContent?.slice(0, 80) })).slice(-12);
      return { viewport: innerWidth, width: document.documentElement.scrollWidth, smallTargets, overflow, panels: document.querySelectorAll('[data-panel-type]').length, center: document.querySelector('.workspace-surface').getBoundingClientRect().width };
    });
    const path = `${directory}/${name}.png`;
    const exists = await access(path).then(() => true, () => false);
    if (!exists) await page.screenshot({ path, fullPage: true });
    checks.push({ name, ...viewport, ...result });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin);
  const notes = page.getByLabel('Document: Demo notes');
  await notes.waitFor();
  await notes.fill('Draft retained across overview and reload. Synthetic inspection only.');
  await page.reload();
  await notes.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-draft-editor]')?.value === 'Draft retained across overview and reload. Synthetic inspection only.');
  assert.equal(await page.locator('.connection-status').getAttribute('open'), null);
  assert.equal(await page.locator('.project-settings').getAttribute('open'), null);
  await page.getByRole('button', { name: 'Accept plan', exact: true }).focus();
  const focus = await page.evaluate(() => getComputedStyle(document.activeElement).outlineWidth);
  assert.equal(focus, '3px');
  await capture('desktop', { width: 1440, height: 1000 });
  assert.ok(checks.at(-1).center > 720);
  await page.getByRole('button', { name: 'All projects', exact: true }).click();
  await capture('projects-desktop', { width: 1440, height: 1000 });
  await page.getByRole('region', { name: 'Project overview' }).getByRole('button', { name: 'Continue' }).click();
  assert.equal(await notes.inputValue(), 'Draft retained across overview and reload. Synthetic inspection only.');
  await capture('mobile', { width: 375, height: 812 });
  const nav = page.getByRole('navigation', { name: 'Main surfaces' });
  await nav.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('heading', { name: 'Your projects' }).waitFor({ state: 'visible' });
  await page.getByRole('region', { name: 'Project overview' }).getByRole('button', { name: 'Continue' }).click();
  await nav.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByLabel('Message to Nemo').waitFor({ state: 'visible' });
  await capture('manager-mobile', { width: 375, height: 812 });
  await page.getByRole('button', { name: 'Sources & privacy', exact: true }).click();
  await page.getByRole('button', { name: 'Revoke source' }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: 'Revoke source' }).isDisabled(), true);
  await capture('privacy-mobile', { width: 375, height: 812 });
  await capture('landscape', { width: 812, height: 375 });
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  await capture('large-text', { width: 375, height: 812 });
  await page.evaluate(() => document.documentElement.style.fontSize = '');
  await page.goto(`${origin}/__ui_empty`);
  await page.getByRole('heading', { name: 'Make room for your next project.' }).waitFor();
  await capture('welcome-desktop', { width: 1440, height: 1000 });
  await capture('welcome-mobile', { width: 375, height: 812 });
  await page.getByLabel('Project title', { exact: true }).fill('Synthetic first project');
  await page.getByLabel('Project brief', { exact: true }).fill('Only verify the first-use form.');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('heading', { name: 'Synthetic first project', exact: true }).waitFor();
  await page.getByText('Progress unknown', { exact: true }).waitFor();
  await writeFile(`${directory}/checks.json`, JSON.stringify({ round, evidence: 'Synthetic headless Edge only; isolated browser storage', origin, focus, checks, consoleErrors: errors, draftReloadAndOverview: 'preserved', firstProject: 'created through existing fixture API', privacyShortcut: 'opened; native actions disabled without bridge', native: 'NOT RUN', provider: 'NOT RUN', userVisualAcceptance: 'PENDING' }, null, 2));
  assert.deepEqual(errors, []);
  for (const result of checks) { assert.ok(result.width <= result.viewport, `${result.name}: horizontal overflow; see checks.json`); assert.deepEqual(result.smallTargets, [], `${result.name}: target height`); }
  console.log(`PASS ${round}: ${checks.length} captures, draft persistence, first project, privacy access, keyboard focus, 44px targets, responsive/reduced motion/200% text. ${directory}`);
} finally { await browser?.close(); await server.close(); }
