import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { localBinding } from '../../fixtures/codex/synthetic';
import { goldenObservationBatch } from '../../fixtures/contracts/golden';
import { ObservationBatchSchema } from '@living-playbooks/contracts';

export const batch = ObservationBatchSchema.parse({ ...goldenObservationBatch, observations: goldenObservationBatch.observations.map(o => ({ ...o, provenance: { ...o.provenance, adapterId: 'codex-app-server', adapterVersion: '0.166.0' } })) });
describe('bounded atomic journal on real filesystem', () => {
  it('persists batch and cursor together, rejects stale commits, and retains the previous valid snapshot', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lp-spool-'));
    try {
      const path = join(dir, 'journal');
      const store = await JournalStore.open(path);
      await store.putBinding(localBinding, true);
      await store.commitObservationBatch(localBinding.binding.id, null, batch);
      const restarted = await JournalStore.open(path);
      expect(restarted.cursor(localBinding.binding.id)).toEqual(batch.nextCursor);
      expect((await restarted.pendingUploads(20))[0]?.input.observations[0]?.excerpt).toContain('implementation');
      await expect(restarted.commitObservationBatch(localBinding.binding.id, null, batch)).rejects.toThrow('cursor');
      expect(JSON.parse(await readFile(`${path}.previous`, 'utf8')).data.uploads).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('queue full never advances cursor or discards pending records; corruption blocks reopening', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lp-spool-'));
    try {
      const path = join(dir, 'journal');
      const store = await JournalStore.open(path, { count: 1 });
      await store.putBinding(localBinding, true);
      await store.commitObservationBatch(localBinding.binding.id, null, batch);
      const next = { ...batch, nextCursor: { ...batch.nextCursor, offset: 200 }, observations: batch.observations.map(o => ({ ...o, id: '00000000-0000-4000-8000-000000000099', sourceItemId: 'next' })) };
      await expect(store.commitObservationBatch(localBinding.binding.id, batch.nextCursor, next)).rejects.toThrow('spool');
      expect(store.cursor(localBinding.binding.id)?.offset).toBe(100);
      expect(await store.pendingUploads(20)).toHaveLength(1);
      await writeFile(path, '{partial');
      await expect(JournalStore.open(path)).rejects.toThrow('corrupt');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
