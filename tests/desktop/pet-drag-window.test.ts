import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import type { Rectangle } from '../../apps/desktop/src/main/windows';

test('native cursor drag clamps in DIP, persists moved position, follows popup, and cancels on focus loss', async () => {
  let cursor = { x: -600, y: 700 }; const saved: unknown[] = [];
  const directory = await mkdtemp(join(tmpdir(), 'pet-drag-'));
  const path = join(directory, 'journal.json'); const store = await JournalStore.open(path);
  const writes: Promise<void>[] = [];
  const areas = [{ x: -1920, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1040 }];
  class FakeWindow extends EventEmitter {
    bounds: Rectangle; destroyed = false;
    webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler() {}, send() {} });
    constructor(options: Record<string, unknown>) { super(); this.bounds = { x: Number(options.x ?? 0), y: Number(options.y ?? 0), width: Number(options.width), height: Number(options.height) }; }
    removeMenu() {} isDestroyed() { return this.destroyed; } isVisible() { return true; } destroy() { this.destroyed = true; }
    getPosition() { return [this.bounds.x, this.bounds.y]; } getBounds() { return this.bounds; }
    setPosition(x: number, y: number) { this.bounds = { ...this.bounds, x, y }; this.emit('moved'); }
    setBounds(b: Rectangle) { this.bounds = b; } async loadURL() {} show() {} focus() {} hide() {}
  }
  const display = Object.assign(new EventEmitter(), { getPrimaryDisplay: () => ({ workArea: areas[1] }), getAllDisplays: () => areas.map(workArea => ({ workArea })), getCursorScreenPoint: () => cursor, getDisplayMatching: (r: Rectangle) => ({ workArea: r.x < 0 ? areas[0] : areas[1] }) });
  vi.doMock('electron', () => ({ BrowserWindow: FakeWindow, screen: display, session: { fromPartition: () => ({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onHeadersReceived() {} } }) } }));
  try {
    const { createNativeWindows } = await import('../../apps/desktop/src/main/native-windows');
    const native = createNativeWindows({ renderer: 'file:///app/index.html', preloadDirectory: '/preload', position: { x: -700, y: 600 }, closeWorkspace() {}, moved: p => { saved.push(p); writes.push(store.setPosition(p)); } });
    await native.showChat(() => true);
    native.dragPet('start'); cursor = { x: -3500, y: 2000 }; native.dragPet('move');
    expect(native.pet.getPosition()).toEqual([-1920, 800]); expect(saved.at(-1)).toEqual({ x: -1920, y: 800 });
    expect(native.petChat!.getBounds().x).toBeGreaterThanOrEqual(-1920);
    cursor = { x: 800, y: 500 }; native.dragPet('move'); expect(native.pet.getPosition()).toEqual([700, 400]);
    native.pet.emit('blur'); cursor = { x: 1200, y: 500 }; native.dragPet('move'); expect(native.pet.getPosition()).toEqual([700, 400]);
    native.dragPet('start'); native.dragPet('end'); cursor = { x: 1500, y: 500 }; native.dragPet('move'); expect(native.pet.getPosition()).toEqual([700, 400]);
    await Promise.all(writes); await store.flush();
    expect((await JournalStore.open(path)).position()).toEqual({ x: 700, y: 400 });
    native.destroy();
  } finally { vi.doUnmock('electron'); await rm(directory, { recursive: true, force: true }); }
});
