import { app, dialog, ipcMain, powerMonitor, safeStorage } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createHttpClient } from '@living-playbooks/api-client';
import { createInstalledObserver, ADAPTER, VERSION } from '@living-playbooks/codex-observer';
import * as c from '@living-playbooks/contracts';
import { CredentialVault } from './credentials';
import { readPairingResponse } from './pairing';
import { ConsentSelections, receivingIdentity } from './consent';
import { NativeBoundary, type Authority } from './ipc';
import { JournalStore } from './local-store';
import { SourceController } from './source-controller';
import { SyncEngine } from './sync';
import { QuestionPresentation } from './presentation';
import { createNativeWindows } from './native-windows';
import { createCompanionTray } from './tray';
import { CompanionLifetime } from './windows';
type SourceEnrollment = { operationId: string; deviceId: string; cloud: boolean; bindingId?: string; withdrawal?: 'pause' | 'revoke'; completion: Promise<void>; failed: boolean };

app.setName('Living Playbooks');
app.setPath('userData', join(app.getPath('appData'), 'LivingPlaybooks'));
if (!app.requestSingleInstanceLock()) app.quit();
else void start().catch(() => { dialog.showErrorBox('Living Playbooks blocked', 'Native startup failed. Preserve the application journal and its .previous snapshot; no source cursor has been reset. Check the renderer build and local protected storage.'); app.exit(1); });

