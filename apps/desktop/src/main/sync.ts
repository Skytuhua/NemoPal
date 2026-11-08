import { ClientError } from '@living-playbooks/api-client';
import type { PlaybooksClient } from '@living-playbooks/contracts';
import type { JournalStore } from './local-store';

export type SyncState = { connected: boolean; reason?: string };
export class SyncEngine {
  private running?: Promise<SyncState>;
  private stopped = false;
  private authorizationBlocked = false;
  constructor(private store: JournalStore, private client: PlaybooksClient) {}
  run(): Promise<SyncState> {
    if (this.stopped || this.authorizationBlocked) return Promise.resolve({ connected: false, reason: this.authorizationBlocked ? 'Pairing expired or revoked; explicit re-pairing required.' : 'Synchronization stopped.' });
    return this.running ??= this.drain().finally(() => { this.running = undefined; });
  }
  private async drain(): Promise<SyncState> {
    try {
      while (!this.stopped) {
        const source = this.store.pendingSourceCommands()[0];
        if (source) {
          try {
            if (source.kind === 'revoke') await this.client.revokeSource(source.bindingId, { operationId: source.operationId, input: { grantRevision: source.grantRevision, removeExcerpts: true } });
            else await this.client.setSourceState(source.bindingId, { operationId: source.operationId, input: { grantRevision: source.grantRevision, state: 'paused' } });
          } catch (error) {
            // Deletion or a prior revoke already satisfies withdrawal. Require the
            // validated API code as well as status; router/conflict errors stay pending.
            const withdrawn = error instanceof ClientError && (error.status === 404 && error.apiCode === 'not_found' || error.status === 409 && error.apiCode === 'source_revoked');
            if (!withdrawn) throw error;
          }
          await this.store.acknowledgeSourceCommand(source.id); continue;
        }
        const upload = (await this.store.pendingUploads(1))[0];
        if (!upload) break;
        const binding = this.store.binding(upload.bindingId)?.binding;
        if (!binding || !this.store.isFollowing(upload.bindingId) || binding.grantRevision !== upload.grantRevision || binding.exportPolicy === 'off') break;
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
