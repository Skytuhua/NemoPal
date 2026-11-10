import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { Principal } from '../../auth/credentials';
import { CanonicalT3Store, enrollmentSchema } from './canonical-store';
import { localEndpoint } from './client/boundary';
import { id, T3Error } from './model';
import type { T3Context } from './model';
import { T3Service, type T3Selection } from './service';

const startSchema = z.strictObject({ projectId: id, bindingId: id, endpoint: z.string().max(100), enrollment: enrollmentSchema });
type Store = Pick<CanonicalT3Store, 'enroll' | 'load'>;
type Service = Pick<T3Service, 'start' | 'stop' | 'status' | 'activity'>;
type Gate = { claim(): Promise<() => Promise<void>> };
type Active = { principal: Principal; selection: T3Selection; store: Store; service: Service; stopping: boolean; enrolled: boolean;
  context?: T3Context; authorizationUrl?: string; error?: string; release?: () => Promise<void>; starting?: Promise<void>; closing?: Promise<void>; started?: boolean };

/** A durable, fail-closed fence. A crash or uncertain close requires operator reconciliation. */
export function postgresT3Gate(pool: Pool): Gate {
  return { async claim() {
    const token = randomUUID();
    await pool.query('INSERT INTO t3_host_fence(singleton, token) VALUES(true, $1)', [token]);
    return async () => { const result = await pool.query('DELETE FROM t3_host_fence WHERE singleton=true AND token=$1', [token]); if (result.rowCount !== 1) throw new T3Error('unavailable'); };
  } };
}

/** One host instance, selected by an authenticated owner; never starts automatically. */
export class T3Host {
  private active?: Active;
  constructor(private readonly options: { gate: Gate; makeStore(principal: Principal): Store; makeService(store: Store): Service }) {}
  start(principal: Principal, input: unknown): void {
    const value = startSchema.parse(input);
    localEndpoint(value.endpoint);
    if (this.active) throw new T3Error('conflict');
    const selection = { ownerId: principal.ownerId, deviceId: principal.deviceId, projectId: value.projectId, bindingId: value.bindingId };
    const store = this.options.makeStore(principal);
    const active: Active = { principal: { ...principal }, selection, store, service: this.options.makeService(store), stopping: false, enrolled: false };
    this.active = active;
    active.starting = (async () => {
      try {
        active.release = await this.options.gate.claim();
        if (active.stopping) return;
        active.context = await store.enroll(selection, value.enrollment);
        active.enrolled = true;
        if (active.stopping) return;
        await active.service.start(selection, { endpoint: value.endpoint, onAuthorization: url => { if (!active.stopping) active.authorizationUrl = url; } });
        active.started = true;
        active.authorizationUrl = undefined;
      } catch { active.authorizationUrl = undefined; active.error = 'unavailable'; }
    })();
  }
  private owned(principal: Principal): Active {
    const active = this.active;
    if (!active || active.principal.credentialId !== principal.credentialId || active.principal.ownerId !== principal.ownerId || active.principal.deviceId !== principal.deviceId) throw new T3Error('wrong_owner');
    return active;
  }
  async view(principal: Principal) {
    const active = this.owned(principal);
    if (active.stopping) return { status: 'stopping' };
    if (active.enrolled) {
      const { context } = await active.store.load(active.selection);
      if (JSON.stringify(context) !== JSON.stringify(active.context)) throw new T3Error('revoked');
    }
    if (active !== this.active || active.stopping) throw new T3Error('revoked');
    const activity = active.service.activity();
    return { status: active.error ? 'unavailable' : active.started ? active.service.status() : 'starting', ...(active.authorizationUrl ? { authorizationUrl: active.authorizationUrl } : {}),
      ...(active.context ? { selection: { projectId: active.selection.projectId, bindingId: active.selection.bindingId, taskId: active.context.mapping.taskId, environmentId: active.context.grant.environmentId, t3ProjectId: active.context.grant.t3ProjectId, threadId: active.context.grant.threadId, runId: active.context.mapping.runId, runOrdinal: active.context.mapping.runOrdinal } } : {}),
      ...(activity ? { activity } : {}), questionResponse: 'open_in_t3', permissionApproval: 'open_in_t3' };
  }
  async stop(principal: Principal) { await this.close(this.owned(principal)); }
  async shutdown() { if (this.active) await this.close(this.active); }
  private close(active: Active): Promise<void> {
    if (active.closing) return active.closing;
    active.stopping = true; active.authorizationUrl = undefined;
    active.closing = (async () => {
      // Stop an in-progress OAuth flow before waiting for its start to settle.
      await active.service.stop();
      await active.starting;
      await active.service.stop();
      if (['pending', 'stopping', 'cleanup_unconfirmed'].includes(active.service.status())) throw new T3Error('unavailable');
      if (active.release) await active.release();
      if (this.active === active) this.active = undefined;
    })();
    return active.closing;
  }
}

export function createT3Host(pool: Pool, now?: () => Date) {
  return new T3Host({ gate: postgresT3Gate(pool), makeStore: principal => new CanonicalT3Store(pool, principal, now),
    makeService: store => new T3Service({ enabled: true, store: store as CanonicalT3Store }) });
}
