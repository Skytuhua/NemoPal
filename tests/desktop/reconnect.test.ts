import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { SyncEngine } from '../../apps/desktop/src/main/sync';
import { localBinding } from '../../fixtures/codex/synthetic';
import { goldenObservationBatch } from '../../fixtures/contracts/golden';
import { ObservationBatchSchema, type PlaybooksClient } from '@living-playbooks/contracts';

it('lost responses retry the exact durable operation; reconnect sends revokes before other uploads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-reconnect-'));
  try {
    const path = join(dir, 'journal'); let store = await JournalStore.open(path); await store.putBinding(localBinding, true);
    await store.commitObservationBatch(localBinding.binding.id, null, ObservationBatchSchema.parse(goldenObservationBatch));
    const commands: unknown[] = []; let fail = true;
    const client = { ingestObservations: async (_id: string, command: unknown) => { commands.push(command); if (fail) throw Error('lost response'); return { result: { acceptedIds: [goldenObservationBatch.observations[0]!.id], duplicateIds: [] } }; } } as unknown as PlaybooksClient;
    const sync = new SyncEngine(store, client);
    expect((await sync.run()).connected).toBe(false);
    store = await JournalStore.open(path); fail = false;
    expect((await new SyncEngine(store, client).run()).connected).toBe(true);
    expect(commands[1]).toEqual(commands[0]);
    expect(await store.pendingUploads(20)).toEqual([]);
    const other = { ...localBinding, binding: { ...localBinding.binding, id: '00000000-0000-4000-8000-000000000098' } };
    await store.revokeBinding(localBinding.binding.id, 1);
    await store.putBinding(other, true); await store.commitObservationBatch(other.binding.id, null, { ...ObservationBatchSchema.parse(goldenObservationBatch), observations: goldenObservationBatch.observations.map(o => ({ ...ObservationBatchSchema.parse(goldenObservationBatch).observations[0]!, bindingId: other.binding.id })) });
    const order: string[] = [];
    const ordered = { revokeSource: async () => { order.push('revoke'); return { result: store.binding(localBinding.binding.id)!.binding }; }, ingestObservations: async () => { order.push('upload'); return { result: { acceptedIds: [goldenObservationBatch.observations[0]!.id], duplicateIds: [] } }; } } as unknown as PlaybooksClient;
    await new SyncEngine(store, ordered).run(); expect(order).toEqual(['revoke', 'upload']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
