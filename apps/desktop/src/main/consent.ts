import { randomUUID } from 'node:crypto';
import { ConfirmSourceInputSchema, IdSchema, type ConfirmSourceInput, type SourceSelectionPreview } from '@living-playbooks/contracts';

export class ConsentSelections {
  private selections = new Map<string, { projectId: string; threadId: string; workspace: string; expires: number }>();
  constructor(private origin: string | null, private receivingDisclosure: string | null) {}
  offer(projectId: string, threadId: string, workspace: string): SourceSelectionPreview {
    IdSchema.parse(projectId); IdSchema.parse(threadId);
    this.selections.clear();
    const selectionId = randomUUID(); this.selections.set(selectionId, { projectId, threadId, workspace, expires: Date.now() + 300000 });
    return { available: true, selectionId, projectId, displayName: 'Selected project build/test conversation', adapterId: 'codex-app-server', adapterVersion: '0.166.0', capability: 'incremental_history', cloudOrigin: this.origin && this.receivingDisclosure ? this.origin : '',
      disclosure: `Local read: only selected thread ${threadId} in this project on this device. Completed visible messages and exit metadata only. Cloud sharing ${this.origin && this.receivingDisclosure ? `requires a separate choice: ${this.receivingDisclosure}` : 'OFF; no receiving model endpoint/disclosure configured'}. Filtering is best effort, not a guarantee. Pause stops collection; revoke stops locally immediately and removes queued exports; cloud confirmation may be pending. Already processed provider data cannot be recalled.` };
  }
  confirm(raw: ConfirmSourceInput) {
    const input = ConfirmSourceInputSchema.parse(raw); const selection = this.selections.get(input.selectionId);
    if (!selection || selection.projectId !== input.projectId || selection.expires < Date.now()) throw Error('Native source selection expired or mismatched');
    if (input.exportPolicy !== 'off' && (!this.origin || !this.receivingDisclosure)) throw Error('Receiving endpoint and explicit disclosure are required; cloud sharing is OFF');
    this.selections.delete(input.selectionId); return selection;
  }
}
