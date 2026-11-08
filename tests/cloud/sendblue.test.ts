import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import type { Pool } from 'pg';
import * as c from '@living-playbooks/contracts';
import { buildServer } from '../../apps/cloud/src/api/server';
import { goldenSnapshot } from '../../fixtures/contracts/golden';
import { Store } from '../../apps/cloud/src/domain/store';
import { Messaging } from '../../apps/cloud/src/domain/messaging';
import { SendbluePoll } from '../../apps/cloud/src/integrations/sendblue/poll';
import { JobQueue } from '../../apps/cloud/src/jobs/queue';
import { SendblueDelivery } from '../../apps/cloud/src/jobs/sendblue-delivery';
import { enqueueNotification } from '../../apps/cloud/src/integrations/sendblue/outbox';
import { capability } from '../../apps/cloud/src/integrations/sendblue/config';

const config = { enabled: true, account: 'synthetic@example.invalid', line: '+15550000001', keyId: 'synthetic-id', apiSecret: 'synthetic-api-secret', signingSecret: 'synthetic-signing-secret' };
const sender = '+15550000002';
const instant = new Date('2026-11-08T12:00:00Z');
const projectId = goldenSnapshot.project.id;
const ownerId = goldenSnapshot.project.ownerId;
const principal = { credentialId: randomUUID(), ownerId, deviceId: randomUUID() };
const payload = (overrides: Record<string, unknown> = {}) => ({ accountEmail: config.account, message_handle: 'opaque-not-a-uuid', from_number: sender, to_number: config.line, sendblue_number: config.line, number: sender, content: 'What remains?', is_outbound: false, status: 'RECEIVED', message_type: 'message', group_id: '', media_url: '', ...overrides });
const command = (input: unknown, expectedRevision = 0) => ({ operationId: randomUUID(), expectedRevision, input });

test('an in-flight poll from a revoked link cannot import into its replacement', async () => {
  const h = await harness();
  try {
    await h.link(); const oldId = h.db.links[0].id;
    await h.link();
    const messaging = new Messaging(new Store(h.db.pool, h.now, config));
    await expect(messaging.accept(payload(), oldId)).rejects.toThrow();
    expect(h.db.messages).toHaveLength(0);
    expect(h.db.jobs).toHaveLength(0);
  } finally { await h.app.close(); }
});

test('polled messages use canonical receipts and STOP revokes pending work', async () => {
  const h = await harness();
  try {
    await h.link(); h.advance(120000);
    const data = [payload({ date_sent: '2026-11-08T12:01:00Z' })];
    const fetcher = async () => new Response(JSON.stringify({ status: 'OK', data, pagination: { offset: 0, limit: 50, total: data.length, hasMore: false } }));
    const poll = new SendbluePoll(h.db.pool, config, new Messaging(new Store(h.db.pool, h.now, config)), fetcher, h.now);
    await poll.tick(new AbortController().signal);
    await poll.tick(new AbortController().signal);
    expect(h.db.messages).toHaveLength(1); expect(h.db.jobs).toHaveLength(1); expect(h.db.receipts).toHaveLength(1);
    data.push(payload({ message_handle: 'stop', content: 'STOP', date_sent: '2026-11-08T12:01:30Z' }));
    await poll.tick(new AbortController().signal);
    expect(h.db.links[0].active).toBe(false); expect(h.db.jobs[0].state).toBe('cancelled');
    expect(h.db.messages).toHaveLength(1); expect(h.db.receipts).toHaveLength(2);
  } finally { await h.app.close(); }
});


async function harness() {
  const db = new MemoryQueries();
  let now = new Date(instant);
  const app = buildServer(db.pool, { now: () => now, sendblue: config } as Parameters<typeof buildServer>[1]);
  const request = (url: string, body: unknown, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url, payload: body as object, headers });
  const webhook = (body: unknown = payload(), secret = config.signingSecret) => request('/webhooks/sendblue', body, { 'sb-signing-secret': secret });
  const link = async (notifications = false) => {
    const result = await request(`/v1/projects/${projectId}/sendblue/link`, command({ sender, expiresAt: new Date(now.getTime() + 3600000).toISOString(), notifications }, db.project.revision), { authorization: 'Bearer synthetic' });
    expect(result.statusCode, db.lastQuery).toBe(200);
    return result;
  };
  return { db, app, request, webhook, link, now: () => now, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, queue: new JobQueue(db.pool, () => now, config) };
}

