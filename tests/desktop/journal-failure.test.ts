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

it.each(['pause','revoke'] as const)('a withdrawn enrollment persists %s and its cleanup command in its first write', async action => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-withdrawn-enrollment-'));
  try {
    const path = join(dir, 'journal'); const store = await JournalStore.open(path);
    await store.putBinding(localBinding, true, null, action);
    const first = await JournalStore.open(path);
    expect(first.isFollowing(localBinding.binding.id)).toBe(false);
    expect(first.binding(localBinding.binding.id)?.binding.state).toBe(action === 'revoke' ? 'revoked' : 'paused');
    expect(first.pendingSourceCommands()).toMatchObject([{ kind: action, bindingId: localBinding.binding.id, grantRevision: 1 }]);
    await mkdir(`${path}.tmp`);
    const controller = new SourceController(store, { probe: async () => { throw Error(); }, readDelta: async () => { throw Error('must not read'); }, stop: async () => {} });
    await expect(controller[action](localBinding.binding.id)).rejects.toThrow();
    expect((await JournalStore.open(path)).isFollowing(localBinding.binding.id)).toBe(false);
    expect((await JournalStore.open(path)).pendingSourceCommands()).toMatchObject([{ kind: action }]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
