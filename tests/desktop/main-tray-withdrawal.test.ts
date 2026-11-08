import { mkdir, rm } from 'node:fs/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { ObservationBatchSchema } from '@living-playbooks/contracts';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { localBinding } from '../../fixtures/codex/synthetic';
import { fixtureIds, goldenObservationBatch } from '../../fixtures/contracts/golden';
import { deferred, startSyntheticMain } from './main-harness';

type Main = Awaited<ReturnType<typeof startSyntheticMain>>;
const offline = { listProjects: vi.fn(async () => { throw Error('Synthetic offline cloud'); }) };
const seed = async (store: JournalStore) => {
  await store.putBinding(localBinding, true);
  await store.commitObservationBatch(localBinding.binding.id, null, ObservationBatchSchema.parse(goldenObservationBatch));
};
const idle = (main: Main) => vi.waitFor(() => {
  expect(main.trayItem('pause-sources').enabled).toBe(true);
  expect(main.trayItem('revoke-sources').enabled).toBe(true);
});
const click = (main: Main, action: 'pause' | 'revoke') => {
  main.clickTray(`${action}-sources`);
  expect(main.trayItem('pause-sources').enabled).toBe(false);
  expect(main.trayItem('revoke-sources').enabled).toBe(false);
};

it.each([
  ['pause', '2099-01-01T00:00:00.000Z', 'paused', 1],
  ['revoke', '2099-01-01T00:00:00.000Z', 'revoked', 0],
  ['pause', '2000-01-01T00:00:00.000Z', 'paused', 1],
  ['revoke', '2000-01-01T00:00:00.000Z', 'revoked', 0],
] as const)('native tray %s survives offline restart with credential expiry %s and no project snapshot', async (action, credentialExpiry, state, uploads) => {
  const main = await startSyntheticMain({ seed, credentialExpiry, client: offline });
  try {
    expect(main.client.getSnapshot).not.toHaveBeenCalled();
    await expect(main.invoke('invoke', { type: 'getSnapshot', projectId: localBinding.binding.projectId })).rejects.toThrow();
    main.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    click(main, action); await idle(main);
    expect(main.dialog.showErrorBox).not.toHaveBeenCalled();
    expect(main.observer.stop).toHaveBeenCalledWith(localBinding.binding.id);
    const restarted = await JournalStore.open(main.path);
    expect(restarted.binding(localBinding.binding.id)?.binding).toMatchObject({ state, grantRevision: action === 'revoke' ? 2 : 1, exportPolicy: action === 'revoke' ? 'off' : 'approved_excerpts' });
    expect(restarted.pendingSourceCommands()).toMatchObject([{ kind: action, bindingId: localBinding.binding.id, grantRevision: 1 }]);
    expect(await restarted.pendingUploads(20)).toHaveLength(uploads);
    expect(main.desktopEvents).toContainEqual(expect.objectContaining({ type: 'source_state', binding: expect.objectContaining({ state }), cloudRevocationPending: action === 'revoke' }));
    const dialogs = JSON.stringify(main.dialog.showMessageBox.mock.calls);
    expect(dialogs).toMatch(/this device/i);
    expect(dialogs).toMatch(/cloud.*pending|pending.*cloud/i);
    expect(dialogs).toMatch(action === 'revoke' ? /queued.*(remov|delet|purg)/i : /queued.*(retain|held|keep)/i);
    const reads = main.observer.readDelta.mock.calls.length;
    main.tick(); await nextTurn();
    expect(main.observer.readDelta).toHaveBeenCalledTimes(reads);
    expect(main.client.getSnapshot).not.toHaveBeenCalled();
    await expect(main.invoke('invoke', { type: 'getSnapshot', projectId: localBinding.binding.projectId })).rejects.toThrow();
  } finally { await main.close(); }
});

it.each(['pause', 'revoke'] as const)('native %s can be cancelled without changing local consent or the queue', async action => {
  const main = await startSyntheticMain({ seed, credentialExpiry: '2000-01-01T00:00:00.000Z' });
  try {
    click(main, action); await idle(main); // The native dialog defaults to Cancel.
    expect(main.dialog.showMessageBox.mock.calls[0]?.[1]).toMatchObject({ defaultId: 1, cancelId: 1 });
    expect(main.observer.stop).not.toHaveBeenCalled();
    const restarted = await JournalStore.open(main.path);
    expect(restarted.binding(localBinding.binding.id)?.binding.state).toBe('following');
    expect(restarted.pendingSourceCommands()).toEqual([]);
    expect(await restarted.pendingUploads(20)).toHaveLength(1);
  } finally { await main.close(); }
});

