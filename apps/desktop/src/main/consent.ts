import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { boundedText, ConfirmSourceInputSchema, IdSchema, type ConfirmSourceInput, type SourceSelectionPreview } from '@living-playbooks/contracts';

export const ReceivingIdentitySchema = z.strictObject({ cloudOrigin: boundedText(512, true), modelEndpoint: boundedText(512, true), disclosure: boundedText(512, true) });
export type ReceivingIdentity = z.infer<typeof ReceivingIdentitySchema>;
export function receivingIdentity(cloudOrigin: string | null, modelEndpoint?: string, disclosure?: string): ReceivingIdentity | null {
  const parsed = ReceivingIdentitySchema.safeParse({ cloudOrigin, modelEndpoint, disclosure });
  return parsed.success ? parsed.data : null;
}

export class ConsentSelections {
  private selections = new Map<string, { projectId: string; threadId: string; workspace: string; expires: number; receiving: ReceivingIdentity | null }>();
  constructor(private origin: string | null, private receiving: ReceivingIdentity | null) {}
  offer(projectId: string, threadId: string, workspace: string): SourceSelectionPreview {
    IdSchema.parse(projectId); IdSchema.parse(threadId);
    this.selections.clear();
    const receiving = this.receiving ? ReceivingIdentitySchema.parse(this.receiving) : null;
    const selectionId = randomUUID(); this.selections.set(selectionId, { projectId, threadId, workspace, expires: Date.now() + 300000, receiving });
    return { available: true, selectionId, projectId, displayName: 'Selected project build/test conversation', adapterId: 'codex-app-server', adapterVersion: '0.166.0', capability: 'incremental_history', cloudOrigin: this.origin && receiving ? this.origin : '',
      disclosure: `Local read: only selected thread ${threadId} in this project on this device. Completed visible messages and exit metadata only. Cloud sharing ${this.origin && receiving ? `requires a separate choice: ${receiving.modelEndpoint}; ${receiving.disclosure}` : 'OFF; no receiving model endpoint/disclosure configured'}. Filtering is best effort, not a guarantee. Pause stops collection; revoke stops locally immediately and removes queued exports; cloud confirmation may be pending. Already processed provider data cannot be recalled.` };
  }
  confirm(raw: ConfirmSourceInput) {
    const input = ConfirmSourceInputSchema.parse(raw); const selection = this.selections.get(input.selectionId);
    if (!selection || selection.projectId !== input.projectId || selection.expires < Date.now()) throw Error('Native source selection expired or mismatched');
    if (input.exportPolicy !== 'off' && (!this.origin || !selection.receiving)) throw Error('Receiving endpoint and explicit disclosure are required; cloud sharing is OFF');
    this.selections.delete(input.selectionId); return selection;
  }
}
