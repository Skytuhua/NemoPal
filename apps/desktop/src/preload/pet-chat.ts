import { contextBridge, ipcRenderer } from 'electron';
import { AcceptedJobSchema, PetChatCommandSchema, PetChatStateSchema, type PetChatBridge } from '@living-playbooks/contracts';

const bridge: PetChatBridge = {
  read: async () => PetChatStateSchema.parse(await ipcRenderer.invoke('lp:petChat', 'petChatRead')),
  async invoke(input) {
    const command = PetChatCommandSchema.parse(input);
    const result: unknown = await ipcRenderer.invoke('lp:petChat', 'petChatInvoke', command);
    return command.type === 'send' ? AcceptedJobSchema.parse(result) : undefined;
  },
  onEvent(listener) {
    const receive = (_event: unknown, raw: unknown) => { const parsed = PetChatStateSchema.safeParse(raw); if (parsed.success) listener(parsed.data); };
    ipcRenderer.on('lp:pet-chat-event', receive);
    return () => { ipcRenderer.removeListener('lp:pet-chat-event', receive); };
  },
};
contextBridge.exposeInMainWorld('petChat', Object.freeze(bridge));
