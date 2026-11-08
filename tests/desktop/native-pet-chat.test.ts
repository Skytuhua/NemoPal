import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import type { Rectangle } from '../../apps/desktop/src/main/windows';

test('secure native popup is lazy, focusable and independent; resize/close never changes saved sprite bounds', async () => {
  const created: FakeWindow[] = [], workArea = { x: -1920, y: 0, width: 1920, height: 1080 };
  class FakeWindow extends EventEmitter {
    destroyed = false; bounds: Rectangle;
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn(), send: vi.fn() });
    show = vi.fn(); focus = vi.fn(); hide = vi.fn(); removeMenu = vi.fn(); setPosition = vi.fn();
    setBounds = vi.fn((value: Rectangle) => { this.bounds = value; });
    loadURL = vi.fn(async () => { this.webContents.emit('did-finish-load'); });
    constructor(readonly options: Record<string, unknown>) { super(); this.bounds = { x: Number(options.x ?? 0), y: Number(options.y ?? 0), width: Number(options.width), height: Number(options.height) }; created.push(this); }
    getBounds() { return this.bounds; } getPosition() { return [this.bounds.x, this.bounds.y]; }
    isVisible() { return true; } isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
  }
  const display = Object.assign(new EventEmitter(), { getPrimaryDisplay: () => ({ workArea }), getAllDisplays: () => [{ workArea }], getDisplayMatching: () => ({ workArea }) });
  const headers = vi.fn();
  vi.doMock('electron', () => ({ BrowserWindow: FakeWindow, screen: display, session: { fromPartition: () => ({ setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), webRequest: { onHeadersReceived: headers } }) } }));
  try {
    const { createNativeWindows } = await import('../../apps/desktop/src/main/native-windows');
    const moved = vi.fn(), close = vi.fn(), closePet = vi.fn();
    const native = createNativeWindows({ renderer: 'file:///app/index.html', preloadDirectory: '/preload', position: { x: -420, y: 600 }, closeWorkspace: vi.fn(), closePet, closeChat: close, moved });
    expect(created).toHaveLength(2); expect(native.petChat).toBeUndefined();
    expect(created[1]!.options).toMatchObject({ width: 240, height: 280, transparent: true, focusable: true });
    created[1]!.emit('close', { preventDefault: vi.fn() }); expect(closePet).toHaveBeenCalledOnce();
    await native.showChat(() => true);
    const popup = created[2]!;
    expect(popup.options).toMatchObject({ width: 360, height: 460, focusable: true, transparent: false, skipTaskbar: true, frame: false, webPreferences: { preload: '/preload/pet-chat.cjs', sandbox: true, contextIsolation: true, nodeIntegration: false } });
    expect(popup.options).not.toHaveProperty('parent');
    expect(popup.loadURL).toHaveBeenCalledExactlyOnceWith('file:///app/index.html?surface=pet-chat');
    expect(popup.focus).toHaveBeenCalledOnce();
    native.resizeChat(true); expect(created).toHaveLength(3);
    expect(popup.bounds).toMatchObject({ width: 560, height: 640 }); expect(moved).not.toHaveBeenCalled();
    expect(created[1]!.setPosition).not.toHaveBeenCalled();
    const preventDefault = vi.fn(); popup.emit('close', { preventDefault }); expect(preventDefault).toHaveBeenCalled(); expect(close).toHaveBeenCalledOnce();
    const denied = { preventDefault: vi.fn() }; popup.webContents.emit('will-navigate', denied, 'https://foreign.invalid'); expect(denied.preventDefault).toHaveBeenCalledOnce();
    popup.webContents.emit('will-frame-navigate', denied); expect(denied.preventDefault).toHaveBeenCalledTimes(2);
    native.hideChat(false); await native.showChat(() => true); expect(created).toHaveLength(3);
    native.destroyChat(); expect(popup.destroyed).toBe(true); expect(native.petChat).toBeUndefined();
    native.destroy();
  } finally { vi.doUnmock('electron'); }
});
