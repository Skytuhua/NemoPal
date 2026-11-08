import { expect, it, vi } from 'vitest';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { ObservationBatchSchema, type PlaybooksClient, type ProjectSnapshot } from '@living-playbooks/contracts';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { fixtureIds, goldenObservationBatch } from '../../fixtures/contracts/golden';
import { localBinding, syntheticReceiving } from '../../fixtures/codex/synthetic';
import { deferred, projectSnapshot, startSyntheticMain } from './main-harness';

type Main = Awaited<ReturnType<typeof startSyntheticMain>>;
const summaries = async (main: Main) => (await main.client.listProjects()).filter(project => project.id === projectSnapshot('B').project.id);
async function prepareB(main: Main) {
  const b = await summaries(main);
  vi.mocked(main.client.listProjects).mockResolvedValue(b);
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ token: 'synthetic-owner-b-token', deviceId: fixtureIds.owner, expiresAt: '2099-01-01T00:00:00.000Z' }));
}
async function pairB(main: Main) {
  await prepareB(main);
  await main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic B' });
}

it('a held old-owner snapshot cannot return, restore authority or reach the pet after pairing', async () => {
  const main = await startSyntheticMain();
  const a = projectSnapshot('A'), b = projectSnapshot('B'), release = deferred<ProjectSnapshot>();
  let request: Promise<unknown> | undefined;
  try {
    await main.invoke('invoke', { type: 'getSnapshot', projectId: a.project.id });
    vi.mocked(main.client.getSnapshot).mockImplementationOnce(() => release.promise);
    const count = vi.mocked(main.client.getSnapshot).mock.calls.length;
    request = main.invoke('invoke', { type: 'getSnapshot', projectId: a.project.id });
    const outcome = request.then(value => ({ accepted: true, value }), () => ({ accepted: false }));
    await vi.waitFor(() => expect(main.client.getSnapshot).toHaveBeenCalledTimes(count + 1));
    await pairB(main);
    expect(main.petEvents.at(-1)).toMatchObject({ projectId: null, managerName: '', checkIn: null });
    await main.invoke('invoke', { type: 'listProjects' });
    await expect(main.invoke('invoke', { type: 'getSnapshot', projectId: b.project.id })).resolves.toMatchObject({ project: { id: b.project.id } });
    const pairedAt = main.petEvents.length;
    release.resolve(a);
    expect(await outcome).toEqual({ accepted: false });
    expect(main.petEvents.slice(pairedAt).some(event => event.projectId === a.project.id)).toBe(false);
    expect(main.petEvents.at(-1)).toMatchObject({ projectId: b.project.id, managerName: 'Manager B' });
    await expect(main.invoke('invoke', { type: 'getSnapshot', projectId: a.project.id })).rejects.toThrow();
    await vi.waitFor(() => expect(main.client.listProjects).toHaveBeenCalled());
    await main.invoke('invoke', { type: 'listProjects' });
    await expect(main.invoke('invoke', { type: 'getSnapshot', projectId: b.project.id })).resolves.toMatchObject({ project: { id: b.project.id } });
  } finally { release.resolve(a); await request?.catch(() => {}); await main.close(); }
});

it('invalidates old reads before protected replacement finishes', async () => {
  const encryption = deferred<void>(), snapshot = deferred<ProjectSnapshot>();
  const main = await startSyntheticMain({ credentialEncryption: () => encryption.promise });
  let pairing: Promise<unknown> | undefined, request: Promise<unknown> | undefined;
  try {
    vi.mocked(main.client.getSnapshot).mockImplementationOnce(() => snapshot.promise);
    const count = vi.mocked(main.client.getSnapshot).mock.calls.length;
    request = main.invoke('invoke', { type: 'getSnapshot', projectId: projectSnapshot('A').project.id });
    const outcome = request.then(() => true, () => false);
    await vi.waitFor(() => expect(main.client.getSnapshot).toHaveBeenCalledTimes(count + 1));
    await prepareB(main);
    pairing = main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic B' });
    await vi.waitFor(() => expect(main.petEvents.at(-1)).toMatchObject({ projectId: null, managerName: '' }));
    snapshot.resolve(projectSnapshot('A'));
    expect(await outcome).toBe(false);
    encryption.resolve(); await pairing;
  } finally { encryption.resolve(); snapshot.resolve(projectSnapshot('A')); await pairing?.catch(() => {}); await request?.catch(() => {}); await main.close(); }
});