it.each(['pause', 'revoke'] as const)('native %s remains reachable without a configured cloud origin', async action => {
  const main = await startSyntheticMain({ seed, apiOrigin: '' });
  try {
    main.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    click(main, action); await idle(main);
    expect(main.dialog.showErrorBox).not.toHaveBeenCalled();
    expect((await JournalStore.open(main.path)).pendingSourceCommands()).toMatchObject([{ kind: action }]);
    expect(main.client.listProjects).not.toHaveBeenCalled();
    expect(main.client.getSnapshot).not.toHaveBeenCalled();
  } finally { await main.close(); }
});

it.each(['pause', 'revoke'] as const)('native %s fails closed without protected device custody', async action => {
  const main = await startSyntheticMain({ seed, withoutCredential: true });
  try {
    main.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    click(main, action); await idle(main);
    expect(main.dialog.showErrorBox).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/custody|verif|protected/i));
    expect(main.observer.stop).not.toHaveBeenCalled();
    const restarted = await JournalStore.open(main.path);
    expect(restarted.binding(localBinding.binding.id)?.binding.state).toBe('following');
    expect(restarted.pendingSourceCommands()).toEqual([]);
  } finally { await main.close(); }
});

it.each(['pause', 'revoke'] as const)('native %s cannot withdraw a foreign device grant', async action => {
  const main = await startSyntheticMain({ seed, credentialDevice: fixtureIds.owner, credentialExpiry: '2000-01-01T00:00:00.000Z' });
  try {
    main.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    click(main, action); await idle(main);
    expect(main.observer.stop).not.toHaveBeenCalled();
    const restarted = await JournalStore.open(main.path);
    expect(restarted.binding(localBinding.binding.id)?.binding.state).toBe('following');
    expect(restarted.pendingSourceCommands()).toEqual([]);
    expect(JSON.stringify(main.dialog.showMessageBox.mock.calls)).toMatch(/no .*sources|no .*access/i);
  } finally { await main.close(); }
});

it('native withdrawals stay single-flight through confirmation and preference menu rebuilds', async () => {
  const main = await startSyntheticMain({ seed, credentialExpiry: '2000-01-01T00:00:00.000Z' });
  const confirmation = deferred<{ response: number }>();
  try {
    main.dialog.showMessageBox.mockImplementationOnce(() => confirmation.promise).mockResolvedValue({ response: 0 });
    click(main, 'revoke');
    main.clickTray('pause-sources'); main.clickTray('revoke-sources');
    main.clickTray('click-through');
    expect(main.trayItem('revoke-sources').enabled).toBe(false);
    expect(main.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(main.observer.stop).not.toHaveBeenCalled();
    confirmation.resolve({ response: 0 }); await idle(main);
    expect(main.observer.stop).toHaveBeenCalledTimes(1);
    expect((await JournalStore.open(main.path)).pendingSourceCommands()).toMatchObject([{ kind: 'revoke', grantRevision: 1 }]);
    expect(main.windows.pet.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
    main.clickTray('click-through');
    expect(main.windows.pet.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true });
    main.clickTray('open'); expect(main.windows.workspace.show).toHaveBeenCalled();
    main.clickTray('hide');
    await vi.waitFor(async () => expect((await JournalStore.open(main.path)).preference()).toMatchObject({ hidden: true }));
    main.clickTray('focus');
    await vi.waitFor(async () => expect((await JournalStore.open(main.path)).preference()).toMatchObject({ hidden: true, focus: true }));
  } finally { confirmation.resolve({ response: 1 }); await main.close(); }
});

it('native confirmation cannot carry old device custody across re-pairing', async () => {
  const main = await startSyntheticMain({ seed, credentialExpiry: '2000-01-01T00:00:00.000Z' });
  const confirmation = deferred<{ response: number }>();
  try {
    main.dialog.showMessageBox.mockImplementationOnce(() => confirmation.promise);
    click(main, 'revoke');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ token: 'synthetic-replacement-token', deviceId: fixtureIds.owner, expiresAt: '2099-01-01T00:00:00.000Z' }), { headers: { 'Content-Type': 'application/json' } }));
    await main.invoke('pair', { code: 'synthetic-pairing-code', deviceName: 'Synthetic replacement device' });
    confirmation.resolve({ response: 0 }); await idle(main);
    expect(main.dialog.showErrorBox).toHaveBeenCalledTimes(1);
    expect(main.observer.stop).not.toHaveBeenCalled();
    const restarted = await JournalStore.open(main.path);
    expect(restarted.binding(localBinding.binding.id)?.binding.state).toBe('following');
    expect(restarted.pendingSourceCommands()).toEqual([]);
  } finally { confirmation.resolve({ response: 1 }); await main.close(); }
});

