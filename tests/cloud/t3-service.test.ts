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

it('exposes only committed activity and clears it when the session stops', async () => {
  const h = fixture(); const service = new T3Service({ enabled: true, store: h.store, openSession: h.openSession, now: () => now, intervalMs: 60000 });
  await service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  expect(service.activity()).toBeUndefined();
  await service.poll();
  const activity = service.activity()!;
  expect(activity.mode).toBe('current');
  activity.items.length = 0;
  expect(service.activity()!.items).toHaveLength(1);
  await service.stop();
  expect(service.activity()).toBeUndefined();
});

it('returns bounded pending questions for manual resolution in T3', async () => {
  const h = fixture();
  const openSession = async () => { const session = await h.openSession(); return { ...session, toolNames: ['t3_thread_read', 't3_pending_request'],
    async callTool(name: string, args: Record<string, unknown>) {
      if (name !== 't3_pending_request') return session.callTool(name, args);
      if (args.action === 'list') return { structuredContent: { requestIds: ['request'] } };
      return { structuredContent: { requestId: 'request', questions: [{ id: 'choice', header: 'Question', question: 'Choose one', options: [{ label: 'Yes', description: '' }] }] } };
    } }; };
  const service = new T3Service({ enabled: true, store: h.store, openSession, now: () => now, intervalMs: 60000 });
  await service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  expect(await service.questions()).toMatchObject({ resolution: 'open_in_t3', questions: [{ requestId: 'request' }] });
  await service.stop();
});

it('marks the last committed activity offline when a subsequent read fails', async () => {
  const h = fixture(); let clock = now; let fail = false;
  const openSession = async () => { const session = await h.openSession(); return { ...session,
    async callTool(...args: Parameters<typeof session.callTool>) { if (fail) throw Error('offline'); return session.callTool(...args); } }; };
  const service = new T3Service({ enabled: true, store: h.store, openSession, now: () => clock, intervalMs: 60000 });
  await service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  await service.poll(); fail = true; clock += 1000;
  await service.poll();
  expect(service.activity()?.mode).toBe('offline');
  await service.stop();
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
  let revoked!: () => void; const revocationDone = new Promise<void>(resolve => { revoked = resolve; });
  const store = { ...h.store, async revoke(...args: Parameters<T3ServiceStore['revoke']>) { await h.store.revoke(...args); revoked(); } };
  const openSession = async () => { const session = await h.openSession(); const call = session.callTool;
    return { ...session, async callTool(...args: Parameters<typeof call>) { entered(); await barrier; return call(...args); } }; };
  const service = new T3Service({ enabled: true, store, openSession, now: () => now, intervalMs: 60000 });
  await service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  const poll = service.poll().catch(() => undefined); await readStarted; const revoking = service.revoke();
  await revocationDone; release(); await revoking; await poll;
  expect(h.checkpoint()).toBeUndefined(); expect(h.current().grant.revoked).toBe(true); expect(h.closes()).toBe(1);
});

it('closes a session returned after shutdown during startup and never schedules a read', async () => {
  const h = fixture(); let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const opening = new Promise<void>(r => { entered = r; });
  const openSession = async () => { entered(); await barrier; return h.openSession(); };
  const service = new T3Service({ enabled: true, store: h.store, openSession, now: () => now });
  const start = service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  const rejected = expect(start).rejects.toThrow();
  await opening; const stopping = service.stop(); release(); await rejected; await stopping;
  expect(h.closes()).toBe(1); expect(h.calls).toHaveLength(0);
});

it('stops the session when canonical authority is revoked outside the service', async () => {
  const h = fixture(); const service = new T3Service({ enabled: true, store: h.store, openSession: h.openSession, now: () => now, intervalMs: 60000 });
  await service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} });
  h.current().grant.revoked = true;
  await service.poll(); await service.stop();
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

it('keeps all stop callers fenced until a held open and cleanup settle', async () => {
  const h = fixture(); let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const opening = new Promise<void>(r => { entered = r; });
  const service = new T3Service({ enabled: true, store: h.store, openSession: async () => { entered(); await barrier; return h.openSession(); }, now: () => now, storeTimeoutMs: 50 });
  const connection = { endpoint: 'synthetic-endpoint', onAuthorization() {} };
  const starting = service.start(selection, connection).catch(() => {}); await opening;
  const stops = [service.stop(), service.stop()].map(p => p.catch(e => e));
  await Promise.all(stops); await expect(service.start(selection, connection)).rejects.toMatchObject({ code: 'conflict' });
  release(); await starting; await service.stop(); expect(h.closes()).toBe(1);
});