test('Sendblue webhook defaults off and cannot touch storage or transport', async () => {
  const pool = { query: () => { throw Error('unexpected_storage'); } } as unknown as Pool;
  const app = buildServer(pool);
  try {
    const response = await app.inject({ method: 'POST', url: '/webhooks/sendblue', payload: {} });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'sendblue_disabled', retryable: true });
  } finally { await app.close(); }
});

test('capability distinguishes disabled/unconfigured; only an authenticated desktop owner can enroll', async () => {
  expect(capability({ enabled: false }).state).toBe('disabled');
  expect(capability({ enabled: true }).state).toBe('unconfigured');
  expect(capability(config)).toMatchObject({ state: 'configured', transport: 'iMessage_or_SMS' });
  const h = await harness();
  try {
    const denied = await h.request(`/v1/projects/${projectId}/sendblue/link`, command({ sender, expiresAt: '2026-11-08T13:00:00Z' }));
    expect(denied.statusCode).toBe(401); expect(h.db.links).toHaveLength(0);
    const oversized = await h.app.inject({ method: 'POST', url: '/webhooks/sendblue', headers: { 'sb-signing-secret': config.signingSecret }, payload: payload({ metadata: 'x'.repeat(20000) }) });
    expect(oversized.statusCode).toBe(422); expect(h.db.messages).toHaveLength(0);
  } finally { await h.app.close(); }
});

test('authenticated owner explicitly creates a finite project phone grant; sender text cannot link', async () => {
  const h = await harness();
  try {
    expect((await h.webhook()).statusCode).toBe(403);
    await h.link();
    expect(h.db.links).toHaveLength(1);
    expect(h.db.links[0]).toMatchObject({ owner_id: ownerId, project_id: projectId, active: true });
    expect(h.db.credentials).toHaveLength(1);
    const response = await h.webhook();
    expect(response.statusCode).toBe(200);
    expect(h.db.messages).toHaveLength(1);
    expect(h.db.jobs).toHaveLength(1);
    expect(h.db.jobs[0].authority).toMatchObject({ kind: 'sendblue', projectId, ownerId });
    expect(h.db.jobs[0].authority.credentialId).toBeUndefined();
    expect(h.db.jobs[0].data.inputMessageId).toBe(h.db.messages[0].id);
  } finally { await h.app.close(); }
});

test.each([
  ['wrong sender', { from_number: '+15550000003', number: '+15550000003' }, 403],
  ['wrong account', { accountEmail: 'other@example.invalid' }, 403],
  ['wrong receiving line', { to_number: '+15550000004' }, 403],
  ['wrong line identity', { sendblue_number: '+15550000004' }, 403],
  ['group', { group_id: 'group' }, 422],
  ['media', { media_url: 'https://synthetic.invalid/image' }, 422],
  ['reaction', { message_type: 'reaction' }, 422],
  ['nested', { content: { text: 'hidden' } }, 422],
  ['unsupported nested attachment', { app_card: { url: 'https://synthetic.invalid' } }, 422],
  ['oversize', { content: 'x'.repeat(4097) }, 422],
] as const)('rejects %s without canonical mutations', async (_name, fields, status) => {
  const h = await harness();
  try { await h.link(); expect((await h.webhook(payload(fields))).statusCode).toBe(status); expect(h.db.messages).toHaveLength(0); expect(h.db.jobs).toHaveLength(0); }
  finally { await h.app.close(); }
});

test('webhook authenticates independently and returns safe failures without PII or secrets', async () => {
  const h = await harness();
  try {
    const denied = await h.webhook(payload(), 'wrong');
    expect(denied.statusCode).toBe(401); expect(h.db.messages).toHaveLength(0);
    expect(denied.body).not.toContain(sender); expect(denied.body).not.toContain(config.signingSecret);
    await h.link(); h.db.failAt = 'INSERT INTO messages';
    const failed = await h.webhook();
    expect(failed.statusCode).toBe(503); expect(failed.json().retryable).toBe(true);
    expect(failed.body).not.toContain('sensitive-storage-error');
    expect(h.db.receipts).toHaveLength(0); expect(h.db.messages).toHaveLength(0); expect(h.db.jobs).toHaveLength(0);
  } finally { await h.app.close(); }
});

