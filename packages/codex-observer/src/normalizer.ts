import { z } from 'zod';
import { LIMITS, ObservationSchema, type LocalBinding, type Observation } from '@living-playbooks/contracts';
import { ADAPTER, VERSION, digest } from './cursor';

const Item = z.object({ id: z.string().min(1).max(120), type: z.string().min(1), completedAtMs: z.number().int().nonnegative().nullable().optional() });
// Known payloads are ignored by type; none of these raw fields is copied to observations.
const ignored = new Set(['hookPrompt', 'reasoning', 'functionCallOutput', 'plan', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall', 'subAgentActivity', 'webSearch', 'imageView', 'sleep', 'imageGeneration', 'enteredReviewMode', 'exitedReviewMode', 'contextCompaction']);
const known = new Set(['userMessage', 'agentMessage', 'commandExecution', ...ignored]);
export function validateItems(raw: unknown[]): Record<string, unknown>[] {
  const seen = new Map<string, string>();
  return raw.map(value => {
    const item = Item.parse(value);
    if (!known.has(item.type)) throw Error('Unsupported item schema');
    const hash = digest(value);
    if (seen.has(item.id) && seen.get(item.id) !== hash) throw Error('Conflicting duplicate item schema');
    seen.set(item.id, hash);
    return value as Record<string, unknown>;
  });
}
export function safeExcerpt(text: string): string | undefined {
  // Best effort only. Entire suspicious excerpts are excluded rather than partially concealing a secret.
  if (/(?:sk-[\w-]{16,}|\b(?:api[_-]?key|token|password|secret|authorization)\s*[:=]|Bearer\s+\S+|-----BEGIN|diff --git|@@\s+-\d|```|https?:\/\/\S+@)/i.test(text)) return undefined;
  let result = '';
  for (const point of text) { if (Buffer.byteLength(result + point) > LIMITS.excerptBytes) break; result += point; }
  return result.trim() || undefined;
}
export function normalizeItem(item: Record<string, unknown>, turnId: string, completedAt: number | null | undefined, binding: LocalBinding, mode: Observation['provenance']['mode'], observedAt: string, terminalFailure = false): Observation | null {
  if (ignored.has(String(item.type))) return null;
  const sourceItemId = `${turnId}/${String(item.id)}`;
  let fields: Pick<Observation, 'kind' | 'metadata'>;
  let text: string | undefined;
  let level: Observation['provenance']['evidenceLevel'];
  if (item.type === 'agentMessage') {
    const message = z.object({ text: z.string(), phase: z.enum(['commentary', 'partial_answer', 'final_answer']).nullable().optional() }).parse(item);
    if (message.phase !== 'final_answer' || (terminalFailure && typeof item.completedAtMs !== 'number')) return null;
    fields = { kind: 'assistant_report', metadata: { type: 'message', role: 'assistant' } }; level = 'agent_reported'; text = message.text;
  } else if (item.type === 'userMessage') {
    const message = z.object({ content: z.array(z.object({ type: z.string(), text: z.string().optional() })) }).parse(item);
    if (terminalFailure && typeof item.completedAtMs !== 'number') return null;
    fields = { kind: 'user_visible_message', metadata: { type: 'message', role: 'user' } }; level = 'user_reported';
    // Attachments, skill/path references and inline media are never exported.
    if (message.content.every(part => part.type === 'text' && part.text !== undefined)) text = message.content.map(part => part.text).join('\n');
  } else {
    const command = z.object({ status: z.enum(['completed', 'failed', 'declined', 'inProgress']), exitCode: z.number().int().nullable().optional() }).parse(item);
    if (!['completed', 'failed'].includes(command.status)) return null;
    fields = { kind: 'tool_result_metadata', metadata: { type: 'tool', exitCode: command.exitCode ?? null } }; level = 'source_tool_observed';
  }
  const time = typeof item.completedAtMs === 'number' ? item.completedAtMs : typeof completedAt === 'number' ? completedAt * 1000 : null;
  if (time === null) throw Error('Missing completed item timestamp schema');
  const hex = digest([binding.binding.id, binding.binding.grantRevision, sourceItemId]).slice(0, 32);
  const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20)}`;
  const excerpt = binding.binding.exportPolicy === 'approved_excerpts' && text ? safeExcerpt(text) : undefined;
  return ObservationSchema.parse({ id, bindingId: binding.binding.id, grantRevision: binding.binding.grantRevision, sourceItemId, sourceRevision: digest([sourceItemId, time, fields, excerpt ?? null]), occurredAt: new Date(time).toISOString(), observedAt,
    ...fields, ...(excerpt === undefined ? {} : { excerpt }), provenance: { adapterId: ADAPTER, adapterVersion: VERSION, mode, evidenceLevel: level } });
}
