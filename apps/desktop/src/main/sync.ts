import { ClientError } from '@living-playbooks/api-client';
import type { PlaybooksClient } from '@living-playbooks/contracts';
import type { JournalStore } from './local-store';
import type { ReceivingIdentity } from './consent';

export type SyncState = { connected: boolean; reason?: string };
export class SyncEngine {
  private running?: Promise<SyncState>;
  private stopped = false;
  private authorizationBlocked = false;
  constructor(private store: JournalStore, private client: PlaybooksClient, private currentReceiving: () => ReceivingIdentity | null = () => null) {}
  run(): Promise<SyncState> {
    if (this.stopped || this.authorizationBlocked) return Promise.resolve({ connected: false, reason: this.authorizationBlocked ? 'Pairing expired or revoked; explicit re-pairing required.' : 'Synchronization stopped.' });
    return this.running ??= this.drain().finally(() => { this.running = undefined; });
  }
  private async drain(): Promise<SyncState> {
    try {
      while (!this.stopped) {
        const source = this.store.pendingSourceCommands()[0];
        if (source) {
          if (source.kind === 'revoke') await this.client.revokeSource(source.bindingId, { operationId: source.operationId, input: { grantRevision: source.grantRevision, removeExcerpts: true } });
          else await this.client.setSourceState(source.bindingId, { operationId: source.operationId, input: { grantRevision: source.grantRevision, state: 'paused' } });
          await this.store.acknowledgeSourceCommand(source.id); continue;
        }
        const upload = (await this.store.pendingUploads(1))[0];
        if (!upload) break;
        const binding = this.store.binding(upload.bindingId)?.binding;
        if (!binding || !this.store.isFollowing(upload.bindingId) || binding.grantRevision !== upload.grantRevision || binding.exportPolicy === 'off') break;
        if (!this.store.canExport(upload.bindingId, upload.grantRevision, this.currentReceiving())) return { connected: true, reason: 'Exports held for explicit receiving endpoint/disclosure consent. Pending observations retained; local pause/revoke remains available.' };
        const receipt = await this.client.ingestObservations(upload.bindingId, { operationId: upload.operationId, input: upload.input });
        const confirmed = new Set([...receipt.result.acceptedIds, ...receipt.result.duplicateIds]);
        if (upload.input.observations.some(o => !confirmed.has(o.id))) throw Error('Upload acknowledgement incomplete');
        await this.store.acknowledgeUploads([upload.id]);
      }
      return { connected: !this.stopped, ...(this.stopped ? { reason: 'Synchronization stopped.' } : {}) };
    } catch (error) {
      this.authorizationBlocked = error instanceof ClientError && ['unauthorized', 'forbidden', 'authorization'].includes(error.code);
      return { connected: false, reason: this.authorizationBlocked ? 'Pairing expired or revoked; explicit re-pairing required.' : 'Cloud synchronization pending; durable observations and revocations retained.' };
    }
  }
  async stop(): Promise<void> { this.stopped = true; await this.running; }
}
