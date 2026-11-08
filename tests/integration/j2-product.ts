import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type { ElectronApplication } from '@playwright/test';
import type { Pool, PoolClient } from 'pg';
import { ChatMessageSchema, ManagerJobSchema, ProjectSchema, type Project } from '@living-playbooks/contracts';
import { Blocked, bounded } from './j1-safety'; // Never import j1-product or cloud test setup.
import { assertDatabaseIsolation, checkGuards, cloudEnvironment, configuration, JOB_MS,
  readUsage, sha256, STARTUP_MS, systemEnvironment, usageReceipt, type Configuration } from './j2-safety';

// Intentionally outside the automatic suite. --check-guards never enters runLive().
if (process.argv.includes('--check-guards')) {
  const checks = await checkGuards();
  console.log(JSON.stringify({ guardChecks: 'PASS', checks, J2: 'NOT_RUN' }));
} else if (process.argv.includes('--check-build')) {
  try { console.log(JSON.stringify({ buildChecks: 'PASS', J2: 'NOT_RUN', ...await assertBuiltCloud() })); }
  catch { console.log(JSON.stringify({ buildChecks: 'BLOCKED', J2: 'NOT_RUN' })); process.exitCode = 1; }
} else await runLive();

async function assertBuiltCloud() {
  const mapFile = resolve('apps/cloud/dist/main.js.map');
  const map = JSON.parse(await readFile(mapFile, 'utf8')) as { sources: string[]; sourcesContent: string[] };
  for (const file of ['packages/nemotron/src/adapter.ts', 'packages/nemotron/src/runner.ts',
    'apps/cloud/src/jobs/model-settings.ts', 'apps/cloud/src/main.ts']) {
    const index = map.sources.findIndex(source => resolve(dirname(mapFile), source) === resolve(file));
    assert(index >= 0); assert.equal(map.sourcesContent[index], await readFile(file, 'utf8'));
  }
  return { cloudBundleSha256: sha256(await readFile('apps/cloud/dist/main.js')),
    adapterSha256: sha256(await readFile('packages/nemotron/src/adapter.ts')) };
}