it('serializes pairing so two redemptions cannot replace credentials out of order', async () => {
  const main = await startSyntheticMain(), response = deferred<Response>();
  let pending: Promise<unknown> | undefined;
  try {
    await prepareB(main);
    vi.mocked(globalThis.fetch).mockImplementationOnce(() => response.promise);
    pending = main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic B' });
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    await expect(main.invoke('pair', { code: 'another-synthetic-code', deviceName: 'Synthetic C' })).rejects.toThrow();
    response.resolve(Response.json({ token: 'synthetic-owner-b-token', deviceId: fixtureIds.owner, expiresAt: '2099-01-01T00:00:00.000Z' }));
    await expect(pending).resolves.toMatchObject({ paired: true, deviceId: fixtureIds.owner });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  } finally { response.resolve(Response.json({})); await pending?.catch(() => {}); await main.close(); }
});

it('Quit owns a protected pairing write and prevents late pairing GUI or restart work', async () => {
  const entered = deferred<void>(), release = deferred<void>();
  const main = await startSyntheticMain({ credentialEncryption: async () => { entered.resolve(); await release.promise; } });
  let pending: Promise<unknown> | undefined;
  try {
    await prepareB(main);
    pending = main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic B' });
    const outcome = pending.then(() => true, () => false);
    await entered.promise;
    main.clickTray('quit'); await nextTurn();
    expect(main.app.exit).not.toHaveBeenCalled();
    release.resolve(); expect(await outcome).toBe(false);
    await vi.waitFor(() => expect(main.app.exit).toHaveBeenCalledWith(0));
    expect(main.dialog.showErrorBox).not.toHaveBeenCalled();
  } finally { release.resolve(); await pending?.catch(() => {}); await main.close(); }
});

it('Quit during the protected storage check prevents a later redemption request', async () => {
  const main = await startSyntheticMain(), entered = deferred<void>(), release = deferred<boolean>();
  let pending: Promise<unknown> | undefined;
  try {
    main.protectedStorage.isAsyncEncryptionAvailable.mockImplementationOnce(() => { entered.resolve(); return release.promise; });
    const sent = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ token: 'synthetic-owner-b-token', deviceId: fixtureIds.owner, expiresAt: '2099-01-01T00:00:00.000Z' }));
    pending = main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic B' });
    const outcome = pending.then(() => true, () => false);
    await entered.promise; main.clickTray('quit'); await nextTurn();
    release.resolve(true); expect(await outcome).toBe(false);
    await vi.waitFor(() => expect(main.app.exit).toHaveBeenCalledWith(0));
    expect(sent).not.toHaveBeenCalled();
  } finally { release.resolve(true); await pending?.catch(() => {}); await main.close(); }
});

it('a completed pairing reply cannot return after a later pairing has replaced it', async () => {
  const main = await startSyntheticMain(), entered = deferred<void>(), release = deferred<void>();
  let pending: Promise<unknown> | undefined;
  try {
    await prepareB(main);
    const { NativeBoundary } = await import('../../apps/desktop/src/main/ipc');
    const call = NativeBoundary.prototype.call;
    let pairs = 0;
    vi.spyOn(NativeBoundary.prototype, 'call').mockImplementation(async function (this: InstanceType<typeof NativeBoundary>, ...args) {
      const result = await call.apply(this, args);
      if (args[1] === 'pair' && ++pairs === 1) { entered.resolve(); await release.promise; }
      return result;
    });
    pending = main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic B' });
    const outcome = pending.then(() => true, () => false);
    await entered.promise;
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(Response.json({ token: 'synthetic-owner-c-token', deviceId: fixtureIds.task, expiresAt: '2099-01-01T00:00:00.000Z' }));
    await expect(main.invoke('pair', { code: 'synthetic-code-c', deviceName: 'Synthetic C' })).resolves.toMatchObject({ deviceId: fixtureIds.task });
    release.resolve(); expect(await outcome).toBe(false);
  } finally { release.resolve(); await pending?.catch(() => {}); await main.close(); }
});

