import { expect, it, vi } from 'vitest';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { localBinding } from '../../fixtures/codex/synthetic';
import { startSyntheticMain } from './main-harness';
import { fixtureIds } from '../../fixtures/contracts/golden';

it.each(['pauseSource', 'revokeSource'])('offline restart permits %s from durable device custody without cloud project authority', async operation => {
  const main = await startSyntheticMain({ seed: store => store.putBinding(localBinding, true), client: { listProjects: vi.fn(async () => { throw Error('Synthetic offline cloud'); }) } });
  try {
    expect(main.observer.readDelta).toHaveBeenCalledTimes(1);
    await expect(main.invoke('invoke', { type: 'getSnapshot', projectId: localBinding.binding.projectId })).rejects.toThrow();
    await main.invoke(operation, localBinding.binding.id);
    expect(main.observer.stop).toHaveBeenCalledWith(localBinding.binding.id);
    const restarted = await JournalStore.open(main.path);
    expect(restarted.binding(localBinding.binding.id)?.binding.state).toBe(operation === 'pauseSource' ? 'paused' : 'revoked');
    expect(restarted.pendingSourceCommands()).toHaveLength(1);
    expect(main.desktopEvents).toContainEqual(expect.objectContaining({ type: 'source_state', binding: expect.objectContaining({ state: operation === 'pauseSource' ? 'paused' : 'revoked' }) }));
    await expect(main.invoke('invoke', { type: 'getSnapshot', projectId: localBinding.binding.projectId })).rejects.toThrow();
  } finally { await main.close(); }
});
it('local withdrawal still works with an expired cloud token, but rejects a binding from another device', async () => {
  const main = await startSyntheticMain({ seed: store => store.putBinding(localBinding, true), credentialExpiry: '2000-01-01T00:00:00.000Z' });
  try { await main.invoke('revokeSource', localBinding.binding.id); expect((await JournalStore.open(main.path)).binding(localBinding.binding.id)?.binding.state).toBe('revoked'); }
  finally { await main.close(); }
  const foreign = await startSyntheticMain({ seed: store => store.putBinding(localBinding, true), credentialDevice: fixtureIds.owner, client: { listProjects: vi.fn(async () => { throw Error('offline'); }) } });
  try { await expect(foreign.invoke('pauseSource', localBinding.binding.id)).rejects.toThrow(); await expect(foreign.invoke('revokeSource', localBinding.binding.id)).rejects.toThrow(); expect(foreign.observer.stop).not.toHaveBeenCalled(); expect((await JournalStore.open(foreign.path)).binding(localBinding.binding.id)?.binding.state).toBe('following'); }
  finally { await foreign.close(); }
});
