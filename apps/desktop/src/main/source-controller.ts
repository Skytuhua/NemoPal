import type { CodexObserver } from '@living-playbooks/contracts';
import type { JournalStore } from './local-store';

export class SourceController {
  private active = new Map<string, { abort: AbortController; promise: Promise<void> }>();
  private stopped = false;
  constructor(private store: JournalStore, private observer: CodexObserver, private onBlock: (id: string, reason: string) => void = () => {}) {}
  poll(id: string): Promise<void> {
    const current = this.active.get(id); if (current) return current.promise;
    const local = this.store.binding(id);
    if (this.stopped || !local || !this.store.isFollowing(id)) return Promise.resolve();
    const abort = new AbortController();
    const promise = (async () => {
      try {
        const cursor = this.store.cursor(id); const batch = await this.observer.readDelta(local, cursor, abort.signal);
        if (!abort.signal.aborted && this.store.isFollowing(id)) await this.store.commitObservationBatch(id, cursor, batch);
      } catch (error) {
        if (!abort.signal.aborted) { await this.store.blockBinding(id).catch(() => {}); this.onBlock(id, error instanceof Error && /spool/.test(error.message) ? 'Local spool full; source cursor retained.' : 'Source read or durability blocked; cursor retained. Revalidate selected source.'); }
      } finally { this.active.delete(id); }
    })();
    this.active.set(id, { abort, promise }); return promise;
  }
  async pause(id: string): Promise<void> { this.store.fence(id); this.active.get(id)?.abort.abort(); const saved = this.store.pauseBinding(id); await this.observer.stop(id); await saved; }
  async revoke(id: string): Promise<void> { this.store.fence(id); this.active.get(id)?.abort.abort(); const local = this.store.binding(id); if (!local) throw Error('Unknown source binding'); const saved = this.store.revokeBinding(id, local.binding.grantRevision); await this.observer.stop(id); await saved; }
  async stop(): Promise<void> { this.stopped = true; const runs = [...this.active.values()]; for (const run of runs) run.abort.abort(); for (const local of this.store.bindings()) await this.observer.stop(local.binding.id); await Promise.all(runs.map(run => run.promise)); }
}
