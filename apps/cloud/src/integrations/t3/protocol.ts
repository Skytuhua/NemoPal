import { z } from 'zod';
import { authorized, cancelled, contextSchema, deadline, id, pageSchema, parse, pendingSchema, T3Error, type Answers, type T3Authority, type T3Context } from './model';

export const T3_TOOLS = ['t3_thread_read', 't3_pending_request'] as const;
export type T3ToolName = typeof T3_TOOLS[number];
/** Supply a separately authenticated OAuth MCP client; this module never finds credentials or opens a socket. */
export interface T3McpClient {
  readonly configuration: { endpoint: string; environmentId: string };
  readonly toolNames: readonly string[];
  readonly permissions: readonly string[];
  callTool(name: T3ToolName, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown>;
}
export function connectionPreview(endpoint: string) {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new T3Error('invalid_configuration'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/mcp' ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new T3Error('invalid_configuration');
  return { endpoint: url.href, authentication: 'oauth' as const, allowedTools: [...T3_TOOLS], writesConfiguration: false,
    connection: 'not_tested' as const, permissionResponse: 'unsupported' as const,
    requiredPermissions: { observation: ['orchestration:read'], questionResponse: ['orchestration:read', 'orchestration:operate'] },
    nextStep: 'Parent supplies a dedicated OAuth MCP client after owner reviews this endpoint and its broad T3 permissions.' };
}

export class T3Adapter {
  private readonly environmentId: string;
  constructor(private readonly client: T3McpClient, readonly authority: T3Authority, readonly now: () => number) {
    connectionPreview(client.configuration.endpoint);
    this.environmentId = parse(id, client.configuration.environmentId);
  }
  capabilities() {
    const permissions = Array.isArray(this.client.permissions) ? this.client.permissions : [];
    const tools = Array.isArray(this.client.toolNames) ? this.client.toolNames : [];
    const read = permissions.includes('orchestration:read');
    const pending = tools.includes('t3_pending_request');
    return { observation: read && tools.includes('t3_thread_read'), questions: read && pending,
      questionResponse: read && pending && permissions.includes('orchestration:operate'), permissionResponse: false as const };
  }
  async guard(context: T3Context, signal: AbortSignal) {
    if (context.grant.environmentId !== this.environmentId) throw new T3Error('invalid_configuration');
    return deadline(inner => authorized(context, this.authority, this.now, inner), signal);
  }
  private async call(context: T3Context, name: T3ToolName, args: Record<string, unknown>, signal: AbortSignal, write = false, expiresAt?: number): Promise<unknown> {
    context = parse(contextSchema, context);
    const capability = write ? 'questionResponse' : name === 't3_thread_read' ? 'observation' : 'questions';
    if (!this.capabilities()[capability]) throw new T3Error('capability_unavailable');
    return deadline(async inner => {
      await this.guard(context, inner);
      if (!this.capabilities()[capability]) throw new T3Error('capability_unavailable');
      if (write && (!Number.isSafeInteger(expiresAt) || expiresAt! <= this.now())) throw new T3Error('expired', true);
      try {
        const result = await this.client.callTool(name, { ...args, environmentId: context.grant.environmentId, threadId: context.grant.threadId }, inner);
        await this.guard(context, inner);
        if (!result || typeof result !== 'object' || ('isError' in result && result.isError === true)) throw new T3Error('unavailable');
        const envelope = result as { structuredContent?: unknown; content?: { type?: string; text?: string }[] };
        if (envelope.structuredContent !== undefined) return envelope.structuredContent;
        const text = envelope.content?.find(item => item.type === 'text')?.text;
        if (!text || text.length > 200000) throw new T3Error('invalid_contract');
        return JSON.parse(text);
      } catch (error) { cancelled(signal); throw error instanceof T3Error ? error : new T3Error('unavailable'); }
    }, signal);
  }
  async read(context: T3Context, cursor: { afterPosition?: number; itemId?: string }, signal: AbortSignal) {
    const bounded = parse(z.object({ afterPosition: z.number().int().nonnegative().optional(), itemId: id.optional() }).strict(), cursor);
    const page = parse(pageSchema, await this.call(context, 't3_thread_read', { ...bounded, view: 'activity', limit: bounded.itemId ? 1 : 25, maxCharsPerItem: 1, runLimit: 10 }, signal));
    if (page.thread.threadId !== context.grant.threadId || page.thread.projectId !== context.grant.t3ProjectId) throw new T3Error('invalid_contract');
    return { ...page, items: page.items.filter(item => item.visibility === 'local' && item.sourceThreadId === context.grant.threadId) };
  }
  async pendingIds(context: T3Context, signal: AbortSignal) {
    return parse(z.object({ requestIds: z.array(id).max(100) }), await this.call(context, 't3_pending_request', { action: 'list' }, signal)).requestIds;
  }
  async question(context: T3Context, requestId: string, signal: AbortSignal) {
    const question = parse(pendingSchema, await this.call(context, 't3_pending_request', { action: 'read', requestId: parse(id, requestId) }, signal));
    if (question.requestId !== requestId || new Set(question.questions.map(q => q.id)).size !== question.questions.length) throw new T3Error('invalid_contract');
    return question;
  }
  async answerQuestion(context: T3Context, requestId: string, answers: Answers, signal: AbortSignal, expiresAt: number) {
    return parse(z.object({ sequence: z.number().int().nonnegative() }), await this.call(context, 't3_pending_request', { action: 'respond', requestId: parse(id, requestId), answers }, signal, true, expiresAt));
  }
  async answerPermission(): Promise<never> { throw new T3Error('permission_unsupported'); }
}