it('a stalled old background cycle neither blocks the new owner nor presents its late result', async () => {
  const main = await startSyntheticMain(), release = deferred<ProjectSnapshot>();
  try {
    await main.invoke('invoke', { type: 'getSnapshot', projectId: projectSnapshot('A').project.id });
    vi.mocked(main.client.getSnapshot).mockImplementationOnce(() => release.promise);
    const count = vi.mocked(main.client.getSnapshot).mock.calls.length;
    main.tick();
    await vi.waitFor(() => expect(main.client.getSnapshot).toHaveBeenCalledTimes(count + 1));
    await pairB(main);
    await main.invoke('invoke', { type: 'listProjects' });
    await expect(main.invoke('invoke', { type: 'getSnapshot', projectId: projectSnapshot('B').project.id })).resolves.toMatchObject({ project: { title: 'B' } });
    const pairedAt = main.petEvents.length;
    release.resolve(projectSnapshot('A')); await nextTurn();
    expect(main.petEvents.slice(pairedAt).some(event => event.projectId === projectSnapshot('A').project.id)).toBe(false);
    expect(main.petEvents.at(-1)?.projectId).toBe(projectSnapshot('B').project.id);
  } finally { release.resolve(projectSnapshot('A')); await nextTurn(); await main.close(); }
});

it.each(['hash', 'authorization'] as const)('old authenticated commands cannot acquire the new credential during %s', async stage => {
  const main = await startSyntheticMain();
  const entered = deferred<void>(), release = deferred<void>();
  let pending: Promise<unknown> | undefined;
  try {
    const configuration = main.clientConfigurations[0];
    if (!configuration) throw Error('Synthetic native configuration missing');
    const actual = await vi.importActual<typeof import('@living-playbooks/api-client')>('@living-playbooks/api-client');
    const oldClient = actual.createHttpClient({ ...configuration, getAuthorization: async () => {
      if (stage === 'authorization') { entered.resolve(); await release.promise; }
      return configuration.getAuthorization?.();
    } });
    const sent: string[] = [];
    await prepareB(main);
    vi.mocked(globalThis.fetch).mockImplementation(async url => {
      const path = new URL(url instanceof Request ? url.url : url).pathname;
      if (path.endsWith('/auth/redeem')) return Response.json({ token: 'synthetic-owner-b-token', deviceId: fixtureIds.owner, expiresAt: '2099-01-01T00:00:00.000Z' });
      sent.push(path); throw Error('Synthetic stale request recorded');
    });
    if (stage === 'hash') {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(async (...args) => { entered.resolve(); await release.promise; return digest(...args); });
    }
    pending = oldClient.sendMessage(projectSnapshot('A').project.id, { operationId: fixtureIds.owner, expectedRevision: 0, input: { text: 'Synthetic owner A message' } });
    const outcome = pending.then(() => true, () => false);
    await entered.promise;
    await main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic B' });
    release.resolve(); expect(await outcome).toBe(false);
    expect(await configuration.getAuthorization?.()).toBe('Bearer synthetic-main-port-token');
    expect(await main.clientConfigurations.at(-1)?.getAuthorization?.()).toBe('Bearer synthetic-owner-b-token');
    expect(sent).toEqual([]);
  } finally { release.resolve(); await pending?.catch(() => {}); await main.close(); }
});

