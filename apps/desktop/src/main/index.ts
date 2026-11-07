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
  const fetchBounded: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.headers && new Headers(init.headers).get('Accept') === 'text/event-stream' ? init.signal : AbortSignal.any([AbortSignal.timeout(15000), ...(init?.signal ? [init.signal] : [])]) });
  const client = createHttpClient({ origin: origin ?? 'http://127.0.0.1:4310', allowInsecureLoopback: !app.isPackaged, getAuthorization: () => vault.authorization(), fetch: fetchBounded });
  // Explicit owner configuration must name BOTH the actual receiving endpoint and a disclosure.
  const currentReceiving = () => receivingIdentity(origin, process.env.LP_RECEIVING_MODEL_ENDPOINT, process.env.LP_EXPORT_DISCLOSURE);
  const consent = new ConsentSelections(origin, currentReceiving());
  const authority: Authority = { projects: new Set(), checkIns: new Map(), documents: new Map(), jobs: new Map() };
  let selectedProject: string | undefined;
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
  const preference = async (input: c.PetPreference) => {
    await presentation.command({ type: 'setPreference', preference: input });
    if (input.hidden) windows.pet.hide(); else windows.pet.showInactive();
    if (input.pinnedProjectId) { selectedProject = input.pinnedProjectId; if (connected) await refresh(input.pinnedProjectId); }
    tray.rebuild();
  };
  const lifetime = new CompanionLifetime(() => windows.workspace.hide(), async () => {
    quitting = true; clearInterval(timer); eventsAbort?.abort();
    await sources.stop(); await sync.stop(); vault.clearMemory();
  }, () => store.flush(), () => { tray.tray.destroy(); windows.destroy(); app.exit(0); });
  const tray = createCompanionTray({ preference: () => store.preference(), open, setPreference: preference, clickThrough: value => windows.pet.setIgnoreMouseEvents(value, { forward: true }), quit: () => { void lifetime.quit().catch(() => { dialog.showErrorBox('Quit blocked', 'Local journal flush failed. Monitoring is stopped; preserve the journal before exiting.'); }); }, error: () => sendDesktop({ type: 'connection', connected, reason: 'Native preference could not be saved.' }) });
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
  async function refresh(projectId: string) {
    requirePaired(); const snapshot = remember(await client.getSnapshot(projectId));
    selectedProject = store.preference().pinnedProjectId ?? projectId;
    if (selectedProject === projectId) await presentation.refresh(snapshot, connected && !suspended);
    return snapshot;
  }
  function disconnect() { connected = false; presentation.offline(); sendDesktop({ type: 'connection', connected: false, reason: 'Cloud unavailable; local monitoring and pending cloud revocation are reported separately.' }); }
  async function execute(input: c.AllowedClientCommand): Promise<unknown> {
    requirePaired();
    switch (input.type) {
      case 'listProjects': { const result = await client.listProjects(); const ids = new Set(result.map(project => project.id)); for (const id of authority.projects) if (!ids.has(id)) authority.projects.delete(id); for (const id of ids) authority.projects.add(id); return result; }
      case 'createProject': return client.createProject(input.command);
      case 'getSnapshot': { const result = await sync.run(); connected = result.connected; return refresh(input.projectId); }
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
        const result = await vault.save(await readPairingResponse(response)); credentialBlocker = ''; sync = new SyncEngine(store, client, currentReceiving); void cycle(); return result;
      }
      case 'selectSource': {
        const projectId = raw as string; const threadId = process.env.LP_SELECTED_SOURCE;
        if (!threadId || !process.env.LP_SYNTHETIC_SOURCE_NAME || !c.IdSchema.safeParse(threadId).success) return { available: false, reason: 'No exact named own synthetic test source configured. No archive scan or implicit current-thread read is permitted.' };
        const choice = await dialog.showMessageBox(windows.workspace, { type: 'question', buttons: ['Preview this exact source', 'Cancel'], defaultId: 1, cancelId: 1, message: 'Select one harmless build/test conversation', detail: `Thread: ${threadId}\nWorkspace: ${process.cwd()}\nOnly this identity will be validated after local-read consent. Cloud sharing is a separate choice.`, noLink: true });
        return choice.response === 0 ? consent.offer(projectId, threadId, process.cwd()) : { available: false, reason: 'Source selection cancelled.' };
      }
      case 'confirmSource': {
        const input = c.ConfirmSourceInputSchema.parse(raw); const choice = consent.confirm(input); requirePaired();
        const snapshot = await client.getSnapshot(input.projectId);
        const deviceId = vault.deviceId()!;
        const binding: c.SourceBinding = input.exportPolicy === 'off' ? { id: randomUUID(), projectId: input.projectId, deviceId, sourceKey: randomUUID(), adapterId: ADAPTER, adapterVersion: VERSION, capability: 'incremental_history', grantRevision: 1, exportPolicy: 'off', state: 'following', lastObservedAt: null } : (await client.enrollSource(input.projectId, { operationId: input.selectionId, expectedRevision: snapshot.project.revision, input: { sourceKey: randomUUID(), adapterId: ADAPTER, adapterVersion: VERSION, capability: 'incremental_history', exportPolicy: input.exportPolicy } })).result;
        await store.putBinding({ binding, selectedSource: choice.threadId, sourceIdentity: choice.workspace, localReadConsented: true }, input.exportPolicy !== 'off', choice.receiving);
        await sources.poll(binding.id); sourceState(binding.id); return store.binding(binding.id)!.binding;
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
        const project = store.preference().pinnedProjectId ?? selectedProject; if (project && authority.projects.has(project)) await refresh(project);
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
  app.on('before-quit', event => { if (!quitting) { event.preventDefault(); void lifetime.quit(); } });
  powerMonitor.on('suspend', () => { suspended = true; eventsAbort?.abort(); void sources.stop(); disconnect(); });
  powerMonitor.on('resume', () => { void (async () => { await sources.stop(); observer = makeObserver(); sources = makeController(); suspended = false; await cycle(); })(); });
  windows.pet.webContents.on('did-finish-load', () => { const event = presentation.current(); if (event) windows.pet.webContents.send('lp:pet-event', event); else windows.pet.webContents.send('lp:pet-event', c.SafePetEventSchema.parse({ type: 'pet_state', projectId: null, managerName: '', petPackId: 'original-nemo-v1', state: 'offline', checkIn: null, demoTiming: false, preference: store.preference() })); });
  await windows.load();
  windows.workspace.show(); if (!store.preference().hidden) windows.pet.showInactive();
  await cycle();
}
