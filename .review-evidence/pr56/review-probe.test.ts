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

it('defaults disabled and never opens a session or reads authority', async () => {
  const h = fixture(); let reads = 0;
  const store = { ...h.store, async load() { reads++; return h.store.load(selection); } };
  const service = new T3Service({ store, openSession: h.openSession, now: () => now });
  await expect(service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} })).rejects.toThrow();
  expect(reads).toBe(0); expect(h.calls).toHaveLength(0);
});

it('composes scoped session, adapter and observer and commits only metadata', async () => {
  const h = fixture(); const service = new T3Service({ enabled: true, store: h.store, openSession: h.openSession, now: () => now, intervalMs: 60000 });
  await service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  const observed = await service.poll();
  expect(observed?.mode).toBe('current'); expect(observed?.cursor).toBe(1);
  expect(h.calls).toHaveLength(1); expect(h.calls[0]).toMatchObject({ environmentId: 'environment', threadId: 'thread', view: 'activity' });
  expect(JSON.stringify(h.checkpoint())).not.toContain('private prose');
  await service.stop(); expect(h.closes()).toBe(1);
});

it('rejects a selection that does not match the authoritative binding before opening', async () => {
  const h = fixture(); let opened = false;
  const service = new T3Service({ enabled: true, store: h.store, now: () => now, openSession: async (...args) => { opened = true; return h.openSession(); } });
  await expect(service.start({ ...selection, projectId: 'other' }, { endpoint: 'synthetic-endpoint', onAuthorization() {} })).rejects.toThrow();
  expect(opened).toBe(false);
});

it('does not persist an observation when revocation wins during the read', async () => {
  const h = fixture(); let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const readStarted = new Promise<void>(r => { entered = r; });
  const openSession = async () => { const session = await h.openSession(); const call = session.callTool;
    return { ...session, async callTool(...args: Parameters<typeof call>) { entered(); await barrier; return call(...args); } }; };
  const service = new T3Service({ enabled: true, store: h.store, openSession, now: () => now, intervalMs: 60000 });
  await service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  const poll = service.poll(); await readStarted; await service.revoke(); release(); await poll;
  expect(h.checkpoint()).toBeUndefined(); expect(h.current().grant.revoked).toBe(true); expect(h.closes()).toBe(1);
});

it('closes a session returned after shutdown during startup and never schedules a read', async () => {
  const h = fixture(); let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const opening = new Promise<void>(r => { entered = r; });
  const openSession = async () => { entered(); await barrier; return h.openSession(); };
  const service = new T3Service({ enabled: true, store: h.store, openSession, now: () => now });
  const start = service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  const rejected = expect(start).rejects.toThrow();
  await opening; await service.stop(); release(); await rejected;
  expect(h.closes()).toBe(1); expect(h.calls).toHaveLength(0);
});

it('stops the session when canonical authority is revoked outside the service', async () => {
  const h = fixture(); const service = new T3Service({ enabled: true, store: h.store, openSession: h.openSession, now: () => now, intervalMs: 60000 });
  await service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  h.current().grant.revoked = true;
  await service.poll();
  expect(h.closes()).toBe(1); expect(h.calls).toHaveLength(0);
  expect(await service.poll()).toBeUndefined();
});


it('closes on a failed checkpoint commit so the next session restarts from durable state', async () => {
  const h = fixture(); const store = { ...h.store, async commitIfCurrent() { throw Error('storage unavailable'); } };
  const service = new T3Service({ enabled: true, store, openSession: h.openSession, now: () => now, intervalMs: 60000 });
  await service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  await expect(service.poll()).rejects.toThrow(); expect(h.closes()).toBe(1);
  expect(await service.poll()).toBeUndefined(); expect(h.checkpoint()).toBeUndefined();
});

it('does not allow a new session while durable revocation is pending', async () => {
  const h = fixture(); let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const revoking = new Promise<void>(r => { entered = r; });
  const store = { ...h.store, async revoke(...args: Parameters<T3ServiceStore['revoke']>) { entered(); await barrier; await h.store.revoke(...args); } };
  const service = new T3Service({ enabled: true, store, openSession: h.openSession, now: () => now, intervalMs: 60000 });
  const connection = { endpoint: 'synthetic-endpoint', onAuthorization() {} };
  await service.start(selection, connection); const pending = service.revoke(); await revoking;
  await expect(service.start(selection, connection)).rejects.toThrow();
  release(); await pending; expect(h.current().grant.revoked).toBe(true);
});

