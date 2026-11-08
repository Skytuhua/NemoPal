import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { SourceController } from '../../apps/desktop/src/main/source-controller';
import { localBinding } from '../../fixtures/codex/synthetic';
import { goldenObservationBatch } from '../../fixtures/contracts/golden';
import { ObservationBatchSchema } from '@living-playbooks/contracts';

it('offline revoke immediately stops reads, purges pending exports and survives restart as cloud-revocation-pending', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-revoke-'));
  const batch = ObservationBatchSchema.parse(goldenObservationBatch);
  try {
    const path = join(dir, 'journal'); const store = await JournalStore.open(path); await store.putBinding(localBinding, true);
    await store.commitObservationBatch(localBinding.binding.id, null, batch);
    let reads = 0;
    const controller = new SourceController(store, { probe: async () => { throw Error(); }, readDelta: async () => { reads++; return batch; }, stop: async () => {} });
    await controller.revoke(localBinding.binding.id);
    await controller.poll(localBinding.binding.id);
    expect(reads).toBe(0);
    const restarted = await JournalStore.open(path);
    expect(await restarted.pendingUploads(20)).toEqual([]);
    expect(restarted.pendingSourceCommands()[0]).toMatchObject({ kind: 'revoke', bindingId: localBinding.binding.id, grantRevision: 1 });
    expect(restarted.binding(localBinding.binding.id)?.binding).toMatchObject({ state: 'revoked', exportPolicy: 'off', grantRevision: 2 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('a revoked in-flight read cannot commit its old grant or advance the cursor', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-revoke-'));
  try {
    const store = await JournalStore.open(join(dir, 'journal')); await store.putBinding(localBinding, true);
    let finish!: (value: ReturnType<typeof ObservationBatchSchema.parse>) => void;
    const controller = new SourceController(store, { probe: async () => { throw Error(); }, readDelta: () => new Promise(resolve => { finish = resolve; }), stop: async () => {} });
    const read = controller.poll(localBinding.binding.id);
    await controller.revoke(localBinding.binding.id);
    finish(ObservationBatchSchema.parse(goldenObservationBatch)); await read;
    expect(store.cursor(localBinding.binding.id)).toBeNull();
    expect(await store.pendingUploads(20)).toEqual([]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
