import type { PoolClient } from 'pg';
import { reauthorize, type Principal } from '../../auth/credentials';
import { reject } from '../../domain/errors';
import { capability, type SendblueConfig } from './config';

export type PhoneAction = 'message' | 'manager' | 'reply' | 'notify';
export type PhoneAuthority = {
  kind: 'sendblue'; linkId: string; linkRevision: number; ownerId: string; projectId: string;
  account: string; line: string; sender: string;
};
export type JobAuthority = Principal | PhoneAuthority;
export const isPhone = (authority: JobAuthority): authority is PhoneAuthority => 'kind' in authority && authority.kind === 'sendblue';
export const actorId = (authority: JobAuthority) => isPhone(authority) ? authority.linkId : authority.deviceId;
export function phoneAuthority(row: any): PhoneAuthority {
  return { kind: 'sendblue', linkId: row.id, linkRevision: row.revision, ownerId: row.owner_id, projectId: row.project_id,
    account: row.account, line: row.receiving_line, sender: row.sender };
}
export async function reauthorizeJob(db: PoolClient, authority: JobAuthority, now: () => Date, projectId: string | null, action: PhoneAction, config: SendblueConfig) {
  if (!isPhone(authority)) { await reauthorize(db, authority, now()); return; }
  // All phone paths lock owner, then project/link. Revoke serializes with the final transport guard.
  await db.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [authority.ownerId]);
  const row = (await db.query('SELECT * FROM sendblue_links WHERE id=$1 FOR UPDATE', [authority.linkId])).rows[0];
  if (!row || !row.active || new Date(row.expires_at) <= now() || row.revision !== authority.linkRevision ||
    row.owner_id !== authority.ownerId || row.project_id !== projectId || authority.projectId !== projectId ||
    row.account !== authority.account || row.receiving_line !== authority.line || row.sender !== authority.sender ||
    !row.actions.includes(action) || !capability(config).available || row.account !== config.account || row.receiving_line !== config.line)
    reject(403, 'phone_authority', 'Phone authorization is unavailable.');
}
export async function disableLink(db: PoolClient, linkId: string) {
  await db.query('UPDATE sendblue_links SET active=false,revision=revision+1 WHERE id=$1', [linkId]);
  await db.query("UPDATE jobs SET state='cancelled',generation=generation+1,lease_expires_at=NULL,data=data || jsonb_build_object('state','cancelled','leaseGeneration',generation+1,'leaseExpiresAt',NULL) WHERE authority->>'kind'='sendblue' AND authority->>'linkId'=$1 AND state IN ('queued','running')", [linkId]);
  await db.query("UPDATE sendblue_outbox SET state=CASE WHEN state='sending' THEN 'uncertain' ELSE 'cancelled' END,generation=generation+1,lease_expires_at=NULL WHERE link_id=$1 AND state IN ('pending','leased','sending')", [linkId]);
}
