import { randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { answersFor, contextSchema, deadline, digest, id, parse, sanitized, T3Error, type T3Context, type T3Question } from './model';
import { bindingKey } from './observer';
import { T3Adapter } from './protocol';

export type NotificationInput = { operationId: string; ownerId: string; projectId: string; kind: 't3_question' | 't3_permission_notice'; requestKey: string; text: string; expiresAt: number };
/** Enqueue must durably deduplicate operationId and recheck link/owner opt-out at its own transport boundary. Acceptance is not delivery. */
export interface NotificationSink { enqueue(input: NotificationInput, signal: AbortSignal): Promise<{ state: 'accepted' }> }
export type QuestionResponse = { operationId: string; answerDigest: string; state: 'received' | 'sending' | 'accepted' | 'uncertain'; sequence?: number };
const runProofSchema = z.object({ proofId: id, kind: z.literal('question'), bindingKey: z.string().regex(/^[a-f0-9]{64}$/), requestId: id, runId: id,
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int().positive() }).strict();
export type QuestionRunProof = z.infer<typeof runProofSchema>;
/** Requires independent trusted request/run evidence, absent from public pending_request responses. Never infer this from the thread's active run. */
export interface QuestionRunBindingPort {
  resolve(context: T3Context, requestId: string, actionDigest: string, signal: AbortSignal): Promise<QuestionRunProof | null>;
}
export type AttentionRecord = {
  requestKey: string; bindingKey: string; revision: number; ownerId: string; deviceId: string; environmentId: string; projectId: string; t3ProjectId: string;
  threadId: string; runId: string; requestId: string; kind: 'question' | 'permission'; grantRevision: number; actionDigest: string; expiresAt: number;
  taskId: string; taskRevision: number; mappingRevision: number; runOrdinal: number;
  responseCapability: 'question' | 'manual'; runBinding: 'verified_request_run' | 'observed_current_run' | 'parent_notice'; runProof?: QuestionRunProof; question?: T3Question; offeredDecisions: string[];
  challenge: string; notifications: { pet: 'pending' | 'accepted'; sendblue: 'pending' | 'accepted' }; response: QuestionResponse | null; requestState: 'pending' | 'not_pending';
};
/** Canonical parent store: atomic CAS across workers/restarts, detached records, and grant/mapping fences checked under the commit lock. */
export interface AttentionRepository {
  load(requestKey: string): Promise<AttentionRecord | null>;
  create(record: AttentionRecord): Promise<boolean>;
  compareAndSet(requestKey: string, expectedRevision: number, next: AttentionRecord): Promise<boolean>;
}
export type OwnerResponsePrincipal = { authenticated: boolean; ownerId: string; deviceId: string; channel: 'app' | 'pet' | 'sendblue' };
const replySchema = z.object({ operationId: id, requestKey: z.string().regex(/^[a-f0-9]{64}$/), requestId: id, runId: id, grantRevision: z.number().int().positive(),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/), challenge: z.string().min(1).max(100), answers: z.unknown() }).strict();
const permissionSchema = z.object({ environmentId: id, projectId: id, threadId: id, runId: id, requestId: id, grantRevision: z.number().int().positive(),
  actionDigest: z.string().regex(/^[a-f0-9]{64}$/), offeredDecisions: z.array(z.enum(['accept', 'acceptForSession', 'acceptAlways', 'decline', 'cancel'])).max(5), expiresAt: z.number().int().positive() }).strict();

