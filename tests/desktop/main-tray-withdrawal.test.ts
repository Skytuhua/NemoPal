import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { ObservationBatchSchema, SourceSelectionPreviewSchema, type CommandReceipt, type ProjectSnapshot, type SourceBinding } from '@living-playbooks/contracts';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { localBinding, selectedThread, syntheticReceiving } from '../../fixtures/codex/synthetic';
import { fixtureIds, goldenObservationBatch } from '../../fixtures/contracts/golden';
import { deferred, projectSnapshot, startSyntheticMain } from './main-harness';

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

it.each(['repair','withdraw'] as const)('native transport denies enrollment changed during real command hashing: %s', async change => {
  const enrollSource = vi.fn();
  const main = await startSyntheticMain({ client: { enrollSource }, receivingEndpoint: syntheticReceiving.modelEndpoint, disclosure: syntheticReceiving.disclosure });
  const hashing = deferred<void>(), release = deferred<void>();
  let enrolling: Promise<unknown> | undefined;
  try {
    vi.stubEnv('LP_SELECTED_SOURCE', selectedThread); vi.stubEnv('LP_SYNTHETIC_SOURCE_NAME', 'synthetic-transport-race');
    const actual = await vi.importActual<typeof import('@living-playbooks/api-client')>('@living-playbooks/api-client');
    let authorization = 'Bearer synthetic-main-port-token';
    const realClient = actual.createHttpClient({ origin: 'http://127.0.0.1:4310', allowInsecureLoopback: true, getAuthorization: () => authorization, fetch: main.transport });
    enrollSource.mockImplementation(realClient.enrollSource);
    const sourcePosts: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const path = new URL(url instanceof Request ? url.url : url).pathname;
      if (path.endsWith('/auth/redeem')) return Response.json({ token: 'synthetic-replacement-token', deviceId: fixtureIds.owner, expiresAt: '2099-01-01T00:00:00.000Z' });
      sourcePosts.push(path); throw Error('Synthetic source HTTP side effect');
    });
    await main.invoke('invoke', { type: 'listProjects' }); main.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    const preview = SourceSelectionPreviewSchema.parse(await main.invoke('selectSource', localBinding.binding.projectId));
    if (!preview.available) throw Error('Synthetic preview missing');
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => { hashing.resolve(); await release.promise; return digest(...args); });
    enrolling = main.invoke('confirmSource', { selectionId: preview.selectionId, projectId: preview.projectId, allowLocalRead: true, exportPolicy: 'approved_excerpts', acknowledgedBestEffortFiltering: true });
    await hashing.promise;
    if (change === 'repair') { await main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic B' }); authorization = 'Bearer synthetic-replacement-token'; }
    else { click(main, 'revoke'); await idle(main); }
    release.resolve(); await expect(enrolling).rejects.toThrow();
    expect(sourcePosts).toEqual([]); expect(main.observer.readDelta).not.toHaveBeenCalled();
    expect((await JournalStore.open(main.path)).bindings()).toEqual([]);
  } finally { release.resolve(); await enrolling?.catch(() => {}); await main.close(); }
});

it('re-pairing during the snapshot cancels stale source consent before a cloud enrollment', async () => {
  const snapshot = deferred<ProjectSnapshot>();
  const enrollSource = vi.fn();
  const main = await startSyntheticMain({ client: { enrollSource }, receivingEndpoint: syntheticReceiving.modelEndpoint, disclosure: syntheticReceiving.disclosure });
  let enrolling: Promise<unknown> | undefined;
  try {
    vi.stubEnv('LP_SELECTED_SOURCE', selectedThread); vi.stubEnv('LP_SYNTHETIC_SOURCE_NAME', 'synthetic-custody-race');
    await main.invoke('invoke', { type: 'listProjects' }); main.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    const preview = SourceSelectionPreviewSchema.parse(await main.invoke('selectSource', localBinding.binding.projectId));
    if (!preview.available) throw Error('Synthetic preview missing');
    vi.mocked(main.client.getSnapshot).mockClear().mockImplementationOnce(() => snapshot.promise);
    enrolling = main.invoke('confirmSource', { selectionId: preview.selectionId, projectId: preview.projectId, allowLocalRead: true, exportPolicy: 'approved_excerpts', acknowledgedBestEffortFiltering: true });
    await vi.waitFor(() => expect(main.client.getSnapshot).toHaveBeenCalledTimes(1));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ token: 'synthetic-replacement-token', deviceId: fixtureIds.owner, expiresAt: '2099-01-01T00:00:00.000Z' }));
    await main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic B' });
    snapshot.resolve(projectSnapshot('A'));
    await expect(enrolling).rejects.toThrow();
    expect(enrollSource).not.toHaveBeenCalled(); expect(main.observer.readDelta).not.toHaveBeenCalled();
    expect((await JournalStore.open(main.path)).bindings()).toEqual([]);
  } finally { snapshot.resolve(projectSnapshot('A')); await enrolling?.catch(() => {}); await main.close(); }
});

