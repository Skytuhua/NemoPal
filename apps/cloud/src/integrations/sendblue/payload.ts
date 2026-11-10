import { createHash } from 'node:crypto';
import { z } from 'zod';
import { boundedText, canonicalJson } from '@living-playbooks/contracts';
import { reject } from '../../domain/errors';
import { phoneNumber, type SendblueConfig } from './config';

const statuses = ['RECEIVED', 'REGISTERED', 'PENDING', 'QUEUED', 'ACCEPTED', 'SENT', 'DELIVERED', 'ERROR', 'DECLINED'] as const;
const replyReference = z.object({ message_handle: z.string().min(1).max(256), part: z.string().max(256).optional(), part_index: z.number().int().min(0).max(50).optional() }).strict();
const schema = z.object({ accountEmail: z.string().min(1).max(254), message_handle: z.string().min(1).max(256),
  from_number: z.string().regex(phoneNumber), to_number: z.string().regex(phoneNumber),
  sendblue_number: z.string().nullable().optional(), number: z.string().optional(),
  content: boundedText(4096, true), is_outbound: z.boolean(), status: z.enum(statuses), message_type: z.literal('message'),
  group_id: z.union([z.literal(''), z.null()]).optional(), media_url: z.union([z.literal(''), z.null()]).optional(),
  participants: z.array(z.string().max(32)).max(2).optional(), is_reaction: z.literal(false).optional(),
  opted_out: z.boolean().optional(), service: z.enum(['iMessage', 'SMS', 'RCS']).nullable().optional(),
  reply_to: replyReference.optional(), thread_originator: replyReference.optional(),
});
export type SendblueMessage = z.infer<typeof schema>;
export function parseMessage(body: unknown, config: SendblueConfig) {
  if (body && typeof body === 'object' && Object.entries(body).some(([key, value]) => value !== null && typeof value === 'object' && !['participants', 'reply_to', 'thread_originator'].includes(key)))
    reject(422, 'sendblue_payload', 'Unsupported message.');
  const message = schema.parse(body);
  const line = message.is_outbound ? message.from_number : message.to_number;
  const sender = message.is_outbound ? message.to_number : message.from_number;
  if (message.accountEmail !== config.account || line !== config.line || message.sendblue_number && message.sendblue_number !== line)
    reject(403, 'sendblue_scope', 'Message scope is unavailable.');
  if (message.number && message.number !== sender || message.participants?.some(value => value !== sender && value !== line))
    reject(422, 'sendblue_payload', 'Unsupported message.');
  if (!message.is_outbound && message.status !== 'RECEIVED' || message.is_outbound && message.status === 'RECEIVED')
    reject(422, 'sendblue_payload', 'Unsupported message transition.');
  const hash = createHash('sha256').update(canonicalJson({ account: message.accountEmail, handle: message.message_handle,
    from: message.from_number, to: message.to_number, content: message.content, outbound: message.is_outbound,
    status: message.status, type: message.message_type, optedOut: message.opted_out === true })).digest('hex');
  return { message, hash, sender };
}
export function messageOperation(account: string, handle: string) {
  const bytes = createHash('sha256').update(JSON.stringify(['sendblue', account, handle])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 0x40; bytes[8] = (bytes[8]! & 63) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