it('a new device can sync while prior-device uploads and withdrawal commands remain retained', async () => {
  const b = projectSnapshot('B').sourceBindings[0];
  if (!b) throw Error('Synthetic B source missing');
  const binding = { ...localBinding, binding: { ...b, deviceId: fixtureIds.owner } };
  const ingestObservations = vi.fn<PlaybooksClient['ingestObservations']>(async (_id, command) => ({ operationId: command.operationId, requestHash: 'a'.repeat(64), status: 'completed', projectRevision: 0, eventSequence: 0, result: { acceptedIds: command.input.observations.map(observation => observation.id), duplicateIds: [] } }));
  const main = await startSyntheticMain({ receivingEndpoint: syntheticReceiving.modelEndpoint, disclosure: syntheticReceiving.disclosure,
    client: { ingestObservations }, seed: async store => {
      await store.putBinding(localBinding, true, syntheticReceiving);
      await store.commitObservationBatch(localBinding.binding.id, null, ObservationBatchSchema.parse(goldenObservationBatch));
      await store.pauseBinding(localBinding.binding.id);
      await store.putBinding(binding, true, syntheticReceiving);
      await store.commitObservationBatch(binding.binding.id, null, ObservationBatchSchema.parse({ ...goldenObservationBatch,
        observations: goldenObservationBatch.observations.map(observation => ({ ...observation, bindingId: binding.binding.id, id: fixtureIds.owner })) }));
    } });
  try {
    const before = await JournalStore.open(main.path);
    const prior = before.pendingSourceCommands();
    await pairB(main);
    await vi.waitFor(async () => expect(await (await JournalStore.open(main.path)).pendingUploads(1, fixtureIds.owner)).toEqual([]));
    expect(ingestObservations.mock.calls.map(call => call[0])).toEqual([binding.binding.id]);
    const after = await JournalStore.open(main.path);
    expect(await after.pendingUploads(20, fixtureIds.device)).toHaveLength(1);
    expect(after.pendingSourceCommands()).toEqual(prior);
    expect(after.binding(localBinding.binding.id)?.binding.state).toBe('paused');
    expect(main.client.setSourceState).toHaveBeenCalledTimes(1); // Only the initial A session attempted A's withdrawal.
  } finally { await main.close(); }
});

it('an invalid redemption keeps the current session usable', async () => {
  const main = await startSyntheticMain();
  try {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'synthetic invalid code' }, { status: 401 }));
    await expect(main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic B' })).rejects.toThrow();
    await expect(main.invoke('invoke', { type: 'getSnapshot', projectId: projectSnapshot('A').project.id })).resolves.toMatchObject({ project: { title: 'A' } });
  } finally { await main.close(); }
});

it('explicit pairing retry succeeds after protected save fails, while old local withdrawal remains available', async () => {
  let encryptions = 0;
  const main = await startSyntheticMain({ seed: store => store.putBinding(localBinding, false),
    credentialEncryption: async () => { if (++encryptions === 1) throw Error('Synthetic protected save failed'); } });
  try {
    const attemptedWithAbortedSignal: boolean[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      attemptedWithAbortedSignal.push(Boolean(init?.signal?.aborted));
      if (init?.signal?.aborted) throw new DOMException('Synthetic Fetch honors cancellation', 'AbortError');
      return Response.json({ token: 'synthetic-owner-b-token', deviceId: fixtureIds.owner, expiresAt: '2099-01-01T00:00:00.000Z' });
    });
    await expect(main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic B' })).rejects.toThrow();
    await expect(main.invoke('capabilities')).resolves.toMatchObject({ paired: false });
    await main.invoke('pauseSource', localBinding.binding.id);
    expect((await JournalStore.open(main.path)).binding(localBinding.binding.id)?.binding.state).toBe('paused');
    await expect(main.invoke('pair', { code: 'synthetic-code-retry', deviceName: 'Synthetic B' })).resolves.toMatchObject({ paired: true, deviceId: fixtureIds.owner });
    expect(attemptedWithAbortedSignal).toEqual([false, false]);
    expect(encryptions).toBe(2);
  } finally { await main.close(); }
});

it('a held old-owner project list cannot repopulate the new owner authority', async () => {
  const main = await startSyntheticMain();
  const a = projectSnapshot('A'), original = await main.client.listProjects(), release = deferred<typeof original>();
  let request: Promise<unknown> | undefined;
  try {
    vi.mocked(main.client.listProjects).mockImplementationOnce(() => release.promise);
    request = main.invoke('invoke', { type: 'listProjects' });
    const outcome = request.then(() => true, () => false);
    await pairB(main);
    release.resolve(original);
    expect(await outcome).toBe(false);
    await expect(main.invoke('invoke', { type: 'getSnapshot', projectId: a.project.id })).rejects.toThrow();
  } finally { release.resolve(original); await request?.catch(() => {}); await main.close(); }
});

