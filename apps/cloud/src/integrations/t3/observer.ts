import { z } from 'zod';
import { authorized, contextSchema, digest, id, itemSchema, parse, T3Error, type T3Authority, type T3Context, type T3Page } from './model';
import { T3Adapter } from './protocol';

export type T3Observation = {
  bindingKey: string; mode: 'current' | 'stale' | 'offline' | 'revoked' | 'cancelled' | 'unmapped'; label: string;
  cursor: number; lastSeenAt: number | null; threadUpdatedAt: string | null; runId: string | null; runOrdinal: number | null;
  status: string; runStatus: string; items: T3Page['items']; hasMore: boolean;
};
export const bindingKey = (context: T3Context) => { const value = parse(contextSchema, context); return digest([value.grant, value.mapping]); };
const terminal = new Set(['completed', 'failed', 'interrupted', 'cancelled', 'rolled_back']);

/** One bounded tick per call. Parent schedules ticks and persists returned metadata, never a transcript. */
export class T3Observer {
  private state: T3Observation;
  private readonly context: T3Context;
  private readonly stop = new AbortController();
  private busy = false;
  private lastAttempt = -Infinity;
  private refreshOffset = 0;
  constructor(context: T3Context, private readonly adapter: T3Adapter, private readonly now: () => number, checkpoint?: T3Observation) {
    this.context = parse(contextSchema, context);
    const key = bindingKey(this.context);
    this.state = { bindingKey: key, mode: 'stale', label: 'T3 not yet observed', cursor: context.grant.startPosition,
      lastSeenAt: null, threadUpdatedAt: null, runId: null, runOrdinal: null, status: 'unknown', runStatus: 'unknown', items: [], hasMore: false };
    // Checkpoints are parent-owned metadata. Fresh polling is mandatory before using one for an action.
    if (checkpoint?.bindingKey === key && Number.isSafeInteger(checkpoint.cursor) && checkpoint.cursor >= this.state.cursor) {
      this.state.cursor = checkpoint.cursor;
      const items = z.array(itemSchema).max(100).safeParse(checkpoint.items);
      if (items.success && checkpoint.runId === context.mapping.runId && checkpoint.runOrdinal === context.mapping.runOrdinal) {
        this.state.runId = checkpoint.runId; this.state.runOrdinal = checkpoint.runOrdinal;
        this.state.items = items.data.filter(item => item.visibility === 'local' && item.sourceThreadId === context.grant.threadId && item.runId === checkpoint.runId && item.position > context.grant.startPosition);
      }
    }
  }
  cancel() { this.stop.abort(); this.state.mode = 'cancelled'; this.state.label = 'T3 observation cancelled'; }
  snapshot(): T3Observation {
    const state = structuredClone(this.state);
    if (state.mode === 'current' && (state.lastSeenAt === null || this.now() - state.lastSeenAt > 15000)) { state.mode = 'stale'; state.label = 'T3 activity is stale'; }
    return state;
  }
  async poll(signal = new AbortController().signal): Promise<T3Observation> {
    if (this.stop.signal.aborted) return this.snapshot();
    if (signal.aborted) return { ...this.snapshot(), mode: 'cancelled', label: 'T3 observation cancelled' };
    if (this.busy || this.now() - this.lastAttempt < 1000) return this.snapshot();
    this.busy = true; this.lastAttempt = this.now();
    const combined = AbortSignal.any([signal, this.stop.signal]);
    try {
      const active = this.state.items.filter(item => !terminal.has(item.status));
      const refresh = active.length ? active[this.refreshOffset++ % active.length] : undefined;
      const pages = [await this.adapter.read(this.context, { afterPosition: this.state.cursor }, combined)];
      if (refresh) pages.push(await this.adapter.read(this.context, { itemId: refresh.itemId }, combined));
      const latest = pages.reduce((a, b) => Date.parse(a.thread.updatedAt) >= Date.parse(b.thread.updatedAt) ? a : b);
      if (this.state.threadUpdatedAt && Date.parse(latest.thread.updatedAt) < Date.parse(this.state.threadUpdatedAt)) {
        this.state.mode = 'stale'; this.state.label = 'T3 activity is stale'; return this.snapshot();
      }
      const runId = latest.thread.activeRunId ?? latest.thread.latestRunId;
      const run = latest.recentRuns.find(run => run.runId === runId);
      if (this.state.threadUpdatedAt && Date.parse(latest.thread.updatedAt) === Date.parse(this.state.threadUpdatedAt) &&
        (this.state.runId !== runId || this.state.status !== latest.thread.status || this.state.runStatus !== (run?.status ?? 'unknown'))) {
        this.state.mode = 'stale'; this.state.label = 'T3 activity version conflicts; review in T3'; return this.snapshot();
      }
      const items = new Map(this.state.runId === runId ? this.state.items.map(item => [item.itemId, item]) : []);
      for (const page of pages) for (const item of page.items) {
        if (item.runId !== runId || item.position <= this.context.grant.startPosition) continue;
        const old = items.get(item.itemId);
        if (!old || Date.parse(item.updatedAt) > Date.parse(old.updatedAt)) items.set(item.itemId, item);
      }
      const matches = runId === this.context.mapping.runId && run?.ordinal === this.context.mapping.runOrdinal;
      this.state = { bindingKey: this.state.bindingKey, mode: matches ? 'current' : 'unmapped', label: matches ? `T3 ${run?.status ?? latest.thread.status}` : 'T3 run changed; task mapping needs review',
        cursor: Math.max(this.state.cursor, pages[0]!.nextPosition ?? this.state.cursor), lastSeenAt: this.now(), threadUpdatedAt: latest.thread.updatedAt,
        runId, runOrdinal: run?.ordinal ?? null, status: latest.thread.status, runStatus: run?.status ?? 'unknown', items: [...items.values()].sort((a, b) => a.position - b.position).slice(-100), hasMore: pages[0]!.hasMore };
    } catch (error) {
      const mode = combined.aborted ? 'cancelled' : error instanceof T3Error && error.code === 'revoked' ? 'revoked' : 'offline';
      this.state.mode = mode; this.state.label = `T3 observation ${mode}`;
    } finally { this.busy = false; }
    return this.snapshot();
  }
}