test('lost webhook response, duplicate and process restart preserve one canonical message/job; changed payload conflicts', async () => {
  const h = await harness();
  try {
    await h.link(); expect((await h.webhook()).statusCode).toBe(200);
    await h.app.close();
    const restarted = buildServer(h.db.pool, { now: h.now, sendblue: config } as Parameters<typeof buildServer>[1]);
    try {
      const replay = await restarted.inject({ method: 'POST', url: '/webhooks/sendblue', payload: payload({ date_updated: 'changed-metadata' }), headers: { 'sb-signing-secret': config.signingSecret } });
      expect(replay.statusCode).toBe(200);
      const conflict = await restarted.inject({ method: 'POST', url: '/webhooks/sendblue', payload: payload({ content: 'different' }), headers: { 'sb-signing-secret': config.signingSecret } });
      expect(conflict.statusCode).toBe(409);
      expect(h.db.messages).toHaveLength(1); expect(h.db.jobs).toHaveLength(1); expect(h.db.receipts).toHaveLength(1);
    } finally { await restarted.close(); }
  } finally { await h.app.close(); }
});

test('STOP atomically revokes queued/running phone work; START never restores it', async () => {
  const h = await harness();
  try {
    await h.link(); await h.webhook(); const job = await h.queue.claim(); expect(job).not.toBeNull();
    expect((await h.webhook(payload({ message_handle: 'stop', content: 'STOP' }))).statusCode).toBe(200);
    expect(h.db.links[0].active).toBe(false); expect(h.db.jobs[0].state).toBe('cancelled');
    await expect(h.queue.context(job!)).rejects.toThrow();
    expect((await h.webhook(payload({ message_handle: 'start', content: 'START' }))).statusCode).toBe(403);
    expect((await h.webhook(payload({ message_handle: 'stop', content: 'STOP' }))).statusCode).toBe(200);
    expect(h.db.jobs).toHaveLength(1);
  } finally { await h.app.close(); }
});

test('expired grants and disabled feature cannot admit or claim a phone manager job', async () => {
  const h = await harness();
  try {
    await h.link(); await h.webhook(); h.advance(3600001);
    expect((await h.webhook(payload({ message_handle: 'late' }))).statusCode).toBe(403);
    expect(await h.queue.claim()).toBeNull(); expect(h.db.jobs[0].state).toBe('failed');
  } finally { await h.app.close(); }
});

async function complete(h: Awaited<ReturnType<typeof harness>>) {
  const job = (await h.queue.claim())!;
  expect(job).not.toBeNull();
  const context = await h.queue.context(job);
  const proposal: c.ManagerProposal = { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch,
    grantVersions: job.grantVersions, taskChanges: [], decisionSuggestions: [], workspace: context.snapshot.project.workspace,
    reply: { text: 'Record the synthetic demonstration.', observationIds: [] } };
  await h.queue.commit(job, proposal);
  return { job, proposal };
}

test('canonical manager commit creates one correlated durable intent; commit failure rolls back both', async () => {
  const h = await harness();
  try {
    await h.link(); await h.webhook();
    const { job, proposal } = await complete(h);
    expect(h.db.messages).toHaveLength(2); expect(h.db.outbox).toHaveLength(1);
    expect(h.db.outbox[0]).toMatchObject({ input_message_id: h.db.messages[0].id, message_id: h.db.messages[1].id, state: 'pending' });
    await expect(h.queue.commit(job, proposal)).rejects.toThrow('lease_lost'); expect(h.db.outbox).toHaveLength(1);
    await h.webhook(payload({ message_handle: 'another' }));
    h.db.failAt = 'INSERT INTO sendblue_outbox';
    await expect(complete(h)).rejects.toThrow();
    expect(h.db.messages).toHaveLength(3); expect(h.db.outbox).toHaveLength(1); expect(h.db.jobs[1].state).toBe('running');
  } finally { await h.app.close(); }
});

