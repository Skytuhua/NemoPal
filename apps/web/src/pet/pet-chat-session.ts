import { z } from 'zod';
import { boundedText, MessageInputSchema, RevisionSchema, revisionedCommandSchema } from '@living-playbooks/contracts';
import type { DraftStore, LocalDraft } from '../features/documents/drafts';

const PendingSchema = z.strictObject({ command: revisionedCommandSchema(MessageInputSchema), sent: z.strictObject({ text: boundedText(16384, true), baseRevision: RevisionSchema }) });
export type PendingPetMessage = z.infer<typeof PendingSchema>;

/** One popup composer, separate from workspace keys; pending envelopes never change on refresh. */
export class PetChatSession {
  readonly draftKey: string;
  pending?: PendingPetMessage;
  constructor(private store: DraftStore, scope: string) { this.draftKey = `pet-chat:${scope}:draft`; }
  async load() {
    const saved = await this.store.read(`${this.draftKey}:pending`);
    if (saved) {
      if (saved.text.length > 40000) throw Error('Pending message invalid');
      this.pending = PendingSchema.parse(JSON.parse(saved.text));
    }
  }
  async prepare(sent: LocalDraft, expectedRevision: number): Promise<PendingPetMessage> {
    if (this.pending) throw Error('Reconcile the pending message first');
    const pending = PendingSchema.parse({ command: { operationId: crypto.randomUUID(), expectedRevision, input: { text: sent.text } }, sent: { text: sent.text, baseRevision: sent.baseRevision } });
    await this.store.flush();
    await this.store.write(`${this.draftKey}:pending`, { text: JSON.stringify(pending), baseRevision: 0 });
    await this.store.flush();
    this.pending = pending;
    return pending;
  }
  async complete(pending: PendingPetMessage) {
    if (this.pending !== pending) return;
    await this.store.remove(`${this.draftKey}:pending`); await this.store.flush();
    if (this.pending === pending) this.pending = undefined;
  }
}