const receiptSchema = z.object({ receiptId: id, ownerId: id, projectId: id, environmentId: id, threadId: id, taskId: id, runId: id,
  grantRevision: z.number().int().positive(), taskRevision: z.number().int().positive(), mappingRevision: z.number().int().positive(), runOrdinal: z.number().int().positive(),
  policyRevision: z.number().int().positive(), criterionId: id, outcome: z.literal('success') }).strict();
export type T3SuccessReceipt = z.infer<typeof receiptSchema>;
/** Verifier must validate a trusted criterion/receipt, never assistant prose or arbitrary task_status. Parent commits with canonical authority. */
export async function completionProposal(context: T3Context, observation: T3Observation, input: unknown,
  verifyReceipt: (receipt: T3SuccessReceipt) => Promise<boolean>, authority: T3Authority, now: () => number, signal = new AbortController().signal) {
  try {
    context = parse(contextSchema, context);
    const current = await authorized(context, authority, now, signal);
    if (!current.completionPolicy.enabled || JSON.stringify(current.completionPolicy) !== JSON.stringify(context.completionPolicy) || observation.bindingKey !== bindingKey(context) ||
      observation.mode !== 'current' || observation.status !== 'completed' || observation.runStatus !== 'completed' || observation.lastSeenAt === null || now() - observation.lastSeenAt > 15000 ||
      observation.runId !== context.mapping.runId || observation.runOrdinal !== context.mapping.runOrdinal) return null;
    const receipt = parse(receiptSchema, input);
    const expected = { ...context.mapping, environmentId: context.grant.environmentId, threadId: context.grant.threadId,
      policyRevision: context.completionPolicy.revision, criterionId: context.completionPolicy.criterionId };
    if (Object.entries(expected).some(([key, value]) => receipt[key as keyof T3SuccessReceipt] !== value) || !await verifyReceipt(receipt)) return null;
    const fresh = await authorized(context, authority, now, signal);
    if (JSON.stringify(fresh.completionPolicy) !== JSON.stringify(current.completionPolicy) || now() - observation.lastSeenAt > 15000) return null;
    return { kind: 't3_task_success_proposal' as const, operationId: digest(receipt), ...receipt };
  } catch { return null; }
}