export class T3Attention {
  private readonly context: T3Context;
  constructor(context: T3Context, private readonly adapter: T3Adapter, private readonly repository: AttentionRepository,
    private readonly sinks: { pet: NotificationSink; sendblue: NotificationSink }, private readonly now: () => number, private readonly questionRunBinding?: QuestionRunBindingPort) {
    this.context = parse(contextSchema, context);
  }
  private async load(requestKey: string) {
    const record = await sanitized(() => this.repository.load(requestKey));
    if (!record || record.requestKey !== requestKey || record.bindingKey !== bindingKey(this.context) || record.ownerId !== this.context.grant.ownerId ||
      record.deviceId !== this.context.grant.deviceId || record.environmentId !== this.context.grant.environmentId || record.projectId !== this.context.grant.projectId ||
      record.t3ProjectId !== this.context.grant.t3ProjectId || record.threadId !== this.context.grant.threadId || record.runId !== this.context.mapping.runId ||
      record.grantRevision !== this.context.grant.revision || record.taskId !== this.context.mapping.taskId || record.taskRevision !== this.context.mapping.taskRevision ||
      record.mappingRevision !== this.context.mapping.mappingRevision || record.runOrdinal !== this.context.mapping.runOrdinal) throw new T3Error('stale_request');
    return record;
  }
  private async fresh(record: AttentionRecord, signal: AbortSignal) {
    await this.adapter.guard(this.context, signal);
    if (record.expiresAt <= this.now()) throw new T3Error('expired');
  }
  private async save(record: AttentionRecord, patch: Partial<AttentionRecord>) {
    const next = { ...record, ...patch, revision: record.revision + 1 };
    if (!await sanitized(() => this.repository.compareAndSet(record.requestKey, record.revision, next))) throw new T3Error('conflict');
    return next;
  }
  private async liveRun(signal: AbortSignal) {
    const page = await this.adapter.read(this.context, { afterPosition: this.context.grant.startPosition }, signal);
    const runId = page.thread.activeRunId ?? page.thread.latestRunId;
    if (runId !== this.context.mapping.runId || !['running', 'waiting'].includes(page.thread.status) ||
      !page.recentRuns.some(run => run.runId === runId && run.ordinal === this.context.mapping.runOrdinal)) throw new T3Error('stale_request');
  }
  private async liveQuestion(requestId: string, signal: AbortSignal) {
    await this.liveRun(signal);
    if (!(await this.adapter.pendingIds(this.context, signal)).includes(requestId)) throw new T3Error('stale_request');
    const question = await this.adapter.question(this.context, requestId, signal);
    await this.liveRun(signal);
    return question;
  }
  private async runProof(requestId: string, actionDigest: string, signal: AbortSignal) {
    if (!this.questionRunBinding) return undefined;
    const result = await deadline(inner => sanitized(() => this.questionRunBinding!.resolve(structuredClone(this.context), requestId, actionDigest, inner)), signal);
    await this.adapter.guard(this.context, signal);
    if (result === null) return undefined;
    const proof = parse(runProofSchema, result);
    if (proof.bindingKey !== bindingKey(this.context) || proof.requestId !== requestId || proof.runId !== this.context.mapping.runId ||
      proof.actionDigest !== actionDigest || proof.expiresAt <= this.now()) throw new T3Error('stale_request');
    return proof;
  }
  private async create(kind: AttentionRecord['kind'], requestId: string, actionDigest: string, question: T3Question | undefined,
    offeredDecisions: string[], expiresAt: number, signal: AbortSignal, runProof?: QuestionRunProof): Promise<AttentionRecord> {
    await this.adapter.guard(this.context, signal);
    const key = bindingKey(this.context), grant = this.context.grant;
    const record: AttentionRecord = { requestKey: digest([key, kind, requestId]), bindingKey: key, revision: 1,
      ownerId: grant.ownerId, deviceId: grant.deviceId, environmentId: grant.environmentId, projectId: grant.projectId, t3ProjectId: grant.t3ProjectId,
      threadId: grant.threadId, runId: this.context.mapping.runId, requestId, kind, grantRevision: grant.revision, actionDigest,
      taskId: this.context.mapping.taskId, taskRevision: this.context.mapping.taskRevision, mappingRevision: this.context.mapping.mappingRevision, runOrdinal: this.context.mapping.runOrdinal,
      expiresAt: Math.min(expiresAt, grant.expiresAt, runProof?.expiresAt ?? Infinity, this.now() + 300000), responseCapability: kind === 'question' && runProof && this.adapter.capabilities().questionResponse ? 'question' : 'manual',
      runBinding: kind === 'question' ? runProof ? 'verified_request_run' : 'observed_current_run' : 'parent_notice', runProof, question, offeredDecisions, challenge: randomBytes(24).toString('base64url'),
      notifications: { pet: 'pending', sendblue: 'pending' }, response: null, requestState: 'pending' };
    if (record.expiresAt <= this.now()) throw new T3Error('expired');
    if (await sanitized(() => this.repository.create(record))) return record;
    const existing = await this.load(record.requestKey);
    if (existing.actionDigest !== actionDigest || existing.requestState !== 'pending') throw new T3Error('stale_request');
    await this.fresh(existing, signal);
    return existing;
  }
  async captureQuestion(requestId: string, signal = new AbortController().signal) {
    const question = await this.liveQuestion(parse(id, requestId), signal);
    const actionDigest = digest(question), proof = await this.runProof(requestId, actionDigest, signal);
    return this.create('question', requestId, actionDigest, question, [], this.now() + 300000, signal, proof);
  }
  /** Public pending_request cannot discover approvals. Parent may supply a scoped notice from an independently authorized source; this never enables a response. */
  async permissionNotice(input: unknown, signal = new AbortController().signal) {
    const notice = parse(permissionSchema, input), grant = this.context.grant;
    if (notice.environmentId !== grant.environmentId || notice.projectId !== grant.projectId || notice.threadId !== grant.threadId ||
      notice.runId !== this.context.mapping.runId || notice.grantRevision !== grant.revision) throw new T3Error('stale_request');
    return this.create('permission', notice.requestId, notice.actionDigest, undefined, notice.offeredDecisions, notice.expiresAt, signal);
  }
  async notify(requestKey: string, signal = new AbortController().signal) {
    let record = await this.load(requestKey); await this.fresh(record, signal);
    if (record.kind === 'question' && digest(await this.liveQuestion(record.requestId, signal)) !== record.actionDigest) throw new T3Error('stale_request');
    const result: Record<'pet' | 'sendblue', 'accepted' | 'retryable' | 'skipped'> = { pet: 'skipped', sendblue: 'skipped' };
    for (const name of ['pet', 'sendblue'] as const) {
      record = await this.load(requestKey); await this.fresh(record, signal);
      if (record.notifications[name] === 'accepted') { result[name] = 'accepted'; continue; }
      if (record.response || record.requestState !== 'pending') continue;
      const input: NotificationInput = { operationId: digest([requestKey, name]), ownerId: record.ownerId, projectId: record.projectId,
        kind: record.kind === 'question' ? 't3_question' : 't3_permission_notice', requestKey, expiresAt: record.expiresAt,
        text: record.kind === 'permission' ? 'A T3 permission request needs your review. Open in T3 to decide; remote approval is unavailable.'
          : record.responseCapability === 'manual' ? 'A T3 question needs your answer. Open in T3; remote response is unavailable.'
          : `A T3 question needs your answer. Review in NemoPal. Response code: ${record.challenge}` };
      await this.fresh(record, signal);
      try {
        const receipt = await this.sinks[name].enqueue(input, signal);
        if (receipt.state !== 'accepted') throw new T3Error('unavailable');
      } catch { result[name] = 'retryable'; continue; }
      // A crash here retries the same port operationId; the sink owns durable deduplication.
      record = await this.load(requestKey);
      await this.save(record, { notifications: { ...record.notifications, [name]: 'accepted' } }); result[name] = 'accepted';
    }
    return result;
  }
  /** Principal comes only from parent's authenticated owner/channel ingress, never a request body or a model. */
  async respond(principal: OwnerResponsePrincipal, input: unknown, signal = new AbortController().signal): Promise<QuestionResponse> {
    if (principal.authenticated !== true || principal.ownerId !== this.context.grant.ownerId || principal.deviceId !== this.context.grant.deviceId || !['app', 'pet', 'sendblue'].includes(principal.channel)) throw new T3Error('wrong_owner');
    const reply = parse(replySchema, input);
    let record = await this.load(reply.requestKey); await this.fresh(record, signal);
    if (record.kind !== 'question') throw new T3Error('permission_unsupported');
    if (record.responseCapability !== 'question' || record.runBinding !== 'verified_request_run' || !record.runProof || !this.questionRunBinding ||
      !this.adapter.capabilities().questionResponse || !record.question) throw new T3Error('capability_unavailable');
    if (reply.requestId !== record.requestId || reply.runId !== record.runId || reply.grantRevision !== record.grantRevision || reply.actionDigest !== record.actionDigest ||
      !timingSafeEqual(Buffer.from(digest(reply.challenge)), Buffer.from(digest(record.challenge)))) throw new T3Error('stale_request');
    const answers = answersFor(record.question, reply.answers), answerDigest = digest(answers);
    if (record.response) {
      if (record.response.operationId !== reply.operationId || record.response.answerDigest !== answerDigest) throw new T3Error('replay');
      if (record.response.state !== 'received') return { ...record.response, state: record.response.state === 'sending' ? 'uncertain' : record.response.state };
    }
    if (record.requestState !== 'pending' || digest(await this.liveQuestion(record.requestId, signal)) !== record.actionDigest) throw new T3Error('stale_request');
    const proof = await this.runProof(record.requestId, record.actionDigest, signal);
    if (!proof || proof.proofId !== record.runProof.proofId) throw new T3Error('stale_request');
    await this.fresh(record, signal);
    if (!record.response) record = await this.save(record, { response: { operationId: reply.operationId, answerDigest, state: 'received' } });
    await this.fresh(record, signal);
    record = await this.save(record, { response: { ...record.response!, state: 'sending' } });
    let response: QuestionResponse;
    let attempted = false;
    try {
      await this.fresh(record, signal);
      attempted = true;
      const receipt = await this.adapter.answerQuestion(this.context, record.requestId, answers, signal, Math.min(record.expiresAt, proof.expiresAt));
      response = { ...record.response!, state: 'accepted', sequence: receipt.sequence };
    } catch (error) {
      if (!attempted || (error instanceof T3Error && error.notSent)) {
        await this.save(record, { response: { ...record.response!, state: 'received' } });
        throw error instanceof T3Error ? error : new T3Error('unavailable');
      }
      response = { ...record.response!, state: 'uncertain' };
    }
    await this.save(record, { response });
    return response;
  }
  async reconcile(requestKey: string, signal = new AbortController().signal) {
    const record = await this.load(requestKey); await this.fresh(record, signal);
    if (record.kind === 'permission') return record;
    const pending = (await this.adapter.pendingIds(this.context, signal)).includes(record.requestId);
    // Absence cannot prove that this human answer reached the provider (another channel may have resolved it).
    return !pending && record.requestState === 'pending' ? this.save(record, { requestState: 'not_pending' }) : record;
  }
}
