import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { HttpNemotronAdapter } from '@living-playbooks/nemotron';
import type { ModelTurnInput } from '@living-playbooks/contracts';
const settings = { baseUrl: 'https://synthetic-nemotron.example/v1', model: 'owner-selected-nemotron', apiKey: 'synthetic-test-only', callBudget: 8, tokenBudget: 100000 };
const input: ModelTurnInput = { projectId: randomUUID(), messages: [{ role: 'user', content: 'Synthetic tool test.' }], remainingModelCalls: 4, remainingToolCalls: 6 };
const toolMessage = { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_project_state', arguments: '{}' } }] };
test('HTTP adapter translates an actual function call and tool-result continuation without leaking native formatting', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetcher: typeof fetch = async (_url, init) => { bodies.push(JSON.parse(init!.body as string)); return Response.json({ model: settings.model, choices: [{ finish_reason: 'tool_calls', message: toolMessage }] }); };
    const adapter = new HttpNemotronAdapter(settings, fetcher);
    const result = await adapter.next(input, new AbortController().signal);
    expect(result).toMatchObject({ type: 'tool_calls', calls: [{ id: 'call-1', name: 'read_project_state', arguments: {} }] });
    expect(bodies[0]).toMatchObject({ model: settings.model, stream: false, parallel_tool_calls: false });
    await adapter.next({ ...input, messages: [...input.messages, { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'read_project_state', arguments: {} }] }, { role: 'tool', content: '{"project":"synthetic"}', toolCallId: 'call-1' }] }, new AbortController().signal);
    expect(bodies[1]).toMatchObject({ messages: [{role:'system',content:expect.stringContaining('RAW JSON')},{ role: 'user', content: 'Synthetic tool test.' }, { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_project_state', arguments: '{}' } }] }, { role: 'tool', content: '{"project":"synthetic"}', tool_call_id: 'call-1' }] });
});
test('202 is unsupported pending and does not submit another request; errors are sanitized', async () => {
    let count = 0;
    const adapter = new HttpNemotronAdapter(settings, async () => { count++; return new Response('private-provider-body', { status: 202 }); });
    await expect(adapter.next(input, new AbortController().signal)).rejects.toThrow('unsupported_pending');
    expect(count).toBe(1);
    for (const status of [401, 429, 500]) {
        const a = new HttpNemotronAdapter(settings, async () => new Response('private-provider-body', { status }));
        await expect(a.next(input, new AbortController().signal)).rejects.toThrow(status === 401 ? 'provider_auth' : status === 429 ? 'provider_rate_limit' : 'provider_unavailable');
    }
});
test('unconfigured settings and unsafe endpoints reject before any HTTP call', async () => {
    let calls = 0;
    const f: typeof fetch = async () => { calls++; return Response.json({}); };
    for (const changed of [{ apiKey: '' }, { model: '' }, { callBudget: 0 }, { tokenBudget: Infinity }, { baseUrl: 'http://public.example/v1' }, { baseUrl: 'https://user:pass@public.example/v1' }]) {
        await expect(async () => new HttpNemotronAdapter({ ...settings, ...changed }, f).next(input, new AbortController().signal)).rejects.toThrow(/configuration/);
    }
    expect(calls).toBe(0);
});
