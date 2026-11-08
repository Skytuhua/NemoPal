import { openLocalT3Session, type LocalT3Session, type LocalT3SessionOptions } from './client';
import { authorized, contextSchema, parse, T3Error, type T3Context } from './model';
import { T3Observer, type T3Observation } from './observer';
import { T3Adapter } from './protocol';

export type T3Selection = { ownerId: string; deviceId: string; projectId: string; bindingId: string };
/** The implementation must read canonical owner/device/source consent and mapping on every load.
 * commitIfCurrent and revoke must serialize with canonical grant, project and mapping mutations;
 * revoke must remove any retained checkpoint. A cache or caller-supplied context is not authority. */
export interface T3ServiceStore {
  load(selection: T3Selection): Promise<{ context: T3Context; checkpoint?: T3Observation }>;
  commitIfCurrent(expected: T3Context, observation: T3Observation): Promise<boolean>;
  revoke(selection: T3Selection, expected: T3Context): Promise<void>;
}
type OpenSession = (options: LocalT3SessionOptions) => Promise<LocalT3Session>;
type Options = { enabled?: boolean; store: T3ServiceStore; openSession?: OpenSession; now?: () => number; intervalMs?: number };
type Connection = Pick<LocalT3SessionOptions, 'endpoint' | 'onAuthorization' | 'signInTimeoutMs' | 'requestTimeoutMs' | 'sessionTimeoutMs'>;
type Active = { context: T3Context; selection: T3Selection; stop: AbortController; session?: LocalT3Session; observer?: T3Observer; timer?: ReturnType<typeof setTimeout>; polling?: Promise<T3Observation | undefined>; closing?: Promise<void> };

/** Explicitly started, single-binding lifecycle. This module registers no route and starts no network listener. */
export class T3Service {
  private active?: Active;
  private revoking = false;
  private stopping = false;
  private readonly now: () => number;
  private readonly openSession: OpenSession;
  private readonly intervalMs: number;
  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now;
    this.openSession = options.openSession ?? openLocalT3Session;
    this.intervalMs = options.intervalMs ?? 5000;
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs < 1000 || this.intervalMs > 60000) throw new T3Error('invalid_configuration');
  }
  private async authority(selection: T3Selection): Promise<T3Context> {
    const { context } = await this.options.store.load(selection);
    const value = parse(contextSchema, context);
    if (Object.entries(selection).some(([key, expected]) => value.grant[key as keyof T3Context['grant']] !== expected)) throw new T3Error('revoked');
    return value;
  }
  async start(selection: T3Selection, connection: Connection): Promise<void> {
    if (!this.options.enabled) throw new T3Error('capability_unavailable');
    if (this.active || this.revoking || this.stopping) throw new T3Error('conflict');
    const active: Active = { selection: { ...selection }, context: undefined as unknown as T3Context, stop: new AbortController() };
    this.active = active;
    try {
      const loaded = await this.options.store.load(active.selection);
      const context = parse(contextSchema, loaded.context);
      active.context = context;
      await authorized(context, () => this.authority(active.selection), this.now, active.stop.signal);
      const session = await this.openSession({ ...connection, environmentId: context.grant.environmentId, threadId: context.grant.threadId, signal: active.stop.signal });
      if (active.stop.signal.aborted || this.active !== active) {
        await session.close();
        throw new T3Error('cancelled');
      }
      active.session = session;
      await authorized(context, () => this.authority(active.selection), this.now, active.stop.signal);
      const adapter = new T3Adapter(active.session, () => this.authority(active.selection), this.now);
      if (!adapter.capabilities().observation) throw new T3Error('capability_unavailable');
      active.observer = new T3Observer(context, adapter, this.now, loaded.checkpoint);
      if (this.active !== active || active.stop.signal.aborted) throw new T3Error('cancelled');
      this.schedule(active);
    } catch (error) {
      await this.close(active);
      throw error instanceof T3Error ? error : new T3Error('unavailable');
    }
  }
  private schedule(active: Active) {
    if (this.active !== active || active.stop.signal.aborted) return;
    active.timer = setTimeout(() => { active.timer = undefined; void this.poll().catch(() => {}).finally(() => this.schedule(active)); }, this.intervalMs);
  }
  async poll(): Promise<T3Observation | undefined> {
    const active = this.active;
    if (!active?.observer || active.stop.signal.aborted) return undefined;
    if (active.polling) return active.polling;
    active.polling = (async () => {
      const observation = await active.observer!.poll(active.stop.signal);
      if (active.stop.signal.aborted || this.active !== active) return undefined;
      if (observation.mode === 'revoked') { await this.close(active); return undefined; }
      if (observation.mode !== 'current' && observation.mode !== 'unmapped') return observation;
      // This must be one atomic authority check plus write, not a check followed by a write.
      let committed: boolean;
      try { committed = await this.options.store.commitIfCurrent(active.context, observation); }
      catch { await this.close(active); throw new T3Error('unavailable'); }
      if (!committed) { await this.close(active); return undefined; }
      if (active.stop.signal.aborted || this.active !== active) return undefined;
      return observation;
    })();
    try { return await active.polling; } finally { active.polling = undefined; }
  }
  private close(active: Active): Promise<void> {
    if (active.closing) return active.closing;
    active.stop.abort(); active.observer?.cancel();
    if (active.timer) clearTimeout(active.timer);
    if (this.active === active) this.active = undefined;
    active.closing = (async () => { if (active.session) await active.session.close(); })();
    return active.closing;
  }
  async stop(): Promise<void> {
    const active = this.active;
    if (active) {
      this.stopping = true;
      try { await this.close(active); }
      finally { await active.polling?.catch(() => {}); this.stopping = false; }
    }
  }
  async revoke(): Promise<void> {
    const active = this.active;
    if (!active?.context) throw new T3Error('unavailable');
    // Fence local reads synchronously, then durably revoke even if session cleanup fails.
    this.revoking = true;
    const closing = this.close(active).then(() => undefined, () => new T3Error('unavailable'));
    try {
      await this.options.store.revoke(active.selection, active.context);
      const failure = await closing;
      await active.polling?.catch(() => {});
      if (failure) throw failure;
    } finally {
      await closing;
      await active.polling?.catch(() => {});
      this.revoking = false;
    }
  }
}
