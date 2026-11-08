import { createInstalledObserver } from '../../packages/codex-observer/src/transport';
import { randomUUID } from 'node:crypto';
import type { LocalBinding } from '@living-playbooks/contracts';

const selectedSource = process.env.LP_SELECTED_SOURCE;
if (!process.env.LP_SYNTHETIC_SOURCE_NAME || process.env.LP_OBSERVER_LOCAL_READ_CONSENT !== '1') { console.error('BLOCKED: general authorization permits metadata only. A named own synthetic test source and explicit local-content-read consent are required for this live reader.'); process.exit(2); }
if (!selectedSource || selectedSource !== process.env.CODEX_THREAD_ID) { console.error('BLOCKED: this acceptance runner permits only its exact own project build/test vendor thread; no profile lookup.'); process.exit(2); }
const binding: LocalBinding = { binding: { id: randomUUID(), projectId: randomUUID(), deviceId: randomUUID(), sourceKey: randomUUID(), adapterId: 'codex-app-server', adapterVersion: '0.166.0', capability: 'incremental_history', grantRevision: 1, exportPolicy: 'off', state: 'following', lastObservedAt: null }, selectedSource, sourceIdentity: process.cwd(), localReadConsented: true };
const observer = createInstalledObserver();
try {
  const signal = AbortSignal.timeout(15000);
  const baseline = await observer.readDelta(binding, null, signal);
  let cursor = baseline.nextCursor;
  let freshBatches = 0;
  let observations = 0;
  for (let pass = 0; pass < 3; pass++) {
    const batch = await observer.readDelta(binding, cursor, signal); cursor = batch.nextCursor;
    if (batch.observations.length) freshBatches++;
    observations += batch.observations.length;
  }
  console.log(JSON.stringify({ source: 'exact own build/test conversation', strategy: 'codex-cli 0.166.0 stored-history App Server', scopeValidated: true, backfill: 0, cloudSharing: 'OFF', freshBatches, observations, noninterference: 'Only initialize/initialized, thread/read(includeTurns:false), thread/turns/list(full,desc,limit20). No harness mutations sent. App Server initialization may write its own logs/state.' }));
  if (freshBatches < 2) { console.error('BLOCKED: two fresh completed source updates were not observed. Synthetic fixtures and a validated baseline do not satisfy live automatic-observation acceptance.'); process.exitCode = 2; }
} catch { console.error('BLOCKED: exact own source or installed read schema failed validation; no broader history scan attempted.'); process.exitCode = 2; }
finally { await observer.stop(binding.binding.id); }
