import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { _electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { Pool } from 'pg';
import { issueGrant } from '../../apps/cloud/src/auth/credentials';
import type { Project } from '@living-playbooks/contracts';
import { assertSchedulerIsolation, Blocked, bounded } from './j1-safety';

// Catches broken trusted pairing, saved snapshot rendering, owner writes and native credential recovery.
// Run only after the parent releases the dedicated DB; never import cloud/helpers (it truncates).
const receipt: Record<string, boolean | string> = {};
let stage = 'preflight';
let pool: Pool | undefined;
let cloud: ChildProcess | undefined;
let desktop: ElectronApplication | undefined;
let directory: string | undefined;
let failure: 'BLOCKED' | 'FAIL' | undefined;
let ownerGrantAttempted = false;
const ownerId = randomUUID();
const title = `Synthetic J1 ${randomUUID()}`;
const brief = 'Build a harmless local acceptance demonstration. No source history or model access.';
const mainEntry = resolve('apps/desktop/dist/main/index.js');
const rendererEntry = pathToFileURL(resolve('apps/web/dist/index.html')).href;

function systemEnvironment(): Record<string, string> {
  // No inherited model keys, renderer override, temporary pairing or selected source identity.
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined &&
    /^(path|systemroot|windir|comspec|temp|tmp|userprofile|localappdata|appdata|programdata|programfiles|programfiles\(x86\)|systemdrive|username|userdomain)$/i.test(key))) as Record<string, string>;
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  return address.port;
}
async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  assert(child.pid);
  const exited = once(child, 'exit');
  // Windows needs the exact owned process tree, including Chromium children.
  await promisify(execFile)('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, timeout: 5000 }).catch(() => {});
  await bounded(exited, 5000);
}
async function closeDesktop() {
  if (!desktop) return;
  const current = desktop;
  // Playwright disposes the process lookup when close() resolves; retain the owned handle first.
  const child = current.process();
  try { await bounded(current.close()); }
  catch { receipt.nativeCloseRequiredFallback = true; }
  finally { await stopProcess(child); }
  desktop = undefined;
}
async function cleanupOwner() {
  if (!pool || !ownerGrantAttempted) return;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [ownerId]);
    const ids = (await db.query('SELECT id FROM projects WHERE owner_id=$1', [ownerId])).rows.map(row => row.id as string);
    await db.query('DELETE FROM checkin_presentations WHERE owner_id=$1', [ownerId]);
    await db.query('DELETE FROM command_receipts WHERE project_id=ANY($1::uuid[]) OR actor_id IN (SELECT device_id FROM credentials WHERE owner_id=$2)', [ids, ownerId]);
    await db.query('DELETE FROM events WHERE owner_id=$1', [ownerId]);
    // All table names are fixed test code; every content delete is scoped to this owner's exact project IDs.
    for (const table of ['generated_dependencies', 'observations', 'messages', 'documents', 'jobs', 'checkins', 'source_bindings'])
      await db.query(`DELETE FROM ${table} WHERE project_id=ANY($1::uuid[])`, [ids]);
    await db.query('DELETE FROM projects WHERE owner_id=$1', [ownerId]);
    await db.query('DELETE FROM credentials WHERE owner_id=$1', [ownerId]);
    await db.query('DELETE FROM owners WHERE id=$1', [ownerId]);
    await db.query('COMMIT');
    assert.equal((await pool.query('SELECT id FROM owners WHERE id=$1', [ownerId])).rowCount, 0);
    receipt.syntheticOwnerRemoved = true;
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
async function removeProfile() {
  if (!directory) return;
  const parent = await realpath(tmpdir());
  const actual = await realpath(directory);
  const child = relative(parent, actual);
  assert(child && !child.startsWith(`..${sep}`) && !child.includes(sep));
  assert(basename(actual).startsWith('lp-j1-product-'));
  assert.equal((await lstat(directory)).isSymbolicLink(), false);
  assert.equal(resolve(directory).toLowerCase(), actual.toLowerCase());
  await rm(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  receipt.isolatedProfileRemoved = true;
}

try {
  if (!process.argv.includes('--db-released')) throw new Blocked('Explicit DB resource release required');
  if (process.platform !== 'win32') throw new Blocked('Windows native storage required');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/playbooks_test' || url.username !== 'playbooks')
    throw new Blocked('Dedicated local test DB required');
  for (const file of [mainEntry, 'apps/desktop/dist/preload/workspace.cjs', 'apps/desktop/dist/preload/pet.cjs', 'apps/cloud/dist/main.js', 'apps/web/dist/index.html']) await access(file);

  stage = 'database';
  pool = new Pool({ connectionString: url.href, max: 2, connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000 });
  pool.on('error', () => { receipt.databasePoolError = true; });
  stage = 'database-isolation';
  await assertSchedulerIsolation(pool, ownerId);
  // The parent has already migrated. migrate() updates legacy owner defaults globally, so do not run it here.
  ownerGrantAttempted = true;
  let grant = await issueGrant(pool, { ownerId, timezone: 'America/Chicago', reminders: false });
  const modelUsageBefore = (await pool.query('SELECT calls,reserved_tokens FROM model_usage')).rows;
  receipt.uniqueSyntheticOwner = grant.ownerId === ownerId;
  assert(receipt.uniqueSyntheticOwner);

  stage = 'cloud-start';
  const origin = `http://127.0.0.1:${await freePort()}`;
  cloud = spawn(process.execPath, [resolve('apps/cloud/dist/main.js')], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...systemEnvironment(), DATABASE_URL: url.href, PUBLIC_ORIGIN: origin, PORT: new URL(origin).port, LP_MODEL_LIVE_OPT_IN: 'false', LP_DEMO_TIMING: 'false' },
  });
  cloud.stderr!.resume(); // Never retain or print raw child logs.
  await new Promise<void>((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Cloud startup exceeded bound')), 10000);
    const finish = (error?: Error) => { clearTimeout(timer); cloud!.stdout!.removeListener('data', output); error ? reject(error) : done(); };
    const output = (data: Buffer) => { if (data.toString().includes('cloud started.')) finish(); };
    cloud!.stdout!.on('data', output);
    cloud!.once('error', () => finish(new Error('Cloud spawn failed')));
    cloud!.once('exit', () => finish(new Error('Cloud exited')));
  });
  cloud.stdout!.resume();
  assert.equal((await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(5000) })).status, 200);
  receipt.productionCloudReady = true;

  stage = 'isolated-launcher';
  directory = await mkdtemp(join(await realpath(tmpdir()), 'lp-j1-product-'));
  const appData = join(directory, 'app-data'), sessionData = join(directory, 'session-data');
  await mkdir(appData); await mkdir(sessionData);
  const launcher = join(directory, 'launcher.mjs');
  await writeFile(launcher, `import { app } from 'electron';\napp.setPath('appData', ${JSON.stringify(appData)});\napp.setPath('sessionData', ${JSON.stringify(sessionData)});\nawait import(${JSON.stringify(pathToFileURL(mainEntry).href)});\n`);
  async function launch(): Promise<Page> {
    desktop = await _electron.launch({ args: [launcher], cwd: process.cwd(), timeout: 20000,
      env: { ...systemEnvironment(), LP_API_ORIGIN: origin } });
    const isolated = await bounded(desktop.evaluate(({ app }, paths) => app.getPath('appData') === paths.appData &&
      app.getPath('userData') === paths.userData && app.getPath('sessionData') === paths.sessionData,
      { appData, userData: join(appData, 'LivingPlaybooks'), sessionData }));
    assert(isolated); receipt.actualMainProfileIsolated = true;
    const workspace = desktop.windows().find(page => page.url() === rendererEntry) ??
      await desktop.waitForEvent('window', { predicate: page => page.url() === rendererEntry, timeout: 10000 });
    assert(workspace); workspace.setDefaultTimeout(10000);
    assert.equal(workspace.url(), rendererEntry);
    return workspace;
  }
  async function rendered(page: Page, phase: string) {
    const checkpoint = stage;
    stage = `${checkpoint}:title`;
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 15000 });
    stage = `${checkpoint}:brief`;
    await expect(page.locator('.project-heading > p')).toHaveText(brief);
    stage = `${checkpoint}:phase`;
    await expect(page.getByLabel(/^Phase/)).toHaveValue(phase);
    stage = `${checkpoint}:inference-blocked`;
    await expect(page.getByText(/Nemotron unavailable/)).toBeVisible();
    stage = `${checkpoint}:send-disabled`;
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    stage = `${checkpoint}:source-off`;
    await expect(page.getByText('No source linked', { exact: false })).toBeVisible();
    stage = `${checkpoint}:fixture-off`;
    await expect(page.getByText(/Fixture mode/)).toHaveCount(0);
    stage = `${checkpoint}:snapshot-current`;
    await expect(page.getByText('Cloud snapshot current', { exact: true })).toBeVisible();
    stage = checkpoint;
  }
  async function saved(phase: string) {
    const rows = (await pool!.query('SELECT id,data FROM projects WHERE owner_id=$1', [ownerId])).rows;
    assert.equal(rows.length, 1);
    const project = rows[0]!.data as Project;
    assert.equal(project.title, title); assert.equal(project.goal, brief); assert.equal(project.phase, phase);
    assert.equal(project.tasks.length, 0); assert.equal(project.workspace.panels.length, 0);
    return { id: rows[0]!.id as string, revision: project.revision };
  }

  stage = 'native-storage';
  let page = await launch();
  if (!await bounded(desktop!.evaluate(async ({ safeStorage }) => safeStorage.isAsyncEncryptionAvailable())))
    throw new Blocked('Actual Windows safeStorage unavailable');
  receipt.nativeProtectedStorageAvailable = true;

  stage = 'trusted-ui-pairing';
  await expect(page.getByRole('heading', { name: 'Pair this desktop' })).toBeVisible();
  // No traces, screenshots or raw errors: Playwright fill errors may otherwise echo this in-memory secret.
  await page.getByLabel('Pairing code', { exact: true }).fill(grant.code);
  grant = { ...grant, code: '' };
  await page.getByLabel('Device name', { exact: true }).fill('Synthetic J1 isolated desktop');
  await page.getByRole('button', { name: 'Pair desktop', exact: true }).click();
  await expect(page.getByLabel('Project title', { exact: true })).toBeEnabled({ timeout: 15000 });
  assert((await stat(join(appData, 'LivingPlaybooks', 'device.protected'))).size > 0);
  const credentials = (await pool.query("SELECT kind,consumed_at IS NOT NULL AS consumed FROM credentials WHERE owner_id=$1", [ownerId])).rows;
  assert.equal(credentials.filter(row => row.kind === 'access').length, 1);
  assert.equal(credentials.filter(row => row.kind === 'pairing' && row.consumed).length, 1);
  receipt.trustedUiPairing = true;

  stage = 'ui-project-create';
  await page.getByLabel('Project title', { exact: true }).fill(title);
  stage = 'ui-project-brief';
  await page.getByLabel('Project brief', { exact: true }).fill(brief);
  stage = 'ui-project-submit';
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  stage = 'ui-project-render';
  await rendered(page, 'planning');
  const initial = await saved('planning');
  receipt.uiCreateMatchesSavedSnapshot = true;

  stage = 'ui-owner-change';
  await expect(page.getByLabel(/^Phase/)).toBeEnabled();
  await page.getByLabel(/^Phase/).selectOption('building');
  await expect.poll(async () => (await pool!.query("SELECT data->>'phase' AS phase FROM projects WHERE owner_id=$1", [ownerId])).rows[0]?.phase,
    { timeout: 10000 }).toBe('building');
  assert((await saved('building')).revision > initial.revision);
  await rendered(page, 'building');
  receipt.uiOwnerChangeSaved = true;

  stage = 'renderer-reload';
  await page.reload();
  await rendered(page, 'building'); await saved('building');
  receipt.rendererReloadReadsSavedState = true;

  stage = 'full-native-restart';
  const previousPid = desktop!.process().pid;
  await closeDesktop();
  page = await launch();
  assert.notEqual(desktop!.process().pid, previousPid);
  await rendered(page, 'building'); await saved('building');
  await expect(page.getByRole('heading', { name: 'Pair this desktop' })).toHaveCount(0);
  assert.equal((await pool.query("SELECT id FROM credentials WHERE owner_id=$1 AND kind='access'", [ownerId])).rowCount, 1);
  receipt.fullProcessRestartRestoresProtectedCredentialAndSavedState = true;

  stage = 'off-gates';
  assert.equal((await pool.query('SELECT reminders FROM owners WHERE id=$1', [ownerId])).rows[0]!.reminders, false);
  for (const table of ['source_bindings', 'observations', 'checkins'])
    assert.equal((await pool.query(`SELECT id FROM ${table} WHERE project_id=$1`, [initial.id])).rowCount, 0);
  assert.deepEqual((await pool.query('SELECT calls,reserved_tokens FROM model_usage')).rows, modelUsageBefore);
  // A source-free profile need not have written a journal yet. If present, it must contain no sharing state.
  const journalText = await readFile(join(appData, 'LivingPlaybooks', 'journal.json'), 'utf8').catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  });
  if (journalText !== undefined) {
    const journal = JSON.parse(journalText) as { data: { entries: unknown[]; uploads: unknown[]; sourceCommands: unknown[] } };
    assert.equal(journal.data.entries.length, 0); assert.equal(journal.data.uploads.length, 0); assert.equal(journal.data.sourceCommands.length, 0);
  }
  receipt.modelExportRemindersOff = true;
  stage = 'complete';
} catch (error) {
  failure = error instanceof Blocked ? 'BLOCKED' : 'FAIL';
  receipt.assertionFailed = error instanceof Error && error.name === 'AssertionError';
} finally {
  const failedStage = stage;
  let stopped = true;
  for (const stop of [() => closeDesktop(), async () => { if (cloud) await stopProcess(cloud); }]) {
    try { await stop(); } catch { stopped = false; receipt.childCleanupFailed = true; }
  }
  receipt.ownedProcessesStopped = stopped;
  try { await cleanupOwner(); } catch { receipt.databaseCleanupFailed = true; failure = 'FAIL'; }
  if (pool) await pool.end();
  if (stopped) { try { await removeProfile(); } catch { receipt.profileCleanupFailed = true; failure = 'FAIL'; } }
  else failure = 'FAIL';
  console.log(JSON.stringify({ result: failure ?? 'PASS', stage: failedStage, ...receipt }));
  process.exitCode = failure === 'BLOCKED' ? 2 : failure ? 1 : 0;
}
