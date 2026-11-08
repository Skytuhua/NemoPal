import { createInstalledObserver } from '../../packages/codex-observer/src/transport';
import { randomUUID } from 'node:crypto';
import { IdSchema, LocalBindingSchema, ObservationBatchSchema, ObserverCapabilityReportSchema, type CodexObserver, type Observation, type ObservationBatch } from '@living-playbooks/contracts';
import { ADAPTER, VERSION, decodeCursor, digest } from '../../packages/codex-observer/src/cursor';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export type GateClock = { now(): number; sleep(ms: number, signal: AbortSignal): Promise<void> };
type Evidence = 'synthetic_guard' | 'installed_source_observation';
type Reason = 'consent_required' | 'own_source_required' | 'invalid_bounds' | 'no_two_fresh_items' | 'two_distinct_items' | 'cancelled' | 'incompatible_source' | 'source_read_failed' | 'cleanup_failed';
export type GateReceipt = {
  evidence: Evidence; status: 'blocked' | 'passed'; reason: Reason; liveAcceptance: boolean;
  adapterId: string; adapterVersion: string; maxWaitMs: number; pollIntervalMs: number; cleanupGraceMs: number;
  cloudSharing: 'OFF'; baselineEnrolled: boolean; freshItems: number; duplicates: number; reads: number;
  elapsedMs: number; enrolledAfterStartMs: number | null; cleanup: 'not_started' | 'stopped' | 'timeout' | 'failed';
  items: { identitySha256: string; revisionSha256: string; kind: Observation['kind']; evidenceLevel: Observation['provenance']['evidenceLevel']; detectedAfterEnrollmentMs: number; detectionLatencyMs: number }[];
};
type Dependencies = { createObserver(): CodexObserver; clock: GateClock; cwd: string; signal: AbortSignal; evidence: Evidence; onEnrolled?(): void };

