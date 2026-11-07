import { expect, it, vi } from 'vitest';
import { ObservationBatchSchema } from '@living-playbooks/contracts';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { localBinding, syntheticReceiving } from '../../fixtures/codex/synthetic';
import { goldenObservationBatch } from '../../fixtures/contracts/golden';
import { startSyntheticMain } from './main-harness';

it.each([
  ['missing configuration', undefined, undefined],
  ['missing disclosure', syntheticReceiving.modelEndpoint, undefined],
  ['changed endpoint', 'https://different.example.test/v1', syntheticReceiving.disclosure],
  ['changed disclosure', syntheticReceiving.modelEndpoint, 'Different receiver terms'],
])('main holds previously consented queued excerpts after restart with %s', async (_label, receivingEndpoint, disclosure) => {
  const main = await startSyntheticMain({ receivingEndpoint, disclosure, seed: async store => {
    await store.putBinding(localBinding, true, syntheticReceiving);
    await store.commitObservationBatch(localBinding.binding.id, null, ObservationBatchSchema.parse(goldenObservationBatch));
  } });
  try {
    expect(main.client.ingestObservations).not.toHaveBeenCalled();
    expect(await (await JournalStore.open(main.path)).pendingUploads(20)).toHaveLength(1);
    expect(main.desktopEvents.some(e => e.type === 'connection' && e.reason?.includes('consent'))).toBe(true);
    await main.invoke('revokeSource', localBinding.binding.id);
    await vi.waitFor(() => expect(main.client.revokeSource).toHaveBeenCalled());
    expect(main.client.ingestObservations).not.toHaveBeenCalled();
  } finally { await main.close(); }
});

it('old journals without receiving identity reopen but hold exports even when a receiver is now configured', async () => {
  const main = await startSyntheticMain({ receivingEndpoint: syntheticReceiving.modelEndpoint, disclosure: syntheticReceiving.disclosure, seed: async store => {
    await store.putBinding(localBinding, true); // Legacy journal: no acknowledged receiver metadata.
    await store.commitObservationBatch(localBinding.binding.id, null, ObservationBatchSchema.parse(goldenObservationBatch));
  } });
  try { expect(main.client.ingestObservations).not.toHaveBeenCalled(); expect(await (await JournalStore.open(main.path)).pendingUploads(20)).toHaveLength(1); }
  finally { await main.close(); }
});

it('the same acknowledged destination/disclosure on restart preserves consented excerpt upload', async () => {
  const main = await startSyntheticMain({ receivingEndpoint: syntheticReceiving.modelEndpoint, disclosure: syntheticReceiving.disclosure, seed: async store => {
    await store.putBinding(localBinding, true, syntheticReceiving);
    await store.commitObservationBatch(localBinding.binding.id, null, ObservationBatchSchema.parse(goldenObservationBatch));
  } });
  try { expect(main.client.ingestObservations).toHaveBeenCalledTimes(1); expect(await (await JournalStore.open(main.path)).pendingUploads(20)).toEqual([]); }
  finally { await main.close(); }
});