test('phone retry lineage survives a competing reflection; desktop manager replies do not create phone intents', async () => {
  const h = await harness();
  try {
    await h.link(); await h.webhook(); const job = (await h.queue.claim())!;
    const unrelated = structuredClone(h.db.jobs[0]);
    unrelated.id = randomUUID(); unrelated.state = 'queued'; unrelated.authority = principal; unrelated.data = { ...unrelated.data, id: unrelated.id, kind: 'reflection', state: 'queued', inputMessageId: null, tries: 0, leaseExpiresAt: null, leaseGeneration: 0 };
    h.db.jobs.push(unrelated);
    await h.queue.fail(job, 'proposal_stale');
    expect(h.db.jobs[2].data.inputMessageId).toBe(job.inputMessageId); expect(h.db.jobs[2].authority).toEqual(h.db.jobs[0].authority);
    unrelated.state = 'cancelled';
    h.advance(10001); await complete(h); expect(h.db.outbox).toHaveLength(1);
    await new Store(h.db.pool, h.now).message(principal, '/desktop-message', projectId, { ...command({ text: 'Desktop only' }, h.db.project.revision), input: { text: 'Desktop only' } });
    await complete(h); expect(h.db.outbox).toHaveLength(1);
  } finally { await h.app.close(); }
});

test('manager context retains its exact canonical input after the recent-message window moves', async () => {
  const h = await harness();
  try {
    await h.link(); await h.webhook();
    const original = h.db.messages[0];
    for (let i = 0; i < 201; i++) h.db.messages.push({ id: randomUUID(), project_id: projectId, data: { ...original.data, id: randomUUID(), role: 'manager', text: `Synthetic later ${i}` } });
    const job = (await h.queue.claim())!;
    const context = await h.queue.context(job);
    expect(context.snapshot.messages.find(m => m.id === job.inputMessageId)?.text).toBe('What remains?');
    expect(context.snapshot.messages.length).toBeLessThanOrEqual(200);
  } finally { await h.app.close(); }
});

test('source-permission epoch change cancels a committed reply before transport', async () => {
  const h = await harness();
  try {
    await h.link(); await h.webhook(); await complete(h); h.db.project.epoch++;
    const fetcher = vi.fn(); await new SendblueDelivery(h.db.pool, config, h.now, fetcher).tick();
    expect(fetcher).not.toHaveBeenCalled(); expect(h.db.outbox[0].state).toBe('cancelled');
  } finally { await h.app.close(); }
});

test('authority expiry during job row wait fences context/commit; revoke route cancels pending outbox', async () => {
  const h = await harness();
  try {
    await h.link(); await h.webhook(); const job = (await h.queue.claim())!;
    h.db.links[0].expires_at = new Date(h.now().getTime() + 1000).toISOString();
    h.db.beforeQuery = async q => { if (q.startsWith('SELECT * FROM jobs WHERE id=')) { h.advance(1001); h.db.beforeQuery = undefined; } };
    await expect(h.queue.context(job)).rejects.toThrow();
  } finally { await h.app.close(); }
  const fresh = await harness();
  try {
    await fresh.link(); await fresh.webhook(); await complete(fresh);
    const revoked = await fresh.request(`/v1/projects/${projectId}/sendblue/revoke`, command({ linkId: fresh.db.links[0].id }, fresh.db.project.revision), { authorization: 'Bearer synthetic' });
    expect(revoked.statusCode).toBe(200); expect(fresh.db.outbox[0].state).toBe('cancelled');
  } finally { await fresh.app.close(); }
});

test('bounded dispatcher uses ordinary Sendblue headers and explicit line; acceptance is not delivery', async () => {
  const h = await harness();
  try {
    await h.link(); await h.webhook(); await complete(h);
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'sb-api-key-id': config.keyId, 'sb-api-secret-key': config.apiSecret });
      expect(init?.headers).not.toHaveProperty('Idempotency-Key'); expect(JSON.parse(String(init?.body))).toMatchObject({ number: sender, from_number: config.line });
      return Response.json({ message_handle: 'sent-opaque', status: 'QUEUED' });
    });
    await new SendblueDelivery(h.db.pool, config, h.now, fetcher).tick();
    expect(fetcher).toHaveBeenCalledTimes(1); expect(h.db.outbox[0].state).toBe('accepted');
    const status = payload({ message_handle: 'sent-opaque', from_number: config.line, to_number: sender, sendblue_number: null, is_outbound: true, content: h.db.outbox[0].text, status: 'DELIVERED' });
    expect((await h.webhook(status)).statusCode).toBe(200); expect((await h.webhook(status)).statusCode).toBe(200);
    expect(h.db.outbox[0].state).toBe('delivered'); expect(h.db.jobs).toHaveLength(1);
    expect((await h.webhook({ ...status, status: 'SENT' })).statusCode).toBe(200); expect(h.db.outbox[0].state).toBe('delivered');
    expect((await h.webhook({ ...status, message_handle: 'unknown-echo' })).statusCode).toBe(422);
  } finally { await h.app.close(); }
});

