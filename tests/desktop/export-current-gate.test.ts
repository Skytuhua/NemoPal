import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ObservationBatchSchema, type PlaybooksClient } from '@living-playbooks/contracts';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { SyncEngine } from '../../apps/desktop/src/main/sync';
import { localBinding, syntheticReceiving } from '../../fixtures/codex/synthetic';
import { goldenObservationBatch } from '../../fixtures/contracts/golden';

it('checks the current receiving identity before every upload, retaining the second batch when it changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lp-current-consent-'));
  try {
    const store = await JournalStore.open(join(directory, 'journal')); await store.putBinding(localBinding, true, syntheticReceiving);
    const first = ObservationBatchSchema.parse(goldenObservationBatch); const second = { ...first, nextCursor: { ...first.nextCursor, offset: 200 }, observations: first.observations.map(o => ({ ...o, id: '00000000-0000-4000-8000-000000000099', sourceItemId: 'second' })) };
    await store.commitObservationBatch(localBinding.binding.id, null, first); await store.commitObservationBatch(localBinding.binding.id, first.nextCursor, second);
    let identity = syntheticReceiving; const sent: unknown[] = [];
    const client = { ingestObservations: async (_id: string, command: unknown) => { sent.push(command); identity = { ...syntheticReceiving, modelEndpoint: 'https://changed.example.test/v1' }; return { result: { acceptedIds: [goldenObservationBatch.observations[0]!.id], duplicateIds: [] } }; } } as unknown as PlaybooksClient;
    const state = await new SyncEngine(store, client, () => identity).run();
    expect(sent).toHaveLength(1); expect(state.reason).toContain('consent'); expect(await store.pendingUploads(20)).toHaveLength(1); expect(store.cursor(localBinding.binding.id)?.offset).toBe(200);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
