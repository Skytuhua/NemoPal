import { openLocalT3Session, type LocalT3Session, type LocalT3SessionOptions } from './client';
import { T3ConnectionError } from './client/boundary';
import { authorized, contextSchema, parse, T3Error, type T3Context } from './model';
import { T3Observer, type T3Observation } from './observer';
import { T3Adapter } from './protocol';

export type T3Selection = { ownerId: string; deviceId: string; projectId: string; bindingId: string };
/** Canonical authority must be read on every load. Commit and revoke must serialize with
 * grant, project and mapping changes; revoke removes retained checkpoints. A timeout
 * does not cancel or roll back a store operation: its promise must settle only when its
 * outcome is known, including on rejection. An unknown database outcome must remain
 * pending until reconciled; rejection is not proof of rollback. Until settlement the
 * service fences all new starts. */
export interface T3ServiceStore {
  load(selection: T3Selection): Promise<{ context: T3Context; checkpoint?: T3Observation }>;
  commitIfCurrent(expected: T3Context, observation: T3Observation): Promise<boolean>;
  revoke(selection: T3Selection, expected: T3Context): Promise<void>;
}
type OpenSession = (options: LocalT3SessionOptions) => Promise<LocalT3Session>;
type Options = { enabled?: boolean; store: T3ServiceStore; openSession?: OpenSession; now?: () => number; intervalMs?: number; storeTimeoutMs?: number };
type Connection = Pick<LocalT3SessionOptions, 'endpoint' | 'onAuthorization' | 'signInTimeoutMs' | 'requestTimeoutMs' | 'sessionTimeoutMs'>;
type Active = { context?: T3Context; selection: T3Selection; stop: AbortController; session?: LocalT3Session; observer?: T3Observer;
  timer?: ReturnType<typeof setTimeout>; starting?: Promise<void>; polling?: Promise<T3Observation | undefined>; closing?: Promise<void>;
  operations: Set<Promise<unknown>>; opening: boolean; inCall: boolean; stopping: boolean; pending: boolean; openFailure?: T3ConnectionError };