test.each(['lost-response', 'accepted-persistence-failure', 'restart-sending'] as const)('possible transmission becomes uncertain and is never auto-resent: %s', async mode => {
  const h = await harness();
  try {
    await h.link(); await h.webhook(); await complete(h);
    const fetcher = vi.fn(async () => {
      if (mode === 'lost-response') throw Error('private-provider-error');
      if (mode === 'accepted-persistence-failure') h.db.failAt = 'UPDATE sendblue_outbox SET provider_handle';
      return Response.json({ message_handle: 'provider-received', status: 'QUEUED' });
    });
    if (mode === 'restart-sending') { h.db.outbox[0].state = 'sending'; h.db.outbox[0].lease_expires_at = new Date(0); }
    const delivery = new SendblueDelivery(h.db.pool, config, h.now, fetcher);
    await delivery.tick().catch(() => {}); h.db.failAt = ''; h.advance(31000);
    await new SendblueDelivery(h.db.pool, config, h.now, fetcher).tick();
    await delivery.tick(); expect(fetcher).toHaveBeenCalledTimes(mode === 'restart-sending' ? 0 : 1); expect(h.db.outbox[0].state).toBe('uncertain');
  } finally { await h.app.close(); }
});

test('revoke during a held delivery reservation prevents transport; expired lease can be safely reclaimed', async () => {
  const h = await harness();
  try {
    await h.link(); await h.webhook(); await complete(h);
    const fetcher = vi.fn(async () => Response.json({ message_handle: 'never' }));
    const delivery = new SendblueDelivery(h.db.pool, config, h.now, fetcher);
    const claimed = (await delivery.claim())!; expect(claimed).not.toBeNull();
    h.advance(31000); const reclaimed = (await delivery.claim())!; expect(reclaimed.generation).toBeGreaterThan(claimed.generation);
    await delivery.deliver(claimed); expect(fetcher).not.toHaveBeenCalled();
    await h.webhook(payload({ message_handle: 'stop-during-wait', content: 'STOP' }));
    await delivery.deliver(reclaimed); expect(fetcher).not.toHaveBeenCalled(); expect(h.db.outbox[0].state).toBe('cancelled');
  } finally { await h.app.close(); }
});

test('default-off dispatcher and disabled job queue never transport or run phone jobs', async () => {
  const h = await harness();
  try {
    await h.link(); await h.webhook(); const fetcher = vi.fn();
    expect(await new JobQueue(h.db.pool, h.now, { enabled: false }).claim()).toBeNull();
    await new SendblueDelivery(h.db.pool, { enabled: false }, h.now, fetcher).tick(); expect(fetcher).not.toHaveBeenCalled();
  } finally { await h.app.close(); }
});

test('cancelling a stuck transport releases the dispatcher and leaves a durable uncertain intent', async () => {
  const h = await harness();
  try {
    await h.link(); await h.webhook(); await complete(h);
    const controller = new AbortController();
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const fetcher = vi.fn(async () => { started(); return new Promise<Response>(() => {}); });
    const delivery = new SendblueDelivery(h.db.pool, config, h.now, fetcher);
    const sending = delivery.tick(controller.signal);
    await entered; controller.abort();
    await Promise.race([sending, new Promise((_, reject) => setTimeout(() => reject(Error('dispatcher_stuck')), 100))]);
    expect(h.db.outbox[0].state).toBe('uncertain');
  } finally { await h.app.close(); }
});

test('owner grant/revoke honors project revision and webhook rate bounds persist without duplicate jobs', async () => {
  const h = await harness();
  try {
    await h.link();
    const stale = await h.request(`/v1/projects/${projectId}/sendblue/revoke`, command({ linkId: h.db.links[0].id }, 0), { authorization: 'Bearer synthetic' });
    expect(stale.statusCode).toBe(409); expect(h.db.links[0].active).toBe(true);
    for (let i = 0; i < 10; i++) expect((await h.webhook(payload({ message_handle: `rate-${i}` }))).statusCode).toBe(200);
    expect((await h.webhook(payload({ message_handle: 'rate-extra' }))).statusCode).toBe(429); expect(h.db.jobs).toHaveLength(10);
    expect((await h.webhook(payload({ message_handle: 'rate-0' }))).statusCode).toBe(200);
  } finally { await h.app.close(); }
});

