import { contextBridge, ipcRenderer } from 'electron';
import type { PetBridge, SafePetEvent } from '@living-playbooks/contracts';

const bridge: PetBridge = {
  invoke: input => ipcRenderer.invoke('lp:pet', 'petInvoke', input),
  drag: phase => ipcRenderer.invoke('lp:pet', 'petDrag', phase),
  onEvent(listener) { const receive = (_event: unknown, data: SafePetEvent) => listener(data); ipcRenderer.on('lp:pet-event', receive); return () => { ipcRenderer.removeListener('lp:pet-event', receive); }; },
  onFocusControls(listener) { const receive = () => listener(); ipcRenderer.on('lp:pet-controls-focus', receive); return () => { ipcRenderer.removeListener('lp:pet-controls-focus', receive); }; },
};
contextBridge.exposeInMainWorld('pet', Object.freeze(bridge));