it('returns an explicit pending result while a late commit still fences restart', async () => {
  const h = fixture(); let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const writing = new Promise<void>(r => { entered = r; });
  const store = { ...h.store, async commitIfCurrent(...args: Parameters<T3ServiceStore['commitIfCurrent']>) { entered(); await barrier; return h.store.commitIfCurrent(...args); } };
  const service = new T3Service({ enabled: true, store, openSession: h.openSession, now: () => now, intervalMs: 60000, storeTimeoutMs: 30 });
  const connection = { endpoint: 'synthetic-endpoint', onAuthorization() {} };
  await service.start(selection, connection); const poll = service.poll(); await writing;
  await expect(poll).rejects.toMatchObject({ code: 'pending' });
  await expect(service.stop()).rejects.toMatchObject({ code: 'pending' });
  await expect(service.start(selection, connection)).rejects.toMatchObject({ code: 'conflict' });
  release(); await service.stop(); expect(h.checkpoint()).toBeDefined();
  await service.start(selection, connection); await service.stop();
});

it('fences starts when a load or revoke outcome is still pending', async () => {
  const h = fixture(); let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const waiting = new Promise<void>(r => { entered = r; });
  const store = { ...h.store, async load(...args: Parameters<T3ServiceStore['load']>) { entered(); await barrier; return h.store.load(...args); } };
  const service = new T3Service({ enabled: true, store, openSession: h.openSession, now: () => now, storeTimeoutMs: 30 });
  const connection = { endpoint: 'synthetic-endpoint', onAuthorization() {} };
  const start = service.start(selection, connection); await waiting;
  await expect(start).rejects.toMatchObject({ code: 'pending' });
  await expect(service.start(selection, connection)).rejects.toMatchObject({ code: 'conflict' });
  release(); await service.stop();
});

it('keeps revocation pending and fenced until its actual outcome is known', async () => {
  const h = fixture(); let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const waiting = new Promise<void>(r => { entered = r; });
  const store = { ...h.store, async revoke(...args: Parameters<T3ServiceStore['revoke']>) { entered(); await barrier; await h.store.revoke(...args); } };
  const service = new T3Service({ enabled: true, store, openSession: h.openSession, now: () => now, storeTimeoutMs: 30 });
  const connection = { endpoint: 'synthetic-endpoint', onAuthorization() {} };
  await service.start(selection, connection); const revoke = service.revoke(); await waiting;
  await expect(revoke).rejects.toMatchObject({ code: 'pending' });
  await expect(service.start(selection, connection)).rejects.toMatchObject({ code: 'conflict' });
  release(); await service.stop();
  await expect(service.start(selection, connection)).rejects.toMatchObject({ code: 'revoked' });
});

it('surfaces a timed out authority read and fences the still-running load', async () => {
  const h = fixture(); let hold = false; let release!: () => void; let entered!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const waiting = new Promise<void>(r => { entered = r; });
  const store = { ...h.store, async load(...args: Parameters<T3ServiceStore['load']>) { if (hold) { entered(); await barrier; } return h.store.load(...args); } };
  const service = new T3Service({ enabled: true, store, openSession: h.openSession, now: () => now, storeTimeoutMs: 30 });
  const connection = { endpoint: 'synthetic-endpoint', onAuthorization() {} };
  await service.start(selection, connection); hold = true;
  const poll = service.poll(); await waiting; await expect(poll).rejects.toMatchObject({ code: 'pending' });
  expect(service.status()).toBe('pending');
  await expect(service.start(selection, connection)).rejects.toMatchObject({ code: 'conflict' });
  release(); await service.stop();
});

it('fences an authority read abandoned by the adapter deadline before the store deadline', async () => {
  vi.useFakeTimers();
  try {
    const h = fixture(); let hold = false; let reads = 0; let release!: () => void; let entered!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const store = { ...h.store, async load(...args: Parameters<T3ServiceStore['load']>) {
      if (hold) { reads++; entered(); await barrier; }
      return h.store.load(...args);
    } };
    const service = new T3Service({ enabled: true, store, openSession: h.openSession, now: () => now + Date.now(), intervalMs: 60000, storeTimeoutMs: 6000 });
    // Keep the synthetic clock inside the grant lifetime while allowing the observer's throttle to advance.
    vi.setSystemTime(0);
    const connection = { endpoint: 'synthetic-endpoint', onAuthorization() {} };
    await service.start(selection, connection); hold = true;
    const poll = service.poll(); const result = poll.catch(error => error); await waiting;
    await vi.advanceTimersByTimeAsync(6000);
    expect(await result).toMatchObject({ code: 'pending' });
    expect(service.status()).toBe('pending');
    await service.poll();
    expect(reads).toBe(1);
    await expect(service.start(selection, connection)).rejects.toMatchObject({ code: 'conflict' });
    release(); await service.stop();
  } finally { vi.useRealTimers(); }
});