it('Quit while native confirmation is open prevents later withdrawal and destroyed-menu rebuilds', async () => {
  const main = await startSyntheticMain({ seed, credentialExpiry: '2000-01-01T00:00:00.000Z' });
  const confirmation = deferred<{ response: number }>();
  main.dialog.showMessageBox.mockImplementationOnce(() => confirmation.promise);
  click(main, 'revoke');
  await main.close();
  confirmation.resolve({ response: 0 }); await nextTurn();
  expect(main.observer.stop).toHaveBeenCalledTimes(1); // Lifetime stop only.
  expect(main.dialog.showMessageBox).toHaveBeenCalledTimes(1);
  expect(main.dialog.showErrorBox).not.toHaveBeenCalled();
});

it.each(['pause', 'revoke'] as const)('native %s fences an in-flight observer before a late batch can commit', async action => {
  const main = await startSyntheticMain({ seed, client: offline });
  const batch = deferred<ReturnType<typeof ObservationBatchSchema.parse>>();
  try {
    const before = await JournalStore.open(main.path);
    main.observer.readDelta.mockImplementationOnce(() => batch.promise);
    const reads = main.observer.readDelta.mock.calls.length;
    main.tick(); await vi.waitFor(() => expect(main.observer.readDelta).toHaveBeenCalledTimes(reads + 1));
    const signal = main.observer.readDelta.mock.calls.at(-1)![2];
    main.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    click(main, action); await idle(main);
    expect(signal.aborted).toBe(true);
    batch.resolve(ObservationBatchSchema.parse(goldenObservationBatch)); await nextTurn();
    const restarted = await JournalStore.open(main.path);
    expect(restarted.cursor(localBinding.binding.id)).toEqual(before.cursor(localBinding.binding.id));
    expect(await restarted.pendingUploads(20)).toHaveLength(action === 'pause' ? 1 : 0);
  } finally { batch.resolve(ObservationBatchSchema.parse(goldenObservationBatch)); await main.close(); }
});

it('native failure reporting sanitizes observer errors and allows retry', async () => {
  const main = await startSyntheticMain({ seed, credentialExpiry: '2000-01-01T00:00:00.000Z' });
  try {
    main.observer.stop.mockRejectedValueOnce(Error('secret=C:\\private-source token=do-not-display'));
    main.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    click(main, 'revoke'); await idle(main);
    expect(main.dialog.showErrorBox).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(main.dialog.showErrorBox.mock.calls)).not.toMatch(/private-source|do-not-display/);
    expect(main.dialog.showMessageBox).toHaveBeenCalledTimes(1); // No success claim.
    click(main, 'revoke'); await idle(main);
    expect(main.observer.stop).toHaveBeenCalledTimes(2);
    expect((await JournalStore.open(main.path)).binding(localBinding.binding.id)?.binding).toMatchObject({ state: 'revoked', grantRevision: 2 });
  } finally { main.observer.stop.mockImplementation(async () => {}); await main.close(); }
});

it('native journal failure is visible, leaves collection fenced and never claims durable revocation', async () => {
  const main = await startSyntheticMain({ seed, client: offline });
  let failedWrite = false;
  try {
    await mkdir(`${main.path}.tmp`);
    main.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    click(main, 'revoke'); await idle(main); failedWrite = true;
    expect(main.observer.stop).toHaveBeenCalledWith(localBinding.binding.id);
    expect(main.dialog.showErrorBox).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/journal|durab|sav|persist/i));
    expect(JSON.stringify(main.dialog.showErrorBox.mock.calls)).not.toContain(main.path);
    expect(main.dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect((await JournalStore.open(main.path)).binding(localBinding.binding.id)?.binding.state).toBe('following');
    const reads = main.observer.readDelta.mock.calls.length;
    main.tick(); await nextTurn();
    expect(main.observer.readDelta).toHaveBeenCalledTimes(reads);
  } finally { await rm(`${main.path}.tmp`, { recursive: true, force: true }); await main.close(failedWrite); }
});
