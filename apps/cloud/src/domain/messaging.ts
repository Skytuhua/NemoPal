import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as c from '@living-playbooks/contracts';
import type { Principal } from '../auth/credentials';
import { Store, appendOwnerMessage, saveProject } from './store';
import { reject, revision } from './errors';
import { phoneNumber, requireSendblue } from '../integrations/sendblue/config';
import { disableLink, phoneAuthority } from '../integrations/sendblue/authority';
import { parseMessage, messageOperation } from '../integrations/sendblue/payload';

export const LinkInput = z.object({ sender: z.string().regex(phoneNumber), expiresAt: c.TimestampSchema, notifications: z.boolean().default(false) }).strict();
export class Messaging {
  constructor(public store: Store) {}
  async link(principal: Principal, path: string, projectId: string, envelope: c.RevisionedCommandEnvelope<z.infer<typeof LinkInput>>) {
    requireSendblue(this.store.phoneConfig);
    return this.store.command(principal, path, envelope, projectId, async (db, project) => {
      revision(project!.revision, envelope.expectedRevision);
      const expires = new Date(envelope.input.expiresAt).getTime(), now = this.store.now().getTime();
      if (expires <= now || expires > now + 7 * 86400000) reject(422, 'phone_expiry', 'Phone authorization must expire within seven days.');
      const config = this.store.phoneConfig;
      const old = (await db.query('SELECT * FROM sendblue_links WHERE owner_id=$1 AND project_id=$2 AND active FOR UPDATE', [principal.ownerId, projectId])).rows;
      for (const row of old) await disableLink(db, row.id);
      const id = randomUUID(), actions = ['message', 'manager', 'reply', ...(envelope.input.notifications ? ['notify'] : [])];
      await db.query('INSERT INTO sendblue_links(id,owner_id,project_id,account,receiving_line,sender,actions,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, principal.ownerId, projectId, config.account, config.line, envelope.input.sender, actions, envelope.input.expiresAt]);
      await saveProject(db, project!, this.store.now());
      return { result: { id, revision: 0, expiresAt: envelope.input.expiresAt, actions }, kind: 'project_updated', resourceId: projectId };
    });
  }
  async revoke(principal: Principal, path: string, projectId: string, envelope: c.RevisionedCommandEnvelope<{ linkId: string }>) {
    return this.store.command(principal, path, envelope, projectId, async (db, project) => {
      revision(project!.revision, envelope.expectedRevision);
      const row = (await db.query('SELECT * FROM sendblue_links WHERE id=$1 FOR UPDATE', [envelope.input.linkId])).rows[0];
      if (!row || row.owner_id !== principal.ownerId || row.project_id !== projectId) reject(404, 'not_found', 'Phone link is unavailable.');
      if (row.active) await disableLink(db, row.id);
      await saveProject(db, project!, this.store.now());
      return { result: null, kind: 'project_updated', resourceId: projectId };
    });
  }
  async accept(body: unknown) {
    const config = this.store.phoneConfig;
    requireSendblue(config);
    const { message, hash, sender } = parseMessage(body, config);
    const receiptArgs = [config.account, message.message_handle, message.is_outbound, message.status];
    const prior = (await this.store.pool.query('SELECT payload_hash FROM sendblue_receipts WHERE account=$1 AND handle=$2 AND outbound=$3 AND status=$4', receiptArgs)).rows[0];
    if (prior) {
      if (prior.payload_hash !== hash) reject(409, 'sendblue_conflict', 'Message identity conflicts with existing state.');
      return { accepted: true, duplicate: true };
    }
    const row = (await this.store.pool.query('SELECT * FROM sendblue_links WHERE account=$1 AND receiving_line=$2 AND sender=$3 AND active', [config.account, config.line, sender])).rows[0];
    if (!row) reject(403, 'sendblue_scope', 'Message scope is unavailable.');
    const authority = phoneAuthority(row);
    const operationId = messageOperation(config.account!, `${message.is_outbound}:${message.message_handle}:${message.status}`);
    await this.store.command(authority, '/webhooks/sendblue', { operationId, input: { hash } }, row.project_id, async (db, project) => {
      let ownerMessageId: string | null = null, jobId: string | null = null;
      if (message.is_outbound) {
        const intent = (await db.query('SELECT * FROM sendblue_outbox WHERE account=$1 AND provider_handle=$2 AND link_id=$3 FOR UPDATE', [config.account, message.message_handle, row.id])).rows[0];
        if (!intent) reject(422, 'sendblue_echo', 'Uncorrelated outbound message.');
        if (intent.text !== message.content) reject(409, 'sendblue_conflict', 'Message identity conflicts with existing state.');
        // Keep every transition receipt; delayed callbacks must never regress delivery.
        const rank: Record<string, number> = { REGISTERED: 0, PENDING: 1, QUEUED: 2, ACCEPTED: 3, SENT: 4, ERROR: 5, DECLINED: 5, DELIVERED: 6 };
        if ((rank[message.status] ?? -1) > (rank[intent.provider_status] ?? -1))
          await db.query('UPDATE sendblue_outbox SET provider_status=$2,state=$3 WHERE id=$1', [intent.id, message.status, message.status === 'DELIVERED' ? 'delivered' : ['ERROR','DECLINED'].includes(message.status) ? 'failed' : 'accepted']);
      } else if (message.content.trim().toUpperCase() === 'STOP' || message.opted_out) {
        await disableLink(db, row.id);
        await saveProject(db, project!, this.store.now());
      } else {
        const count = Number((await db.query('SELECT count(*) FROM sendblue_receipts WHERE link_id=$1 AND NOT outbound AND created_at>$2', [row.id, new Date(this.store.now().getTime() - 60000)])).rows[0].count);
        if (count >= 10) reject(429, 'sendblue_rate', 'Phone message rate limit reached.');
        const accepted = await appendOwnerMessage(db, project!, message.content, operationId, this.store.now(), authority);
        ownerMessageId = accepted.message.id; jobId = accepted.job;
      }
      await db.query('INSERT INTO sendblue_receipts(account,handle,outbound,status,payload_hash,link_id,owner_message_id,job_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [...receiptArgs, hash, row.id, ownerMessageId, jobId, this.store.now()]);
      return { result: null, kind: ownerMessageId ? 'message_added' : 'project_updated', resourceId: ownerMessageId ?? row.project_id, ...(jobId ? { acceptedJob: jobId } : {}) };
    });
    return { accepted: true, duplicate: false };
  }
}