it('pairing aborts the old event stream and ignores its late callbacks and failures', async () => {
  const subscription = deferred<void>();
  const subscribe = vi.fn(async () => new Promise<void>(() => {})).mockImplementationOnce(() => subscription.promise);
  const main = await startSyntheticMain({ client: { subscribe } });
  try {
    const [, receive, signal] = vi.mocked(main.client.subscribe).mock.calls[0]!;
    await pairB(main);
    await main.invoke('invoke', { type: 'listProjects' });
    const count = main.desktopEvents.length;
    receive({ seq: 123, projectId: projectSnapshot('B').project.id, kind: 'job_updated', resourceId: fixtureIds.owner, revision: 0 });
    expect(signal.aborted).toBe(true);
    expect(main.desktopEvents.slice(count).some(event => event.type === 'project_event')).toBe(false);
    subscription.reject(Error('Synthetic stale stream failure'));
    await Promise.resolve();
    await expect(main.invoke('invoke', { type: 'getSnapshot', projectId: projectSnapshot('B').project.id })).resolves.toMatchObject({ project: { title: 'B' } });
  } finally { subscription.resolve(); await main.close(); }
});

it('pairing clears the old owner pin durably while retaining non-owner pet preferences', async () => {
  const main = await startSyntheticMain();
  try {
    await main.invoke('setPetPreference', { hidden: false, focus: true, reducedMotion: true, pinnedProjectId: projectSnapshot('A').project.id });
    await pairB(main);
    const { JournalStore } = await import('../../apps/desktop/src/main/local-store');
    expect((await JournalStore.open(main.path)).preference()).toEqual({ hidden: false, focus: true, reducedMotion: true, pinnedProjectId: null });
  } finally { await main.close(); }
});

it.each(['pause', 'revoke', 'tray-revoke'] as const)('failed pin persistence preserves old %s custody until explicit retry succeeds', async action => {
  const main = await startSyntheticMain({ seed: store => store.putBinding(localBinding, true) });
  try {
    const { JournalStore: ActualJournal } = await import('../../apps/desktop/src/main/local-store');
    vi.spyOn(ActualJournal.prototype, 'setPreference').mockRejectedValueOnce(Error('Synthetic preference save failed'));
    await prepareB(main);
    vi.mocked(globalThis.fetch).mockImplementation(async (_url, init) => {
      if (init?.signal?.aborted) throw new DOMException('Synthetic Fetch honors cancellation', 'AbortError');
      return Response.json({ token: 'synthetic-owner-b-token', deviceId: fixtureIds.owner, expiresAt: '2099-01-01T00:00:00.000Z' });
    });
    const encrypt = vi.spyOn(main.protectedStorage, 'encryptStringAsync');
    const cursor = (await ActualJournal.open(main.path)).cursor(localBinding.binding.id);
    await expect(main.invoke('pair', { code: 'synthetic-code', deviceName: 'Synthetic B' })).rejects.toThrow();
    await expect(main.invoke('capabilities')).resolves.toMatchObject({ paired: false });
    await expect(main.invoke('invoke', { type: 'listProjects' })).rejects.toThrow();
    if (action === 'tray-revoke') {
      main.dialog.showMessageBox.mockResolvedValue({ response: 0 });
      main.clickTray('revoke-sources');
    } else await expect(main.invoke(action === 'pause' ? 'pauseSource' : 'revokeSource', localBinding.binding.id)).resolves.toBeUndefined();
    const state = action === 'pause' ? 'paused' : 'revoked';
    await vi.waitFor(async () => expect((await ActualJournal.open(main.path)).binding(localBinding.binding.id)?.binding.state).toBe(state));
    const retained = await ActualJournal.open(main.path);
    expect(retained.cursor(localBinding.binding.id)).toEqual(cursor);
    expect(retained.pendingSourceCommands()).toContainEqual(expect.objectContaining({ bindingId: localBinding.binding.id, kind: action === 'pause' ? 'pause' : 'revoke' }));
    expect(encrypt).not.toHaveBeenCalled();
    await expect(main.invoke('pair', { code: 'synthetic-code-retry', deviceName: 'Synthetic B' })).resolves.toMatchObject({ paired: true, deviceId: fixtureIds.owner });
    expect(main.client.revokeSource).not.toHaveBeenCalled(); expect(main.client.setSourceState).not.toHaveBeenCalled();
    expect((await ActualJournal.open(main.path)).pendingSourceCommands()).toEqual(retained.pendingSourceCommands());
  } finally { await main.close(); }
});
