import type { Pool, PoolClient } from 'pg';
import { transaction } from '../db/transaction';
import { DomainError } from '../domain/errors';
import { reauthorizeJob, type PhoneAuthority } from '../integrations/sendblue/authority';
import { capability, sendblueConfig, type SendblueConfig } from '../integrations/sendblue/config';
import { beginSend, readAcceptance, type SendblueFetch } from '../integrations/sendblue/transport';
import { abortable } from '@living-playbooks/nemotron';

export type DeliveryLease = { id: string; owner_id: string; project_id: string; authority: PhoneAuthority; generation: number };
export class SendblueDelivery {
  constructor(public pool: Pool, public config: SendblueConfig = sendblueConfig(), public now: () => Date = () => new Date(), private fetcher: SendblueFetch = fetch) {}
  private async guarded(db: PoolClient, lease: DeliveryLease, expectedState: string) {
    await db.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [lease.owner_id]);
    const project = (await db.query('SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [lease.project_id, lease.owner_id])).rows[0];
    const row = (await db.query('SELECT * FROM sendblue_outbox WHERE id=$1 FOR UPDATE', [lease.id])).rows[0];
    if (!row || row.state !== expectedState || row.generation !== lease.generation) return null;
    try { await reauthorizeJob(db, row.authority, this.now, lease.project_id, row.kind === 'manager_reply' ? 'reply' : 'notify', this.config); }
    catch (error) { if (!(error instanceof DomainError)) throw error; await db.query("UPDATE sendblue_outbox SET state='cancelled',lease_expires_at=NULL WHERE id=$1", [lease.id]); return null; }
    if (!project || project.deleted || project.data.status !== 'active' || project.data.epoch !== Number(row.project_epoch) || new Date(row.expires_at) <= this.now() || !row.lease_expires_at || new Date(row.lease_expires_at) <= this.now() || !row.text) {
      await db.query("UPDATE sendblue_outbox SET state='cancelled',lease_expires_at=NULL WHERE id=$1", [lease.id]); return null;
    }
    return row;
  }
  async claim(): Promise<DeliveryLease | null> {
    if (!capability(this.config).available) return null;
    return transaction(this.pool, async db => {
      const candidate = (await db.query("SELECT id,owner_id,project_id FROM sendblue_outbox WHERE state='pending' OR state IN ('leased','sending') AND lease_expires_at<=$1 ORDER BY expires_at,id LIMIT 1", [this.now()])).rows[0];
      if (!candidate) return null;
      await db.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [candidate.owner_id]);
      const row = (await db.query('SELECT * FROM sendblue_outbox WHERE id=$1 FOR UPDATE SKIP LOCKED', [candidate.id])).rows[0];
      if (!row || !(row.state === 'pending' || ['leased','sending'].includes(row.state) && new Date(row.lease_expires_at) <= this.now())) return null;
      // A crash after the durable sending marker may have transmitted. Never replay it.
      if (row.state === 'sending') { await db.query("UPDATE sendblue_outbox SET state='uncertain',lease_expires_at=NULL WHERE id=$1", [row.id]); return null; }
      return (await db.query("UPDATE sendblue_outbox SET state='leased',generation=generation+1,lease_expires_at=$2 WHERE id=$1 RETURNING *", [row.id, new Date(this.now().getTime() + 30000)])).rows[0] as DeliveryLease;
    });
  }
  async deliver(lease: DeliveryLease, external: AbortSignal = new AbortController().signal) {
    if (!capability(this.config).available || external.aborted) return;
    const marked = await transaction(this.pool, async db => {
      const row = await this.guarded(db, lease, 'leased');
      if (!row || external.aborted) return false;
      await db.query("UPDATE sendblue_outbox SET state='sending',lease_expires_at=$2 WHERE id=$1", [lease.id, new Date(this.now().getTime() + 30000)]);
      return true;
    });
    if (!marked) return;
    // Persist sending first. A lost COMMIT/response remains conservatively uncertain after restart.
    const signal = AbortSignal.any([external, AbortSignal.timeout(10000)]);
    const started = await transaction(this.pool, async db => {
      const row = await this.guarded(db, lease, 'sending');
      if (!row) return null;
      if (signal.aborted) { await db.query("UPDATE sendblue_outbox SET state='cancelled',lease_expires_at=NULL WHERE id=$1", [lease.id]); return null; }
      // Linearize initiation with STOP/revoke; never hold database locks while awaiting the provider.
      const response = beginSend(this.config, row.authority.sender, row.text, this.fetcher, signal);
      void response.catch(() => {});
      return { response };
    });
    if (!started) return;
    let accepted: Awaited<ReturnType<typeof readAcceptance>> | null = null;
    try { accepted = await abortable(readAcceptance(await abortable(started.response, signal)), signal); }
    catch { /* Any possible transmission without a trustworthy response remains uncertain. */ }
    if (accepted)
      await this.pool.query("UPDATE sendblue_outbox SET provider_handle=$2,provider_status=$3,state=CASE WHEN state='sending' AND generation=$4 THEN 'accepted' ELSE state END,lease_expires_at=NULL WHERE id=$1", [lease.id, accepted.handle, accepted.status, lease.generation]);
    else
      await this.pool.query("UPDATE sendblue_outbox SET state='uncertain',lease_expires_at=NULL WHERE id=$1 AND state='sending' AND generation=$2", [lease.id, lease.generation]);
  }
  async tick(signal?: AbortSignal) { const lease = await this.claim(); if (lease) await this.deliver(lease, signal); }
}
export function startSendblueDispatcher(delivery: SendblueDelivery) {
  if (!capability(delivery.config).available) return async () => {};
  const controller = new AbortController(); let active: Promise<void> | null = null;
  const tick = () => { if (active || controller.signal.aborted) return; active = delivery.tick(controller.signal).catch(() => {}).finally(() => { active = null; }); };
  const timer = setInterval(tick, 15000); tick();
  return async () => { clearInterval(timer); controller.abort(); await active; };
}
