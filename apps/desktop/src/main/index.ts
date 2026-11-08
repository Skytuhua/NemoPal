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
  let ownerGeneration = 0;
  let ownerAbort = new AbortController();
  let pairing = false;
  let pairingAbort: AbortController | undefined;
  let pairingCompletion: Promise<void> | undefined;
  let ownerReady = true;
  const assertOwner = (generation: number) => { if (quitting || generation !== ownerGeneration) throw Error('Pairing session changed'); };
  const fetchBounded: typeof fetch = (input, init) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    if (init?.method === 'POST' && /^\/v1\/projects\/[^/]+\/sources$/.test(path)) {
      const command = c.revisionedCommandSchema(c.EnrollSourceInputSchema).parse(JSON.parse(String(init.body)));
      const enrollment = [...enrollments].find(entry => entry.operationId === command.operationId);
      // Hashing and authorization lookup in the client can await; fence at the actual transport boundary.
      if (quitting || !enrollment || enrollment.withdrawal || vault.deviceId() !== enrollment.deviceId || new Headers(init.headers).get('Authorization') !== vault.authorization())
        return Promise.reject(Error('Source enrollment authority changed'));
    }
    const observations = /^\/v1\/sources\/([^/]+)\/observations$/.exec(path);
    if (init?.method === 'POST' && observations) {
      const command = c.commandEnvelopeSchema(c.IngestObservationsInputSchema).parse(JSON.parse(String(init.body)));
      const upload = store.pendingUpload(command.operationId);
      const binding = upload && store.binding(upload.bindingId)?.binding;
      if (quitting || !upload || !binding || upload.bindingId !== observations[1] || binding.deviceId !== vault.deviceId() ||
          !store.isFollowing(binding.id) || binding.grantRevision !== upload.grantRevision || binding.exportPolicy === 'off' ||
          !store.canExport(binding.id, upload.grantRevision, currentReceiving()) || JSON.stringify(upload.input) !== JSON.stringify(command.input) ||
          new Headers(init.headers).get('Authorization') !== vault.authorization())
        return Promise.reject(Error('Observation export authority changed'));
    }
    return fetch(input, { ...init, signal: init?.headers && new Headers(init.headers).get('Accept') === 'text/event-stream' ? init.signal : AbortSignal.any([AbortSignal.timeout(15000), ...(init?.signal ? [init.signal] : [])]) });
  };
  function makeClient() {
    const generation = ownerGeneration, authorization = vault.authorization(), signal = ownerAbort.signal;
    return createHttpClient({ origin: origin ?? 'http://127.0.0.1:4310', allowInsecureLoopback: !app.isPackaged, getAuthorization: () => authorization,
      fetch: (input, init) => {
        assertOwner(generation);
        if (signal.aborted || !authorization || authorization !== vault.authorization()) return Promise.reject(Error('Pairing authority changed'));
        return fetchBounded(input, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) });
      } });
  }
  let client = makeClient();
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
  const sourceState = (id: string) => { const local = store.binding(id); if (!quitting && local && local.binding.deviceId === vault.localDeviceId()) sendDesktop({ type: 'source_state', binding: local.binding, cloudRevocationPending: store.pendingSourceCommands().some(command => command.bindingId === id && command.kind === 'revoke') }); };
  const makeController = () => { const generation = ownerGeneration; return new SourceController(store, observer, (id, reason) => { if (generation !== ownerGeneration || quitting) return; const local = store.binding(id); if (local && local.binding.deviceId === vault.localDeviceId()) sendDesktop({ type: 'source_state', binding: { ...local.binding, state: 'blocked' }, cloudRevocationPending: false }); sendDesktop({ type: 'connection', connected, reason }); }); };
  let sources = makeController();
  let sync = new SyncEngine(store, client, currentReceiving, vault.localDeviceId());
  const windows = createNativeWindows({ renderer, preloadDirectory: resolve(base, '../preload'), position: store.position(), closeWorkspace: () => lifetime.closeWorkspace(), moved: point => { void store.setPosition(point).catch(() => { sendDesktop({ type: 'connection', connected: false, reason: 'Local position could not be saved.' }); }); } });
  const open = () => { windows.workspace.show(); windows.workspace.focus(); };
  const makePresentation = () => { const generation = ownerGeneration; return new QuestionPresentation(store, client, event => { windows.pet.webContents.send('lp:pet-event', c.SafePetEventSchema.parse(event)); }, projectId => { if (generation === ownerGeneration && !quitting) void refresh(projectId).catch(() => { if (generation === ownerGeneration) disconnect(); }); }, Date.now, projectId => { assertOwner(generation); sendDesktop({ type: 'open_project', projectId }); open(); }); };
  let presentation = makePresentation();
  const fenceSelection = () => { const generation = ++selectionGeneration; presentation.selectProject(petProject()); return generation; };
  const preference = async (input: c.PetPreference) => {
    const owner = ownerGeneration;
    const previousPin = pinnedProject;
    const pinChanged = previousPin !== input.pinnedProjectId;
    pinnedProject = input.pinnedProjectId;
    const generation = fenceSelection();
    try {
      if (pinChanged) await store.setPreference(input);
      else await presentation.command({ type: 'setPreference', preference: input });
    } catch (error) {
      if (owner === ownerGeneration && generation === selectionGeneration) { pinnedProject = previousPin; fenceSelection(); }
      throw error;
    }
    assertOwner(owner);
    if (input.hidden) windows.pet.hide(); else windows.pet.showInactive();
    const project = petProject();
    if (pinChanged && connected && project) await refresh(project, generation);
    tray.rebuild();
  };
  const lifetime = new CompanionLifetime(() => windows.workspace.hide(), async () => {
    quitting = true; ownerAbort.abort(); pairingAbort?.abort(); clearInterval(timer); eventsAbort?.abort();
    await sources.stop(); await sync.stop(); await pairingCompletion; vault.clearMemory();
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
  // Tray toggles may arrive from a menu built before pairing.
  const tray = createCompanionTray({ preference: () => store.preference(), open, setPreference: input => preference({ ...input, pinnedProjectId: pinnedProject ?? null }), clickThrough: value => windows.pet.setIgnoreMouseEvents(value, { forward: true }), withdrawSources, quit, error: action => {
    if (action) reportWithdrawalFailure();
    else sendDesktop({ type: 'connection', connected, reason: 'Native preference could not be saved.' });
  } });
  const requirePaired = () => { if (pairing || !ownerReady || !origin || !vault.authorization()) throw Error('Configure an API origin and explicitly pair this device.'); };
  const remember = (snapshot: c.ProjectSnapshot) => {
    eventSequence = Math.max(eventSequence, snapshot.eventSequence);
    authority.projects.add(snapshot.project.id);
    for (const [id, project] of authority.checkIns) if (project === snapshot.project.id) authority.checkIns.delete(id);
    for (const question of snapshot.checkIns) authority.checkIns.set(question.id, question.projectId);
    for (const document of snapshot.documents) authority.documents.set(document.id, document.projectId);
    const local = store.bindings().filter(entry => entry.binding.deviceId === vault.localDeviceId() && entry.binding.projectId === snapshot.project.id).map(entry => entry.binding);
    return c.ProjectSnapshotSchema.parse({ ...snapshot, sourceBindings: [...snapshot.sourceBindings.filter(binding => !local.some(entry => entry.id === binding.id)), ...local] });
  };
  async function refresh(projectId: string, generation = selectionGeneration) {
    const owner = ownerGeneration;
    requirePaired(); const raw = await client.getSnapshot(projectId); assertOwner(owner);
    const snapshot = remember(raw);
    if (generation === selectionGeneration && petProject() === projectId) await presentation.refresh(snapshot, connected && !suspended);
    assertOwner(owner);
    return snapshot;
  }
  function disconnect() { connected = false; presentation.offline(); sendDesktop({ type: 'connection', connected: false, reason: 'Cloud unavailable; local monitoring and pending cloud revocation are reported separately.' }); }
  async function execute(input: c.AllowedClientCommand): Promise<unknown> {
    const owner = ownerGeneration;
    requirePaired();
    switch (input.type) {
      case 'listProjects': { const result = await client.listProjects(); assertOwner(owner); const ids = new Set(result.map(project => project.id)); for (const id of authority.projects) if (!ids.has(id)) authority.projects.delete(id); for (const id of ids) authority.projects.add(id); return result; }
      case 'createProject': return client.createProject(input.command);
      case 'getSnapshot': {
        selectedProject = input.projectId;
        const generation = fenceSelection();
        const result = await sync.run(); assertOwner(owner); connected = result.connected;
        return refresh(input.projectId, generation);
      }
      case 'sendMessage': { const job = await client.sendMessage(input.projectId, input.command); assertOwner(owner); authority.jobs.set(job.jobId, input.projectId); return job; }
      case 'applyAction': return client.applyAction(input.projectId, input.command);
      case 'saveDocument': return client.saveDocument(input.projectId, input.documentId, input.command);
      case 'answerCheckIn': return client.answerCheckIn(input.checkInId, input.command);
      case 'snoozeCheckIn': return client.snoozeCheckIn(input.checkInId, input.command);
      case 'cancelCheckIn': return client.cancelCheckIn(input.checkInId, input.command);
      case 'deleteProject': { const result = await client.deleteProject(input.projectId, input.command); assertOwner(owner); authority.projects.delete(input.projectId); const controller = sources; for (const entry of store.bindings().filter(e => e.binding.deviceId === vault.localDeviceId() && e.binding.projectId === input.projectId)) await controller.revoke(entry.binding.id); return result; }
      case 'cancelJob': return client.cancelJob(input.jobId, input.command);
    }
  }
  async function dispatch(operation: string, raw: unknown): Promise<unknown> {
    switch (operation) {
      case 'capabilities': {
        const capability = await observer.probe();
        const sourceObservation = process.env.LP_SELECTED_SOURCE && process.env.LP_SYNTHETIC_SOURCE_NAME ? capability : { ...capability, available: false, capability: 'unavailable', reason: 'No exact named own synthetic project test source configured. General authorization permits source metadata only; live content observation is blocked.' };
        return c.DesktopCapabilitiesSchema.parse({ nativePet: { available: true }, sourceObservation, paired: ownerReady && Boolean(vault.authorization()), cloudOrigin: origin });
      }
      case 'pair': {
        if (pairing) throw Error('Pairing already in progress');
        const previousOwner = ownerGeneration;
        const redemption = new AbortController(); pairingAbort = redemption;
        let finish!: () => void;
        pairingCompletion = new Promise<void>(resolve => { finish = resolve; });
        pairing = true;
        try {
          if (!origin || (!await safeStorage.isAsyncEncryptionAvailable() && process.env.LP_TEMPORARY_PAIRING !== '1')) throw Error('Configured origin and protected storage or explicit temporary session required.');
          assertOwner(previousOwner);
          const response = await fetchBounded(new URL('/v1/auth/redeem', origin), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c.PairingInputSchema.parse(raw)), redirect: 'error', credentials: 'omit', signal: redemption.signal });
          const credential = await readPairingResponse(response);
          assertOwner(previousOwner);
          // Invalidate before protected storage awaits; an old response cannot acquire the new owner.
          presentation.reset(); ++ownerGeneration; ++selectionGeneration; ownerReady = false;
          const owner = ownerGeneration;
          ownerAbort.abort(); eventsAbort?.abort(); eventsAbort = undefined; syncing = undefined;
          connected = false; eventSequence = 0; selectedProject = undefined; pinnedProject = null;
          authority.projects.clear(); authority.checkIns.clear(); authority.documents.clear(); authority.jobs.clear();
          consent = new ConsentSelections(origin, currentReceiving());
          credentialBlocker = 'Pairing transition incomplete; explicitly re-pair. Local source custody remains retained.';
          for (const entry of enrollments) { entry.withdrawal = 'revoke'; if (entry.bindingId) store.fence(entry.bindingId); }
          await Promise.all([sources.stop(), sync.stop()]);
          assertOwner(owner);
          // Retain prior local withdrawal custody until the journal transition succeeds.
          await store.setPreference({ ...store.preference(), pinnedProjectId: null });
          assertOwner(owner);
          const result = await vault.save(credential);
          assertOwner(owner);
          ownerAbort = new AbortController(); client = makeClient(); observer = makeObserver(); sources = makeController();
          sync = new SyncEngine(store, client, currentReceiving, vault.localDeviceId()); presentation = makePresentation();
          if (store.preference().hidden) windows.pet.hide(); else windows.pet.showInactive(); tray.rebuild();
          credentialBlocker = ''; ownerReady = true; return result;
        } finally { redemption.abort(); pairingAbort = undefined; pairing = false; finish(); pairingCompletion = undefined; if (ownerReady && !quitting) void cycle(); }
      }
      case 'selectSource': {
        const owner = ownerGeneration;
        const projectId = raw as string; const threadId = process.env.LP_SELECTED_SOURCE;
        if (!threadId || !process.env.LP_SYNTHETIC_SOURCE_NAME || !c.IdSchema.safeParse(threadId).success) return { available: false, reason: 'No exact named own synthetic test source configured. No archive scan or implicit current-thread read is permitted.' };
        const choice = await dialog.showMessageBox(windows.workspace, { type: 'question', buttons: ['Preview this exact source', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Select one harmless build/test conversation', detail: `Thread: ${threadId}\nWorkspace: ${process.cwd()}\nOnly this identity will be validated after local-read consent. Cloud sharing is a separate choice.`, noLink: true });
        assertOwner(owner);
        return choice.response === 0 ? consent.offer(projectId, threadId, process.cwd()) : { available: false, reason: 'Source selection cancelled.' };
      }
      case 'confirmSource': {
        const controller = sources, ownerClient = client;
        const input = c.ConfirmSourceInputSchema.parse(raw); const choice = consent.confirm(input); requirePaired();
        const enrollment: SourceEnrollment = { operationId: input.selectionId, deviceId: vault.deviceId()!, cloud: input.exportPolicy !== 'off', completion: Promise.resolve(), failed: false };
        enrollments.add(enrollment);
        const operation = (async () => { try {
          const snapshot = await ownerClient.getSnapshot(input.projectId);
          if (quitting || enrollment.withdrawal || vault.deviceId() !== enrollment.deviceId) throw Error('Source consent no longer current');
          const deviceId = enrollment.deviceId;
          const binding: c.SourceBinding = input.exportPolicy === 'off' ? { id: randomUUID(), projectId: input.projectId, deviceId, sourceKey: randomUUID(), adapterId: ADAPTER, adapterVersion: VERSION, capability: 'incremental_history', grantRevision: 1, exportPolicy: 'off', state: 'following', lastObservedAt: null } : (await ownerClient.enrollSource(input.projectId, { operationId: input.selectionId, expectedRevision: snapshot.project.revision, input: { sourceKey: randomUUID(), adapterId: ADAPTER, adapterVersion: VERSION, capability: 'incremental_history', exportPolicy: input.exportPolicy } })).result;
          enrollment.bindingId = binding.id;
          if (binding.deviceId !== deviceId || binding.projectId !== input.projectId) throw Error('Source enrollment identity mismatch');
          if (quitting || vault.localDeviceId() !== deviceId) enrollment.withdrawal = 'revoke';
          if (enrollment.withdrawal) store.fence(binding.id);
          await store.putBinding({ binding, selectedSource: choice.threadId, sourceIdentity: choice.workspace, localReadConsented: true }, enrollment.cloud, choice.receiving, enrollment.withdrawal);
          if (enrollment.withdrawal) await controller[enrollment.withdrawal](binding.id);
          else await controller.poll(binding.id);
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
      const owner = ownerGeneration;
      const result = await boundary.call({ role, senderId: event.sender.id, frameId: frame.routingId, topFrameId: window.webContents.mainFrame.routingId, url: frame.url }, operation, input);
      // A successful pair advances its own generation once; a later pair invalidates its reply too.
      assertOwner(operation === 'pair' ? owner + 1 : owner);
      return result;
    } catch { throw Error('Native request rejected. Check source consent, current project and pairing state.'); }
  });
  async function cycle(): Promise<void> {
    if (pairing || !ownerReady || syncing || quitting || suspended) return syncing;
    const owner = ownerGeneration, ownerSync = sync, controller = sources, ownerClient = client, deviceId = vault.deviceId();
    const run = (async () => {
      try {
        if (!origin || !vault.authorization()) { sendDesktop({ type: 'connection', connected: false, reason: credentialBlocker || 'API and pairing unavailable; cloud sharing is OFF.' }); return; }
        const result = await ownerSync.run(); assertOwner(owner); connected = result.connected; sendDesktop({ type: 'connection', ...result });
        // Explicit local-read consent is independent of temporary cloud connectivity.
        for (const local of store.bindings()) { if (local.binding.deviceId !== deviceId) continue; await controller.poll(local.binding.id); assertOwner(owner); sourceState(local.binding.id); }
        if (!connected) { disconnect(); return; }
        const projects = await ownerClient.listProjects(); assertOwner(owner); const authorized = new Set(projects.map(project => project.id));
        for (const id of authority.projects) if (!authorized.has(id)) authority.projects.delete(id);
        for (const id of authorized) authority.projects.add(id);
        if (pinnedProject && !authorized.has(pinnedProject)) { pinnedProject = null; fenceSelection(); await store.setPreference({ ...store.preference(), pinnedProjectId: null }); assertOwner(owner); }
        const uploaded = await ownerSync.run(); assertOwner(owner); connected = uploaded.connected; if (!connected) { disconnect(); return; }
        const project = petProject(); if (project && authority.projects.has(project)) { await refresh(project); assertOwner(owner); }
        else if (!eventSequence && projects[0]) { const snapshot = await ownerClient.getSnapshot(projects[0].id); assertOwner(owner); eventSequence = snapshot.eventSequence; }
        if (!eventsAbort || eventsAbort.signal.aborted) {
          const subscription = new AbortController(); eventsAbort = subscription; const signal = subscription.signal;
          void ownerClient.subscribe(eventSequence, event => { if (owner !== ownerGeneration || signal.aborted || quitting) return; eventSequence = Math.max(eventSequence, event.seq); if (authority.projects.has(event.projectId)) { sendDesktop({ type: 'project_event', event }); if (event.kind === 'job_updated') authority.jobs.set(event.resourceId, event.projectId); void cycle(); } }, signal).catch(() => { if (owner === ownerGeneration && !signal.aborted && !quitting) { eventSequence = 0; disconnect(); subscription.abort(); } });
        }
      } catch { if (owner === ownerGeneration && !quitting) disconnect(); }
    })().finally(() => { if (syncing === run) syncing = undefined; });
    syncing = run; return run;
  }
  const timer = setInterval(() => { void cycle(); }, c.LIMITS.activePollMs);
  app.on('second-instance', open);
  app.on('window-all-closed', () => {});
  app.on('activate', open);
  app.on('before-quit', event => { event.preventDefault(); quit(); });
  powerMonitor.on('suspend', () => { suspended = true; eventsAbort?.abort(); void sources.stop(); disconnect(); });
  powerMonitor.on('resume', () => { const owner = ownerGeneration, controller = sources; void (async () => { await controller.stop(); assertOwner(owner); observer = makeObserver(); sources = makeController(); suspended = false; await cycle(); })().catch(() => { if (owner === ownerGeneration && !quitting) disconnect(); }); });
  windows.pet.webContents.on('did-finish-load', () => { const event = presentation.current(); if (event) windows.pet.webContents.send('lp:pet-event', event); else windows.pet.webContents.send('lp:pet-event', c.SafePetEventSchema.parse({ type: 'pet_state', projectId: null, managerName: '', petPackId: 'original-nemo-v1', state: 'offline', checkIn: null, demoTiming: false, preference: store.preference() })); });
  try { await windows.load(); }
  catch (error) { if (quitting) return; throw error; }
  if (quitting) return;
  windows.workspace.show(); if (!store.preference().hidden) windows.pet.showInactive();
  await cycle();
}
