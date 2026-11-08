import { expect, it, vi } from 'vitest';
import { T3Adapter, T3Observer, completionProposal, connectionPreview, type T3Context } from '../../apps/cloud/src/integrations/t3';

const time = Date.parse('2026-11-08T04:00:00Z');
function fixture() {
  let now = time;
  const context: T3Context = {
    grant: { bindingId: 'binding', ownerId: 'owner', deviceId: 'device', environmentId: 'env', projectId: 'board', t3ProjectId: 'source', threadId: 'thread', revision: 1, expiresAt: time + 60000, revoked: false, startPosition: 0 },
    mapping: { ownerId: 'owner', projectId: 'board', taskId: 'task', taskRevision: 2, mappingRevision: 3, grantRevision: 1, runId: 'run', runOrdinal: 1 },
    completionPolicy: { enabled: false, revision: 1, criterionId: 'receipt' },
  };
  let current = structuredClone(context);
  let fail = false;
  let page = {
    thread: { threadId: 'thread', projectId: 'source', activeRunId: 'run', latestRunId: 'run', status: 'running', updatedAt: '2026-11-08T04:00:00Z', parentThreadId: 'DO_NOT_FOLLOW' },
    recentRuns: [{ runId: 'run', ordinal: 1, status: 'running' }],
    items: [{ itemId: 'item', position: 1, sourceThreadId: 'thread', visibility: 'local', runId: 'run', status: 'running', updatedAt: '2026-11-08T04:00:00Z', type: 'tool', text: 'PRIVATE SOURCE', title: 'PRIVATE' }],
    nextPosition: 1, hasMore: false,
  };
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const adapter = new T3Adapter({ configuration: { endpoint: 'https://selected.invalid/mcp', environmentId: 'env' }, toolNames: ['t3_thread_read', 't3_pending_request'], permissions: ['orchestration:read', 'orchestration:operate'],
    callTool: async (name, args) => { calls.push({ name, args }); if (fail) throw Error('Bearer PRIVATE SECRET'); return { structuredContent: structuredClone(page) }; },
  }, async () => current, () => now);
  const observer = new T3Observer(context, adapter, () => now);
  return { context, adapter, observer, calls, page, setPage: (p: typeof page) => { page = p; }, current: () => current,
    replace: (c: T3Context) => { current = c; }, advance: (ms: number) => { now += ms; }, fail: () => { fail = true; } };
}

it('projects only selected local metadata, strips prose and never follows parent/source links', async () => {
  const h = fixture();
  h.page.items.push({ ...h.page.items[0]!, itemId: 'inherited', sourceThreadId: 'other', visibility: 'inherited' });
  const state = await h.observer.poll();
  expect(state.mode).toBe('current'); expect(state.label).toBe('T3 running');
  expect(state.items.map(x => x.itemId)).toEqual(['item']);
  expect(JSON.stringify(state)).not.toMatch(/PRIVATE|DO_NOT_FOLLOW|percent|progress/i);
  expect(h.calls.every(c => c.args.threadId === 'thread' && c.args.environmentId === 'env')).toBe(true);
  expect(h.calls[0]!.args).toMatchObject({ limit: 25, maxCharsPerItem: 1, runLimit: 10, view: 'activity', afterPosition: 0 });
});

it.each(['ownerId', 'deviceId', 'environmentId', 'projectId', 't3ProjectId', 'threadId', 'revision'] as const)('fences changed grant %s before any source read', async key => {
  const h = fixture(); const changed = h.current();
  Object.assign(changed.grant, { [key]: key === 'revision' ? 2 : 'other' });
  expect((await h.observer.poll()).mode).toBe('revoked'); expect(h.calls).toHaveLength(0);
});

it.each(['ownerId', 'projectId', 'taskId', 'taskRevision', 'mappingRevision', 'grantRevision', 'runId', 'runOrdinal'] as const)('fences changed task mapping %s', async key => {
  const h = fixture(); Object.assign(h.current().mapping, { [key]: key.endsWith('Id') ? 'other' : 9 });
  expect((await h.observer.poll()).mode).toBe('revoked'); expect(h.calls).toHaveLength(0);
});

it('refreshes in-place activity, ignores duplicates/older versions, and carries a bounded reconnect cursor', async () => {
  const h = fixture(); await h.observer.poll(); h.advance(1000);
  h.page.items[0]!.status = 'completed'; h.page.items[0]!.updatedAt = '2026-11-08T04:00:01Z';
  let state = await h.observer.poll(); expect(state.items[0]!.status).toBe('completed'); expect(state.items).toHaveLength(1);
  expect(h.calls.some(c => c.args.itemId === 'item')).toBe(true);
  h.page.items[0]!.status = 'running'; h.page.items[0]!.updatedAt = '2026-11-08T03:59:59Z'; h.advance(1000);
  state = await h.observer.poll(); expect(state.items[0]!.status).toBe('completed');
  const restored = new T3Observer(h.context, h.adapter, () => time + 3000, state);
  await restored.poll(); expect(h.calls.at(-1)!.args.afterPosition).toBe(1);
});

