// SYNTHETIC guard evidence only: no installed Codex process or source reads.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CodexObserver, LocalBinding, Observation, ObservationBatch, SourceCursor } from '@living-playbooks/contracts';
import { ADAPTER, VERSION, digest, makeCursor } from '../../packages/codex-observer/src/cursor';
import { localBinding, selectedThread } from '../../fixtures/codex/synthetic';
import { runObserverGate, type GateClock } from '../live/observer';

const start = Date.parse('2026-11-07T18:00:00.000Z');
const iso = (ms: number) => new Date(start + ms).toISOString();
const env = {
  LP_LIVE_TEST_OPT_IN: '1', LP_OBSERVER_LOCAL_READ_CONSENT: '1',
  LP_SYNTHETIC_SOURCE_NAME: 'Synthetic harmless observer guard',
  LP_SELECTED_SOURCE: selectedThread, CODEX_THREAD_ID: selectedThread,
  LP_OBSERVER_WAIT_MS: '5000', LP_OBSERVER_POLL_MS: '1000',
};
const cursor = (offset: number, baseline = false) => makeCursor(selectedThread, 'a'.repeat(64), 'turn', Array.from({ length: offset }, (_, id) => ({ id: `synthetic-${id}`, type: 'agentMessage' })), offset, baseline);
const batch = (offset: number, observations: Observation[] = [], baseline = false): ObservationBatch => ({
  observations, nextCursor: cursor(offset, baseline), mode: 'incremental_history', lastObservedAt: observations.length ? iso(offset * 1000) : null, coverage: 'SYNTHETIC completed items only',
});
const clock: GateClock = {
  now: () => Date.now(),
  sleep: (ms, signal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(Error('cancelled')); return; }
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(Error('cancelled')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  }),
};