async function runLive() {
  const receipt: Record<string, unknown> = {};
  const ownerId = randomUUID();
  const title = `Synthetic J2 ${randomUUID()}`;
  const taskTitle = 'Prepare synthetic demonstration';
  const brief = `First call read_project_state. Create exactly one Todo task titled '${taskTitle}', requirementOrigin brief, evidenceLevel none and no evidence IDs. Create exactly one checklist panel referencing that task. Preserve the existing workspace identity. Return the required raw ManagerProposal using the supplied job/project/grant fences and a short reply. No questions, reminders, documents, decisions, completion claims or other tasks.`;
  const mainEntry = resolve('apps/desktop/dist/main/index.js');
  const rendererEntry = pathToFileURL(resolve('apps/web/dist/index.html')).href;
  let stage = 'preflight', failure: 'BLOCKED' | 'FAIL' | undefined;
  let config: Configuration | undefined, pool: Pool | undefined, lock: PoolClient | undefined;
  let cloud: ChildProcess | undefined, desktop: ElectronApplication | undefined, directory: string | undefined;
  let ownerGrantAttempted = false, startupAttempted = false, projectId: string | undefined;

  async function stopProcess(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (!child.pid) return; // A failed spawn has no process to stop.
    const exited = once(child, 'exit');
    await promisify(execFile)('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true, timeout: 5000, env: systemEnvironment(),
    }).catch(() => {});
    await bounded(exited, 5000);
  }
  async function closeDesktop() {
    if (!desktop) return;
    const current = desktop, child = current.process();
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
      assert(ids.length <= 1);
      if (projectId) assert.deepEqual(ids, [projectId]);
      await db.query('DELETE FROM checkin_presentations WHERE owner_id=$1', [ownerId]);
      await db.query('DELETE FROM command_receipts WHERE project_id=ANY($1::uuid[]) OR actor_id IN (SELECT device_id FROM credentials WHERE owner_id=$2)', [ids, ownerId]);
      await db.query('DELETE FROM events WHERE owner_id=$1', [ownerId]);
      for (const table of ['generated_dependencies', 'observations', 'messages', 'documents', 'jobs', 'checkins', 'source_bindings'])
        await db.query(`DELETE FROM ${table} WHERE project_id=ANY($1::uuid[])`, [ids]);
      await db.query('DELETE FROM projects WHERE owner_id=$1', [ownerId]);
      await db.query('DELETE FROM credentials WHERE owner_id=$1', [ownerId]);
      await db.query('DELETE FROM owners WHERE id=$1', [ownerId]);
      await db.query('COMMIT');
      assert.equal((await db.query('SELECT id FROM owners WHERE id=$1', [ownerId])).rowCount, 0);
      receipt.syntheticOwnerRemoved = true;
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  }
  async function removeProfile() {
    if (!directory) return;
    const parent = await realpath(tmpdir()), actual = await realpath(directory), child = relative(parent, actual);
    assert(child && !child.startsWith(`..${sep}`) && !child.includes(sep));
    assert(basename(actual).startsWith('lp-j2-product-'));
    assert.equal((await lstat(directory)).isSymbolicLink(), false);
    assert.equal(resolve(directory).toLowerCase(), actual.toLowerCase());
    await rm(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    receipt.isolatedProfileRemoved = true;
  }
  async function saved() {
    const rows = (await pool!.query('SELECT id,data FROM projects WHERE owner_id=$1', [ownerId])).rows;
    assert.equal(rows.length, 1);
    const project = ProjectSchema.parse(rows[0]!.data);
    assert.equal(project.id, rows[0]!.id); assert.equal(project.ownerId, ownerId);
    assert.equal(project.title, title); assert.equal(project.goal, brief);
    assert.equal(project.manager.projectId, project.id);
    if (projectId) assert.equal(project.id, projectId);
    return project;
  }
  async function ledger(beforeStartup = false) {
    return usageReceipt(await readUsage(pool!), config!, beforeStartup);
  }

  try {
    config = configuration(process.env, process.argv);
    if (process.platform !== 'win32') throw new Blocked('Actual Windows protected storage required');
    for (const file of [mainEntry, 'apps/desktop/dist/preload/workspace.cjs', 'apps/desktop/dist/preload/pet.cjs',
      'apps/cloud/dist/main.js', 'apps/cloud/dist/main.js.map', 'apps/web/dist/index.html']) await access(file);
    // Refuse a stale cloud build: qualification must be in the bundle, not just the source checkout.
    Object.assign(receipt, await assertBuiltCloud());

    stage = 'database-isolation';
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 5000,
      query_timeout: 5000, statement_timeout: 5000, idle_in_transaction_session_timeout: 10000 });
    pool.on('error', () => { receipt.databasePoolError = true; });
    lock = await pool.connect();
    // Cooperating J2 scripts cannot overlap. Refuse an existing dispatcher/session as well.
    const locked = (await lock.query('SELECT pg_try_advisory_lock(7317506) AS locked')).rows[0]?.locked;
    if (locked !== true) throw new Blocked('Another J2 acceptance run holds the database');
    if ((await lock.query('SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()')).rowCount)
      throw new Blocked('Exclusive J2 database already has another session');
    await assertDatabaseIsolation(lock, ownerId);
    receipt.usageBefore = usageReceipt(await readUsage(lock), config, true);
    // Parent has migrated already. This harness never creates, migrates, resets or drops a DB.
    const { issueGrant } = await import('../../apps/cloud/src/auth/credentials');
    ownerGrantAttempted = true;
    let grant = await issueGrant(pool, { ownerId, timezone: 'America/Chicago', reminders: false });
    assert.equal(grant.ownerId, ownerId); receipt.ownerId = ownerId;

    stage = 'cloud-start';
    const server = createServer();
    await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
    const address = server.address(); assert(address && typeof address !== 'string');
    await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
    const origin = `http://127.0.0.1:${address.port}`;
    // The model key goes only into this allowlisted child environment. Never log the environment.
    const cloudEnv = cloudEnvironment(config, origin, process.env);
    startupAttempted = true;
    cloud = spawn(process.execPath, [resolve('apps/cloud/dist/main.js')], { cwd: process.cwd(), windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'], env: cloudEnv });
    delete (cloudEnv as Partial<typeof cloudEnv>).NVIDIA_API_KEY;
    cloud.stderr!.resume();
    await new Promise<void>((done, reject) => {
      let tail = '';
      const timer = setTimeout(() => finish(new Error('Cloud startup bound')), STARTUP_MS);
      const finish = (error?: Error) => {
        clearTimeout(timer); cloud!.stdout!.removeListener('data', output);
        cloud!.removeListener('error', spawnError); cloud!.removeListener('exit', exited);
        error ? reject(error) : done();
      };
      const spawnError = () => finish(new Error('Cloud spawn failed'));
      const exited = () => finish(new Error('Cloud exited'));
      const output = (data: Buffer) => {
        tail = (tail + data.toString()).slice(-1024);
        if (tail.includes('cloud started. Nemotron capability: probe passed.')) finish();
        else if (tail.includes('cloud started. Nemotron capability: BLOCKED.')) finish(new Blocked('Production startup capability gate failed'));
      };
      cloud!.stdout!.on('data', output); cloud!.once('error', spawnError); cloud!.once('exit', exited);
    });
    cloud.stdout!.resume();
    assert.equal((await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(5000) })).status, 200);
    const startupUsage = await ledger();
    assert(startupUsage.calls >= 2 && startupUsage.calls <= 3);
    receipt.usageAfterStartup = startupUsage; receipt.productionStartupProbePassed = true;

    stage = 'isolated-native-launch';
    directory = await mkdtemp(join(await realpath(tmpdir()), 'lp-j2-product-'));
    const appData = join(directory, 'app-data'), sessionData = join(directory, 'session-data');
    await mkdir(appData); await mkdir(sessionData);
    const launcher = join(directory, 'launcher.mjs');
    await writeFile(launcher, `import { app } from 'electron';\napp.setPath('appData', ${JSON.stringify(appData)});\napp.setPath('sessionData', ${JSON.stringify(sessionData)});\nawait import(${JSON.stringify(pathToFileURL(mainEntry).href)});\n`);
    const { _electron, expect } = await import('@playwright/test');
    desktop = await _electron.launch({ args: [launcher], cwd: process.cwd(), timeout: 20000,
      env: { ...systemEnvironment(), LP_API_ORIGIN: origin } });
    assert(await bounded(desktop.evaluate(({ app }, paths) => app.getPath('appData') === paths.appData &&
      app.getPath('userData') === paths.userData && app.getPath('sessionData') === paths.sessionData,
      { appData, userData: join(appData, 'LivingPlaybooks'), sessionData })));
    receipt.actualMainProfileIsolated = true;
    if (!await bounded(desktop.evaluate(async ({ safeStorage }) => safeStorage.isAsyncEncryptionAvailable())))
      throw new Blocked('Actual Windows safeStorage unavailable');
    receipt.nativeProtectedStorageAvailable = true;
    const page = desktop.windows().find(page => page.url() === rendererEntry) ??
      await desktop.waitForEvent('window', { predicate: page => page.url() === rendererEntry, timeout: 10000 });
    assert.equal(page.url(), rendererEntry); page.setDefaultTimeout(10000);
    stage = 'trusted-ui-pairing';
    await expect(page.getByRole('heading', { name: 'Pair this desktop' })).toBeVisible();
    await page.getByLabel('Pairing code', { exact: true }).fill(grant.code);
    grant = { ...grant, code: '' };
    await page.getByLabel('Device name', { exact: true }).fill('Synthetic J2 isolated desktop');
    await page.getByRole('button', { name: 'Pair desktop', exact: true }).click();
    await expect(page.getByLabel('Project title', { exact: true })).toBeEnabled({ timeout: 15000 });
    assert((await stat(join(appData, 'LivingPlaybooks', 'device.protected'))).size > 0);
    const credentials = (await pool.query('SELECT kind,consumed_at IS NOT NULL AS consumed FROM credentials WHERE owner_id=$1', [ownerId])).rows;
    assert.equal(credentials.filter(row => row.kind === 'access').length, 1);
    assert.equal(credentials.filter(row => row.kind === 'pairing' && row.consumed).length, 1);
    receipt.trustedUiPairing = true;

    stage = 'ui-create';
    await page.getByLabel('Project title', { exact: true }).fill(title);
    await page.getByLabel('Project brief', { exact: true }).fill(brief);
    await page.getByRole('button', { name: 'Create project', exact: true }).click();
    // Capture the canonical empty identity before the worker's proposal, without seeding any state.
    await expect.poll(async () => (await pool!.query('SELECT id FROM projects WHERE owner_id=$1', [ownerId])).rowCount,
      { timeout: 10000 }).toBe(1);
    const initial = await saved(); projectId = initial.id;
    assert.equal(initial.revision, 0); assert.equal(initial.workspace.revision, 0);
    assert.equal(initial.tasks.length, 0); assert.equal(initial.workspace.panels.length, 0);
    receipt.projectId = projectId; receipt.managerId = initial.manager.id; receipt.workspaceId = initial.workspace.id;

    stage = 'initial-plan-worker';
    const deadline = Date.now() + JOB_MS;
    let completedJob: ReturnType<typeof ManagerJobSchema.parse> | undefined;
    let toolReceipts: { name: string; resultDigest: string; references: string[]; durationMs: number }[] = [];
    while (Date.now() < deadline) {
      const jobs: { id: string; data: unknown; state: string; tool_receipts: typeof toolReceipts }[] =
        (await pool.query('SELECT id,data,state,tool_receipts FROM jobs WHERE project_id=$1', [projectId])).rows;
      assert.equal(jobs.length, 1);
      const row = jobs[0]!, job = ManagerJobSchema.parse(row.data);
      assert.equal(job.id, row.id); assert.equal(job.kind, 'initial_plan'); assert.equal(job.projectId, projectId);
      assert.equal(job.inputMessageId, null); assert.equal(job.state, row.state);
      assert(job.tries <= 1); assert.equal(job.errorClass, null); // Stop before a queued retry can spend again.
      assert(['queued', 'running', 'completed'].includes(job.state));
      if (job.state === 'completed') { completedJob = job; toolReceipts = row.tool_receipts; break; }
      await new Promise(done => setTimeout(done, 500));
    }
    assert(completedJob); assert.equal(completedJob.tries, 1);
    assert(completedJob.modelCalls >= 2 && completedJob.modelCalls <= 4);
    assert(completedJob.toolCalls >= 1 && completedJob.toolCalls <= 6);
    assert(Array.isArray(toolReceipts)); assert.equal(toolReceipts.length, completedJob.toolCalls);
    assert(toolReceipts.some(tool => tool.name === 'read_project_state' && /^[a-f0-9]{64}$/.test(tool.resultDigest) &&
      tool.references.length === 0 && Number.isSafeInteger(tool.durationMs) && tool.durationMs >= 0));
    receipt.jobId = completedJob.id; receipt.modelCalls = completedJob.modelCalls; receipt.toolReceiptCount = toolReceipts.length;
    const planned = await saved();
    assert.deepEqual(planned.manager, initial.manager); assert.equal(planned.workspace.id, initial.workspace.id);
    assert(planned.revision > initial.revision); assert(planned.workspace.revision > initial.workspace.revision);
    assert.equal(planned.tasks.length, 1); assert.equal(planned.workspace.panels.length, 1);
    assert.equal(planned.decisions.length, 0); assert.equal(planned.phase, 'planning'); assert.equal(planned.status, 'active');
    const task = planned.tasks[0]!, panel = planned.workspace.panels[0]!;
    assert.equal(task.title, taskTitle); assert.equal(task.status, 'todo'); assert.equal(task.revision, 0);
    assert.equal(task.ownerOverride, false); assert.equal(task.requirementOrigin, 'brief');
    assert.equal(task.evidenceLevel, 'none'); assert.deepEqual(task.evidenceIds, []);
    assert.equal(panel.type, 'checklist'); assert('taskIds' in panel); assert.deepEqual(panel.taskIds, [task.id]);
    const messages = (await pool.query('SELECT id,data FROM messages WHERE project_id=$1', [projectId])).rows;
    assert.equal(messages.length, 1);
    const reply = ChatMessageSchema.parse(messages[0]!.data);
    assert.equal(reply.id, messages[0]!.id); assert.equal(reply.role, 'manager');
    assert.equal(reply.jobId, completedJob.id); assert.equal(reply.projectId, projectId); assert.deepEqual(reply.observationIds, []);
    receipt.taskId = task.id; receipt.checklistId = panel.id; receipt.replyId = reply.id;
    const generatedUsage = await ledger();
    assert.equal(generatedUsage.calls, startupUsage.calls + completedJob.modelCalls);
    assert(generatedUsage.calls <= 7); receipt.usageAfterJob = generatedUsage;

    stage = 'generated-ui';
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page.getByText('Nemotron available', { exact: true })).toBeVisible();
    await expect(page.getByText('Cloud snapshot current', { exact: true })).toBeVisible();
    await expect(page.getByText(/Fixture mode|Demo reminder timing|Layout rejected/)).toHaveCount(0);
    await expect(page.getByText('No source linked', { exact: false })).toBeVisible();
    const arrangement = page.getByRole('button', { name: 'Apply workspace arrangement', exact: true });
    const status = page.getByLabel(`Status: ${taskTitle}`, { exact: true });
    // Refresh is asynchronous. Wait for the generated state before deciding whether to apply it.
    await expect(status.or(arrangement).first()).toBeVisible();
    if (await arrangement.isVisible()) await arrangement.click();
    const item = page.locator(`#task-${task.id}`);
    await expect(status).toHaveValue('todo');
    await expect(item.getByText('Owner correction', { exact: false })).toHaveCount(0);
    await expect(page.locator(`[data-panel-type="checklist"]`).filter({ has: status })).toHaveCount(1);
    await expect(page.getByRole('log', { name: 'Selected manager conversation' }).locator('article')).toHaveCount(1);
    await expect(page.getByRole('log', { name: 'Selected manager conversation' }).locator('article p')).toHaveText(reply.text);
    receipt.generatedTaskChecklistAndReplyRendered = true;

    stage = 'ui-owner-correction';
    await expect(status).toBeEnabled(); await status.selectOption('in_progress');
    await expect.poll(async () => (await saved()).tasks[0]?.status, { timeout: 10000 }).toBe('in_progress');
    const corrected = await saved();
    const assertCorrection = (project: Project) => {
      assert.equal(project.id, initial.id); assert.deepEqual(project.manager, initial.manager);
      assert.deepEqual(project.workspace, planned.workspace); assert.equal(project.tasks.length, 1);
      assert.equal(project.tasks[0]!.id, task.id); assert.equal(project.tasks[0]!.title, taskTitle);
      assert.equal(project.tasks[0]!.status, 'in_progress'); assert.equal(project.tasks[0]!.revision, task.revision + 1);
      assert.equal(project.tasks[0]!.ownerOverride, true); assert.equal(project.tasks[0]!.requirementOrigin, 'brief');
      assert.equal(project.tasks[0]!.evidenceLevel, 'none'); assert.deepEqual(project.tasks[0]!.evidenceIds, []);
      assert.equal(project.revision, planned.revision + 1); assert.equal(project.decisions.length, 1);
      assert.equal(project.decisions[0]!.origin, 'owner'); assert.deepEqual(project.decisions[0]!.observationIds, []);
      assert.equal(project.decisions[0]!.text, `Owner updated task ${task.id} to in_progress.`);
    };
    assertCorrection(corrected);
    await expect(status).toHaveValue('in_progress');
    await expect(item.getByText(/Owner correction/)).toBeVisible();
    receipt.ownerDecisionId = corrected.decisions[0]!.id; receipt.uiOwnerCorrectionSaved = true;

    stage = 'renderer-reload';
    await page.reload();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible({ timeout: 15000 });
    await expect(status).toHaveValue('in_progress'); await expect(item.getByText(/Owner correction/)).toBeVisible();
    await expect(page.getByRole('log', { name: 'Selected manager conversation' }).locator('article p')).toHaveText(reply.text);
    const reloaded = await saved(); assertCorrection(reloaded); assert.deepEqual(reloaded, corrected);
    assert.deepEqual((await pool.query('SELECT id,data FROM messages WHERE project_id=$1', [projectId])).rows, messages);
    assert.equal((await pool.query('SELECT id FROM jobs WHERE project_id=$1', [projectId])).rowCount, 1);
    assert.deepEqual(await ledger(), generatedUsage);
    receipt.sameIdentitiesOwnerDecisionAndCorrectionSurviveReload = true;

    stage = 'off-gates';
    assert.equal((await pool.query('SELECT reminders FROM owners WHERE id=$1', [ownerId])).rows[0]?.reminders, false);
    for (const table of ['source_bindings', 'observations', 'checkins', 'documents', 'generated_dependencies'])
      assert.equal((await pool.query(`SELECT 1 FROM ${table} WHERE project_id=$1`, [projectId])).rowCount, 0);
    const journalText = await readFile(join(appData, 'LivingPlaybooks', 'journal.json'), 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    });
    if (journalText !== undefined) {
      const journal = JSON.parse(journalText) as { data: { entries: unknown[]; uploads: unknown[]; sourceCommands: unknown[] } };
      assert.equal(journal.data.entries.length, 0); assert.equal(journal.data.uploads.length, 0); assert.equal(journal.data.sourceCommands.length, 0);
    }
    receipt.sourcesRemindersAndAdditionalJobsOff = true; stage = 'complete';
  } catch (error) {
    failure = error instanceof Blocked ? 'BLOCKED' : 'FAIL';
    receipt.assertionFailed = error instanceof Error && error.name === 'AssertionError';
  } finally {
    const failedStage = stage;
    let stopped = true;
    // Stop the dispatcher first, so a failed job never waits through its provider retry delay.
    for (const stop of [async () => { if (cloud) await stopProcess(cloud); }, () => closeDesktop()]) {
      try { await stop(); } catch { stopped = false; receipt.childCleanupFailed = true; }
    }
    receipt.ownedProcessesStopped = stopped;
    if (pool && startupAttempted) {
      try {
        const rows = await readUsage(pool);
        receipt.usageFinal = usageReceipt(rows, config!, rows.length === 0);
      } catch { receipt.usageInspectionFailed = true; failure = 'FAIL'; }
    }
    if (stopped) {
      try {
        const before = pool && startupAttempted ? await readUsage(pool) : undefined;
        await cleanupOwner();
        if (before) { assert.deepEqual(await readUsage(pool!), before); receipt.chargedLedgerPreserved = true; }
      } catch { receipt.databaseCleanupFailed = true; failure = 'FAIL'; }
      try { await removeProfile(); } catch { receipt.profileCleanupFailed = true; failure = 'FAIL'; }
    } else failure = 'FAIL';
    lock?.release();
    if (pool) { try { await bounded(pool.end()); } catch { receipt.poolCloseFailed = true; failure = 'FAIL'; } }
    // Never print an exception, provider body, model reply, brief, pairing code, trace or screenshot.
    console.log(JSON.stringify({ journey: 'J2', result: failure ?? 'PASS', stage: failedStage, ...receipt }));
    process.exitCode = failure === 'BLOCKED' ? 2 : failure ? 1 : 0;
  }
}