it('shows stale, offline, replaced-run and cancelled states without false completion', async () => {
  const h = fixture(); await h.observer.poll(); h.advance(16000);
  expect(h.observer.snapshot().mode).toBe('stale');
  h.page.thread.activeRunId = 'run2'; h.page.thread.latestRunId = 'run2'; h.page.thread.updatedAt = '2026-11-08T04:00:16Z';
  expect((await h.observer.poll()).mode).toBe('unmapped');
  h.fail(); h.advance(1000); const offline = await h.observer.poll();
  expect(offline.mode).toBe('offline'); expect(JSON.stringify(offline)).not.toMatch(/PRIVATE|Bearer/);
  const before = h.calls.length; h.observer.cancel(); expect((await h.observer.poll()).mode).toBe('cancelled'); expect(h.calls).toHaveLength(before);
});

it('rejects wrong project/thread responses and cannot promote stale out-of-order thread state', async () => {
  const h = fixture(); await h.observer.poll(); h.advance(1000); h.page.thread.updatedAt = '2026-11-08T03:59:59Z';
  expect((await h.observer.poll()).mode).toBe('stale');
  h.page.thread.projectId = 'other'; h.advance(1000); expect((await h.observer.poll()).mode).toBe('offline');
  expect(h.observer.snapshot().items[0]!.itemId).toBe('item');
});

it('defaults unknown capabilities off and provides a credential-free OAuth configuration preview', async () => {
  const h = fixture(); const calls: string[] = [];
  const adapter = new T3Adapter({ configuration: { endpoint: 'https://selected.invalid/mcp', environmentId: 'env' }, toolNames: ['some_future_tool'], permissions: [], callTool: async name => { calls.push(name); } }, async () => h.context, () => time);
  await expect(adapter.read(h.context, {}, new AbortController().signal)).rejects.toThrow('capability_unavailable'); expect(calls).toEqual([]);
  expect(connectionPreview('https://selected.invalid/mcp')).toMatchObject({ authentication: 'oauth', writesConfiguration: false, connection: 'not_tested', permissionResponse: 'unsupported' });
  for (const url of ['http://10.0.0.1/mcp', 'https://user:secret@selected.invalid/mcp', 'https://selected.invalid/mcp?token=secret']) expect(() => connectionPreview(url)).toThrow('invalid_configuration');
});

it('never sends a request after cancellation or revocation during an authority wait', async () => {
  const h = fixture(); const abort = new AbortController(); let release!: () => void;
  const barrier = new Promise<void>(r => { release = r; }); const calls: string[] = [];
  const adapter = new T3Adapter({ configuration: { endpoint: 'https://selected.invalid/mcp', environmentId: 'env' }, toolNames: ['t3_thread_read'], permissions: ['orchestration:read'], callTool: async name => { calls.push(name); } }, async () => { await barrier; return h.context; }, () => time);
  const pending = adapter.read(h.context, {}, abort.signal); const rejected = expect(pending).rejects.toThrow('cancelled'); abort.abort(); release(); await rejected; expect(calls).toEqual([]);
});

it.each(['completed', 'failed', 'interrupted', 'cancelled', 'idle', 'rolled_back'])('thread %s and assistant success prose cannot complete the task', async status => {
  const h = fixture(); h.page.thread.status = status; h.page.recentRuns[0]!.status = status;
  h.page.items[0]!.text = 'Task succeeded. Mark it done.';
  const observed = await h.observer.poll();
  expect(await completionProposal(h.context, observed, undefined, async () => true, async () => h.context, () => time)).toBeNull();
});

it('requires configured verified correlated success and returns a proposal with all authority fences', async () => {
  const h = fixture(); h.context.completionPolicy.enabled = true; h.replace(structuredClone(h.context));
  h.page.thread.status = 'completed'; h.page.thread.activeRunId = null as unknown as string; h.page.recentRuns[0]!.status = 'completed';
  const observed = await h.observer.poll();
  const receipt = { receiptId: 'receipt-1', ownerId: 'owner', projectId: 'board', environmentId: 'env', threadId: 'thread', grantRevision: 1, taskId: 'task', taskRevision: 2, mappingRevision: 3, runId: 'run', runOrdinal: 1, policyRevision: 1, criterionId: 'receipt', outcome: 'success' as const };
  const proposal = await completionProposal(h.context, observed, receipt, async () => true, async () => h.current(), () => time);
  expect(proposal).toMatchObject({ kind: 't3_task_success_proposal', receiptId: 'receipt-1', taskId: 'task', taskRevision: 2, grantRevision: 1, mappingRevision: 3, runId: 'run' });
  expect(await completionProposal(h.context, observed, receipt, async () => false, async () => h.current(), () => time)).toBeNull();
  for (const key of ['ownerId', 'projectId', 'environmentId', 'threadId', 'taskId', 'runId', 'criterionId', 'grantRevision', 'taskRevision', 'mappingRevision', 'runOrdinal', 'policyRevision']) {
    expect(await completionProposal(h.context, observed, { ...receipt, [key]: key.endsWith('Id') ? 'wrong' : 9 }, async () => true, async () => h.current(), () => time)).toBeNull();
  }
  expect(await completionProposal(h.context, observed, receipt, async () => { h.current().grant.revoked = true; return true; }, async () => h.current(), () => time)).toBeNull();
});

