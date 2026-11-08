import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, vi } from 'vitest';
import type { MenuItemConstructorOptions, MessageBoxOptions } from 'electron';
import { ProjectSnapshotSchema, type CodexObserver, type PetChatState, type PlaybooksClient, type SafeDesktopEvent, type SafePetEvent } from '@living-playbooks/contracts';
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
export function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }

// Real main, IPC, vault, journal, controller, sync and presentation. Only OS/network ports are synthetic.
export async function startSyntheticMain(options: { seed?(store: JournalStore): Promise<void>; client?: Partial<PlaybooksClient>; clientFactory?(configuration: HttpClientOptions, defaults: Pick<PlaybooksClient, 'getSnapshot' | 'subscribe'>): PlaybooksClient; credentialDevice?: string; credentialExpiry?: string; credentialEncryption?: () => Promise<void>; withoutCredential?: boolean; apiOrigin?: string | null; packaged?: boolean; receivingEndpoint?: string; disclosure?: string; windowLoad?: Promise<void>; chatFlushReplies?: boolean[] } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lp-main-boundary-'));
  const profile = join(directory, 'LivingPlaybooks'); const path = join(profile, 'journal.json');
  const store = await JournalStore.open(path); await options.seed?.(store);
  const crypto = { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() };
  if (!options.withoutCredential) await new CredentialVault(join(profile, 'device.protected'), crypto, false).save({ token: 'synthetic-main-port-token', deviceId: options.credentialDevice ?? fixtureIds.device, expiresAt: options.credentialExpiry ?? '2099-01-01T00:00:00.000Z' });
  vi.resetModules();
  vi.stubEnv('LP_API_ORIGIN', options.apiOrigin === null ? undefined : options.apiOrigin ?? 'http://127.0.0.1:4310'); vi.stubEnv('LP_RENDERER_URL', 'http://127.0.0.1:4321/');
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
  const desktopEvents: SafeDesktopEvent[] = []; const petEvents: SafePetEvent[] = []; const chatEvents: PetChatState[] = [];
  const windowPort = (id: number, url: string) => {
    let destroyed = false;
    const show = () => { if (destroyed) throw Error('Destroyed window'); };
    const contents = Object.assign(new EventEmitter(), { id, mainFrame: { routingId: id + 10, url }, send: (_channel: string, value: SafeDesktopEvent | SafePetEvent) => { if (value.type === 'pet_state') petEvents.push(structuredClone(value)); else desktopEvents.push(structuredClone(value)); } });
    return { webContents: contents, show: vi.fn(show), focus: vi.fn(show), hide: vi.fn(), showInactive: vi.fn(show), setIgnoreMouseEvents: vi.fn(), isDestroyed: () => destroyed, destroy: () => { destroyed = true; } };
  };
  const workspace = windowPort(1, 'http://127.0.0.1:4321/'); const pet = windowPort(2, 'http://127.0.0.1:4321/?surface=pet');
  let chatWindow: ReturnType<typeof windowPort> | undefined;
  const windows = { workspace, pet, get petChat() { return chatWindow; }, targets: { workspace: workspace.webContents.mainFrame.url, pet: pet.webContents.mainFrame.url, petChat: 'http://127.0.0.1:4321/?surface=pet-chat' },
    showChat: vi.fn(async (current: () => boolean) => { if (current()) { chatWindow ??= windowPort(3, windows.targets.petChat); chatWindow.show(); chatWindow.focus(); } }), hideChat: vi.fn(() => chatWindow?.hide()), resizeChat: vi.fn(), destroyChat: vi.fn(() => { chatWindow?.destroy(); chatWindow = undefined; }), sendChat: vi.fn((state: PetChatState) => { chatEvents.push(structuredClone(state)); if (state.flushRequestId && chatWindow) { const window = chatWindow; queueMicrotask(() => { void handlers.get('lp:petChat')?.({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, 'petChatInvoke', { type: 'flushed', contextId: state.contextId, flushId: state.flushRequestId, succeeded: options.chatFlushReplies?.shift() ?? true }).catch(() => {}); }); } }),
    dragPet: vi.fn(), cancelPetDrag: vi.fn(), load: vi.fn(async () => { await options.windowLoad; }), destroy: vi.fn(() => { workspace.destroy(); pet.destroy(); chatWindow?.destroy(); }) };
  const app = Object.assign(new EventEmitter(), { setName: vi.fn(), setPath: vi.fn(), getPath: () => directory, requestSingleInstanceLock: () => true, quit: vi.fn(), exit: vi.fn(), whenReady: async () => {}, isPackaged: options.packaged ?? false });
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
  const clientConfigurations: HttpClientOptions[] = [];
  const protectedStorage = { isAsyncEncryptionAvailable: vi.fn(async () => true), encryptStringAsync: async (value: string) => { await options.credentialEncryption?.(); return Buffer.from(value); }, decryptStringAsync: async (value: Buffer) => ({ result: value.toString(), shouldReEncrypt: false }) };
  const powerMonitor = new EventEmitter();
  vi.doMock('electron', () => ({ app, dialog, Menu, Tray, nativeImage: { createFromBitmap: () => ({}) }, ipcMain: { handle: (channel: string, handler: typeof handlers extends Map<string, infer H> ? H : never) => handlers.set(channel, handler) }, powerMonitor, safeStorage: protectedStorage }));
  if (options.packaged) vi.doMock('node:fs', async () => { const fs = await vi.importActual<typeof import('node:fs')>('node:fs'); return { ...fs, existsSync: (path: Parameters<typeof fs.existsSync>[0]) => String(path).replaceAll('\\', '/').endsWith('/web/dist/index.html') || fs.existsSync(path) }; });
  vi.doMock('../../apps/desktop/src/main/native-windows', () => ({ createNativeWindows: () => windows }));
  vi.doMock('@living-playbooks/api-client', async () => ({ ...await vi.importActual('@living-playbooks/api-client'), createHttpClient: (configuration: HttpClientOptions) => { transport = configuration.fetch; clientConfigurations.push(configuration); return options.clientFactory?.(configuration, client) ?? client; } }));
  vi.doMock('@living-playbooks/codex-observer', () => ({ ADAPTER: 'codex-app-server', VERSION: '0.166.0', createInstalledObserver: () => observer }));
  await import('../../apps/desktop/src/main/index');
  await vi.waitFor(() => { expect(dialog.showErrorBox).not.toHaveBeenCalled(); expect(windows.load).toHaveBeenCalled(); if (!options.windowLoad) expect((vi.isMockFunction(client.subscribe) && client.subscribe.mock.calls.length > 0) || desktopEvents.some(e => e.type === 'connection' && !e.connected)).toBe(true); });
  const invoke = (operation: string, input?: unknown) => handlers.get('lp:workspace')!({ sender: workspace.webContents, senderFrame: workspace.webContents.mainFrame }, operation, input);
  const petInvoke = (input: unknown) => handlers.get('lp:pet')!({ sender: pet.webContents, senderFrame: pet.webContents.mainFrame }, 'petInvoke', input);
  const petDrag = (phase: unknown) => handlers.get('lp:pet')!({ sender: pet.webContents, senderFrame: pet.webContents.mainFrame }, 'petDrag', phase);
  const chatInvoke = (operation: string, input?: unknown) => { const window = windows.petChat; if (!window) throw Error('No popup'); return handlers.get('lp:petChat')!({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, operation, input); };
  const trayItem = (id: string) => { const item = trayItems.find(item => item.id === id); expect(item, `Native tray item ${id} must be reachable`).toBeDefined(); return item!; };
  const clickTray = (id: string) => { Reflect.apply(trayItem(id).click!, undefined, []); };
  const dispose = async () => {
    vi.doUnmock('electron'); vi.doUnmock('node:fs'); vi.doUnmock('../../apps/desktop/src/main/native-windows'); vi.doUnmock('@living-playbooks/api-client'); vi.doUnmock('@living-playbooks/codex-observer');
    vi.restoreAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true });
  };
  return { path, app, client, clientConfigurations, protectedStorage, observer, powerMonitor, desktopEvents, petEvents, chatEvents, invoke, petInvoke, petDrag, chatInvoke, dialog, windows, trayItem, clickTray, dispose, transport: ((...args) => { if (!transport) throw Error('Native transport unavailable'); return transport(...args); }) as typeof fetch, tick: () => { const callback = tick.mock.calls[0]?.[0]; if (typeof callback === 'function') callback(); }, async close(quitBlocked = false) {
    try { clickTray('quit'); await vi.waitFor(() => { if (quitBlocked) expect(dialog.showErrorBox).toHaveBeenCalledWith('Quit blocked', expect.any(String)); else expect(app.exit).toHaveBeenCalledWith(0); }); }
    finally { await dispose(); }
  } };
}