function rig() {
  let binding = structuredClone(localBinding) as LocalBinding;
  const observation = (sourceItemId: string, completedMs: number, overrides: Partial<Observation> = {}): Observation => ({
    id: '11111111-1111-4111-8111-111111111111', bindingId: binding.binding.id, grantRevision: binding.binding.grantRevision,
    sourceItemId, sourceRevision: 'safe revision', kind: 'assistant_report', metadata: { type: 'message', role: 'assistant' },
    occurredAt: iso(completedMs), observedAt: new Date().toISOString(),
    provenance: { adapterId: ADAPTER, adapterVersion: VERSION, mode: 'fixture', evidenceLevel: 'agent_reported' }, ...overrides,
  });
  const probe = vi.fn(async () => ({ available: true, adapterId: ADAPTER, adapterVersion: VERSION, installedVersion: VERSION, capability: 'incremental_history' as const, reason: 'SYNTHETIC', coverage: 'SYNTHETIC' }));
  const readDelta = vi.fn(async (input: LocalBinding, _cursor: SourceCursor | null, _signal: AbortSignal) => { binding = input; return batch(0, [], true); });
  const stop = vi.fn(async (_id: string) => {});
  const observer: CodexObserver = { probe, readDelta, stop };
  const createObserver = vi.fn(() => observer);
  const abort = new AbortController();
  const run = (settings = env, evidence: 'synthetic_guard' | 'installed_source_observation' = 'synthetic_guard') => runObserverGate(settings, {
    createObserver, clock, cwd: 'C:\\synthetic-project', signal: abort.signal, evidence,
  });
  return { observation, probe, readDelta, stop, createObserver, abort, run, binding: () => binding };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(start); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('SYNTHETIC observer gate; never live acceptance', () => {
  it('waits for future work after enrollment instead of exhausting immediate reads', async () => {
    const r = rig(); const result = r.run(); await vi.advanceTimersByTimeAsync(0);
    expect(r.readDelta).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ status: 'blocked', reason: 'no_two_fresh_items', freshItems: 0, baselineEnrolled: true, elapsedMs: 5000, cleanup: 'stopped' });
    expect(r.readDelta).toHaveBeenCalledTimes(5);
    expect(r.stop).toHaveBeenCalledExactlyOnceWith(r.binding().binding.id);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('deduplicates source identities within and across batches despite changed observation IDs/revisions', async () => {
    const r = rig(); const result = r.run(); await vi.advanceTimersByTimeAsync(0);
    r.readDelta.mockResolvedValue(batch(1, [r.observation('turn/one', 500), r.observation('turn/one', 500)]));
    await vi.advanceTimersByTimeAsync(1000);
    r.readDelta.mockResolvedValue(batch(2, [r.observation('turn/one', 1500, { id: '22222222-2222-4222-8222-222222222222', sourceRevision: 'changed replay revision' })]));
    await vi.advanceTimersByTimeAsync(1000); expect(r.stop).not.toHaveBeenCalled();
    r.readDelta.mockResolvedValue(batch(3, [r.observation('turn/two', 2500)]));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ status: 'passed', freshItems: 2, duplicates: 2, elapsedMs: 3000, evidence: 'synthetic_guard', liveAcceptance: false, cleanup: 'stopped' });
    expect((await result).items.map(i => i.identitySha256)).toEqual([digest('turn/one'), digest('turn/two')]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cannot pass on only old/future timestamps, duplicates or a replayed cursor', async () => {
    const r = rig(); const result = r.run(); await vi.advanceTimersByTimeAsync(0);
    r.readDelta.mockResolvedValue(batch(1, [r.observation('turn/old', -1), r.observation('turn/future', 9000), r.observation('turn/one', 500)]));
    await vi.advanceTimersByTimeAsync(1000);
    r.readDelta.mockResolvedValue(batch(1, [r.observation('turn/replayed-cursor', 1500), r.observation('turn/one', 500)]));
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toMatchObject({ status: 'blocked', reason: 'no_two_fresh_items', freshItems: 1, liveAcceptance: false });
  });

  it('can wait beyond the old 15-second cap for two externally supplied completed items', async () => {
    const r = rig(); const result = r.run({ ...env, LP_OBSERVER_WAIT_MS: '60000' }); await vi.advanceTimersByTimeAsync(0);
    r.readDelta.mockImplementation(async () => {
      const elapsed = Date.now() - start;
      if (elapsed < 18000) return batch(0, [], true);
      if (elapsed < 38000) return batch(1, [r.observation('turn/one', 17500)]);
      return batch(2, [r.observation('turn/two', 37500)]);
    });
    await vi.advanceTimersByTimeAsync(37000); expect(r.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ status: 'passed', freshItems: 2, elapsedMs: 38000, liveAcceptance: false });
  });

  it('keeps its accepted cursor when an earlier cursor is replayed', async () => {
    const r = rig(); const result = r.run(); await vi.advanceTimersByTimeAsync(0);
    r.readDelta.mockResolvedValue(batch(1, [r.observation('turn/one', 500)])); await vi.advanceTimersByTimeAsync(1000);
    r.readDelta.mockResolvedValue(batch(2)); await vi.advanceTimersByTimeAsync(1000);
    r.readDelta.mockResolvedValue(batch(1, [r.observation('turn/one', 500)])); await vi.advanceTimersByTimeAsync(1000);
    r.readDelta.mockResolvedValue(batch(3, [r.observation('turn/two', 3500)])); await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ status: 'passed', freshItems: 2 });
    expect(r.readDelta.mock.calls.at(-1)?.[1]).toEqual(cursor(2));
  });

  it.each([
    { LP_LIVE_TEST_OPT_IN: '' }, { LP_OBSERVER_LOCAL_READ_CONSENT: 'true' }, { LP_SYNTHETIC_SOURCE_NAME: '   ' },
    { LP_SELECTED_SOURCE: 'foreign' }, { LP_SELECTED_SOURCE: 'invalid', CODEX_THREAD_ID: 'invalid' }, { CODEX_THREAD_ID: '' }, { LP_OBSERVER_WAIT_MS: 'Infinity' },
    { LP_OBSERVER_WAIT_MS: '300001' }, { LP_OBSERVER_WAIT_MS: '999' }, { LP_OBSERVER_POLL_MS: '0' }, { LP_OBSERVER_POLL_MS: '100ms' },
  ])('blocks before observer creation on missing consent/identity or unbounded config: %j', async overrides => {
    const r = rig();
    expect(await r.run({ ...env, ...overrides })).toMatchObject({ status: 'blocked', cleanup: 'not_started', liveAcceptance: false });
    expect(r.createObserver).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each([{ available: false }, { adapterId: 'foreign' }, { adapterVersion: 'other' }, { installedVersion: 'other' }, { capability: 'unavailable' }])('blocks incompatible pinned capability before reading: %j', async overrides => {
    const r = rig(); r.probe.mockResolvedValue({ available: true, adapterId: ADAPTER, adapterVersion: VERSION, installedVersion: VERSION, capability: 'incremental_history', reason: 'PRIVATE PATH', coverage: 'SYNTHETIC', ...overrides } as Awaited<ReturnType<typeof r.probe>>);
    const receipt = await r.run();
    expect(receipt).toMatchObject({ status: 'blocked', reason: 'incompatible_source', cleanup: 'stopped' });
    expect(r.readDelta).not.toHaveBeenCalled(); expect(r.stop).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(receipt)).not.toContain('PRIVATE PATH');
  });

  it('blocks transient read failure without re-enrollment, retry or discovery', async () => {
    const r = rig(); const result = r.run(); await vi.advanceTimersByTimeAsync(0);
    r.readDelta.mockRejectedValue(Error('PRIVATE PATH AND CREDENTIALS')); await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ status: 'blocked', reason: 'source_read_failed', baselineEnrolled: true, cleanup: 'stopped' });
    expect(r.readDelta.mock.calls.map(c => c[1])).toEqual([null, cursor(0, true)]);
    expect(JSON.stringify(await result)).not.toContain('PRIVATE');
  });

  it.each(['waiting', 'reading', 'probing', 'baseline'] as const)('cancels while %s and drops late reads', async phase => {
    const r = rig(); let finish: ((b: ObservationBatch) => void) | undefined;
    if (phase === 'probing') r.probe.mockImplementation(() => new Promise(() => {}));
    if (phase === 'baseline') r.readDelta.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const result = r.run(); await vi.advanceTimersByTimeAsync(0);
    if (phase === 'reading') {
      r.readDelta.mockImplementation(() => new Promise(resolve => { finish = resolve; })); await vi.advanceTimersByTimeAsync(1000);
    }
    let settled = false; void result.then(() => { settled = true; });
    r.abort.abort(); await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(await result).toMatchObject({ status: 'blocked', reason: 'cancelled', cleanup: 'stopped', freshItems: 0 });
    const calls = r.readDelta.mock.calls.length;
    finish?.(batch(2, [r.observation('turn/one', 1), r.observation('turn/two', 2)]));
    await vi.advanceTimersByTimeAsync(10000);
    expect(r.readDelta).toHaveBeenCalledTimes(calls); expect(r.stop).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not create an observer for an already cancelled run', async () => {
    const r = rig(); r.abort.abort();
    expect(await r.run()).toMatchObject({ status: 'blocked', reason: 'cancelled', cleanup: 'not_started' });
    expect(r.createObserver).not.toHaveBeenCalled();
  });

  it.each(['baseline', 'poll', 'probe'] as const)('bounds a non-cooperative %s and aborts before stop', async phase => {
    const r = rig();
    if (phase === 'probe') r.probe.mockImplementation(() => new Promise(() => {}));
    if (phase === 'baseline') r.readDelta.mockImplementation(() => new Promise(() => {}));
    const result = r.run(); let settled = false; void result.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(0);
    if (phase === 'poll') r.readDelta.mockImplementation(() => new Promise(() => {}));
    r.stop.mockImplementation(async () => { for (const call of r.readDelta.mock.calls) expect(call[2].aborted).toBe(true); });
    await vi.advanceTimersByTimeAsync(5000); expect(settled).toBe(true);
    expect(await result).toMatchObject({ status: 'blocked', reason: 'no_two_fresh_items', elapsedMs: 5000, cleanup: 'stopped' });
    expect(r.stop).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['hang', 'reject'] as const)('bounds cleanup and reports stop %s', async mode => {
    const r = rig(); r.stop.mockImplementation(() => mode === 'hang' ? new Promise(() => {}) : Promise.reject(Error('PRIVATE')));
    const result = r.run(); let settled = false; void result.then(() => { settled = true; }, () => {});
    await vi.advanceTimersByTimeAsync(7000); expect(settled).toBe(true);
    expect(await result).toMatchObject({ status: 'blocked', cleanup: mode === 'hang' ? 'timeout' : 'failed', reason: 'cleanup_failed' });
    expect(r.stop).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('withdraws a two-item pass when cleanup cannot confirm stop', async () => {
    const r = rig(); const result = r.run(); await vi.advanceTimersByTimeAsync(0);
    r.stop.mockRejectedValue(Error('PRIVATE'));
    r.readDelta.mockResolvedValue(batch(1, [r.observation('turn/one', 500), r.observation('turn/two', 600)]));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ status: 'blocked', reason: 'cleanup_failed', freshItems: 2, cleanup: 'failed', liveAcceptance: false });
  });

  it.each(['baseline-content', 'foreign-grant', 'wrong-adapter', 'fixture-live', 'import', 'excerpt', 'cursor-identity', 'cursor-birth'] as const)('blocks incompatible %s without leaking content', async mode => {
    const r = rig();
    if (mode === 'baseline-content') r.readDelta.mockImplementation(async input => batch(0, [{ ...r.observation('turn/one', 500), bindingId: input.binding.id }], true));
    const result = r.run(env, mode === 'fixture-live' ? 'installed_source_observation' : 'synthetic_guard'); await vi.advanceTimersByTimeAsync(0);
    if (mode !== 'baseline-content') {
      let o = r.observation('turn/one', 500);
      if (mode === 'foreign-grant') o = { ...o, grantRevision: 99 };
      if (mode === 'wrong-adapter') o = { ...o, provenance: { ...o.provenance, adapterVersion: 'other' } };
      if (mode === 'import') o = { ...o, provenance: { ...o.provenance, mode: 'imported_history' } };
      if (mode === 'excerpt') o = { ...o, excerpt: 'PRIVATE CONTENT' };
      const next = batch(1, [o]);
      if (mode === 'cursor-identity') next.nextCursor.identity = 'foreign';
      if (mode === 'cursor-birth') next.nextCursor = makeCursor(selectedThread, 'b'.repeat(64), 'turn', [], 1);
      r.readDelta.mockResolvedValue(next); await vi.advanceTimersByTimeAsync(1000);
    }
    expect(await result).toMatchObject({ status: 'blocked', reason: 'incompatible_source', liveAcceptance: false, cleanup: 'stopped' });
    expect(JSON.stringify(await result)).not.toContain('PRIVATE CONTENT');
  });

  it('emits only safe hashes/counts/timing while using the exact own off-export binding', async () => {
    const r = rig(); const result = r.run(); await vi.advanceTimersByTimeAsync(0);
    expect(r.binding()).toMatchObject({ selectedSource: selectedThread, sourceIdentity: 'C:\\synthetic-project', localReadConsented: true, binding: { adapterId: ADAPTER, adapterVersion: VERSION, exportPolicy: 'off', state: 'following' } });
    r.readDelta.mockResolvedValue(batch(1, [r.observation('turn/one', 500), r.observation('turn/two', 600)])); await vi.advanceTimersByTimeAsync(1000);
    const receipt = await result;
    expect(receipt).toMatchObject({ status: 'passed', cloudSharing: 'OFF', freshItems: 2, evidence: 'synthetic_guard', liveAcceptance: false });
    for (const value of [selectedThread, 'synthetic-project', 'turn/one', 'safe revision', env.LP_SYNTHETIC_SOURCE_NAME]) expect(JSON.stringify(receipt)).not.toContain(value);
    expect(receipt.items[0]).toEqual({ identitySha256: digest('turn/one'), revisionSha256: digest('safe revision'), kind: 'assistant_report', evidenceLevel: 'agent_reported', detectedAfterEnrollmentMs: 1000, detectionLatencyMs: 500 });
    expect(r.readDelta.mock.calls[1]?.[1]).toEqual(cursor(0, true));
  });
});
