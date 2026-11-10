import { expect, it, vi } from 'vitest';
import { T3Service, type T3ServiceStore } from '../../apps/cloud/src/integrations/t3/service';
import type { T3Context } from '../../apps/cloud/src/integrations/t3/model';

const now = Date.parse('2026-11-08T04:00:00Z');
const context: T3Context = {
  grant: { bindingId: 'binding', ownerId: 'owner', deviceId: 'device', environmentId: 'environment', projectId: 'project', t3ProjectId: 'source', threadId: 'thread', revision: 1, expiresAt: now + 60000, revoked: false, startPosition: 0 },
  mapping: { ownerId: 'owner', projectId: 'project', taskId: 'task', taskRevision: 1, mappingRevision: 1, grantRevision: 1, runId: 'run', runOrdinal: 1 },
  completionPolicy: { enabled: false, revision: 1, criterionId: 'criterion' },
};
const selection = { ownerId: 'owner', deviceId: 'device', projectId: 'project', bindingId: 'binding' };
function fixture() {
  let current = structuredClone(context);
  let checkpoint: unknown;
  let closeCount = 0;
  const calls: Record<string, unknown>[] = [];
  const store: T3ServiceStore = {
    async load() { return { context: structuredClone(current), checkpoint: checkpoint as never }; },
    async commitIfCurrent(expected, observation) {
      if (JSON.stringify(current) !== JSON.stringify(expected) || current.grant.revoked) return false;
      checkpoint = structuredClone(observation); return true;
    },
    async revoke() { current.grant.revoked = true; current.grant.revision++; checkpoint = undefined; },
  };
  const openSession = async () => ({ configuration: { endpoint: 'https://synthetic.invalid/mcp', environmentId: 'environment' }, toolNames: ['t3_thread_read'], permissions: ['orchestration:read'],
    async callTool(_name: string, args: Record<string, unknown>) {
      calls.push(args);
      return { structuredContent: { thread: { threadId: 'thread', projectId: 'source', activeRunId: 'run', latestRunId: 'run', status: 'running', updatedAt: '2026-11-08T04:00:00Z' }, recentRuns: [{ runId: 'run', ordinal: 1, status: 'running' }], items: [{ itemId: 'item', position: 1, runId: 'run', sourceThreadId: 'thread', visibility: 'local', status: 'running', updatedAt: '2026-11-08T04:00:00Z', text: 'private prose' }], nextPosition: 1, hasMore: false } };
    }, async close() { closeCount++; } });
  return { store, openSession, calls, checkpoint: () => checkpoint, closes: () => closeCount, current: () => current };
}

it('independent: a revoked external authority leaves cached activity visible until another poll', async () => {
  const h = fixture(); const svc = new T3Service({ enabled: true, store: h.store, openSession: h.openSession, now: () => now, intervalMs: 60000 });
  await svc.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  await svc.poll();
  await h.store.revoke(selection, context);
  expect(svc.activity()?.mode).toBe('current');
  await svc.poll();
  expect(svc.activity()).toBeUndefined();
  await svc.stop();
});

it('independent: separate service instances can open simultaneous sessions for one binding', async () => {
  const h = fixture(); let opens = 0;
  const open = async () => { opens++; return h.openSession(); };
  const opts = { enabled: true, store: h.store, openSession: open, now: () => now, intervalMs: 60000 };
  const a = new T3Service(opts); const b = new T3Service(opts);
  await a.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  await b.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  expect(opens).toBe(2); expect(a.status()).toBe('active'); expect(b.status()).toBe('active');
  await a.stop(); await b.stop();
});
