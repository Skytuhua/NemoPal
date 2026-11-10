import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { clampDragPosition, type Rectangle } from '../../apps/desktop/src/main/windows';

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
    const seam = createNativeWindows({ renderer: 'file:///app/index.html', preloadDirectory: '/preload', position: { x: -120, y: 600 }, closeWorkspace() {}, moved() {} });
    expect(seam.pet.getPosition()).toEqual([-120, 600]);
    seam.clamp();
    expect(seam.pet.getPosition()).toEqual([-120, 600]);
    seam.destroy();
    const native = createNativeWindows({ renderer: 'file:///app/index.html', preloadDirectory: '/preload', position: { x: -700, y: 600 }, closeWorkspace() {}, moved: p => { saved.push(p); writes.push(store.setPosition(p)); } });
    await native.showChat(() => true);
    native.dragPet('start');
    // The full 240-DIP window can span adjacent work areas without stalling at the seam.
    for (const x of [-241, -240, -220, -120, -1, 0, -1, -120, -220, -240, -241]) {
      cursor = { x: x + 100, y: 700 };
      native.dragPet('move');
      expect(native.pet.getPosition()).toEqual([x, 600]);
    }
    cursor = { x: -3500, y: 2000 }; native.dragPet('move');
    expect(native.pet.getPosition()).toEqual([-1920, 800]); expect(saved.at(-1)).toEqual({ x: -1920, y: 800 });
    expect(native.petChat!.getBounds().x).toBeGreaterThanOrEqual(-1920);
    cursor = { x: 800, y: 500 }; native.dragPet('move'); expect(native.pet.getPosition()).toEqual([700, 400]);
    native.pet.emit('blur'); cursor = { x: 1200, y: 500 }; native.dragPet('move'); expect(native.pet.getPosition()).toEqual([700, 400]);
    native.dragPet('start'); native.dragPet('end'); cursor = { x: 1500, y: 500 }; native.dragPet('move'); expect(native.pet.getPosition()).toEqual([700, 400]);
    await Promise.all(writes); await store.flush();
    expect((await JournalStore.open(path)).position()).toEqual({ x: 700, y: 400 });
    native.destroy();
  } finally {
    vi.doUnmock('electron');
    await Promise.allSettled(writes);
    const info = await lstat(directory);
    const actual = await realpath(directory), temp = await realpath(tmpdir());
    if (info.isSymbolicLink() || dirname(actual) !== temp || !actual.startsWith(join(temp, 'pet-drag-'))) throw new Error('Unsafe pet test directory');
    await rm(actual, { recursive: true, force: true });
  }
});


test('drag clamping accepts only full coverage by adjacent work areas', () => {
  const size = { width: 240, height: 280 };
  const horizontal = [{ x: -1920, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1040 }];
  expect(clampDragPosition({ x: -120, y: 600 }, size, horizontal)).toEqual({ x: -120, y: 600 });
  const vertical = [{ x: 0, y: -1080, width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1080 }];
  expect(clampDragPosition({ x: 100, y: -140 }, size, vertical)).toEqual({ x: 100, y: -140 });
  const gap = [{ x: -1920, y: 0, width: 1920, height: 1080 }, { x: 20, y: 0, width: 1900, height: 1080 }];
  expect(clampDragPosition({ x: -120, y: 600 }, size, gap)).toEqual({ x: -240, y: 600 });
  expect(clampDragPosition({ x: -120, y: 790 }, size, horizontal)).toEqual({ x: -240, y: 790 });
  expect(clampDragPosition({ x: 9000, y: -500 }, size, horizontal)).toEqual({ x: 1680, y: 0 });
});
