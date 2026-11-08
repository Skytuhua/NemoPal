import { app, ipcMain, safeStorage, screen } from 'electron';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setImmediate as nextNativeTurn } from 'node:timers/promises';
import { createNativeWindows } from '../../apps/desktop/src/main/native-windows';
import { createCompanionTray } from '../../apps/desktop/src/main/tray';
import { CompanionLifetime } from '../../apps/desktop/src/main/windows';
import { NativeBoundary } from '../../apps/desktop/src/main/ipc';
import { CredentialVault } from '../../apps/desktop/src/main/credentials';

const directory = process.env.LP_NATIVE_SMOKE_DIR!;
app.setPath('userData', join(directory, 'profile')); app.setPath('sessionData', join(directory, 'session'));
// Electron emits ready only after its ESM entry finishes evaluating.
void run();
async function run() { try {
  console.log('stage single-instance');
  if (process.argv.includes('--lp-second-instance')) { assert(!app.requestSingleInstanceLock()); app.exit(0); return; }
  assert(app.requestSingleInstanceLock());
  await app.whenReady();
  console.log('stage ready');
  const second = spawn(process.execPath, [process.argv[1]!, '--lp-second-instance'], { env: process.env, stdio: 'ignore', windowsHide: true });
  const secondCode = await new Promise<number | null>((resolve, reject) => { second.once('error', reject); second.once('exit', resolve); }); assert.equal(secondCode, 0);
  const html = join(directory, 'index.html');
  await writeFile(html, '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; connect-src \'none\'; frame-src \'none\'"><title>Controlled native boundary smoke — synthetic, no product renderer</title><p>Living Playbooks controlled native smoke</p>');
  const trace: string[] = [];
  const windows = createNativeWindows({ renderer: pathToFileURL(html).href, preloadDirectory: process.env.LP_NATIVE_PRELOAD_DIR!, position: { x: 99999, y: -99999 }, closeWorkspace: () => lifetime.closeWorkspace(), moved: () => {} });
  const lifetime = new CompanionLifetime(() => windows.workspace.hide(), async () => { trace.push('stop'); }, async () => { trace.push('flush'); }, () => { trace.push('quit'); });
  const authority = { projects: new Set<string>(), checkIns: new Map<string, string>(), documents: new Map<string, string>(), jobs: new Map<string, string>() };
  for (const role of ['workspace', 'pet'] as const) ipcMain.handle(`lp:${role}`, async (event, operation: string, input: unknown) => {
    const window = windows[role]; const frame = event.senderFrame!;
    try { return await new NativeBoundary({ [role]: { senderId: window.webContents.id, frameId: window.webContents.mainFrame.routingId, url: windows.targets[role] } }, authority, async op => { if (op === 'capabilities') return { paired: false }; throw Error('Unavailable in synthetic smoke'); }).call({ role, senderId: event.sender.id, frameId: frame.routingId, topFrameId: window.webContents.mainFrame.routingId, url: frame.url }, operation, input); } catch { throw Error('Synthetic denied request'); }
  });
  await windows.load();
  console.log('stage windows-loaded');
  const workspace = await windows.workspace.webContents.executeJavaScript('({ bridge: typeof window.playbooks, pet: typeof window.pet, node: typeof require, token: window.playbooks?.token })');
  const pet = await windows.pet.webContents.executeJavaScript('({ bridge: typeof window.pet, workspace: typeof window.playbooks, keys: Object.keys(window.pet || {}), node: typeof require })');
  assert.deepEqual(workspace, { bridge: 'object', pet: 'undefined', node: 'undefined', token: undefined });
  assert.deepEqual(pet, { bridge: 'object', workspace: 'undefined', keys: ['invoke', 'onEvent'], node: 'undefined' });
  assert.equal(await windows.workspace.webContents.executeJavaScript('window.playbooks.invoke({type:"exec",command:"whoami"}).then(()=>false,()=>true)'), true);
  assert.equal(await windows.pet.webContents.executeJavaScript('window.pet.invoke({type:"selectSource",projectId:"arbitrary"}).then(()=>false,()=>true)'), true);
  assert.deepEqual(await windows.workspace.webContents.executeJavaScript('window.playbooks.capabilities()'), { paired: false });
  const petShown = once(windows.pet, 'show'); windows.pet.showInactive(); await petShown; assert.equal(windows.pet.isFocused(), false); assert.equal(windows.pet.isAlwaysOnTop(), true);
  const [x = 0, y = 0] = windows.pet.getPosition(); const workAreas = screen.getAllDisplays().map(d => d.workArea);
  assert(workAreas.some(a => x >= a.x && y >= a.y && x + 240 <= a.x + a.width && y + 280 <= a.y + a.height));
  let preference = { hidden: false, focus: false, reducedMotion: true, pinnedProjectId: null };
  let ignoreMouse = false;
  const tray = createCompanionTray({ preference: () => preference, open: () => windows.workspace.show(), setPreference: async input => { preference = { ...input, pinnedProjectId: null }; if (input.hidden) windows.pet.hide(); else windows.pet.showInactive(); }, clickThrough: value => { ignoreMouse = value; windows.pet.setIgnoreMouseEvents(value, { forward: true }); }, quit: () => { void lifetime.quit(); }, error: () => { throw Error('Tray failure'); } });
  console.log('stage tray-controls');
  const workspaceShown = once(windows.workspace, 'show'); tray.menu.getMenuItemById('open')!.click(); await workspaceShown; await nextNativeTurn(); assert(windows.workspace.isVisible());
  const workspaceHidden = once(windows.workspace, 'hide'); windows.workspace.close(); await workspaceHidden; assert(!windows.workspace.isVisible()); assert(windows.pet.isVisible());
  const petHidden = once(windows.pet, 'hide'); tray.menu.getMenuItemById('hide')!.click(); await petHidden; assert(!windows.pet.isVisible());
  tray.menu.getMenuItemById('click-through')!.click(); assert(ignoreMouse);
  tray.rebuild().getMenuItemById('click-through')!.click(); assert(!ignoreMouse);
  const protectedAvailable = await safeStorage.isAsyncEncryptionAvailable();
  console.log('stage protected-storage', protectedAvailable);
  assert(protectedAvailable, 'Windows protected storage unavailable');
  const vault = new CredentialVault(join(directory, 'credential'), { isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(), encryptString: text => safeStorage.encryptStringAsync(text), decryptString: async bytes => (await safeStorage.decryptStringAsync(bytes)).result }, false);
  await vault.save({ token: 'synthetic-native-smoke-token', deviceId: '00000000-0000-4000-8000-000000000007', expiresAt: '2099-01-01T00:00:00.000Z' });
  assert.equal(vault.authorization(), 'Bearer synthetic-native-smoke-token');
  assert(!(await readFile(join(directory, 'credential'))).includes(Buffer.from('synthetic-native-smoke-token')));
  const restored = new CredentialVault(join(directory, 'credential'), { isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(), encryptString: text => safeStorage.encryptStringAsync(text), decryptString: async bytes => (await safeStorage.decryptStringAsync(bytes)).result }, false);
  await restored.load(); assert.equal(restored.authorization(), 'Bearer synthetic-native-smoke-token');
  await lifetime.quit(); assert.deepEqual(trace, ['stop', 'flush', 'quit']);
  await writeFile(join(directory, 'receipt.json'), JSON.stringify({ result: 'PASS', platform: process.platform, electron: process.versions.electron, renderer: 'controlled synthetic test HTML, NOT C product renderer', assertions: ['second Electron process denied instance lock', 'separate sandbox workspace/pet preloads', 'no renderer Node or credentials', 'forbidden workspace/pet methods denied', 'actual small transparent topmost pet shown without focus', 'native tray menu callbacks Open/Hide/click-through escape', 'workspace closes to tray', 'work-area clamp', 'async Windows protected encryption and restart decryption', 'Quit stop then flush'], notVerified: ['physical tray pointer interaction', 'physical display removal', 'fullscreen or secure-desktop behavior', 'complete product pet art/animation/reduced-motion rendering', 'live cloud question/answer loop'] }, null, 2));
  tray.tray.destroy(); windows.destroy(); app.exit(0);
} catch (error) { console.error(error); app.exit(1); } }
