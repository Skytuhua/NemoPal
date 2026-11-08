import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, SafeDesktopEvent } from '@living-playbooks/contracts';

const call = (operation: string, input?: unknown) => ipcRenderer.invoke('lp:workspace', operation, input);
const bridge: DesktopBridge = {
  capabilities: () => call('capabilities'), pair: input => call('pair', input), selectSource: id => call('selectSource', id), confirmSource: input => call('confirmSource', input),
  pauseSource: id => call('pauseSource', id), revokeSource: id => call('revokeSource', id), invoke: input => call('invoke', input), setPetPreference: input => call('setPetPreference', input),
  onEvent(listener) { const receive = (_event: unknown, data: SafeDesktopEvent) => listener(data); ipcRenderer.on('lp:workspace-event', receive); return () => { ipcRenderer.removeListener('lp:workspace-event', receive); }; },
};
contextBridge.exposeInMainWorld('playbooks', Object.freeze(bridge));
