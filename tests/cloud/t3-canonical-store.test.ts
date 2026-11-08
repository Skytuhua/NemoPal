import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { migrate } from '../../apps/cloud/src/db/migrate';
import { authenticate, issueGrant, redeem } from '../../apps/cloud/src/auth/credentials';
import { Store } from '../../apps/cloud/src/domain/store';
import { CanonicalT3Store } from '../../apps/cloud/src/integrations/t3/canonical-store';
import { bindingKey } from '../../apps/cloud/src/integrations/t3/observer';

const url = process.env.T3_DISPOSABLE_TEST_DATABASE_URL;
if (url) { const parsed = new URL(url); if (parsed.hostname !== '127.0.0.1' || !parsed.port || parsed.pathname !== '/nemo_t3_disposable') throw new Error('Expected a test-owned disposable local database.'); }
const pool = new Pool({ connectionString: url });
describe.skipIf(!url)('canonical T3 store on disposable PostgreSQL', () => {
const now = new Date('2026-11-08T04:00:00Z');
let principal: Awaited<ReturnType<typeof authenticate>>;
let projectId: string, bindingId: string, taskId: string;
let store: CanonicalT3Store;
const cmd = <T>(input: T, expectedRevision?: number) => ({ operationId: randomUUID(), input, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
beforeAll(async () => { await migrate(pool); });
beforeEach(async () => {
  const grant = await issueGrant(pool, { timezone: 'UTC' }, now);
  const auth = await redeem(pool, grant.code, now);
  principal = await authenticate(pool, `Bearer ${auth.token}`, now);
  const domain = new Store(pool, () => now);
  await domain.createProject(principal, '/test/create', cmd({ title: 'Synthetic', brief: 'Synthetic project' }));
  projectId = (await pool.query('SELECT id FROM projects WHERE owner_id=$1', [principal.ownerId])).rows[0].id;
  taskId = randomUUID();
  await pool.query("UPDATE projects SET data=jsonb_set(data, '{tasks}', $2::jsonb) WHERE id=$1", [projectId, JSON.stringify([{ id: taskId, title: 'Task', status: 'todo', revision: 0, requirementOrigin: 'brief', evidenceLevel: 'none', evidenceIds: [], ownerOverride: false }])]);
  const enrolled = await domain.enroll(principal, '/test/enroll', projectId, { ...cmd({ sourceKey: 'synthetic', adapterId: 't3', adapterVersion: '1', capability: 'incremental_history', exportPolicy: 'metadata_only' } as const), expectedRevision: 0 });
  bindingId = enrolled.result.id;
  store = new CanonicalT3Store(pool, principal, () => now);
});
afterAll(async () => { await pool.end(); });

function selected() { return { ownerId: principal.ownerId, deviceId: principal.deviceId, projectId, bindingId }; }
function input() { return { sourceGrantRevision: 0, expectedT3GrantRevision: 0, expectedMappingRevision: 0, taskId, taskRevision: 0, environmentId: 'env', t3ProjectId: 'local-project', threadId: 'thread', startPosition: 0, runId: 'run', runOrdinal: 1, expiresAt: now.getTime() + 60000, localReadConsented: true as const }; }
function observed(context: Awaited<ReturnType<CanonicalT3Store['enroll']>>) { return { bindingKey: bindingKey(context), mode: 'current' as const, label: 'T3 running', cursor: 1, lastSeenAt: now.getTime(), threadUpdatedAt: now.toISOString(), runId: 'run', runOrdinal: 1, status: 'running', runStatus: 'running', items: [], hasMore: false }; }

it('binds explicit consent and revision-zero task to canonical authority and fences late writes after pause', async () => {
  const selection = selected();
  await store.enroll(selection, input());
  const { context } = await store.load(selection);
  expect(context.mapping.taskRevision).toBe(0);
  expect(context.grant.revision).toBe(1);
  const observation = observed(context);
  expect(await store.commitIfCurrent(context, observation)).toBe(true);
  expect((await store.load(selection)).checkpoint?.cursor).toBe(1);
  const domain = new Store(pool, () => now);
  await domain.sourceCommand(principal, '/test/pause', bindingId, cmd({ state: 'paused', grantRevision: 0 }), 'state');
  expect(await store.commitIfCurrent(context, observation)).toBe(false);
  await expect(store.load(selection)).rejects.toThrow();
});

it('rejects mismatched device, stale task or source revision, missing consent and unbounded expiry', async () => {
  await expect(store.enroll({ ...selected(), deviceId: randomUUID() }, input())).rejects.toThrow();
  await expect(store.enroll(selected(), { ...input(), taskRevision: 1 })).rejects.toThrow();
  await expect(store.enroll(selected(), { ...input(), sourceGrantRevision: 1 })).rejects.toThrow();
  await expect(store.enroll(selected(), { ...input(), localReadConsented: false } as never)).rejects.toThrow();
  await expect(store.enroll(selected(), { ...input(), expiresAt: now.getTime() + 86400001 })).rejects.toThrow();
  await expect(store.load(selected())).rejects.toThrow();
});

it('remaps with separate increasing revisions and strips untrusted prose from checkpoints', async () => {
  const first = await store.enroll(selected(), input());
  const next = await store.enroll(selected(), { ...input(), expectedT3GrantRevision: 1, expectedMappingRevision: 1, runId: 'other-run' });
  expect(next.grant.revision).toBe(2); expect(next.mapping.mappingRevision).toBe(2);
  await expect(store.enroll(selected(), { ...input(), expectedT3GrantRevision: 1, expectedMappingRevision: 1 })).rejects.toThrow();
  expect(await store.commitIfCurrent(first, observed(first))).toBe(false);
  const observation = { ...observed(next), runId: 'other-run', label: 'private prose', items: [{ itemId: 'item', position: 1, runId: 'other-run', sourceThreadId: 'thread', visibility: 'local' as const, status: 'running' as const, updatedAt: now.toISOString(), text: 'private transcript' }] };
  expect(await store.commitIfCurrent(next, observation)).toBe(true);
  const stored = JSON.stringify((await store.load(selected())).checkpoint);
  expect(stored).not.toContain('private');
});

it('serializes checkpoint writes with a task edit holding the canonical project lock', async () => {
  const context = await store.enroll(selected(), input());
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
    const pending = store.commitIfCurrent(context, observed(context));
    await client.query("UPDATE projects SET data=jsonb_set(data, '{tasks,0,revision}', '1'::jsonb) WHERE id=$1", [projectId]);
    await client.query('COMMIT');
    expect(await pending).toBe(false);
    expect((await pool.query('SELECT checkpoint FROM t3_enrollments WHERE binding_id=$1', [bindingId])).rows[0].checkpoint).toBeNull();
  } finally { await client.query('ROLLBACK'); client.release(); }
});

it('revokes canonical source and clears checkpoint, rejecting late writes and reauthorization after device revocation', async () => {
  const context = await store.enroll(selected(), input());
  await store.commitIfCurrent(context, observed(context));
  const evidenceId = randomUUID();
  await pool.query('INSERT INTO observations(id,project_id,binding_id,source_item,source_revision,data) VALUES($1,$2,$3,$4,$5,$6)', [evidenceId, projectId, bindingId, 'item', 'revision', { excerpt: 'synthetic evidence' }]);
  await store.revoke(selected(), context);
  const row = (await pool.query('SELECT s.data,e.revoked,e.checkpoint FROM source_bindings s JOIN t3_enrollments e ON e.binding_id=s.id WHERE s.id=$1', [bindingId])).rows[0];
  expect(row.data.state).toBe('revoked'); expect(row.data.grantRevision).toBe(1); expect(row.revoked).toBe(true); expect(row.checkpoint).toBeNull();
  expect((await pool.query('SELECT data FROM observations WHERE id=$1', [evidenceId])).rows[0].data).toBeNull();
  expect(await store.commitIfCurrent(context, observed(context))).toBe(false);
  await pool.query('UPDATE credentials SET revoked_at=$2 WHERE id=$1', [principal.credentialId, now]);
  await expect(store.enroll(selected(), input())).rejects.toThrow();
});

it('clears checkpoints when canonical source revocation occurs outside the service', async () => {
  const context = await store.enroll(selected(), input());
  await store.commitIfCurrent(context, observed(context));
  const domain = new Store(pool, () => now);
  await domain.sourceCommand(principal, '/test/revoke', bindingId, cmd({ grantRevision: 0, removeExcerpts: true }), 'revoke');
  const row = (await pool.query('SELECT revoked,consent,checkpoint FROM t3_enrollments WHERE binding_id=$1', [bindingId])).rows[0];
  expect(row).toEqual({ revoked: true, consent: false, checkpoint: null });
  expect(await store.commitIfCurrent(context, observed(context))).toBe(false);
});

it('rejects expired authority and project changes on both load and checkpoint commit', async () => {
  const context = await store.enroll(selected(), input());
  const expiredStore = new CanonicalT3Store(pool, principal, () => new Date(now.getTime() + 60000));
  await expect(expiredStore.load(selected())).rejects.toThrow();
  expect(await expiredStore.revisions(selected())).toEqual({ t3GrantRevision: 1, mappingRevision: 1 });
  expect(await expiredStore.commitIfCurrent(context, observed(context))).toBe(false);
  const domain = new Store(pool, () => now);
  await domain.action(principal, '/test/project-pause', projectId, { ...cmd({ type: 'set_project_status', status: 'paused' } as const), expectedRevision: 1 });
  await expect(store.load(selected())).rejects.toThrow();
  expect(await store.commitIfCurrent(context, observed(context))).toBe(false);
});
});
