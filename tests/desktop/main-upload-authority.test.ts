import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ObservationBatchSchema } from '@living-playbooks/contracts';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { localBinding, syntheticReceiving } from '../../fixtures/codex/synthetic';
import { fixtureIds, goldenObservationBatch } from '../../fixtures/contracts/golden';
import { deferred, startSyntheticMain } from './main-harness';

it.each([
  ['hash', 'pause'], ['hash', 'revoke'], ['hash', 'receiver'], ['hash', 'pair'],
  ['authorization', 'pause'], ['authorization', 'revoke'], ['authorization', 'receiver'], ['authorization', 'pair'],
  ['hash', 'unchanged'], ['authorization', 'unchanged'],
] as const)('actual native upload transport rechecks %s after %s', async (stage, change) => {
  const main = await startSyntheticMain({
    receivingEndpoint: syntheticReceiving.modelEndpoint, disclosure: syntheticReceiving.disclosure,
    client: { ingestObservations: vi.fn(async () => { throw Error('Synthetic cloud unavailable'); }) },
    seed: async store => {
      await store.putBinding(localBinding, true, syntheticReceiving);
      await store.commitObservationBatch(localBinding.binding.id, null, ObservationBatchSchema.parse(goldenObservationBatch));
    },
  });
  const entered = deferred<void>(), release = deferred<void>();
  let pending: Promise<unknown> | undefined;
  try {
    const [upload] = await (await JournalStore.open(main.path)).pendingUploads(1);
    expect(upload).toBeDefined();
    if (!upload) throw Error('Synthetic queued upload missing');
    const actual = await vi.importActual<typeof import('@living-playbooks/api-client')>('@living-playbooks/api-client');
    let authorization = 'Bearer synthetic-main-port-token';
    const realClient = actual.createHttpClient({ origin: syntheticReceiving.cloudOrigin, allowInsecureLoopback: true,
      getAuthorization: async () => { if (stage === 'authorization') { entered.resolve(); await release.promise; } return authorization; }, fetch: main.transport });
    const sent: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const path = new URL(url instanceof Request ? url.url : url).pathname;
      if (path.endsWith('/auth/redeem')) return Response.json({ token: 'synthetic-replacement-token', deviceId: fixtureIds.owner, expiresAt: '2099-01-01T00:00:00.000Z' });
      sent.push(JSON.parse(String(init?.body)));
      throw Error('Synthetic upload recorded; no real HTTP');
    });
    if (stage === 'hash') {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => { entered.resolve(); await release.promise; return digest(...args); });
    }
    pending = realClient.ingestObservations(upload.bindingId, { operationId: upload.operationId, input: upload.input });
    const rejected = expect(pending).rejects.toThrow();
    await entered.promise;
    if (change === 'pause' || change === 'revoke') await main.invoke(change === 'pause' ? 'pauseSource' : 'revokeSource', upload.bindingId);
    else if (change === 'receiver') vi.stubEnv('LP_RECEIVING_MODEL_ENDPOINT', 'https://changed.example.test/v1');
    else if (change === 'pair') { await main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic B' }); authorization = 'Bearer synthetic-replacement-token'; }
    release.resolve(); await rejected;
    expect(sent).toHaveLength(change === 'unchanged' ? 1 : 0);
    const journal = await JournalStore.open(main.path);
    if (change === 'revoke') {
      expect(await journal.pendingUploads(20)).toEqual([]);
      expect(journal.pendingSourceCommands()).toContainEqual(expect.objectContaining({ bindingId: upload.bindingId, kind: 'revoke' }));
    } else expect(await journal.pendingUploads(20)).toHaveLength(1);
  } finally { release.resolve(); await pending?.catch(() => {}); await main.close(); }
});

it.each(['operation', 'payload', 'route', 'authorization'] as const)('native upload transport rejects changed queued %s', async change => {
  const main = await startSyntheticMain({
    receivingEndpoint: syntheticReceiving.modelEndpoint, disclosure: syntheticReceiving.disclosure,
    client: { ingestObservations: vi.fn(async () => { throw Error('Synthetic cloud unavailable'); }) },
    seed: async store => {
      await store.putBinding(localBinding, true, syntheticReceiving);
      await store.commitObservationBatch(localBinding.binding.id, null, ObservationBatchSchema.parse(goldenObservationBatch));
    },
  });
  try {
    const [upload] = await (await JournalStore.open(main.path)).pendingUploads(1);
    if (!upload) throw Error('Synthetic queued upload missing');
    const actual = await vi.importActual<typeof import('@living-playbooks/api-client')>('@living-playbooks/api-client');
    const realClient = actual.createHttpClient({ origin: syntheticReceiving.cloudOrigin, allowInsecureLoopback: true,
      getAuthorization: () => change === 'authorization' ? 'Bearer synthetic-stale-token' : 'Bearer synthetic-main-port-token', fetch: main.transport });
    const sent = vi.spyOn(globalThis, 'fetch').mockRejectedValue(Error('Synthetic HTTP; no network'));
    const input = structuredClone(upload.input);
    if (change === 'payload') {
      const observation = input.observations[0];
      if (!observation) throw Error('Synthetic queued observation missing');
      observation.id = randomUUID();
    }
    await expect(realClient.ingestObservations(change === 'route' ? randomUUID() : upload.bindingId,
      { operationId: change === 'operation' ? randomUUID() : upload.operationId, input })).rejects.toThrow();
    expect(sent).not.toHaveBeenCalled();
    expect(await (await JournalStore.open(main.path)).pendingUploads(20)).toHaveLength(1);
  } finally { await main.close(); }
});