/** Explicitly started, single-binding lifecycle. This module registers no route or listener. */
export class T3Service {
  private active?: Active;
  private cleanupUnconfirmed = false;
  private terminalSession = false;
  private readonly now: () => number;
  private readonly openSession: OpenSession;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now;
    this.openSession = options.openSession ?? openLocalT3Session;
    this.intervalMs = options.intervalMs ?? 5000;
    this.timeoutMs = options.storeTimeoutMs ?? 5000;
    if (!Number.isSafeInteger(this.intervalMs) || this.intervalMs < 1000 || this.intervalMs > 60000 ||
        !Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 60000) throw new T3Error('invalid_configuration');
  }
  /** A pending fence is distinct from an unconfirmed remote close. */
  status(): 'idle' | 'active' | 'stopping' | 'pending' | 'session_ended' | 'cleanup_unconfirmed' {
    return this.active ? (this.active.pending ? 'pending' : this.active.stopping ? 'stopping' : 'active') : (this.cleanupUnconfirmed ? 'cleanup_unconfirmed' : this.terminalSession ? 'session_ended' : 'idle');
  }
  sessionEnded(): boolean { return this.terminalSession; }
  private bounded<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new T3Error('pending')), this.timeoutMs); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
  private track<T>(active: Active, operation: () => Promise<T>): Promise<T> {
    const pending = Promise.resolve().then(operation);
    active.operations.add(pending);
    void pending.then(() => active.operations.delete(pending), () => active.operations.delete(pending));
    return pending;
  }
  private store<T>(active: Active, operation: () => Promise<T>): Promise<T> {
    const pending = this.track(active, operation);
    return this.bounded(pending).catch(error => {
      if (error instanceof T3Error && error.code === 'pending') { active.pending = true; this.close(active); }
      throw error;
    });
  }
  private async authority(active: Active): Promise<T3Context> {
    const { context } = await this.store(active, () => this.options.store.load(active.selection));
    const value = parse(contextSchema, context);
    if (Object.entries(active.selection).some(([key, expected]) => value.grant[key as keyof T3Context['grant']] !== expected)) throw new T3Error('revoked');
    return value;
  }
  async start(selection: T3Selection, connection: Connection): Promise<void> {
    if (!this.options.enabled) throw new T3Error('capability_unavailable');
    if (this.active) throw new T3Error('conflict');
    const active: Active = { selection: { ...selection }, stop: new AbortController(), operations: new Set(), opening: false, inCall: false, stopping: false, pending: false };
    this.active = active;
    this.terminalSession = false;
    const starting = (async () => {
      const loaded = await this.store(active, () => this.options.store.load(active.selection));
      const context = parse(contextSchema, loaded.context); active.context = context;
      await authorized(context, () => this.authority(active), this.now, active.stop.signal);
      if (active.stopping) throw new T3Error('cancelled');
      active.opening = true;
      try { active.session = await this.openSession({ ...connection, environmentId: context.grant.environmentId, threadId: context.grant.threadId, signal: active.stop.signal }); }
      catch (error) { if (error instanceof T3ConnectionError && error.delivery === 'uncertain') active.openFailure = error; throw error; }
      finally { active.opening = false; }
      if (active.stopping) throw new T3Error('cancelled');
      await authorized(context, () => this.authority(active), this.now, active.stop.signal);
      const session = active.session;
      const adapter = new T3Adapter({ ...session, callTool: async (...args) => {
        active.inCall = true;
        try { return await this.track(active, () => session.callTool(...args)); } finally { active.inCall = false; }
      } }, () => this.authority(active), this.now, Math.max(5000, this.timeoutMs + 1000));
      if (!adapter.capabilities().observation) throw new T3Error('capability_unavailable');
      active.observer = new T3Observer(context, adapter, this.now, loaded.checkpoint);
      if (active.stopping) throw new T3Error('cancelled');
      this.schedule(active);
    })();
    active.starting = starting;
    try { await starting; }
    catch (error) {
      this.close(active);
      throw error instanceof T3Error ? error : new T3Error('unavailable');
    } finally { active.starting = undefined; }
  }
  private schedule(active: Active) {
    if (this.active !== active || active.stopping) return;
    active.timer = setTimeout(() => { active.timer = undefined; void this.poll().catch(() => {}).finally(() => this.schedule(active)); }, this.intervalMs);
  }
  async poll(): Promise<T3Observation | undefined> {
    const active = this.active;
    if (!active?.observer || active.stopping) return undefined;
    if (active.polling) return active.polling;
    const polling = (async () => {
      const observation = await active.observer!.poll(active.stop.signal);
      // The adapter deadline may abandon an authority or connector read. Keep
      // it fenced even when the observer converted the error to offline.
      if (active.operations.size) { active.pending = true; this.close(active); }
      if (active.pending) throw new T3Error('pending');
      if (active.stopping) return undefined;
      if (active.session?.closed) {
        this.terminalSession = true;
        this.close(active);
        return { ...observation, mode: 'session_ended' as const, label: 'T3 session ended; restart to reconnect' };
      }
      if (observation.mode === 'revoked') { this.close(active); return undefined; }
      if (observation.mode !== 'current' && observation.mode !== 'unmapped') return observation;
      let committed: boolean;
      try { committed = await this.store(active, () => this.options.store.commitIfCurrent(active.context!, observation)); }
      catch (error) { this.close(active); throw error instanceof T3Error ? error : new T3Error('unavailable'); }
      if (!committed) { this.close(active); return undefined; }
      if (active.stopping) return undefined;
      return observation;
    })();
    active.polling = polling;
    try { return await polling; }
    finally { active.polling = undefined; }
  }
  private close(active: Active): Promise<void> {
    if (active.closing) return active.closing;
    active.stopping = true;
    if (active.timer) clearTimeout(active.timer);
    // Aborting a live connector makes remote closure uncertain. Leave an idle one
    // intact so its close can issue MCP DELETE; abort only a held open or call.
    if (active.opening || active.inCall) active.stop.abort();
    active.observer?.cancel();
    active.closing = (async () => {
      await Promise.resolve();
      await active.starting?.catch(() => {});
      await active.polling?.catch(() => {});
      while (active.operations.size) await Promise.allSettled([...active.operations]);
      try { if (active.openFailure) throw active.openFailure; await active.session?.close(); }
      catch (error) { this.cleanupUnconfirmed = true; throw error; }
      finally { if (this.active === active) this.active = undefined; }
    })();
    void active.closing.catch(() => {});
    return active.closing;
  }
  async stop(): Promise<void> {
    if (this.active) await this.bounded(this.close(this.active));
  }
  async revoke(): Promise<void> {
    const active = this.active;
    if (!active?.context || active.stopping) throw new T3Error('unavailable');
    // Start revocation before cleanup can release the fence; it serializes with commits.
    const revoke = this.store(active, () => this.options.store.revoke(active.selection, active.context!));
    const closing = this.close(active);
    const outcomes = await Promise.allSettled([revoke, this.bounded(closing)]);
    const failed = outcomes.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) throw failed.reason instanceof T3Error ? failed.reason : new T3Error('unavailable');
  }
}
