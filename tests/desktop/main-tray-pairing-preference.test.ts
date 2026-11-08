import { setImmediate as nextTurn } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import type { JournalStore } from '../../apps/desktop/src/main/local-store';
import { fixtureIds } from '../../fixtures/contracts/golden';
import { deferred, projectSnapshot, startSyntheticMain } from './main-harness';

it.each([
  ['focus', 'protected-save'], ['hide', 'protected-save'],
  ['focus', 'journal-clear'], ['hide', 'journal-clear'],
] as const)('tray %s during pairing %s preserves cleared owner pin', async (action, stage) => {
  const entered = deferred<void>(), release = deferred<void>();
  const main = await startSyntheticMain({ credentialEncryption: stage === 'protected-save' ? async () => { entered.resolve(); await release.promise; } : undefined });
  const b = (await main.client.listProjects()).filter(project => project.id === projectSnapshot('B').project.id);
  const background = deferred<typeof b>();
  let pairing: Promise<unknown> | undefined;
  try {
    await main.invoke('setPetPreference', { hidden: false, focus: false, reducedMotion: false, pinnedProjectId: projectSnapshot('A').project.id });
    const { JournalStore: ActualJournal } = await import('../../apps/desktop/src/main/local-store');
    if (stage === 'journal-clear') {
      const save = ActualJournal.prototype.setPreference;
      let held = false;
      vi.spyOn(ActualJournal.prototype, 'setPreference').mockImplementation(async function (this: JournalStore, input) {
        await save.call(this, input);
        if (!held && input.pinnedProjectId === null) { held = true; entered.resolve(); await release.promise; }
      });
    }
    vi.mocked(main.client.listProjects).mockImplementationOnce(() => background.promise).mockResolvedValue(b);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ token: 'synthetic-owner-b-token', deviceId: fixtureIds.owner, expiresAt: '2099-01-01T00:00:00.000Z' }));
    const lists = vi.mocked(main.client.listProjects).mock.calls.length;
    pairing = main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic B' });
    void pairing.catch(() => {});
    await entered.promise;
    main.clickTray(action);
    const flag = action === 'focus' ? 'focus' : 'hidden';
    await vi.waitFor(async () => expect((await ActualJournal.open(main.path)).preference()[flag]).toBe(true));
    release.resolve(); await pairing;
    await vi.waitFor(() => expect(main.client.listProjects).toHaveBeenCalledTimes(lists + 1));
    expect((await ActualJournal.open(main.path)).preference()).toMatchObject({ pinnedProjectId: null, [flag]: true });
    await main.invoke('invoke', { type: 'listProjects' });
    await main.invoke('invoke', { type: 'getSnapshot', projectId: projectSnapshot('B').project.id });
    expect(main.petEvents.at(-1)).toMatchObject({ projectId: projectSnapshot('B').project.id, managerName: 'Manager B' });
  } finally { release.resolve(); background.resolve(b); await pairing?.catch(() => {}); await nextTurn(); await main.close(); }
});