it('discards a delayed checkpoint commit after revocation wins the atomic store check', async () => {
  const h = fixture(); let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const writing = new Promise<void>(r => { entered = r; });
  const store = { ...h.store, async commitIfCurrent(...args: Parameters<T3ServiceStore['commitIfCurrent']>) { entered(); await barrier; return h.store.commitIfCurrent(...args); } };
  const service = new T3Service({ enabled: true, store, openSession: h.openSession, now: () => now, intervalMs: 60000 });
  await service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  const poll = service.poll(); await writing; const revoked = service.revoke();
  await Promise.resolve(); release(); await revoked; await poll;
  expect(h.checkpoint()).toBeUndefined(); expect(h.current().grant.revoked).toBe(true);
});

it('waits for an in-flight checkpoint before allowing a restart after stop', async () => {
  const h = fixture(); let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const writing = new Promise<void>(r => { entered = r; });
  const store = { ...h.store, async commitIfCurrent(...args: Parameters<T3ServiceStore['commitIfCurrent']>) { entered(); await barrier; return h.store.commitIfCurrent(...args); } };
  const service = new T3Service({ enabled: true, store, openSession: h.openSession, now: () => now, intervalMs: 60000 });
  const connection = { endpoint: 'synthetic-endpoint', onAuthorization() {} };
  await service.start(selection, connection); const poll = service.poll(); await writing; const stopped = service.stop();
  await expect(service.start(selection, connection)).rejects.toThrow();
  release(); await stopped; await poll;
});


it('schedules observation and stops scheduling after shutdown', async () => {
  vi.useFakeTimers();
  try {
    const h = fixture(); const service = new T3Service({ enabled: true, store: h.store, openSession: h.openSession, now: () => now, intervalMs: 1000 });
    await service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
    await vi.advanceTimersByTimeAsync(1000); expect(h.calls).toHaveLength(1);
    await service.stop(); await vi.advanceTimersByTimeAsync(10000); expect(h.calls).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});

it('PROBE stop waits for in-progress opening before allowing restart', async () => {
  const h = fixture(); let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const opening = new Promise<void>(r => { entered = r; });
  let opens = 0;
  const service = new T3Service({ enabled: true, store: h.store, now: () => now, openSession: async () => { if (++opens === 1) { entered(); await barrier; } return h.openSession(); }});
  const connection = { endpoint: 'synthetic-endpoint', onAuthorization() {} };
  const start = service.start(selection, connection); const startResult = start.catch(() => {}); await opening;
  const stopped = service.stop(); await stopped;
  let accepted = false; const second = service.start(selection, connection).then(() => { accepted = true; }, () => {}); await second;
  release(); await startResult; await service.stop(); expect(accepted).toBe(false);
});

it('PROBE concurrent stop callers both wait for session cleanup', async () => {
  const h = fixture(); let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const closing = new Promise<void>(r => { entered = r; });
  const service = new T3Service({ enabled: true, store: h.store, now: () => now, openSession: async () => { const session = await h.openSession(); return { ...session, async close() { entered(); await barrier; } }; }});
  await service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  const first = service.stop(); await closing; let secondFinished = false; const second = service.stop().then(() => { secondFinished = true; });
  await second; release(); await first; expect(secondFinished).toBe(false);
});

it('PROBE real client-style cleanup sees service abort before close', async () => {
  const h = fixture(); let abortedAtClose = false;
  const service = new T3Service({ enabled: true, store: h.store, now: () => now, openSession: async options => { const session = await h.openSession(); return { ...session, async close() { abortedAtClose = !!options.signal?.aborted; if (abortedAtClose) throw Error('cleanup uncertain'); } }; }});
  await service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  await expect(service.stop()).resolves.toBeUndefined(); expect(abortedAtClose).toBe(false);
});

it('PROBE failed client session releases service for recovery', async () => {
  const h = fixture(); let calls = 0;
  const service = new T3Service({ enabled: true, store: h.store, now: () => now, openSession: async () => { const session = await h.openSession(); return { ...session, async callTool() { calls++; throw Error('session closed by client after failure'); } }; }});
  const connection = { endpoint: 'synthetic-endpoint', onAuthorization() {} };
  await service.start(selection, connection); expect((await service.poll())?.mode).toBe('offline');
  const restart = service.start(selection, connection); await expect(restart).resolves.toBeUndefined(); await service.stop();
});

it('PROBE failed commit holds restart until session cleanup finishes', async () => {
  const h = fixture(); let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const closing = new Promise<void>(r => { entered = r; }); let opens = 0;
  const store = { ...h.store, async commitIfCurrent() { throw Error('unavailable'); } };
  const service = new T3Service({ enabled: true, store, now: () => now, openSession: async () => { const session = await h.openSession(); if (++opens !== 1) return session; return { ...session, async close() { entered(); await barrier; } }; }});
  const connection = { endpoint: 'synthetic-endpoint', onAuthorization() {} };
  await service.start(selection, connection); const poll = service.poll().catch(() => {}); await closing;
  let accepted = false; await service.start(selection, connection).then(() => { accepted = true; }, () => {});
  release(); await poll; await service.stop(); expect(accepted).toBe(false);
});
