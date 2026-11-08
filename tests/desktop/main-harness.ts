import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, vi } from 'vitest';
import type { MenuItemConstructorOptions, MessageBoxOptions } from 'electron';
import { ProjectSnapshotSchema, type CodexObserver, type PlaybooksClient, type SafeDesktopEvent, type SafePetEvent } from '@living-playbooks/contracts';
import { goldenSnapshot, fixtureIds } from '../../fixtures/contracts/golden';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { CredentialVault } from '../../apps/desktop/src/main/credentials';
import type { HttpClientOptions } from '@living-playbooks/api-client';

export function projectSnapshot(which: 'A' | 'B') {
  const text = JSON.stringify(goldenSnapshot);
  const snapshot = ProjectSnapshotSchema.parse(JSON.parse(which === 'A' ? text : text.replaceAll('00000000-0000-4000-8000-', '11111111-0000-4000-8000-')));
  snapshot.project.title = which; snapshot.project.manager.displayName = `Manager ${which}`;
  for (const question of snapshot.checkIns) question.state = 'cancelled';
  return snapshot;
}
export function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

// Real main, IPC, vault, journal, controller, sync and presentation. Only OS/network ports are synthetic.
export async function startSyntheticMain(options: { seed?(store: JournalStore): Promise<void>; client?: Partial<PlaybooksClient>; credentialDevice?: string; credentialExpiry?: string; withoutCredential?: boolean; apiOrigin?: string; receivingEndpoint?: string; disclosure?: string } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lp-main-boundary-'));
  const profile = join(directory, 'LivingPlaybooks'); const path = join(profile, 'journal.json');
  const store = await JournalStore.open(path); await options.seed?.(store);
  const crypto = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
  if (!options.withoutCredential) await new CredentialVault(join(profile, 'device.protected'), crypto, false).save({ token: 'synthetic-main-port-token', deviceId: options.credentialDevice ?? fixtureIds.device, expiresAt: options.credentialExpiry ?? '2099-01-01T00:00:00.000Z' });
  vi.resetModules();
  vi.stubEnv('LP_API_ORIGIN', options.apiOrigin ?? 'http://127.0.0.1:4310'); vi.stubEnv('LP_RENDERER_URL', 'http://127.0.0.1:4321/');
  vi.stubEnv('LP_RECEIVING_MODEL_ENDPOINT', options.receivingEndpoint ?? ''); vi.stubEnv('LP_EXPORT_DISCLOSURE', options.disclosure ?? '');
  const a = projectSnapshot('A'); const b = projectSnapshot('B');
  const client = {
    listProjects: vi.fn(async () => [a, b].map(s => ({ id: s.project.id, title: s.project.title, goal: s.project.goal, revision: 0, status: s.project.status, phase: s.project.phase, planState: s.project.planState, managerName: s.project.manager.displayName, petPackId: s.project.manager.petPackId, unreadCheckIns: 0, updatedAt: s.project.updatedAt }))),
    getSnapshot: vi.fn(async (id: string) => id === b.project.id ? b : a),
    subscribe: vi.fn(async () => new Promise<void>(() => {})),
    ingestObservations: vi.fn(async () => ({ result: { acceptedIds: [fixtureIds.observation], duplicateIds: [] } })),
    revokeSource: vi.fn(async () => { throw Error('Synthetic offline cloud'); }),
    setSourceState: vi.fn(async () => { throw Error('Synthetic offline cloud'); }),
    ...options.client,
  };
  const observer = { probe: vi.fn(async () => ({ available: false, adapterId: 'codex-app-server', adapterVersion: '0.166.0', installedVersion: null, capability: 'unavailable', reason: 'Synthetic OS port; no real source', coverage: 'Synthetic only' })),
    readDelta: vi.fn<CodexObserver['readDelta']>(async local => ({ observations: [], nextCursor: { adapterId: 'codex-app-server', identity: local.selectedSource, offset: 0, fingerprint: 'synthetic-main-port' }, mode: 'incremental_history', lastObservedAt: null, coverage: 'Synthetic only' })), stop: vi.fn<CodexObserver['stop']>(async () => {}) };
  const handlers = new Map<string, (event: unknown, operation: string, input?: unknown) => Promise<unknown>>();
  const desktopEvents: SafeDesktopEvent[] = []; const petEvents: SafePetEvent[] = [];
  const windowPort = (id: number, url: string) => {
    const contents = Object.assign(new EventEmitter(), { id, mainFrame: { routingId: id + 10, url }, send: (_channel: string, value: SafeDesktopEvent | SafePetEvent) => { if (value.type === 'pet_state') petEvents.push(structuredClone(value)); else desktopEvents.push(structuredClone(value)); } });
    return { webContents: contents, show: vi.fn(), focus: vi.fn(), hide: vi.fn(), showInactive: vi.fn(), setIgnoreMouseEvents: vi.fn(), isDestroyed: () => false };
  };
  const workspace = windowPort(1, 'http://127.0.0.1:4321/'); const pet = windowPort(2, 'http://127.0.0.1:4321/?surface=pet');
  const windows = { workspace, pet, targets: { workspace: workspace.webContents.mainFrame.url, pet: pet.webContents.mainFrame.url }, load: vi.fn(async () => {}), destroy: vi.fn() };
  const app = Object.assign(new EventEmitter(), { setName: vi.fn(), setPath: vi.fn(), getPath: () => directory, requestSingleInstanceLock: () => true, quit: vi.fn(), exit: vi.fn(), whenReady: async () => {}, isPackaged: false });
  // getPath must honor the profile set by the actual entry point, not a test-only main hook.
  const paths: Record<string, string> = { appData: directory };
  app.setPath.mockImplementation((name: string, value: string) => { paths[name] = value; });
  app.getPath = (name?: string) => paths[name ?? 'appData'] ?? directory;
  const dialog = { showErrorBox: vi.fn(), showMessageBox: vi.fn(async (_window: unknown, _options: MessageBoxOptions) => ({ response: 1 })) };
  let trayItems: MenuItemConstructorOptions[] = [];
  const Menu = { buildFromTemplate: (items: MenuItemConstructorOptions[]) => { trayItems = items; return { getMenuItemById: (id: string) => items.find(item => item.id === id) }; } };
  class Tray extends EventEmitter { private destroyed = false; setToolTip() {} setContextMenu() { if (this.destroyed) throw Error('Destroyed tray'); } isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; } }
  const tick = vi.spyOn(globalThis, 'setInterval').mockImplementation(() => ({ unref() {} }) as NodeJS.Timeout);
  let transport: typeof fetch | undefined;
  vi.doMock('electron', () => ({ app, dialog, Menu, Tray, nativeImage: { createFromBitmap: () => ({}) }, ipcMain: { handle: (channel: string, handler: typeof handlers extends Map<string, infer H> ? H : never) => handlers.set(channel, handler) }, powerMonitor: new EventEmitter(), safeStorage: { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async (value: string) => Buffer.from(value), decryptStringAsync: async (value: Buffer) => ({ result: value.toString(), shouldReEncrypt: false }) } }));
  vi.doMock('../../apps/desktop/src/main/native-windows', () => ({ createNativeWindows: () => windows }));
  vi.doMock('@living-playbooks/api-client', async () => ({ ...await vi.importActual('@living-playbooks/api-client'), createHttpClient: (configuration: HttpClientOptions) => { transport = configuration.fetch; return client; } }));
  vi.doMock('@living-playbooks/codex-observer', () => ({ ADAPTER: 'codex-app-server', VERSION: '0.166.0', createInstalledObserver: () => observer }));
  await import('../../apps/desktop/src/main/index');
  await vi.waitFor(() => { expect(dialog.showErrorBox).not.toHaveBeenCalled(); expect(windows.load).toHaveBeenCalled(); expect((vi.isMockFunction(client.subscribe) && client.subscribe.mock.calls.length > 0) || desktopEvents.some(e => e.type === 'connection' && !e.connected)).toBe(true); });
  const invoke = (operation: string, input?: unknown) => handlers.get('lp:workspace')!({ sender: workspace.webContents, senderFrame: workspace.webContents.mainFrame }, operation, input);
  const petInvoke = (input: unknown) => handlers.get('lp:pet')!({ sender: pet.webContents, senderFrame: pet.webContents.mainFrame }, 'petInvoke', input);
  const trayItem = (id: string) => { const item = trayItems.find(item => item.id === id); expect(item, `Native tray item ${id} must be reachable`).toBeDefined(); return item!; };
  const clickTray = (id: string) => { Reflect.apply(trayItem(id).click!, undefined, []); };
  return { path, client, observer, desktopEvents, petEvents, invoke, petInvoke, dialog, windows, trayItem, clickTray, transport: ((...args) => { if (!transport) throw Error('Native transport unavailable'); return transport(...args); }) as typeof fetch, tick: () => { const callback = tick.mock.calls[0]?.[0]; if (typeof callback === 'function') callback(); }, async close(quitBlocked = false) {
    clickTray('quit'); await vi.waitFor(() => { if (quitBlocked) expect(dialog.showErrorBox).toHaveBeenCalledWith('Quit blocked', expect.any(String)); else expect(app.exit).toHaveBeenCalledWith(0); });
    vi.doUnmock('electron'); vi.doUnmock('../../apps/desktop/src/main/native-windows'); vi.doUnmock('@living-playbooks/api-client'); vi.doUnmock('@living-playbooks/codex-observer');
    vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true });
  } };
}
