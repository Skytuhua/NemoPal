import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { SourceController } from '../../apps/desktop/src/main/source-controller';
import { localBinding } from '../../fixtures/codex/synthetic';

it('failed durable writes prevent a successful Quit flush, rather than forgetting an offline revoke on restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-io-failure-'));
  try {
    const path = join(dir, 'journal'); const store = await JournalStore.open(path); await store.putBinding(localBinding, true);
    await mkdir(`${path}.tmp`);
    await expect(store.revokeBinding(localBinding.binding.id, 1)).rejects.toThrow();
    expect(store.isFollowing(localBinding.binding.id)).toBe(false);
    await expect(store.flush()).rejects.toThrow('durability');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('unsupported-source errors remain visibly blocked after reopening instead of pretending to follow', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-io-failure-'));
  try {
    const path = join(dir, 'journal'); const store = await JournalStore.open(path); await store.putBinding(localBinding, true);
    const controller = new SourceController(store, { probe: async () => { throw Error(); }, readDelta: async () => { throw Error('unsupported schema'); }, stop: async () => {} });
    await controller.poll(localBinding.binding.id);
    expect((await JournalStore.open(path)).binding(localBinding.binding.id)?.binding.state).toBe('blocked');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