test('trusted notification seam requires explicit notice grant and exact owner/project; operation reuse conflicts', async () => {
  const h = await harness();
  try {
    await h.link();
    const notice = { operationId: randomUUID(), ownerId, projectId, kind: 't3_question' as const, requestKey: 'synthetic-request', text: 'A question is waiting. Open T3.', expiresAt: new Date(instant.getTime() + 60000).toISOString() };
    await expect(enqueueNotification(h.db.pool, config, notice, h.now)).rejects.toThrow();
    await h.link(true);
    await expect(enqueueNotification(h.db.pool, config, { ...notice, ownerId: randomUUID() }, h.now)).rejects.toThrow();
    await enqueueNotification(h.db.pool, config, notice, h.now); await enqueueNotification(h.db.pool, config, notice, h.now); expect(h.db.outbox).toHaveLength(1);
    await expect(enqueueNotification(h.db.pool, config, { ...notice, text: 'Different' }, h.now)).rejects.toThrow();
    await h.webhook(payload({ content: 'yes' })); expect(h.db.messages[0].data.text).toBe('yes'); expect(h.db.jobs).toHaveLength(1);
  } finally { await h.app.close(); }
});

// SQL-state fixture only: production Store/JobQueue/Fastify code owns all business decisions.
// It deliberately cannot establish PostgreSQL locking, isolation or constraints.
class MemoryQueries {
  project = { ...c.ProjectSchema.parse(goldenSnapshot.project), workspace: { ...c.ProjectSchema.parse(goldenSnapshot.project).workspace, panels: [] } };
  credentials: any[] = [{ id: principal.credentialId, owner_id: ownerId, device_id: principal.deviceId }];
  links: any[] = []; receipts: any[] = []; messages: any[] = []; jobs: any[] = []; commands: any[] = []; outbox: any[] = []; seq = 0;
  failAt = '';
  beforeQuery?: (query: string) => Promise<void>;
  lastQuery = ''; private aborted = false;
  pool = { connect: async () => ({ query: this.query, release: () => {} }), query: (...args: any[]) => this.query(args[0], args[1]) } as unknown as Pool;
  private backup: any;
  query = async (sql: string, args: any[] = []): Promise<any> => {
    const q = sql.replace(/\s+/g, ' ').trim();
    this.lastQuery = q;
    await this.beforeQuery?.(q);
    const rows = (values: any[] = []) => ({ rows: structuredClone(values), rowCount: values.length });
    if (q === 'BEGIN') { this.aborted = false; this.backup = structuredClone({ project: this.project, links: this.links, receipts: this.receipts, messages: this.messages, jobs: this.jobs, commands: this.commands, outbox: this.outbox, seq: this.seq }); return rows(); }
    if (q === 'ROLLBACK') { Object.assign(this, this.backup); this.aborted = false; return rows(); }
    if (this.aborted) throw Error('transaction_aborted');
    if (q === 'COMMIT') return rows();
    if (this.failAt && q.includes(this.failAt)) { this.aborted = true; throw Error('sensitive-storage-error'); }
    if (q.startsWith('SELECT pg_advisory')) return rows();
    if (q.includes("FROM credentials WHERE secret_hash=")) return rows(this.credentials);
    if (q.startsWith('SELECT id FROM credentials')) return rows(this.credentials.filter(r => r.id === args[0]));
    if (q.startsWith('SELECT 1 FROM credentials')) return rows(this.credentials.filter(r => r.id === args[0]));
    if (q.startsWith('SELECT id FROM owners')) return rows([{ id: ownerId }]);
    if (q.includes('FROM projects WHERE id=') && q.startsWith('SELECT')) return rows(args[0] === this.project.id && (!args[1] || args[1] === ownerId) ? [{ id: projectId, owner_id: ownerId, data: this.project, deleted: false }] : []);
    if (q.startsWith('UPDATE projects SET data=')) { this.project = structuredClone(args[1]); return rows(); }
    if (q.startsWith('SELECT * FROM command_receipts')) return rows(this.commands.filter(r => r.actor_id === args[0] && r.operation_id === args[1]));
    if (q.startsWith('INSERT INTO command_receipts')) { this.commands.push({ actor_id: args[0], operation_id: args[1], request_hash: args[3], response: args[4] }); return rows(); }
    if (q.startsWith('INSERT INTO events')) return rows([{ seq: ++this.seq }]);
    if (q.startsWith('INSERT INTO messages')) { this.messages.push({ id: args[0], project_id: args[1], data: structuredClone(args[2]) }); return rows(); }
    if (q.startsWith('INSERT INTO jobs')) { this.jobs.push({ id: args[0], project_id: args[1], data: structuredClone(args[2]), state: args[3], run_after: args[4], stale_count: args[5], authority: structuredClone(args[6]), generation: 0 }); return rows(); }
    if (q.startsWith('SELECT authority FROM jobs')) return rows(this.jobs.filter(r => r.id === args[0]).map(r => ({ authority: r.authority })));
    if (q.startsWith('SELECT * FROM jobs WHERE id=')) return rows(this.jobs.filter(r => r.id === args[0]));
    if (q.startsWith("SELECT id FROM jobs WHERE state='running'")) return rows(this.jobs.filter(r => r.state === 'running' && new Date(r.lease_expires_at) > args[0]));
    if (q.startsWith('SELECT j.id,j.project_id')) return rows(this.jobs.filter(r => r.state === 'queued' && new Date(r.run_after) <= args[0] || r.state === 'running' && new Date(r.lease_expires_at) <= args[0]).slice(0, 1).map(r => ({ ...r, owner_id: ownerId })));
    if (q.startsWith('UPDATE jobs SET data=')) { Object.assign(this.jobs.find(r => r.id === args[0]), { data: structuredClone(args[1]), state: args[2], run_after: args[3], lease_expires_at: args[4], generation: args[5] }); return rows(); }
    if (q.startsWith("SELECT id FROM jobs WHERE project_id=")) return rows(this.jobs.filter(r => r.project_id === args[0] && ['queued','running'].includes(r.state) && r.data.kind === 'reflection' && (!args[1] || r.data.inputMessageId === args[1])).slice(0, 1));
    if (q.startsWith('SELECT data FROM source_bindings')) return rows();
    if (q.startsWith('SELECT') && q.includes('FROM checkins')) return rows();
    if (q.startsWith('SELECT coalesce(max(seq)')) return rows([{ seq: this.seq }]);
    if (q.startsWith('SELECT data FROM messages WHERE id=')) return rows(this.messages.filter(r => r.id === args[0] && r.project_id === args[1]).map(r => ({ data: r.data })));
    if (q.startsWith('SELECT data FROM messages')) return rows(this.messages.slice().reverse().slice(0, args[1]).map(r => ({ data: r.data })));
    if (q.startsWith('SELECT data FROM documents') || q.startsWith('SELECT data FROM observations')) return rows();
    if (q.startsWith('SELECT payload_hash FROM sendblue_receipts')) return rows(this.receipts.filter(r => r.account === args[0] && r.handle === args[1] && r.outbound === args[2] && r.status === args[3]));
    if (q.startsWith('SELECT * FROM sendblue_links WHERE id=')) return rows(this.links.filter(r => r.id === args[0]));
    if (q.startsWith('SELECT * FROM sendblue_links WHERE owner_id=')) return rows(this.links.filter(r => r.owner_id === args[0] && r.project_id === args[1] && r.active));
    if (q.startsWith('SELECT * FROM sendblue_links WHERE account=')) return rows(this.links.filter(r => r.account === args[0] && r.receiving_line === args[1] && r.sender === args[2] && r.active));
    if (q.startsWith('SELECT id,account,receiving_line,sender,linked_at,expires_at FROM sendblue_links')) return rows(this.links.filter(r => r.active && r.linked_at && new Date(r.expires_at) > args[0] && r.account === args[1] && r.receiving_line === args[2]));
    if (q.startsWith('INSERT INTO sendblue_links')) { this.links.push({ id: args[0], owner_id: args[1], project_id: args[2], account: args[3], receiving_line: args[4], sender: args[5], actions: args[6], expires_at: args[7], linked_at: args[8], revision: 0, active: true }); return rows(); }
    if (q.startsWith('UPDATE sendblue_links SET active=')) { const r = this.links.find(r => r.id === args[0]); r.active = false; r.revision++; return rows(); }
    if (q.startsWith('SELECT count(*) FROM sendblue_receipts')) return rows([{ count: this.receipts.filter(r => r.link_id === args[0] && !r.outbound && new Date(r.created_at) > args[1]).length }]);
    if (q.startsWith('INSERT INTO sendblue_receipts')) { this.receipts.push({ account: args[0], handle: args[1], outbound: args[2], status: args[3], payload_hash: args[4], link_id: args[5], owner_message_id: args[6], job_id: args[7], created_at: args[8] }); return rows(); }
    if (q.startsWith('SELECT * FROM sendblue_receipts WHERE link_id=')) return rows(this.receipts.filter(r => r.link_id === args[0] && r.owner_message_id === args[1] && !r.outbound));
    if (q.startsWith("UPDATE jobs SET state='cancelled'")) {
      for (const r of this.jobs.filter(r => r.authority.kind === 'sendblue' && r.authority.linkId === args[0] && ['queued','running'].includes(r.state))) {
        r.state = 'cancelled'; r.generation++; r.lease_expires_at = null; Object.assign(r.data, { state: 'cancelled', leaseGeneration: r.generation, leaseExpiresAt: null });
      } return rows();
    }
    if (q.startsWith('SELECT * FROM sendblue_outbox WHERE operation_id=')) return rows(this.outbox.filter(r => r.operation_id === args[0] || r.link_id === args[1] && (r.kind === args[2] && args[3] !== null && r.request_key === args[3] || args[4] !== null && r.input_message_id === args[4])));
    if (q.startsWith('INSERT INTO sendblue_outbox')) { this.outbox.push({ id: args[0], operation_id: args[1], request_hash: args[2], link_id: args[3], authority: args[4], owner_id: args[5], project_id: args[6], account: args[7], kind: args[8], request_key: args[9], input_message_id: args[10], message_id: args[11], text: args[12], expires_at: args[13], project_epoch: args[14], state: 'pending', generation: 0, lease_expires_at: null, provider_handle: null, provider_status: null }); return rows(); }
    if (q.startsWith('SELECT * FROM sendblue_outbox WHERE account=')) return rows(this.outbox.filter(r => r.account === args[0] && r.provider_handle === args[1] && r.link_id === args[2]));
    if (q.startsWith('SELECT * FROM sendblue_outbox WHERE id=')) return rows(this.outbox.filter(r => r.id === args[0]));
    if (q.startsWith('SELECT id,owner_id,project_id FROM sendblue_outbox')) return rows(this.outbox.filter(r => r.state === 'pending' || ['leased','sending'].includes(r.state) && new Date(r.lease_expires_at) <= args[0]).slice(0,1));
    if (q.startsWith('UPDATE sendblue_outbox SET state=CASE')) { for (const r of this.outbox.filter(r => r.link_id === args[0] && ['pending','leased','sending'].includes(r.state))) { r.state = r.state === 'sending' ? 'uncertain' : 'cancelled'; r.generation++; r.lease_expires_at = null; } return rows(); }
    if (q.startsWith("UPDATE sendblue_outbox SET state='leased'")) { const r = this.outbox.find(r => r.id === args[0]); r.state = 'leased'; r.generation++; r.lease_expires_at = args[1]; return rows([r]); }
    if (q.startsWith("UPDATE sendblue_outbox SET state='sending'")) { const r = this.outbox.find(r => r.id === args[0]); r.state = 'sending'; r.lease_expires_at = args[1]; return rows(); }
    if (q.startsWith('UPDATE sendblue_outbox SET provider_handle')) { const r = this.outbox.find(r => r.id === args[0]); Object.assign(r, { provider_handle: args[1], provider_status: args[2], state: r.state === 'sending' && r.generation === args[3] ? 'accepted' : r.state, lease_expires_at: null }); return rows(); }
    if (q.startsWith('UPDATE sendblue_outbox SET provider_status=')) { Object.assign(this.outbox.find(r => r.id === args[0]), { provider_status: args[1], state: args[2] }); return rows(); }
    if (q.startsWith("UPDATE sendblue_outbox SET state='cancelled'") || q.startsWith("UPDATE sendblue_outbox SET state='uncertain'")) { const r = this.outbox.find(r => r.id === args[0]); if (args.length === 1 || r.state === 'sending' && r.generation === args[1]) { r.state = q.includes("state='cancelled'") ? 'cancelled' : 'uncertain'; r.lease_expires_at = null; } return rows(); }
    throw Error(`unhandled_fixture_query: ${q}`);
  };
}
