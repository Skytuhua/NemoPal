import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { localBinding } from '../../fixtures/codex/synthetic';
import { goldenObservationBatch } from '../../fixtures/contracts/golden';
import { ObservationBatchSchema } from '@living-playbooks/contracts';

it('revocation scrubs queued content from both primary and recoverable previous snapshots', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-private-'));
  try {
    const path = join(dir, 'journal'); const store = await JournalStore.open(path); await store.putBinding(localBinding, true);
    await store.commitObservationBatch(localBinding.binding.id, null, ObservationBatchSchema.parse(goldenObservationBatch));
    await store.revokeBinding(localBinding.binding.id, 1);
    for (const file of [path, `${path}.previous`]) expect(await readFile(file, 'utf8')).not.toContain('The implementation is reported complete');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
