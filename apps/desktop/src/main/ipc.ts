import { z } from 'zod';
import { AllowedClientCommandSchema, ConfirmSourceInputSchema, IdSchema, PairingInputSchema, PetChatCommandSchema, PetCommandSchema, PetPreferenceSchema, utf8Bytes } from '@living-playbooks/contracts';

export type SenderContext = { role: string; senderId: number; frameId: number; topFrameId: number; url: string };
export type WindowIdentity = { senderId: number; frameId: number; url: string };
export type Authority = { projects: Set<string>; checkIns: Map<string, string>; documents: Map<string, string>; jobs: Map<string, string> };
export class NativeBoundary {
  constructor(private windows: Record<string, WindowIdentity>, private authority: Authority, private dispatch: (operation: string, input: unknown) => Promise<unknown>) {}
  async call(sender: SenderContext, operation: string, input?: unknown): Promise<unknown> {
    const window = this.windows[sender.role];
    if (!window || window.senderId !== sender.senderId || window.frameId !== sender.frameId || sender.frameId !== sender.topFrameId || sender.url !== window.url) throw Error('Untrusted native sender');
    if (utf8Bytes(JSON.stringify(input) ?? '') > 131072) throw Error('Native request too large');
    const schemas: Record<string, z.ZodType> = sender.role === 'workspace' ? {
      capabilities: z.undefined(), pair: PairingInputSchema, selectSource: IdSchema, confirmSource: ConfirmSourceInputSchema,
      pauseSource: IdSchema, revokeSource: IdSchema, invoke: AllowedClientCommandSchema, setPetPreference: PetPreferenceSchema,
      startCodexDemo: IdSchema, stopCodexDemo: IdSchema, sendCodexDemo: z.strictObject({ projectId: IdSchema, text: z.string().refine(text => !!text.trim() && utf8Bytes(text) <= 65536) }),
    } : sender.role === 'pet' ? { petInvoke: PetCommandSchema, petDrag: z.enum(['start', 'move', 'end']) } : sender.role === 'petChat' ? { petChatRead: z.undefined(), petChatInvoke: PetChatCommandSchema } : {};
    const schema = schemas[operation];
    if (!schema) throw Error('Native operation denied');
    const parsed = schema.parse(input);
    const project = (id: string) => { if (!this.authority.projects.has(id)) throw Error('Project not authorized'); };
    if (operation === 'selectSource' || operation === 'startCodexDemo' || operation === 'stopCodexDemo') project(parsed as string);
    if (parsed && typeof parsed === 'object') {
      const command = parsed as Record<string, unknown>;
      if (typeof command.projectId === 'string') project(command.projectId);
      if ('checkInId' in command) { const owner = this.authority.checkIns.get(String(command.checkInId)); if (!owner) throw Error('Question not authorized'); project(owner); }
      if ('documentId' in command && this.authority.documents.get(String(command.documentId)) !== command.projectId) throw Error('Document not authorized');
      if ('jobId' in command) { const owner = this.authority.jobs.get(String(command.jobId)); if (!owner) throw Error('Job not authorized'); project(owner); }
      const preference = operation === 'setPetPreference' ? command : command.type === 'setPreference' ? command.preference as Record<string, unknown> : undefined;
      if (typeof preference?.pinnedProjectId === 'string') project(preference.pinnedProjectId);
    }
    return this.dispatch(operation, parsed);
  }
}
