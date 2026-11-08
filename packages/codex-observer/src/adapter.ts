import { z } from 'zod';
import { LocalBindingSchema, ObservationBatchSchema, type CodexObserver, type LocalBinding, type SourceCursor, type ObservationBatch, type Observation } from '@living-playbooks/contracts';
import { ADAPTER, VERSION, decodeCursor, digest, makeCursor, prefixDigest } from './cursor';
import { normalizeItem, validateItems } from './normalizer';

export type ReadTransport = { request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> };
const RequestSchemas: Record<string, z.ZodType> = {
  initialize: z.strictObject({ clientInfo: z.strictObject({ name: z.literal('living_playbooks_observer'), version: z.literal(VERSION) }), capabilities: z.strictObject({ experimentalApi: z.literal(false), explicitGatewayOauth: z.literal(true) }) }),
  'thread/read': z.strictObject({ threadId: z.uuid(), includeTurns: z.literal(false) }),
  'thread/turns/list': z.strictObject({ threadId: z.uuid(), limit: z.literal(20), sortDirection: z.literal('desc'), itemsView: z.literal('full') }),
};
export class ReadOnlyRpc implements ReadTransport {
  constructor(private transport: ReadTransport) {}
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    const schema = RequestSchemas[method];
    if (!schema) return Promise.reject(Error('Forbidden observer method'));
    try { return this.transport.request(method, schema.parse(params), signal); } catch { return Promise.reject(Error('Forbidden observer parameters')); }
  }
}
const Thread = z.object({ thread: z.object({ id: z.string(), cwd: z.string(), createdAt: z.number().int(), sessionId: z.string(), cliVersion: z.string(), turns: z.array(z.unknown()).max(0) }) });
const Turn = z.object({ id: z.string().min(1).max(80), status: z.enum(['completed', 'inProgress', 'interrupted', 'failed']), itemsView: z.literal('full').default('full'), items: z.array(z.unknown()).max(10000), completedAt: z.number().int().nullable().optional() });
const Page = z.object({ data: z.array(Turn).max(20), nextCursor: z.string().nullable().optional(), backwardsCursor: z.string().nullable().optional() });
export class AppServerObserver implements CodexObserver {
  private stopped = new Set<string>();
  private rpc: ReadOnlyRpc;
  constructor(private options: ReadTransport & { version(): Promise<string>; mode: Observation['provenance']['mode']; close?(): Promise<void> }) { this.rpc = new ReadOnlyRpc(options); }
  async probe() {
    let version: string | null = null;
    try { version = await this.options.version(); } catch { /* capability diagnostics contain no source text */ }
    const available = version === VERSION;
    return { available, adapterId: ADAPTER, adapterVersion: VERSION, installedVersion: version, capability: available ? 'incremental_history' as const : 'unavailable' as const,
      reason: available ? 'Pinned stored-history reads available; exact source enrollment and local permission required.' : 'Installed Codex version is unavailable or incompatible.',
      coverage: 'Completed visible final messages and command exit metadata; bounded latest 20 turns. No subscription or active-runtime guarantee. Gaps block.' };
  }
  async readDelta(input: LocalBinding, cursor: SourceCursor | null, signal: AbortSignal): Promise<ObservationBatch> {
    const binding = LocalBindingSchema.parse(input);
    if (binding.binding.adapterId !== ADAPTER || binding.binding.adapterVersion !== VERSION) throw Error('Source adapter identity mismatch');
    if (this.stopped.has(binding.binding.id) || binding.binding.state !== 'following') throw Error('Source monitoring stopped');
    signal.throwIfAborted();
    if (!(await this.probe()).available) throw Error('Unsupported installed version');
    const thread = Thread.parse(await this.rpc.request('thread/read', { threadId: z.uuid().parse(binding.selectedSource), includeTurns: false }, signal)).thread;
    if (thread.id !== binding.selectedSource || thread.cwd.replaceAll('\\', '/').toLowerCase() !== binding.sourceIdentity.replaceAll('\\', '/').toLowerCase() || thread.cliVersion !== VERSION) throw Error('Source identity mismatch');
    const birth = digest([thread.id, thread.sessionId, thread.createdAt, thread.cwd]);
    const anchor = cursor ? decodeCursor(cursor, thread.id) : null;
    if (anchor && anchor.birth !== birth) throw Error('Source identity replaced');
    const page = Page.parse(await this.rpc.request('thread/turns/list', { threadId: thread.id, limit: 20, sortDirection: 'desc', itemsView: 'full' }, signal));
    signal.throwIfAborted();
    if (this.stopped.has(binding.binding.id)) throw Error('Source monitoring stopped');
    const turns = [...page.data].reverse().map(turn => ({ ...turn, items: validateItems(turn.items) }));
    if (new Set(turns.map(t => t.id)).size !== turns.length) throw Error('Duplicate turn schema');
    const latest = turns.at(-1);
    if (!anchor) return ObservationBatchSchema.parse({ observations: [], nextCursor: makeCursor(thread.id, birth, latest?.id ?? null, latest?.items ?? [], latest?.items.length ?? 0, true), mode: 'incremental_history', lastObservedAt: null, coverage: 'Enrolled current tail; no historical import. Completed persisted history only.' });
    const start = anchor.turn === null ? 0 : turns.findIndex(turn => turn.id === anchor.turn);
    if (start < 0 || (anchor.turn === null && page.nextCursor)) throw Error('Source history gap; explicit revalidation required');
    const observations: ObservationBatch['observations'] = [];
    let next = cursor!;
    const now = new Date().toISOString();
    for (let t = start; t < turns.length; t++) {
      const turn = turns[t]!;
      let offset = t === start && anchor.turn !== null ? cursor!.offset : 0;
      if (offset > turn.items.length || (t === start && anchor.turn !== null && prefixDigest(turn.items.slice(0, offset), anchor.baseline) !== anchor.prefix)) throw Error('Source history truncated or prefix changed');
      if (turn.status === 'inProgress') break;
      const seen = new Set(turn.items.slice(0, offset).map(item => String(item.id)));
      while (offset < turn.items.length && observations.length < 20) {
        const item = turn.items[offset++]!;
        if (!seen.has(String(item.id))) {
          const observation = normalizeItem(item, turn.id, turn.completedAt, binding, this.options.mode, now, turn.status !== 'completed');
          if (observation) observations.push(observation);
          seen.add(String(item.id));
        }
      }
      next = makeCursor(thread.id, birth, turn.id, turn.items, offset);
      if (observations.length >= 20) break;
    }
    return ObservationBatchSchema.parse({ observations, nextCursor: next, mode: 'incremental_history', lastObservedAt: observations.length ? now : null, coverage: 'Completed persisted history in latest 20 turns. Failed/interrupted boundaries retain explicitly completed messages and terminal command metadata; unfinished items are excluded. Hidden reasoning, tool output, diffs and attachments excluded. Secret filtering is best effort.' });
  }
  async stop(bindingId: string): Promise<void> { this.stopped.add(bindingId); await this.options.close?.(); }
}