it.each(['device','project'] as const)('a mismatched returned source %s cannot persist or start observing', async identity => {
  const binding: SourceBinding = { ...localBinding.binding, id: randomUUID(), ...(identity === 'device' ? { deviceId: randomUUID() } : { projectId: randomUUID() }) };
  const receipt: CommandReceipt<SourceBinding> = { result: binding, operationId: randomUUID(), requestHash: 'a'.repeat(64), status: 'completed', projectRevision: 0, eventSequence: 0 };
  const main = await startSyntheticMain({ client: { enrollSource: vi.fn(async () => receipt) }, receivingEndpoint: syntheticReceiving.modelEndpoint, disclosure: syntheticReceiving.disclosure });
  try {
    vi.stubEnv('LP_SELECTED_SOURCE', selectedThread); vi.stubEnv('LP_SYNTHETIC_SOURCE_NAME', 'synthetic-custody-mismatch');
    await main.invoke('invoke', { type: 'listProjects' }); main.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    const preview = SourceSelectionPreviewSchema.parse(await main.invoke('selectSource', localBinding.binding.projectId));
    if (!preview.available) throw Error('Synthetic preview missing');
    await expect(main.invoke('confirmSource', { selectionId: preview.selectionId, projectId: preview.projectId, allowLocalRead: true, exportPolicy: 'approved_excerpts', acknowledgedBestEffortFiltering: true })).rejects.toThrow();
    expect(main.observer.readDelta).not.toHaveBeenCalled(); expect((await JournalStore.open(main.path)).bindings()).toEqual([]);
  } finally { await main.close(); }
});

