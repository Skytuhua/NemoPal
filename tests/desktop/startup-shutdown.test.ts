import { mkdir, readFile } from 'node:fs/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { deferred, startSyntheticMain } from './main-harness';

type Main = Awaited<ReturnType<typeof startSyntheticMain>>;
function quit(main: Main, via: 'tray' | 'before-quit') {
  if (via === 'tray') main.clickTray('quit');
  else {
    const event = { preventDefault: vi.fn() };
    main.app.emit('before-quit', event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
  }
}

it.each([
  ['tray', 'abort'], ['tray', 'complete'],
  ['before-quit', 'abort'], ['before-quit', 'complete'],
] as const)('%s shutdown during window load does not show a startup fatal or destroyed windows after %s', async (via, outcome) => {
  const load = deferred<void>();
  const main = await startSyntheticMain({ windowLoad: load.promise });
  try {
    quit(main, via);
    await vi.waitFor(() => expect(main.app.exit).toHaveBeenCalledWith(0));
    expect(main.windows.workspace.isDestroyed()).toBe(true);
    expect(main.windows.pet.isDestroyed()).toBe(true);
    if (outcome === 'abort') load.reject(Error('ERR_ABORTED synthetic navigation'));
    else load.resolve();
    await nextTurn();
    expect(main.dialog.showErrorBox).not.toHaveBeenCalled();
    expect(main.app.exit.mock.calls).toEqual([[0]]);
    expect(main.windows.workspace.show).not.toHaveBeenCalled();
    expect(main.windows.pet.showInactive).not.toHaveBeenCalled();
    expect(main.client.listProjects).not.toHaveBeenCalled();
  } finally { load.resolve(); await nextTurn(); await main.dispose(); }
});

it('before-quit keeps preventing native teardown while journal flush awaits and window load aborts', async () => {
  const load = deferred<void>(); const flushStarted = deferred<void>(); const releaseFlush = deferred<void>();
  const main = await startSyntheticMain({ windowLoad: load.promise });
  const { JournalStore } = await import('../../apps/desktop/src/main/local-store');
  const flush = JournalStore.prototype.flush;
  vi.spyOn(JournalStore.prototype, 'flush').mockImplementation(async function (this: Awaited<ReturnType<typeof JournalStore.open>>) {
    flushStarted.resolve(); await releaseFlush.promise; await flush.call(this);
  });
  try {
    quit(main, 'before-quit'); await flushStarted.promise;
    quit(main, 'before-quit');
    load.reject(Error('ERR_ABORTED synthetic navigation')); await nextTurn();
    expect(main.dialog.showErrorBox).not.toHaveBeenCalled();
    expect(main.app.exit).not.toHaveBeenCalled();
    expect(main.windows.destroy).not.toHaveBeenCalled();
    expect(main.windows.workspace.show).not.toHaveBeenCalled();
    expect(main.windows.pet.showInactive).not.toHaveBeenCalled();
    releaseFlush.resolve();
    await vi.waitFor(() => expect(main.app.exit.mock.calls).toEqual([[0]]));
  } finally { load.resolve(); releaseFlush.resolve(); await nextTurn(); await main.dispose(); }
});

it.each(['tray', 'before-quit'] as const)('%s journal failure remains Quit blocked when pending startup aborts', async via => {
  const load = deferred<void>();
  const main = await startSyntheticMain({ windowLoad: load.promise, seed: async store => {
    await store.setPosition({ x: 10, y: 20 }); await store.setPosition({ x: 30, y: 40 });
  } });
  try {
    const primary = await readFile(main.path); const previous = await readFile(`${main.path}.previous`);
    await mkdir(`${main.path}.tmp`); // Fail a real journal write inside this disposable synthetic profile.
    main.clickTray('focus');
    await vi.waitFor(() => expect(main.desktopEvents).toContainEqual(expect.objectContaining({ type: 'connection', reason: 'Native preference could not be saved.' })));
    quit(main, via);
    await vi.waitFor(() => expect(main.dialog.showErrorBox).toHaveBeenCalledWith('Quit blocked', expect.any(String)));
    load.reject(Error('ERR_ABORTED synthetic navigation')); await nextTurn();
    expect(main.dialog.showErrorBox.mock.calls.map(([title]) => title)).toEqual(['Quit blocked', 'NemoPal blocked']);
    expect(main.app.exit).toHaveBeenCalledWith(1);
    expect(main.windows.destroy).not.toHaveBeenCalled();
    expect(main.windows.workspace.show).not.toHaveBeenCalled();
    expect(main.windows.pet.showInactive).not.toHaveBeenCalled();
    expect(await readFile(main.path)).toEqual(primary);
    expect(await readFile(`${main.path}.previous`)).toEqual(previous);
  } finally { load.resolve(); await nextTurn(); await main.dispose(); }
});

it.each(['unexpected load failure', 'ERR_ABORTED synthetic navigation'])('a window-load failure without shutdown still reports a sanitized startup fatal: %s', async reason => {
  const load = deferred<void>();
  const main = await startSyntheticMain({ windowLoad: load.promise });
  try {
    load.reject(Error(`${reason} token=do-not-display C:\\private-source`));
    await vi.waitFor(() => expect(main.app.exit.mock.calls).toEqual([[1]]));
    expect(main.dialog.showErrorBox).toHaveBeenCalledWith('NemoPal blocked', expect.stringContaining('Native startup failed'));
    expect(main.dialog.showErrorBox).toHaveBeenCalledOnce();
    expect(JSON.stringify(main.dialog.showErrorBox.mock.calls)).not.toMatch(/do-not-display|private-source/);
    expect(main.windows.workspace.show).not.toHaveBeenCalled();
    expect(main.windows.pet.showInactive).not.toHaveBeenCalled();
  } finally { load.resolve(); await nextTurn(); await main.dispose(); }
});


it('startup can finish after a failed quit while window loading is pending', async () => {
  const load = deferred<void>(); const main = await startSyntheticMain({ windowLoad: load.promise });
  const { JournalStore } = await import('../../apps/desktop/src/main/local-store');
  vi.spyOn(JournalStore.prototype, 'flush').mockRejectedValueOnce(Error('Synthetic journal failure'));
  try {
    quit(main, 'tray'); await vi.waitFor(() => expect(main.dialog.showErrorBox).toHaveBeenCalledWith('Quit blocked', expect.any(String)));
    load.resolve(); await vi.waitFor(() => expect(main.windows.workspace.show).toHaveBeenCalled());
    quit(main, 'tray'); await vi.waitFor(() => expect(main.app.exit).toHaveBeenCalledWith(0));
  } finally { load.resolve(); await main.dispose(); }
});


it('a failed quit does not hide a later startup failure', async () => {
  const load = deferred<void>(); const main = await startSyntheticMain({ windowLoad: load.promise });
  const { JournalStore } = await import('../../apps/desktop/src/main/local-store');
  vi.spyOn(JournalStore.prototype, 'flush').mockRejectedValueOnce(Error('Synthetic journal failure'));
  try {
    quit(main, 'tray'); await vi.waitFor(() => expect(main.dialog.showErrorBox).toHaveBeenCalledWith('Quit blocked', expect.any(String)));
    load.reject(Error('later startup failure'));
    await vi.waitFor(() => expect(main.app.exit).toHaveBeenCalledWith(1));
    expect(main.dialog.showErrorBox).toHaveBeenCalledWith('NemoPal blocked', expect.any(String));
  } finally { load.resolve(); await nextTurn(); await main.dispose(); }
});


it('a startup failure during a quit is reported if that quit later fails', async () => {
  const load = deferred<void>(), started = deferred<void>(), release = deferred<void>();
  const main = await startSyntheticMain({ windowLoad: load.promise });
  const { JournalStore } = await import('../../apps/desktop/src/main/local-store');
  vi.spyOn(JournalStore.prototype, 'flush').mockImplementationOnce(async () => { started.resolve(); await release.promise; throw Error('Synthetic journal failure'); });
  try {
    quit(main, 'tray'); await started.promise; load.reject(Error('startup failure during quit')); await nextTurn();
    expect(main.dialog.showErrorBox).not.toHaveBeenCalled();
    release.resolve(); await vi.waitFor(() => expect(main.app.exit).toHaveBeenCalledWith(1));
    expect(main.dialog.showErrorBox).toHaveBeenCalledWith('Quit blocked', expect.any(String));
    expect(main.dialog.showErrorBox).toHaveBeenCalledWith('NemoPal blocked', expect.any(String));
  } finally { load.resolve(); release.resolve(); await nextTurn(); await main.dispose(); }
});


it('startup completes if window load finishes while a pending quit later fails', async () => {
  const load = deferred<void>(), started = deferred<void>(), release = deferred<void>();
  const main = await startSyntheticMain({ windowLoad: load.promise });
  const { JournalStore } = await import('../../apps/desktop/src/main/local-store');
  vi.spyOn(JournalStore.prototype, 'flush').mockImplementationOnce(async () => { started.resolve(); await release.promise; throw Error('Synthetic journal failure'); });
  try {
    quit(main, 'tray'); await started.promise; load.resolve(); await nextTurn();
    expect(main.windows.workspace.show).not.toHaveBeenCalled();
    release.resolve(); await vi.waitFor(() => expect(main.windows.workspace.show).toHaveBeenCalled());
    expect(main.dialog.showErrorBox).toHaveBeenCalledWith('Quit blocked', expect.any(String));
    quit(main, 'tray'); await vi.waitFor(() => expect(main.app.exit).toHaveBeenCalledWith(0));
  } finally { load.resolve(); release.resolve(); await nextTurn(); await main.dispose(); }
});
