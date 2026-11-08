import { BrowserWindow, screen, session } from 'electron';
import { clampPosition, rendererTargets, securePreferences } from './windows';
import { popupPlacement } from './popup-placement';
import type { PetChatState } from '@living-playbooks/contracts';

export function createNativeWindows(options: { renderer: string; preloadDirectory: string; position: { x: number; y: number } | null; closeWorkspace(): void; closePet?(): void; closeChat?(): void; moved(position: { x: number; y: number }): void }) {
  const targets = rendererTargets(options.renderer);
  const nativeSession = session.fromPartition('persist:living-playbooks');
  nativeSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  nativeSession.setPermissionCheckHandler(() => false);
  nativeSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders,
    'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"],
  } }));
  const workspace = new BrowserWindow({ width: 1240, height: 820, minWidth: 800, minHeight: 600, show: false, title: 'Living Playbooks', webPreferences: { ...securePreferences(`${options.preloadDirectory}/workspace.cjs`), session: nativeSession } });
  const point = clampPosition(options.position ?? { x: screen.getPrimaryDisplay().workArea.x + screen.getPrimaryDisplay().workArea.width - 250, y: screen.getPrimaryDisplay().workArea.y + screen.getPrimaryDisplay().workArea.height - 290 }, { width: 240, height: 280 }, screen.getAllDisplays().map(d => d.workArea));
  const pet = new BrowserWindow({ ...point, width: 240, height: 280, show: false, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, focusable: true, resizable: false, minimizable: false, maximizable: false, hasShadow: false, title: 'Living Playbooks companion', webPreferences: { ...securePreferences(`${options.preloadDirectory}/pet.cjs`), session: nativeSession } });
  let petChat: BrowserWindow | undefined, loading: Promise<void> | undefined, expanded = false, chatEvent: PetChatState | undefined;
  const protect = (role: keyof typeof targets, window: BrowserWindow) => {
    window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== targets[role]) event.preventDefault(); });
    window.webContents.on('will-redirect', (event, url) => { if (url !== targets[role]) event.preventDefault(); });
    window.webContents.on('will-frame-navigate', event => { event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => { event.preventDefault(); });
  };
  protect('workspace', workspace); protect('pet', pet);
  const placeChat = () => {
    if (!petChat || petChat.isDestroyed()) return;
    const anchor = pet.getBounds();
    petChat.setBounds(popupPlacement(anchor, screen.getDisplayMatching(anchor).workArea, expanded), false);
  };
  const destroyChat = () => { const previous = petChat; petChat = undefined; loading = undefined; chatEvent = undefined; previous?.destroy(); };
  const showChat = async (current: () => boolean) => {
    if (!current()) return;
    if (!petChat || petChat.isDestroyed()) {
      petChat = new BrowserWindow({ width: 360, height: 460, show: false, frame: false, transparent: false, backgroundColor: '#ffffff', alwaysOnTop: true, skipTaskbar: true, focusable: true, resizable: false, minimizable: false, maximizable: false, title: 'Conversation', webPreferences: { ...securePreferences(`${options.preloadDirectory}/pet-chat.cjs`), session: nativeSession } });
      const created = petChat;
      protect('petChat', created);
      created.on('close', event => { event.preventDefault(); if (petChat === created) { if (options.closeChat) options.closeChat(); else created.hide(); } });
      created.webContents.on('did-finish-load', () => { if (petChat === created && chatEvent) created.webContents.send('lp:pet-chat-event', chatEvent); });
      loading = created.loadURL(targets.petChat);
    }
    const window = petChat;
    placeChat();
    await loading;
    if (!current() || petChat !== window || window.isDestroyed()) return;
    window.show(); window.focus();
  };
  workspace.on('close', event => { event.preventDefault(); options.closeWorkspace(); });
  pet.on('close', event => { event.preventDefault(); if (options.closePet) options.closePet(); else pet.hide(); });
  pet.on('moved', () => { const [x = 0, y = 0] = pet.getPosition(); options.moved({ x, y }); placeChat(); });
  const clamp = () => { const [x = 0, y = 0] = pet.getPosition(); const point = clampPosition({ x, y }, { width: 240, height: 280 }, screen.getAllDisplays().map(d => d.workArea)); pet.setPosition(point.x, point.y, false); placeChat(); };
  screen.on('display-removed', clamp); screen.on('display-metrics-changed', clamp);
  return { workspace, pet, get petChat() { return petChat; }, targets, clamp, showChat, destroyChat,
    resizeChat(value: boolean) { expanded = value; placeChat(); },
    hideChat(restoreFocus: boolean) { petChat?.hide(); if (restoreFocus && !pet.isDestroyed() && pet.isVisible()) { pet.focus(); pet.webContents.send('lp:pet-controls-focus'); } },
    sendChat(state: PetChatState) { chatEvent = state; if (petChat && !petChat.isDestroyed()) petChat.webContents.send('lp:pet-chat-event', state); },
    async load() { await Promise.all([workspace.loadURL(targets.workspace), pet.loadURL(targets.pet)]); }, destroy() { screen.removeListener('display-removed', clamp); screen.removeListener('display-metrics-changed', clamp); destroyChat(); workspace.destroy(); pet.destroy(); } };
}