it.each([
  ['pause','before-confirmation'], ['pause','after-success'],
  ['revoke','before-confirmation'], ['revoke','after-success'],
  ['revoke','cancel'],
  ['revoke','late-write-failure'],
  ['revoke','during-withdrawal'],
] as const)('tray %s fences earlier enrollment completing %s', async (action, when) => {
  const fresh: SourceBinding = { ...localBinding.binding, id: randomUUID(), sourceKey: randomUUID() };
  const enrollment = deferred<CommandReceipt<SourceBinding>>();
  const enrolled: CommandReceipt<SourceBinding> = { result: fresh, operationId: randomUUID(), requestHash: 'a'.repeat(64), status: 'completed', projectRevision: 0, eventSequence: 0 };
  const enrollSource = vi.fn(() => enrollment.promise);
  const main = await startSyntheticMain({
    seed: async store => { await store.putBinding(localBinding, false); await store.revokeBinding(localBinding.binding.id, 1); },
    client: { enrollSource }, receivingEndpoint: syntheticReceiving.modelEndpoint, disclosure: syntheticReceiving.disclosure,
  });
  const confirmation = deferred<{ response: number }>();
  const releaseStop = deferred<void>();
  let enrolling: Promise<unknown> | undefined;
  let journalWriteBlocked = false;
  try {
    vi.stubEnv('LP_SELECTED_SOURCE', selectedThread); vi.stubEnv('LP_SYNTHETIC_SOURCE_NAME', 'synthetic-enrollment-race');
    await main.invoke('invoke', { type: 'listProjects' });
    main.observer.readDelta.mockImplementation(async local => ObservationBatchSchema.parse({ ...goldenObservationBatch, mode: 'incremental_history', observations: goldenObservationBatch.observations.map(o => ({ ...o, id: randomUUID(), bindingId: local.binding.id, grantRevision: local.binding.grantRevision })) }));
    main.dialog.showMessageBox.mockResolvedValue({ response: 0 });
    const preview = SourceSelectionPreviewSchema.parse(await main.invoke('selectSource', localBinding.binding.projectId));
    expect(preview.available).toBe(true); if (!preview.available) throw Error('Synthetic source selection failed');
    enrolling = main.invoke('confirmSource', { selectionId: preview.selectionId, projectId: preview.projectId, allowLocalRead: true, exportPolicy: 'approved_excerpts', acknowledgedBestEffortFiltering: true });
    await vi.waitFor(() => expect(enrollSource).toHaveBeenCalledTimes(1));
    main.dialog.showMessageBox.mockImplementationOnce(() => confirmation.promise).mockResolvedValue({ response: 0 });
    if (when === 'during-withdrawal') main.observer.stop.mockImplementation(id => id === localBinding.binding.id ? releaseStop.promise : Promise.resolve());
    click(main, action);
    if (when === 'before-confirmation') { enrollment.resolve(enrolled); await enrolling; }
    const reads = main.observer.readDelta.mock.calls.length;
    confirmation.resolve({ response: when === 'cancel' ? 1 : 0 });
    if (when === 'during-withdrawal') {
      await vi.waitFor(() => expect(main.observer.stop).toHaveBeenCalledWith(localBinding.binding.id));
      enrollment.resolve(enrolled); await enrolling; releaseStop.resolve();
    }
    await idle(main);
    if (when === 'late-write-failure') {
      await mkdir(`${main.path}.tmp`); journalWriteBlocked = true;
      enrollment.resolve(enrolled);
      await expect(enrolling).rejects.toThrow();
      expect(main.dialog.showErrorBox).toHaveBeenCalledWith('Local source action incomplete', expect.any(String));
      expect(JSON.stringify(main.dialog.showErrorBox.mock.calls)).not.toContain(main.path);
      expect((await JournalStore.open(main.path)).binding(fresh.id)).toBeUndefined();
      expect(main.observer.readDelta).toHaveBeenCalledTimes(reads);
      return;
    }
    if (when !== 'before-confirmation') { enrollment.resolve(enrolled); await enrolling; }
    const restarted = await JournalStore.open(main.path);
    if (when === 'during-withdrawal') expect(main.dialog.showMessageBox.mock.calls.at(-1)?.[1].detail).toMatch(/Cloud revocation.*pending/i);
    if (when === 'cancel') {
      expect(restarted.binding(fresh.id)?.binding.state).toBe('following');
      expect(restarted.pendingSourceCommands()).toEqual([]);
      expect(main.observer.stop).not.toHaveBeenCalledWith(fresh.id);
      return;
    }
    expect(restarted.binding(fresh.id)?.binding.state).toBe(action === 'revoke' ? 'revoked' : 'paused');
    expect(restarted.pendingSourceCommands()).toContainEqual(expect.objectContaining({ kind: action, bindingId: fresh.id }));
    expect(main.observer.stop).toHaveBeenCalledWith(fresh.id);
    if (action === 'revoke') expect(await restarted.pendingUploads(20)).toHaveLength(0);
    if (when === 'after-success') expect(main.observer.readDelta).toHaveBeenCalledTimes(reads);
    main.tick(); await nextTurn();
    expect(main.observer.readDelta).toHaveBeenCalledTimes(reads);
  } finally {
    enrollment.resolve(enrolled); confirmation.resolve({ response: 1 });
    releaseStop.resolve();
    await enrolling?.catch(() => {});
    if (journalWriteBlocked) await rm(`${main.path}.tmp`, { recursive: true, force: true });
    await main.close(journalWriteBlocked);
  }
});

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
    const stoppedForPairing = main.observer.stop.mock.calls.length;
    expect(stoppedForPairing).toBeGreaterThan(0);
    confirmation.resolve({ response: 0 }); await idle(main);
    expect(main.dialog.showErrorBox).toHaveBeenCalledTimes(1);
    expect(main.observer.stop).toHaveBeenCalledTimes(stoppedForPairing);
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
