import { BrowserWindow, screen, session } from 'electron';
import { clampPosition, rendererTargets, securePreferences } from './windows';

export function createNativeWindows(options: { renderer: string; preloadDirectory: string; position: { x: number; y: number } | null; closeWorkspace(): void; moved(position: { x: number; y: number }): void }) {
  const targets = rendererTargets(options.renderer);
  const nativeSession = session.fromPartition('persist:living-playbooks');
  nativeSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  nativeSession.setPermissionCheckHandler(() => false);
  nativeSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders,
    'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"],
  } }));
  const workspace = new BrowserWindow({ width: 1240, height: 820, minWidth: 800, minHeight: 600, show: false, title: 'Living Playbooks', webPreferences: { ...securePreferences(`${options.preloadDirectory}/workspace.cjs`), session: nativeSession } });
  const point = clampPosition(options.position ?? { x: screen.getPrimaryDisplay().workArea.x + screen.getPrimaryDisplay().workArea.width - 250, y: screen.getPrimaryDisplay().workArea.y + screen.getPrimaryDisplay().workArea.height - 290 }, { width: 240, height: 280 }, screen.getAllDisplays().map(d => d.workArea));
  const pet = new BrowserWindow({ ...point, width: 240, height: 280, show: false, frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, minimizable: false, maximizable: false, hasShadow: false, title: 'Living Playbooks companion', webPreferences: { ...securePreferences(`${options.preloadDirectory}/pet.cjs`), session: nativeSession } });
  for (const [role, window] of Object.entries({ workspace, pet }) as ['workspace' | 'pet', BrowserWindow][]) {
    window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (url !== targets[role]) event.preventDefault(); });
    window.webContents.on('will-frame-navigate', event => { event.preventDefault(); });
    window.webContents.on('will-attach-webview', event => { event.preventDefault(); });
  }
  workspace.on('close', event => { event.preventDefault(); options.closeWorkspace(); });
  pet.on('close', event => { event.preventDefault(); pet.hide(); });
  pet.on('moved', () => { const [x = 0, y = 0] = pet.getPosition(); options.moved({ x, y }); });
  const clamp = () => { const [x = 0, y = 0] = pet.getPosition(); const point = clampPosition({ x, y }, { width: 240, height: 280 }, screen.getAllDisplays().map(d => d.workArea)); pet.setPosition(point.x, point.y, false); };
  screen.on('display-removed', clamp); screen.on('display-metrics-changed', clamp);
  return { workspace, pet, targets, clamp, async load() { await Promise.all([workspace.loadURL(targets.workspace), pet.loadURL(targets.pet)]); }, destroy() { screen.removeListener('display-removed', clamp); screen.removeListener('display-metrics-changed', clamp); workspace.destroy(); pet.destroy(); } };
}
