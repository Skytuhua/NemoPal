import { Menu, Tray, nativeImage } from 'electron';
import type { PetPreference } from '@living-playbooks/contracts';

export function createCompanionTray(options: { preference(): PetPreference; open(): void; setPreference(preference: PetPreference): Promise<void>; clickThrough(value: boolean): void; withdrawSources(action: 'pause' | 'revoke'): Promise<void>; quit(): void; error(action?: 'pause' | 'revoke'): void }) {
  // Original neutral tray glyph; C owns the pet artwork.
  const bitmap = Buffer.alloc(16 * 16 * 4);
  for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) { const i = (y * 16 + x) * 4; bitmap[i] = 210; bitmap[i + 1] = 210; bitmap[i + 2] = 210; bitmap[i + 3] = 255; }
  const tray = new Tray(nativeImage.createFromBitmap(bitmap, { width: 16, height: 16 }));
  tray.setToolTip('NemoPal — closing the workspace keeps this companion running');
  let clickThrough = false;
  let withdrawing = false;
  const withdraw = (action: 'pause' | 'revoke') => {
    if (withdrawing) return;
    withdrawing = true; rebuild();
    void options.withdrawSources(action).catch(() => options.error(action)).finally(() => { withdrawing = false; if (!tray.isDestroyed()) rebuild(); });
  };
  const rebuild = () => {
    const preference = options.preference();
    const change = (next: PetPreference) => { void options.setPreference(next).then(rebuild).catch(() => options.error()); };
    const menu = Menu.buildFromTemplate([
      { id: 'open', label: 'Open workspace', click: options.open },
      { id: 'hide', label: 'Hide pet', type: 'checkbox', checked: preference.hidden, click: () => change({ ...preference, hidden: !preference.hidden }) },
      { id: 'focus', label: 'Focus (quiet pet)', type: 'checkbox', checked: preference.focus, click: () => change({ ...preference, focus: !preference.focus }) },
      { id: 'click-through', label: 'Click-through pet (use tray to restore)', type: 'checkbox', checked: clickThrough, click: () => { clickThrough = !clickThrough; options.clickThrough(clickThrough); rebuild(); } },
      { type: 'separator' },
      { id: 'pause-sources', label: 'Pause all local sources…', enabled: !withdrawing, click: () => withdraw('pause') },
      { id: 'revoke-sources', label: 'Revoke all local source access…', enabled: !withdrawing, click: () => withdraw('revoke') },
      { type: 'separator' }, { id: 'quit', label: 'Quit NemoPal', click: options.quit },
    ]);
    tray.setContextMenu(menu); return menu;
  };
  tray.on('double-click', options.open);
  return { tray, rebuild, menu: rebuild() };
}