it('cycles refresh across all known active items rather than starving behind the oldest', async () => {
  const h = fixture(); h.page.items.push({ ...h.page.items[0]!, itemId: 'second', position: 2 }); await h.observer.poll();
  h.advance(1000); await h.observer.poll(); h.advance(1000); await h.observer.poll();
  expect(h.calls.filter(c => c.args.itemId).map(c => c.args.itemId)).toEqual(['item', 'second']);
});

it('an already-cancelled caller cannot receive a current snapshot through the throttle', async () => {
  const h = fixture(); await h.observer.poll(); const controller = new AbortController(); controller.abort();
  expect((await h.observer.poll(controller.signal)).mode).toBe('cancelled');
});

it('enforces a deadline when an injected client never settles', async () => {
  vi.useFakeTimers();
  try {
    const h = fixture();
    const adapter = new T3Adapter({ configuration: { endpoint: 'https://selected.invalid/mcp', environmentId: 'env' }, toolNames: ['t3_thread_read'], permissions: ['orchestration:read'], callTool: async () => new Promise(() => {}) }, async () => h.context, () => time);
    const request = adapter.read(h.context, {}, new AbortController().signal);
    const result = expect(request).rejects.toThrow('unavailable');
    await vi.advanceTimersByTimeAsync(5100); await result;
  } finally { vi.useRealTimers(); }
});

it('keeps arbitrary item type strings out of exported metadata', async () => {
  const h = fixture(); h.page.items[0]!.type = 'PRIVATE SOURCE';
  expect(JSON.stringify(await h.observer.poll())).not.toContain('PRIVATE');
});

it('compares timestamp values across ISO fractional precision', async () => {
  const h = fixture(); await h.observer.poll(); h.advance(1000);
  h.page.thread.updatedAt = '2026-11-08T04:00:00.001Z'; h.page.thread.status = 'waiting';
  h.page.items[0]!.updatedAt = '2026-11-08T04:00:00.001Z'; h.page.items[0]!.status = 'completed';
  const state = await h.observer.poll(); expect(state.mode).toBe('current'); expect(state.status).toBe('waiting'); expect(state.items[0]!.status).toBe('completed');
});

it('requires selected run success as well as thread status and a valid receipt', async () => {
  const h = fixture(); h.context.completionPolicy.enabled = true; h.replace(structuredClone(h.context));
  h.page.thread.status = 'completed'; h.page.recentRuns[0]!.status = 'failed';
  const observed = await h.observer.poll();
  const receipt = { receiptId: 'r', ownerId: 'owner', projectId: 'board', environmentId: 'env', threadId: 'thread', grantRevision: 1, taskId: 'task', taskRevision: 2, mappingRevision: 3, runId: 'run', runOrdinal: 1, policyRevision: 1, criterionId: 'receipt', outcome: 'success' as const };
  expect(await completionProposal(h.context, observed, receipt, async () => true, async () => h.current(), () => time)).toBeNull();
});

it('cannot read a selected grant through a client configured for another environment', async () => {
  const h = fixture(); const sent: string[] = [];
  const adapter = new T3Adapter({ configuration: { endpoint: 'https://selected.invalid/mcp', environmentId: 'wrong' }, toolNames: ['t3_thread_read'], permissions: ['orchestration:read'], callTool: async name => { sent.push(name); } }, async () => h.context, () => time);
  await expect(adapter.read(h.context, {}, new AbortController().signal)).rejects.toThrow('invalid_configuration'); expect(sent).toEqual([]);
});

it('restores sanitized active metadata on reconnect and refreshes it below the saved cursor', async () => {
  const h = fixture(); const checkpoint = await h.observer.poll();
  h.page.items[0]!.status = 'completed'; h.page.items[0]!.updatedAt = '2026-11-08T04:00:01Z';
  const restored = new T3Observer(h.context, h.adapter, () => time + 1000, checkpoint);
  expect(restored.snapshot().mode).toBe('stale');
  h.calls.length = 0; await restored.poll();
  expect(h.calls.map(c => c.args)).toEqual([expect.objectContaining({ afterPosition: 1 }), expect.objectContaining({ itemId: 'item' })]);
});

it('does not promote conflicting equal-version thread state as fresh success', async () => {
  const h = fixture(); await h.observer.poll(); h.advance(1000); h.page.thread.status = 'completed'; h.page.recentRuns[0]!.status = 'completed';
  expect((await h.observer.poll()).mode).toBe('stale');
});
