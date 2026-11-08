import { randomUUID, createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import * as c from '@living-playbooks/contracts';
import { transaction } from '../../db/transaction';
import { reject } from '../../domain/errors';
import { isPhone, phoneAuthority, reauthorizeJob, type JobAuthority, type PhoneAuthority } from './authority';
import { requireSendblue, type SendblueConfig } from './config';
import { messageOperation } from './payload';

const notificationSchema = z.object({ operationId: c.IdSchema, ownerId: c.IdSchema, projectId: c.IdSchema,
  kind: z.enum(['t3_question', 't3_permission_notice']), requestKey: z.string().min(1).max(256),
  text: c.boundedText(1600, true), expiresAt: c.TimestampSchema }).strict();
export type PhoneNotification = z.infer<typeof notificationSchema>;
// Trusted in-process port only. T3 owns correlation and response APIs; this only queues a notice.
export type NotificationEnqueue = (notice: PhoneNotification) => Promise<{ id: string }>;

async function intent(db: PoolClient, authority: PhoneAuthority, input: {
  operationId: string; kind: string; requestKey?: string; inputMessageId?: string; messageId?: string; text: string; expiresAt: string; projectEpoch: number;
}) {
  const hash = createHash('sha256').update(c.canonicalJson({ ...input, operationId: undefined, ownerId: authority.ownerId, projectId: authority.projectId, linkId: authority.linkId })).digest('hex');
  const previous = (await db.query('SELECT * FROM sendblue_outbox WHERE operation_id=$1 OR (link_id=$2 AND kind=$3 AND request_key=$4) OR (link_id=$2 AND input_message_id=$5)', [input.operationId, authority.linkId, input.kind, input.requestKey ?? null, input.inputMessageId ?? null])).rows;
  if (previous.length) {
    if (previous.length !== 1 || previous[0].request_hash !== hash) reject(409, 'sendblue_intent_conflict', 'Notification identity conflicts with existing state.');
    return { id: previous[0].id as string };
  }
  const id = randomUUID();
  await db.query('INSERT INTO sendblue_outbox(id,operation_id,request_hash,link_id,authority,owner_id,project_id,account,kind,request_key,input_message_id,message_id,text,expires_at,project_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
    [id, input.operationId, hash, authority.linkId, authority, authority.ownerId, authority.projectId, authority.account, input.kind, input.requestKey ?? null, input.inputMessageId ?? null, input.messageId ?? null, input.text, input.expiresAt, input.projectEpoch]);
  return { id };
}

export async function enqueueManagerReply(db: PoolClient, project: c.Project, job: c.ManagerJob, authority: JobAuthority, message: c.ChatMessage, now: () => Date, config: SendblueConfig) {
  if (!isPhone(authority)) return;
  await reauthorizeJob(db, authority, now, project.id, 'reply', config);
  const receipt = (await db.query('SELECT * FROM sendblue_receipts WHERE link_id=$1 AND owner_message_id=$2 AND NOT outbound', [authority.linkId, job.inputMessageId])).rows[0];
  if (!receipt || !job.inputMessageId) reject(409, 'sendblue_lineage', 'Phone reply correlation is unavailable.');
  // Send a bounded canonical reply, never the transcript or source/tool payloads.
  let text = '';
  for (const char of message.text) { if (Buffer.byteLength(text + char) > 1600) break; text += char; }
  const row = (await db.query('SELECT * FROM sendblue_links WHERE id=$1 FOR UPDATE', [authority.linkId])).rows[0];
  await intent(db, authority, { operationId: messageOperation('sendblue-reply', `${authority.linkId}:${job.inputMessageId}`), kind: 'manager_reply', inputMessageId: job.inputMessageId,
    messageId: message.id, text, projectEpoch: project.epoch, expiresAt: new Date(Math.min(new Date(row.expires_at).getTime(), now().getTime() + 86400000)).toISOString() });
}

export async function enqueueNotification(pool: Pool, config: SendblueConfig, raw: PhoneNotification, now: () => Date = () => new Date()) {
  const notice = notificationSchema.parse(raw);
  requireSendblue(config);
  return transaction(pool, async db => {
    await db.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [notice.ownerId]);
    const project = (await db.query('SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [notice.projectId, notice.ownerId])).rows[0];
    if (!project || project.deleted || project.data.status !== 'active') reject(403, 'phone_authority', 'Phone authorization is unavailable.');
    const row = (await db.query('SELECT * FROM sendblue_links WHERE owner_id=$1 AND project_id=$2 AND active FOR UPDATE', [notice.ownerId, notice.projectId])).rows[0];
    if (!row) reject(403, 'phone_authority', 'Phone authorization is unavailable.');
    const authority = phoneAuthority(row);
    await reauthorizeJob(db, authority, now, notice.projectId, 'notify', config);
    if (new Date(notice.expiresAt) <= now() || new Date(notice.expiresAt).getTime() > Math.min(new Date(row.expires_at).getTime(), now().getTime() + 86400000))
      reject(422, 'phone_expiry', 'Notification expiry is unavailable.');
    return intent(db, authority, { ...notice, projectEpoch: project.data.epoch });
  });
}