// Race even a non-cooperative mock/adapter, observe late rejections, and fence late results.
function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); }).then(
      value => { signal.removeEventListener('abort', abort); if (signal.aborted) reject(signal.reason); else resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (!/^\d{1,6}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export async function runObserverGate(env: NodeJS.ProcessEnv, deps: Dependencies): Promise<GateReceipt> {
  const started = deps.clock.now();
  const receipt: GateReceipt = { evidence: deps.evidence, status: 'blocked', reason: 'no_two_fresh_items', liveAcceptance: false,
    adapterId: ADAPTER, adapterVersion: VERSION, maxWaitMs: 0, pollIntervalMs: 0, cleanupGraceMs: 2000,
    cloudSharing: 'OFF', baselineEnrolled: false, freshItems: 0, duplicates: 0, reads: 0, elapsedMs: 0, enrolledAfterStartMs: null, cleanup: 'not_started', items: [] };
  const name = env.LP_SYNTHETIC_SOURCE_NAME;
  if (env.LP_LIVE_TEST_OPT_IN !== '1' || env.LP_OBSERVER_LOCAL_READ_CONSENT !== '1' || !name?.trim() || name !== name.trim() || name.length > 80 || /[\r\n\t]/.test(name)) return { ...receipt, reason: 'consent_required' };
  const selectedSource = env.LP_SELECTED_SOURCE;
  if (!selectedSource || selectedSource !== env.CODEX_THREAD_ID || !IdSchema.safeParse(selectedSource).success) return { ...receipt, reason: 'own_source_required' };
  const waitMs = boundedInteger(env.LP_OBSERVER_WAIT_MS, 120000, 1000, 300000);
  const pollMs = boundedInteger(env.LP_OBSERVER_POLL_MS, 1000, 100, 5000);
  if (waitMs === null || pollMs === null || pollMs >= waitMs) return { ...receipt, reason: 'invalid_bounds' };
  receipt.maxWaitMs = waitMs; receipt.pollIntervalMs = pollMs;
  if (deps.signal.aborted) return { ...receipt, reason: 'cancelled' };

  const run = new AbortController(); const deadlineTimer = new AbortController();
  const cancel = () => run.abort();
  deps.signal.addEventListener('abort', cancel, { once: true });
  void deps.clock.sleep(waitMs, deadlineTimer.signal).then(() => run.abort(), () => {});
  const incompatible = Symbol('incompatible source');
  let observer: CodexObserver | undefined;
  let bindingId: string | undefined;
  const parseBatch = (input: unknown): ObservationBatch => {
    const parsed = ObservationBatchSchema.safeParse(input);
    if (!parsed.success || parsed.data.mode !== 'incremental_history') throw incompatible;
    return parsed.data;
  };
  try {
    const binding = LocalBindingSchema.parse({ binding: { id: randomUUID(), projectId: randomUUID(), deviceId: randomUUID(), sourceKey: randomUUID(), adapterId: ADAPTER, adapterVersion: VERSION, capability: 'incremental_history', grantRevision: 1, exportPolicy: 'off', state: 'following', lastObservedAt: null }, selectedSource, sourceIdentity: deps.cwd, localReadConsented: true });
    bindingId = binding.binding.id;
    observer = deps.createObserver();
    const capability = ObserverCapabilityReportSchema.safeParse(await abortable(() => observer!.probe(), run.signal));
    if (!capability.success || !capability.data.available || capability.data.adapterId !== ADAPTER || capability.data.adapterVersion !== VERSION || capability.data.installedVersion !== VERSION || capability.data.capability !== 'incremental_history') throw incompatible;
    receipt.reads++;
    const baseline = parseBatch(await abortable(() => observer!.readDelta(binding, null, run.signal), run.signal));
    let anchor: ReturnType<typeof decodeCursor>;
    try { anchor = decodeCursor(baseline.nextCursor, selectedSource); } catch { throw incompatible; }
    if (anchor.baseline !== true || baseline.observations.length || baseline.lastObservedAt !== null) throw incompatible;
    receipt.baselineEnrolled = true;
    const enrolledAt = deps.clock.now(); receipt.enrolledAfterStartMs = enrolledAt - started;
    deps.onEnrolled?.();
    let cursor = baseline.nextCursor;
    const seenItems = new Set<string>(); const seenCursors = new Set([digest(cursor)]);
    while (receipt.freshItems < 2) {
      await abortable(() => deps.clock.sleep(pollMs, run.signal), run.signal);
      // The exclusive deadline also excludes a timer/read settling at the boundary.
      if (deps.clock.now() - started >= waitMs) { run.abort(); run.signal.throwIfAborted(); }
      receipt.reads++;
      const batch = parseBatch(await abortable(() => observer!.readDelta(binding, cursor, run.signal), run.signal));
      let nextAnchor: ReturnType<typeof decodeCursor>;
      try { nextAnchor = decodeCursor(batch.nextCursor, selectedSource); } catch { throw incompatible; }
      if (nextAnchor.birth !== anchor.birth || (batch.observations.length && nextAnchor.baseline)) throw incompatible;
      // Validate the entire batch before accepting even its first item.
      for (const item of batch.observations) {
        if (item.bindingId !== binding.binding.id || item.grantRevision !== binding.binding.grantRevision || item.excerpt !== undefined || item.provenance.adapterId !== ADAPTER || item.provenance.adapterVersion !== VERSION || item.provenance.mode === 'imported_history' || (deps.evidence === 'installed_source_observation' && item.provenance.mode !== 'observed')) throw incompatible;
      }
      const key = digest(batch.nextCursor); const advanced = !seenCursors.has(key);
      if (advanced) { seenCursors.add(key); cursor = batch.nextCursor; }
      const detectedAt = deps.clock.now();
      for (const item of batch.observations) {
        const identitySha256 = digest(item.sourceItemId);
        if (seenItems.has(identitySha256)) { receipt.duplicates++; continue; }
        seenItems.add(identitySha256);
        const completedAt = Date.parse(item.occurredAt);
        if (!advanced || item.kind === 'activity' || completedAt <= enrolledAt || completedAt > detectedAt) continue;
        receipt.items.push({ identitySha256, revisionSha256: digest(item.sourceRevision), kind: item.kind, evidenceLevel: item.provenance.evidenceLevel, detectedAfterEnrollmentMs: detectedAt - enrolledAt, detectionLatencyMs: detectedAt - completedAt });
        receipt.freshItems++;
        if (receipt.freshItems === 2) break;
      }
    }
    run.signal.throwIfAborted();
    receipt.status = 'passed'; receipt.reason = 'two_distinct_items';
  } catch (error) {
    receipt.reason = deps.signal.aborted ? 'cancelled' : run.signal.aborted ? 'no_two_fresh_items' : error === incompatible ? 'incompatible_source' : 'source_read_failed';
  } finally {
    // Fence before closing; no late result can advance the gate or trigger another read.
    run.abort(); deadlineTimer.abort(); deps.signal.removeEventListener('abort', cancel);
    if (observer && bindingId) {
      const cleanup = new AbortController(); const cleanupTimer = new AbortController();
      void deps.clock.sleep(receipt.cleanupGraceMs, cleanupTimer.signal).then(() => cleanup.abort(), () => {});
      try { await abortable(() => observer!.stop(bindingId!), cleanup.signal); receipt.cleanup = 'stopped'; }
      catch { receipt.cleanup = cleanup.signal.aborted ? 'timeout' : 'failed'; receipt.status = 'blocked'; receipt.reason = 'cleanup_failed'; }
      finally { cleanupTimer.abort(); }
    }
    receipt.elapsedMs = Math.max(0, deps.clock.now() - started);
  }
  receipt.liveAcceptance = receipt.status === 'passed' && receipt.cleanup === 'stopped' && deps.evidence === 'installed_source_observation';
  return receipt;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancel = new AbortController(); const stop = () => cancel.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    const receipt = await runObserverGate(process.env, { createObserver: createInstalledObserver, cwd: process.cwd(), signal: cancel.signal,
      evidence: 'installed_source_observation', clock: { now: Date.now, sleep: (ms, signal) => delay(ms, undefined, { signal }) },
      onEnrolled: () => console.log(JSON.stringify({ event: 'enrolled', evidence: 'installed_source_observation', cloudSharing: 'OFF', backfill: 0 })),
    });
    console.log(JSON.stringify(receipt));
    if (receipt.status === 'blocked') { console.error(`BLOCKED: ${receipt.reason}. General authorization permits metadata only; two distinct future completed items and confirmed cleanup are required.`); process.exitCode = 2; }
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