async function start() {
  await app.whenReady();
  const base = dirname(fileURLToPath(import.meta.url));
  const rendererFile = resolve(base, '../../../web/dist/index.html');
  const renderer = !app.isPackaged && process.env.LP_RENDERER_URL ? process.env.LP_RENDERER_URL : pathToFileURL(rendererFile).href;
  if (renderer.startsWith('file:') && !existsSync(rendererFile)) throw Error('C-owned renderer build unavailable');
  const store = await JournalStore.open(join(app.getPath('userData'), 'journal.json'));
  const vault = new CredentialVault(join(app.getPath('userData'), 'device.protected'), {
    isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(), encryptString: value => safeStorage.encryptStringAsync(value),
    decryptString: async value => { let result = await safeStorage.decryptStringAsync(value); if (result.shouldReEncrypt) result = await safeStorage.decryptStringAsync(value); return result.result; },
  }, process.env.LP_TEMPORARY_PAIRING === '1');
  let credentialBlocker = '';
  await vault.load().catch(() => { credentialBlocker = 'Protected credential cannot be loaded. Explicit re-pairing required.'; });
  const origin = process.env.LP_API_ORIGIN ?? null;
  const fetchBounded: typeof fetch = (input, init) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    if (init?.method === 'POST' && /^\/v1\/projects\/[^/]+\/sources$/.test(path)) {
      const command = c.revisionedCommandSchema(c.EnrollSourceInputSchema).parse(JSON.parse(String(init.body)));
      const enrollment = [...enrollments].find(entry => entry.operationId === command.operationId);
      // Hashing and authorization lookup in the client can await; fence at the actual transport boundary.
      if (quitting || !enrollment || enrollment.withdrawal || vault.deviceId() !== enrollment.deviceId || new Headers(init.headers).get('Authorization') !== vault.authorization())
        return Promise.reject(Error('Source enrollment authority changed'));
    }
    return fetch(input, { ...init, signal: init?.headers && new Headers(init.headers).get('Accept') === 'text/event-stream' ? init.signal : AbortSignal.any([AbortSignal.timeout(15000), ...(init?.signal ? [init.signal] : [])]) });
  };
  const client = createHttpClient({ origin: origin ?? 'http://127.0.0.1:4310', allowInsecureLoopback: !app.isPackaged, getAuthorization: () => vault.authorization(), fetch: fetchBounded });
  // Explicit owner configuration must name BOTH the actual receiving endpoint and a disclosure.
  const currentReceiving = () => receivingIdentity(origin, process.env.LP_RECEIVING_MODEL_ENDPOINT, process.env.LP_EXPORT_DISCLOSURE);
  let consent = new ConsentSelections(origin, currentReceiving());
  const enrollments = new Set<SourceEnrollment>();
  const authority: Authority = { projects: new Set(), checkIns: new Map(), documents: new Map(), jobs: new Map() };
  let selectedProject: string | undefined;
  let pinnedProject = store.preference().pinnedProjectId;
  let selectionGeneration = 0;
  const petProject = () => pinnedProject ?? selectedProject;
  let connected = false;
  let suspended = false;
  let quitting = false;
  let syncing: Promise<void> | undefined;
  let eventsAbort: AbortController | undefined;
  let eventSequence = 0;
  let observer = makeObserver();
  function makeObserver(): c.CodexObserver {
    try { return createInstalledObserver(); }
    catch { return { probe: async () => ({ available: false, adapterId: ADAPTER, adapterVersion: VERSION, installedVersion: null, capability: 'unavailable', reason: 'Pinned Codex executable unavailable.', coverage: 'No source observation.' }), readDelta: async () => { throw Error('Observer unavailable'); }, stop: async () => {} }; }
  }
  const sendDesktop = (event: c.SafeDesktopEvent) => { if (!windows.workspace.isDestroyed()) windows.workspace.webContents.send('lp:workspace-event', c.SafeDesktopEventSchema.parse(event)); };
  const sourceState = (id: string) => { const local = store.binding(id); if (local) sendDesktop({ type: 'source_state', binding: local.binding, cloudRevocationPending: store.pendingSourceCommands().some(command => command.bindingId === id && command.kind === 'revoke') }); };
  const makeController = () => new SourceController(store, observer, (id, reason) => { const local = store.binding(id); if (local) sendDesktop({ type: 'source_state', binding: { ...local.binding, state: 'blocked' }, cloudRevocationPending: false }); sendDesktop({ type: 'connection', connected, reason }); });
  let sources = makeController();
  let sync = new SyncEngine(store, client, currentReceiving);
  const windows = createNativeWindows({ renderer, preloadDirectory: resolve(base, '../preload'), position: store.position(), closeWorkspace: () => lifetime.closeWorkspace(), moved: point => { void store.setPosition(point).catch(() => { sendDesktop({ type: 'connection', connected: false, reason: 'Local position could not be saved.' }); }); } });
  const open = () => { windows.workspace.show(); windows.workspace.focus(); };
  const presentation = new QuestionPresentation(store, client, event => { windows.pet.webContents.send('lp:pet-event', c.SafePetEventSchema.parse(event)); }, projectId => { void refresh(projectId).catch(disconnect); }, Date.now, projectId => { sendDesktop({ type: 'open_project', projectId }); open(); });
  const fenceSelection = () => { const generation = ++selectionGeneration; presentation.selectProject(petProject()); return generation; };
  const preference = async (input: c.PetPreference) => {
    const previousPin = pinnedProject;
    const pinChanged = previousPin !== input.pinnedProjectId;
    pinnedProject = input.pinnedProjectId;
    const generation = fenceSelection();
    try {
      if (pinChanged) await store.setPreference(input);
      else await presentation.command({ type: 'setPreference', preference: input });
    } catch (error) {
      if (generation === selectionGeneration) { pinnedProject = previousPin; fenceSelection(); }
      throw error;
    }
    if (input.hidden) windows.pet.hide(); else windows.pet.showInactive();
    const project = petProject();
    if (pinChanged && connected && project) await refresh(project, generation);
    tray.rebuild();
  };
  const lifetime = new CompanionLifetime(() => windows.workspace.hide(), async () => {
    quitting = true; clearInterval(timer); eventsAbort?.abort();
    await sources.stop(); await sync.stop(); vault.clearMemory();
  }, () => store.flush(), () => { tray.tray.destroy(); windows.destroy(); app.exit(0); });
  const reportWithdrawalFailure = () => dialog.showErrorBox('Local source action incomplete', 'Local source access could not be fully stopped and durably saved. Local reads and exports are fenced for attempted sources, but observer stop or journal saving may have failed. Keep the app running and retry. Preserve the journal and its .previous snapshot; restarting may restore the previous access state. Cloud changes are not confirmed.');
  async function withdrawSources(action: 'pause' | 'revoke') {
    if (quitting) return;
    const deviceId = vault.localDeviceId();
    if (!deviceId) { dialog.showErrorBox('Local source custody unavailable', 'Protected device custody could not be verified. No source access was changed. Restore protected storage or explicitly re-pair this device.'); return; }
    let local = store.bindings().filter(entry => entry.binding.deviceId === deviceId && (action === 'revoke' || entry.binding.state !== 'revoked'));
    if (!local.length && ![...enrollments].some(entry => entry.deviceId === deviceId)) { await dialog.showMessageBox(windows.workspace, { type: 'info', message: 'No local source access on this device', detail: 'No matching sources were changed. Access belonging to other devices is unaffected.' }); return; }
    const revoke = action === 'revoke';
    const choice = await dialog.showMessageBox(windows.workspace, {
      type: 'question', buttons: [revoke ? 'Revoke local access' : 'Pause local sources', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
      message: revoke ? 'Revoke all local source access on this device?' : 'Pause all local sources on this device?',
      detail: revoke
        ? 'Stops local monitoring and removes queued exports. Cloud revocation and removal of retained excerpts remain pending until acknowledged by the cloud. Following again requires new consent.'
        : 'Stops local monitoring. Queued exports are retained but held. Cloud pause remains pending until acknowledged by the cloud. Previously sent data is retained.',
    });
    if (choice.response !== 0 || quitting) return;
    // Pairing can change while the native confirmation is open.
    if (vault.localDeviceId() !== deviceId) throw Error('Local device custody changed');
    consent = new ConsentSelections(origin, currentReceiving());
    const pendingEnrollments = [...enrollments].filter(entry => entry.deviceId === deviceId);
    for (const entry of pendingEnrollments) {
      entry.withdrawal = revoke || entry.withdrawal === 'revoke' ? 'revoke' : 'pause';
      if (entry.bindingId) store.fence(entry.bindingId);
    }
    // Include enrollments that finished while the confirmation dialog was open.
    local = store.bindings().filter(entry => entry.binding.deviceId === deviceId && (revoke || entry.binding.state !== 'revoked'));
    const outcomes = await Promise.allSettled(local.map(async entry => {
      if (revoke) await sources.revoke(entry.binding.id); else await sources.pause(entry.binding.id);
      sourceState(entry.binding.id);
    }));
    const committing = pendingEnrollments.filter(entry => entry.bindingId);
    await Promise.all(committing.map(entry => entry.completion));
    await store.flush();
    if (outcomes.some(result => result.status === 'rejected') || committing.some(entry => entry.failed)) throw Error('Local source withdrawal incomplete');
    const currentIds = new Set(store.bindings().filter(entry => entry.binding.deviceId === deviceId).map(entry => entry.binding.id));
    const pending = store.pendingSourceCommands().some(command => currentIds.has(command.bindingId)) || [...enrollments].some(entry => entry.deviceId === deviceId && entry.cloud && entry.withdrawal);
    await dialog.showMessageBox(windows.workspace, {
      type: 'info', message: revoke ? 'Local source access revoked on this device' : 'Local sources paused on this device',
      detail: `${revoke ? 'Local monitoring stopped; queued exports removed.' : 'Local monitoring stopped; queued exports retained but held.'} ${pending ? `Cloud ${revoke ? 'revocation and excerpt removal' : 'pause'} pending; it has not been acknowledged. Reconnect with valid pairing to retry.` : 'No cloud command is pending for these sources.'}`,
    });
    void cycle();
  }
  const quit = () => { void lifetime.quit().catch(() => { dialog.showErrorBox('Quit blocked', 'Local journal flush failed. Monitoring is stopped; preserve the journal before exiting.'); }); };
  const tray = createCompanionTray({ preference: () => store.preference(), open, setPreference: preference, clickThrough: value => windows.pet.setIgnoreMouseEvents(value, { forward: true }), withdrawSources, quit, error: action => {
    if (action) reportWithdrawalFailure();
    else sendDesktop({ type: 'connection', connected, reason: 'Native preference could not be saved.' });
  } });
  const requirePaired = () => { if (!origin || !vault.authorization()) throw Error('Configure an API origin and explicitly pair this device.'); };
  const remember = (snapshot: c.ProjectSnapshot) => {
    eventSequence = Math.max(eventSequence, snapshot.eventSequence);
    authority.projects.add(snapshot.project.id);
    for (const [id, project] of authority.checkIns) if (project === snapshot.project.id) authority.checkIns.delete(id);
    for (const question of snapshot.checkIns) authority.checkIns.set(question.id, question.projectId);
    for (const document of snapshot.documents) authority.documents.set(document.id, document.projectId);
    const local = store.bindings().filter(entry => entry.binding.projectId === snapshot.project.id).map(entry => entry.binding);
    return c.ProjectSnapshotSchema.parse({ ...snapshot, sourceBindings: [...snapshot.sourceBindings.filter(binding => !local.some(entry => entry.id === binding.id)), ...local] });
  };
  async function refresh(projectId: string, generation = selectionGeneration) {
    requirePaired(); const snapshot = remember(await client.getSnapshot(projectId));
    if (generation === selectionGeneration && petProject() === projectId) await presentation.refresh(snapshot, connected && !suspended);
    return snapshot;
  }
  function disconnect() { connected = false; presentation.offline(); sendDesktop({ type: 'connection', connected: false, reason: 'Cloud unavailable; local monitoring and pending cloud revocation are reported separately.' }); }
  async function execute(input: c.AllowedClientCommand): Promise<unknown> {
    requirePaired();
    switch (input.type) {
      case 'listProjects': { const result = await client.listProjects(); const ids = new Set(result.map(project => project.id)); for (const id of authority.projects) if (!ids.has(id)) authority.projects.delete(id); for (const id of ids) authority.projects.add(id); return result; }
      case 'createProject': return client.createProject(input.command);
      case 'getSnapshot': {
        selectedProject = input.projectId;
        const generation = fenceSelection();
        const result = await sync.run(); connected = result.connected;
        return refresh(input.projectId, generation);
      }
      case 'sendMessage': { const job = await client.sendMessage(input.projectId, input.command); authority.jobs.set(job.jobId, input.projectId); return job; }
      case 'applyAction': return client.applyAction(input.projectId, input.command);
      case 'saveDocument': return client.saveDocument(input.projectId, input.documentId, input.command);
      case 'answerCheckIn': return client.answerCheckIn(input.checkInId, input.command);
      case 'snoozeCheckIn': return client.snoozeCheckIn(input.checkInId, input.command);
      case 'cancelCheckIn': return client.cancelCheckIn(input.checkInId, input.command);
      case 'deleteProject': { const result = await client.deleteProject(input.projectId, input.command); authority.projects.delete(input.projectId); for (const entry of store.bindings().filter(e => e.binding.projectId === input.projectId)) await sources.revoke(entry.binding.id); return result; }
      case 'cancelJob': return client.cancelJob(input.jobId, input.command);
    }
  }
  async function dispatch(operation: string, raw: unknown): Promise<unknown> {
    switch (operation) {
      case 'capabilities': {
        const capability = await observer.probe();
        const sourceObservation = process.env.LP_SELECTED_SOURCE && process.env.LP_SYNTHETIC_SOURCE_NAME ? capability : { ...capability, available: false, capability: 'unavailable', reason: 'No exact named own synthetic project test source configured. General authorization permits source metadata only; live content observation is blocked.' };
        return c.DesktopCapabilitiesSchema.parse({ nativePet: { available: true }, sourceObservation, paired: Boolean(vault.authorization()), cloudOrigin: origin });
      }
      case 'pair': {
        if (!origin || (!await safeStorage.isAsyncEncryptionAvailable() && process.env.LP_TEMPORARY_PAIRING !== '1')) throw Error('Configured origin and protected storage or explicit temporary session required.');
        const response = await fetchBounded(new URL('/v1/auth/redeem', origin), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c.PairingInputSchema.parse(raw)), redirect: 'error', credentials: 'omit' });
        const result = await vault.save(await readPairingResponse(response));
        consent = new ConsentSelections(origin, currentReceiving());
        for (const entry of enrollments) if (entry.deviceId !== vault.localDeviceId()) {
          entry.withdrawal = 'revoke'; if (entry.bindingId) store.fence(entry.bindingId);
        }
        credentialBlocker = ''; sync = new SyncEngine(store, client, currentReceiving); void cycle(); return result;
      }
      case 'selectSource': {
        const projectId = raw as string; const threadId = process.env.LP_SELECTED_SOURCE;
        if (!threadId || !process.env.LP_SYNTHETIC_SOURCE_NAME || !c.IdSchema.safeParse(threadId).success) return { available: false, reason: 'No exact named own synthetic test source configured. No archive scan or implicit current-thread read is permitted.' };
        const choice = await dialog.showMessageBox(windows.workspace, { type: 'question', buttons: ['Preview this exact source', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Select one harmless build/test conversation', detail: `Thread: ${threadId}\nWorkspace: ${process.cwd()}\nOnly this identity will be validated after local-read consent. Cloud sharing is a separate choice.`, noLink: true });
        return choice.response === 0 ? consent.offer(projectId, threadId, process.cwd()) : { available: false, reason: 'Source selection cancelled.' };
      }
      case 'confirmSource': {
        const input = c.ConfirmSourceInputSchema.parse(raw); const choice = consent.confirm(input); requirePaired();
        const enrollment: SourceEnrollment = { operationId: input.selectionId, deviceId: vault.deviceId()!, cloud: input.exportPolicy !== 'off', completion: Promise.resolve(), failed: false };
        enrollments.add(enrollment);
        const operation = (async () => { try {
          const snapshot = await client.getSnapshot(input.projectId);
          if (quitting || enrollment.withdrawal || vault.deviceId() !== enrollment.deviceId) throw Error('Source consent no longer current');
          const deviceId = enrollment.deviceId;
          const binding: c.SourceBinding = input.exportPolicy === 'off' ? { id: randomUUID(), projectId: input.projectId, deviceId, sourceKey: randomUUID(), adapterId: ADAPTER, adapterVersion: VERSION, capability: 'incremental_history', grantRevision: 1, exportPolicy: 'off', state: 'following', lastObservedAt: null } : (await client.enrollSource(input.projectId, { operationId: input.selectionId, expectedRevision: snapshot.project.revision, input: { sourceKey: randomUUID(), adapterId: ADAPTER, adapterVersion: VERSION, capability: 'incremental_history', exportPolicy: input.exportPolicy } })).result;
          enrollment.bindingId = binding.id;
          if (binding.deviceId !== deviceId || binding.projectId !== input.projectId) throw Error('Source enrollment identity mismatch');
          if (quitting || vault.localDeviceId() !== deviceId) enrollment.withdrawal = 'revoke';
          if (enrollment.withdrawal) store.fence(binding.id);
          await store.putBinding({ binding, selectedSource: choice.threadId, sourceIdentity: choice.workspace, localReadConsented: true }, enrollment.cloud, choice.receiving, enrollment.withdrawal);
          if (enrollment.withdrawal) await sources[enrollment.withdrawal](binding.id);
          else await sources.poll(binding.id);
          sourceState(binding.id); return store.binding(binding.id)!.binding;
        } catch (error) { if (enrollment.withdrawal && enrollment.bindingId) reportWithdrawalFailure(); throw error; }
        finally { enrollments.delete(enrollment); } })();
        enrollment.completion = operation.then(() => {}, () => { enrollment.failed = true; });
        return operation;
      }
      case 'pauseSource': case 'revokeSource': {
        const id = raw as string; const local = store.binding(id);
        if (!local || local.binding.deviceId !== vault.localDeviceId()) throw Error('Local source is not in this device custody');
        if (operation === 'pauseSource') await sources.pause(id); else await sources.revoke(id); sourceState(id); void cycle(); return;
      }
      case 'invoke': return execute(c.AllowedClientCommandSchema.parse(raw));
      case 'setPetPreference': return preference(c.PetPreferenceSchema.parse(raw));
      case 'petInvoke': { const input = c.PetCommandSchema.parse(raw); if (input.type === 'setPreference') return preference(input.preference); return presentation.command(input); }
      default: throw Error('Native operation denied');
    }
  }
  for (const role of ['workspace', 'pet'] as const) ipcMain.handle(`lp:${role}`, async (event, operation: unknown, input: unknown) => {
    const window = windows[role]; const frame = event.senderFrame;
    try {
      if (typeof operation !== 'string' || !frame || quitting || event.sender !== window.webContents || frame !== window.webContents.mainFrame) throw Error('Untrusted sender');
      const boundary = new NativeBoundary({ [role]: { senderId: window.webContents.id, frameId: window.webContents.mainFrame.routingId, url: windows.targets[role] } }, authority, dispatch);
      return await boundary.call({ role, senderId: event.sender.id, frameId: frame.routingId, topFrameId: window.webContents.mainFrame.routingId, url: frame.url }, operation, input);
    } catch { throw Error('Native request rejected. Check source consent, current project and pairing state.'); }
  });
  async function cycle(): Promise<void> {
    if (syncing || quitting || suspended) return syncing;
    return syncing = (async () => {
      try {
        if (!origin || !vault.authorization()) { sendDesktop({ type: 'connection', connected: false, reason: credentialBlocker || 'API and pairing unavailable; cloud sharing is OFF.' }); return; }
        const result = await sync.run(); connected = result.connected; sendDesktop({ type: 'connection', ...result });
        // Explicit local-read consent is independent of temporary cloud connectivity.
        for (const local of store.bindings()) { if (local.binding.deviceId !== vault.deviceId()) continue; await sources.poll(local.binding.id); sourceState(local.binding.id); }
        if (!connected) { disconnect(); return; }
        const projects = await client.listProjects(); const authorized = new Set(projects.map(project => project.id));
        for (const id of authority.projects) if (!authorized.has(id)) authority.projects.delete(id);
        for (const id of authorized) authority.projects.add(id);
        const uploaded = await sync.run(); connected = uploaded.connected; if (!connected) { disconnect(); return; }
        const project = petProject(); if (project && authority.projects.has(project)) await refresh(project);
        else if (!eventSequence && projects[0]) eventSequence = (await client.getSnapshot(projects[0].id)).eventSequence;
        if (!eventsAbort || eventsAbort.signal.aborted) {
          eventsAbort = new AbortController(); const signal = eventsAbort.signal;
          void client.subscribe(eventSequence, event => { eventSequence = Math.max(eventSequence, event.seq); if (authority.projects.has(event.projectId)) { sendDesktop({ type: 'project_event', event }); if (event.kind === 'job_updated') authority.jobs.set(event.resourceId, event.projectId); void cycle(); } }, signal).catch(() => { if (!signal.aborted) { eventSequence = 0; disconnect(); eventsAbort?.abort(); } });
        }
      } catch { disconnect(); }
    })().finally(() => { syncing = undefined; });
  }
  const timer = setInterval(() => { void cycle(); }, c.LIMITS.activePollMs);
  app.on('second-instance', open);
  app.on('window-all-closed', () => {});
  app.on('activate', open);
  app.on('before-quit', event => { event.preventDefault(); quit(); });
  powerMonitor.on('suspend', () => { suspended = true; eventsAbort?.abort(); void sources.stop(); disconnect(); });
  powerMonitor.on('resume', () => { void (async () => { await sources.stop(); observer = makeObserver(); sources = makeController(); suspended = false; await cycle(); })(); });
  windows.pet.webContents.on('did-finish-load', () => { const event = presentation.current(); if (event) windows.pet.webContents.send('lp:pet-event', event); else windows.pet.webContents.send('lp:pet-event', c.SafePetEventSchema.parse({ type: 'pet_state', projectId: null, managerName: '', petPackId: 'original-nemo-v1', state: 'offline', checkIn: null, demoTiming: false, preference: store.preference() })); });
  try { await windows.load(); }
  catch (error) { if (quitting) return; throw error; }
  if (quitting) return;
  windows.workspace.show(); if (!store.preference().hidden) windows.pet.showInactive();
  await cycle();
}
