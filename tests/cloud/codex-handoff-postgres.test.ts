import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { migrate } from '../../apps/cloud/src/db/migrate';
import { issueGrant, redeem } from '../../apps/cloud/src/auth/credentials';
import { buildServer } from '../../apps/cloud/src/api/server';
import { JobQueue } from '../../apps/cloud/src/jobs/queue';

it.skipIf(!process.env.CODEX_HANDOFF_TEST_DATABASE_URL)('persists one task request and claims it once on an authenticated paired device', async () => {
  const url = new URL(process.env.CODEX_HANDOFF_TEST_DATABASE_URL!);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/playbooks_codex_handoff_test' || url.search || url.hash) throw Error('An explicit isolated handoff test database is required');
  const schema = `handoff_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: url.href });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: url.href, options: `-c search_path=${schema}` });
  const app = buildServer(pool);
  try {
    await migrate(pool);
    const grant = await issueGrant(pool, { timezone: 'UTC' });
    const device = await redeem(pool, grant.code);
    const other = await redeem(pool, (await issueGrant(pool, { ownerId: grant.ownerId, timezone: 'UTC' })).code);
    const foreign = await redeem(pool, (await issueGrant(pool, { timezone: 'UTC' })).code);
    const request = (method: 'GET' | 'POST', path: string, token: string, payload?: object) => app.inject({ method, url: path, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
    const created = await request('POST', '/v1/projects', device.token, { operationId: randomUUID(), input: { title: 'Synthetic', brief: 'Synthetic project' } });
    expect(created.statusCode).toBe(200);
    const projectId = (await pool.query('SELECT id FROM projects')).rows[0].id as string;
    const queue = new JobQueue(pool);
    const job = (await queue.claim())!;
    const { snapshot } = await queue.context(job);
    const taskId = randomUUID();
    expect(await queue.commit(job, { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch, grantVersions: job.grantVersions, taskChanges: [{ type: 'create', task: { id: taskId, title: 'Synthetic task', status: 'todo', requirementOrigin: 'brief', evidenceLevel: 'none', evidenceIds: [] } }], decisionSuggestions: [], workspace: snapshot.project.workspace, codexTask: { taskId, text: 'Synthetic request' }, reply: { text: 'Queued.', observationIds: [] } })).toBe('completed');
    const path = `/v1/projects/${projectId}/codex/claim`;
    expect((await request('POST', path, foreign.token, {})).statusCode).toBe(404);
    const [a, b] = await Promise.all([request('POST', path, device.token, {}), request('POST', path, other.token, {})]);
    const claims = [a.json(), b.json()].filter(Boolean);
    expect(claims).toHaveLength(1);
    const winner = a.json() ? device : other, loser = winner === device ? other : device;
    const resultPath = `/v1/projects/${projectId}/codex/${claims[0].id}/result`;
    const result = { status: 'completed', output: 'Synthetic untrusted report' };
    expect((await request('POST', resultPath, loser.token, result)).statusCode).toBe(404);
    expect((await request('POST', resultPath, winner.token, result)).statusCode).toBe(200);
    expect((await request('POST', resultPath, winner.token, result)).statusCode).toBe(200);
    expect((await request('POST', path, winner.token, {})).json()).toBeNull();
    const snapshotAfter = (await request('GET', `/v1/projects/${projectId}/snapshot`, device.token)).json();
    expect(snapshotAfter.codexRequests).toMatchObject([{ taskId, state: 'completed', output: result.output }]);
  } finally {
    await app.close(); await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