it('fences a post-call authority read that outlives the enclosing adapter deadline', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(0);
    const h = fixture(); let hold = false; let reads = 0; let release!: () => void; let entered!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const store = { ...h.store, async load(...args: Parameters<T3ServiceStore['load']>) {
      if (hold) { reads++; entered(); await barrier; }
      return h.store.load(...args);
    } };
    const openSession = async () => { const session = await h.openSession(); return { ...session,
      async callTool(...args: Parameters<typeof session.callTool>) {
        await new Promise(resolve => setTimeout(resolve, 4000)); hold = true; return session.callTool(...args);
      } }; };
    const service = new T3Service({ enabled: true, store, openSession, now: () => now + Date.now(), intervalMs: 60000, storeTimeoutMs: 6000 });
    const connection = { endpoint: 'synthetic-endpoint', onAuthorization() {} };
    await service.start(selection, connection);
    const result = service.poll().catch(error => error);
    await vi.advanceTimersByTimeAsync(4000); await waiting;
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toMatchObject({ code: 'pending' });
    await service.poll(); expect(reads).toBe(1);
    await expect(service.start(selection, connection)).rejects.toMatchObject({ code: 'conflict' });
    release(); await service.stop();
  } finally { vi.useRealTimers(); }
});

it('fences an abandoned connector read until the connector actually settles', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(0);
    const h = fixture(); let release!: () => void; let entered!: () => void; let calls = 0;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const openSession = async () => { const session = await h.openSession(); return { ...session,
      async callTool(...args: Parameters<typeof session.callTool>) { calls++; entered(); await barrier; return session.callTool(...args); } }; };
    const service = new T3Service({ enabled: true, store: h.store, openSession, now: () => now + Date.now(), intervalMs: 60000, storeTimeoutMs: 6000 });
    const connection = { endpoint: 'synthetic-endpoint', onAuthorization() {} };
    await service.start(selection, connection);
    const result = service.poll().catch(error => error); await waiting;
    await vi.advanceTimersByTimeAsync(7000);
    expect(await result).toMatchObject({ code: 'pending' });
    await service.poll(); expect(calls).toBe(1);
    await expect(service.start(selection, connection)).rejects.toMatchObject({ code: 'conflict' });
    release(); await service.stop();
  } finally { vi.useRealTimers(); }
});

it('retains terminal session status when a scheduled poll consumes the result', async () => {
  vi.useFakeTimers();
  try {
    const h = fixture(); let ended = false;
    const openSession = async () => { const session = await h.openSession(); return { ...session, get closed() { return ended; } }; };
    const service = new T3Service({ enabled: true, store: h.store, openSession, now: () => now, intervalMs: 1000 });
    const connection = { endpoint: 'synthetic-endpoint', onAuthorization() {} };
    await service.start(selection, connection); ended = true;
    await vi.advanceTimersByTimeAsync(1000); await service.stop();
    expect(service.status()).toBe('session_ended'); expect(service.sessionEnded()).toBe(true);
    await service.start(selection, connection); expect(service.sessionEnded()).toBe(false); await service.stop();
  } finally { vi.useRealTimers(); }
});

it('retains uncertainty when an aborted open reports an unconfirmed delivery', async () => {
  const h = fixture(); let entered!: () => void;
  const opening = new Promise<void>(r => { entered = r; });
  const { T3ConnectionError } = await import('../../apps/cloud/src/integrations/t3/client/boundary');
  let attempts = 0;
  const openSession = async (options: import('../../apps/cloud/src/integrations/t3/client').LocalT3SessionOptions): Promise<import('../../apps/cloud/src/integrations/t3/client').LocalT3Session> => {
    if (attempts++ > 0) return h.openSession();
    entered(); await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => resolve(), { once: true }));
    throw new T3ConnectionError('cancelled', 'cleanup', 'uncertain');
  };
  const service = new T3Service({ enabled: true, store: h.store, openSession, now: () => now });
  const start = service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} }).catch(() => {});
  await opening; await expect(service.stop()).rejects.toMatchObject({ delivery: 'uncertain' }); await start;
  expect(service.status()).toBe('cleanup_unconfirmed');
  await expect(service.start(selection, { endpoint: 'synthetic-endpoint', onAuthorization() {} })).rejects.toMatchObject({ code: 'unavailable' });
  expect(service.status()).toBe('cleanup_unconfirmed');
});
