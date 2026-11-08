import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { describe, expect, test } from 'vitest';
import { migrate } from '../../apps/cloud/src/db/migrate';
import { issueGrant, redeem } from '../../apps/cloud/src/auth/credentials';
import { buildServer } from '../../apps/cloud/src/api/server';
import { JobQueue } from '../../apps/cloud/src/jobs/queue';
import { SendblueDelivery } from '../../apps/cloud/src/jobs/sendblue-delivery';
import { enqueueNotification } from '../../apps/cloud/src/integrations/sendblue/outbox';

const config = { enabled: true, account: 'synthetic@example.invalid', line: '+15550000001', keyId: 'synthetic-id', apiSecret: 'synthetic-api-secret', signingSecret: 'synthetic-webhook-secret' };
const sender = '+15550000002';
const payload = { accountEmail: config.account, message_handle: 'synthetic-inbound', from_number: sender, to_number: config.line, sendblue_number: config.line, number: sender, content: 'Synthetic question?', is_outbound: false, status: 'RECEIVED', message_type: 'message' };

describe.skipIf(!process.env.SENDBLUE_TEST_DATABASE_URL)('isolated PostgreSQL Sendblue path', () => {
  test('persists inbound, reply and opted-in notice using a fake transport', async () => {
    const url = new URL(process.env.SENDBLUE_TEST_DATABASE_URL!);
    if (url.hostname !== '127.0.0.1' || url.username !== 'sendblue_test' || url.pathname !== '/sendblue_owned') throw Error('Expected owned isolated Sendblue database');
    const pool = new Pool({ connectionString: url.href });
    const app = buildServer(pool, { sendblue: config });
    try {
      await migrate(pool); await migrate(pool);
      const grant = await issueGrant(pool, { timezone: 'UTC' });
      const auth = await redeem(pool, grant.code);
      const headers = { authorization: `Bearer ${auth.token}` };
      const create = await app.inject({ method: 'POST', url: '/v1/projects', headers, payload: { operationId: randomUUID(), input: { title: 'Synthetic', brief: 'Synthetic only' } } });
      expect(create.statusCode).toBe(200);
      const project = (await pool.query('SELECT id,data FROM projects WHERE owner_id=$1', [grant.ownerId])).rows[0];
      await pool.query("UPDATE jobs SET state='cancelled',data=data || '{\"state\":\"cancelled\"}'::jsonb WHERE project_id=$1", [project.id]);
      const link = await app.inject({ method: 'POST', url: `/v1/projects/${project.id}/sendblue/link`, headers, payload: { operationId: randomUUID(), expectedRevision: project.data.revision, input: { sender, notifications: true, expiresAt: new Date(Date.now() + 3600000).toISOString() } } });
      expect(link.statusCode).toBe(200);
      const webhook = () => app.inject({ method: 'POST', url: '/webhooks/sendblue', headers: { 'sb-signing-secret': config.signingSecret }, payload });
      const first = await webhook(); expect(first.statusCode).toBe(200);
      const replay = await webhook(); expect(replay.statusCode).toBe(200);
      expect(Number((await pool.query('SELECT count(*) FROM sendblue_receipts')).rows[0].count)).toBe(1);
      const queue = new JobQueue(pool, undefined, config);
      const job = (await queue.claim())!; expect(job).toBeTruthy();
      const context = await queue.context(job);
      await queue.commit(job, { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch, grantVersions: job.grantVersions, taskChanges: [], decisionSuggestions: [], workspace: context.snapshot.project.workspace, reply: { text: 'Synthetic reply.', observationIds: [] } });
      const send = viFetch();
      const delivery = new SendblueDelivery(pool, config, undefined, send.fetcher);
      await delivery.tick();
      expect(send.count()).toBe(1);
      expect((await pool.query('SELECT state FROM sendblue_outbox')).rows[0].state).toBe('accepted');
      const status = await app.inject({ method: 'POST', url: '/webhooks/sendblue', headers: { 'sb-signing-secret': config.signingSecret }, payload: { ...payload, message_handle: 'synthetic-outbound-1', from_number: config.line, to_number: sender, content: 'Synthetic reply.', is_outbound: true, status: 'DELIVERED' } });
      expect(status.statusCode).toBe(200);
      expect((await pool.query('SELECT state FROM sendblue_outbox')).rows[0].state).toBe('delivered');
      await enqueueNotification(pool, config, { operationId: randomUUID(), ownerId: grant.ownerId, projectId: project.id, kind: 't3_question', requestKey: 'synthetic-request', text: 'A question is waiting.', expiresAt: new Date(Date.now() + 600000).toISOString() });
      await delivery.tick();
      expect(send.count()).toBe(2);
      expect(Number((await pool.query("SELECT count(*) FROM sendblue_outbox WHERE state IN ('accepted','delivered')")).rows[0].count)).toBe(2);
      const stop = await app.inject({ method: 'POST', url: '/webhooks/sendblue', headers: { 'sb-signing-secret': config.signingSecret }, payload: { ...payload, message_handle: 'synthetic-stop', content: 'STOP' } });
      expect(stop.statusCode).toBe(200);
      expect((await pool.query('SELECT active FROM sendblue_links')).rows[0].active).toBe(false);
    } finally { await app.close(); await pool.end(); }
  });
});
function viFetch() {
  let calls = 0;
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ message_handle: `synthetic-outbound-${++calls}`, status: 'SENT' }), { status: 200 });
  return { fetcher, count: () => calls };
}
