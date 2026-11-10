import { createHash } from 'node:crypto';
import { z } from 'zod';

export type T3ErrorCode = 'invalid_contract' | 'invalid_configuration' | 'capability_unavailable' | 'revoked' | 'cancelled' | 'unavailable' | 'wrong_owner' | 'stale_request' | 'expired' | 'replay' | 'conflict' | 'permission_unsupported' | 'pending';
export class T3Error extends Error {
  constructor(readonly code: T3ErrorCode, readonly notSent = false) { super(code); this.name = 'T3Error'; }
}
export const id = z.string().min(1).max(200).regex(/^[\w.:-]+$/);
const revision = z.number().int().positive();
export const contextSchema = z.object({
  grant: z.object({ bindingId: id, ownerId: id, deviceId: id, environmentId: id, projectId: id, t3ProjectId: id, threadId: id,
    revision, expiresAt: z.number().int().positive(), revoked: z.boolean(), startPosition: z.number().int().nonnegative() }).strict(),
  mapping: z.object({ ownerId: id, projectId: id, taskId: id, taskRevision: z.number().int().nonnegative().safe(), mappingRevision: revision, grantRevision: revision, runId: id, runOrdinal: revision }).strict(),
  completionPolicy: z.object({ enabled: z.boolean(), revision, criterionId: id }).strict(),
}).strict();
export type T3Context = z.infer<typeof contextSchema>;
export type T3Authority = () => Promise<T3Context>;
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new T3Error('invalid_contract');
  return result.data;
}
export function digest(input: unknown): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
export function cancelled(signal: AbortSignal) { if (signal.aborted) throw new T3Error('cancelled'); }
export async function sanitized<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { throw error instanceof T3Error ? error : new T3Error('unavailable'); }
}
export async function deadline<T>(operation: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, timeoutMs = 5000): Promise<T> {
  cancelled(signal);
  const controller = new AbortController();
  const relay = () => controller.abort();
  signal.addEventListener('abort', relay, { once: true });
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new T3Error(signal.aborted ? 'cancelled' : 'unavailable'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await Promise.race([operation(controller.signal), aborted]); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', relay); controller.signal.removeEventListener('abort', onAbort); }
}
export async function authorized(expected: T3Context, authority: T3Authority, now: () => number, signal: AbortSignal): Promise<T3Context> {
  cancelled(signal);
  expected = parse(contextSchema, expected);
  const current = parse(contextSchema, await sanitized(authority));
  cancelled(signal);
  if (current.grant.revoked || current.grant.expiresAt <= now() ||
      JSON.stringify(current.grant) !== JSON.stringify(expected.grant) || JSON.stringify(current.mapping) !== JSON.stringify(expected.mapping) ||
      current.mapping.grantRevision !== current.grant.revision || current.mapping.ownerId !== current.grant.ownerId || current.mapping.projectId !== current.grant.projectId)
    throw new T3Error('revoked');
  return current;
}

export const statusSchema = z.enum(['idle', 'preparing', 'queued', 'starting', 'pending', 'running', 'waiting', 'completed', 'interrupted', 'failed', 'cancelled', 'rolled_back']);
export const itemSchema = z.object({ itemId: id, position: z.number().int().nonnegative(), runId: id.nullable(), sourceThreadId: id,
  visibility: z.enum(['local', 'inherited', 'synthetic']), status: statusSchema, updatedAt: z.iso.datetime() });
export const pageSchema = z.object({
  thread: z.object({ threadId: id, projectId: id, activeRunId: id.nullable(), latestRunId: id.nullable(), status: statusSchema, updatedAt: z.iso.datetime() }),
  recentRuns: z.array(z.object({ runId: id, ordinal: revision, status: statusSchema })).max(10),
  items: z.array(itemSchema).max(25), nextPosition: z.number().int().nonnegative().nullable(), hasMore: z.boolean(),
});
export type T3Page = z.infer<typeof pageSchema>;
export const questionSchema = z.object({ id, header: z.string().max(500), question: z.string().max(16000),
  options: z.array(z.object({ label: z.string().min(1).max(1000), description: z.string().max(4000), value: z.string().max(1000).optional() })).max(30),
  multiSelect: z.boolean().optional(), allowCustomAnswer: z.boolean().optional(), required: z.boolean().optional(), initialAnswer: z.string().max(16000).optional(),
});
export const pendingSchema = z.object({ requestId: id, questions: z.array(questionSchema).min(1).max(20) });
export type T3Question = z.infer<typeof pendingSchema>;
export type Answers = Record<string, string | string[]>;
export function answersFor(question: T3Question, input: unknown): Answers {
  const answers = parse(z.record(id, z.union([z.string().max(16000), z.array(z.string().max(16000)).max(30)])), input);
  if (JSON.stringify(answers).length > 32000 || Object.keys(answers).some(key => !question.questions.some(q => q.id === key))) throw new T3Error('invalid_contract');
  for (const q of question.questions) {
    const answer = answers[q.id];
    if (answer === undefined) { if (q.required !== false) throw new T3Error('invalid_contract'); continue; }
    const values = typeof answer === 'string' ? [answer] : answer;
    if ((!q.multiSelect && values.length !== 1) || (q.required !== false && !values.length) || new Set(values).size !== values.length || values.some(value => !value.trim())) throw new T3Error('invalid_contract');
    if (q.allowCustomAnswer !== true && values.some(value => !q.options.some(option => value === (option.value ?? option.label)))) throw new T3Error('invalid_contract');
  }
  return Object.fromEntries(Object.entries(answers).sort(([a], [b]) => a.localeCompare(b)));
}
