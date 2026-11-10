import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createThreadMcpServer, type T3Runner } from '../../packages/mcp-bridge/src/index';

const threadId = '11111111-1111-4111-8111-111111111111';
const anotherThread = '12345678-1234-4234-8234-123456789012';
const close: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(close.splice(0).map(fn => fn())); });

async function connect(run: T3Runner) {
  const server = createThreadMcpServer(threadId, run);
  const client = new Client({ name: 'nemopal-test', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  close.push(() => client.close(), () => server.close());
  return client;
}
const history = () => JSON.stringify({ thread: { threadId, title: 'Synthetic coding thread', status: 'running', link: 'https://app.t3.codes/threads/example', runtimeMode: 'full-access', privatePath: 'PRIVATE' }, messages: [{ role: 'user', text: 'Synthetic request', runId: 'run-1', privateData: 'PRIVATE' }] });

describe('NemoPal selected-thread MCP', () => {
  it('exposes only bounded reading and non-interrupting sending', async () => {
    const client = await connect(vi.fn());
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toEqual(['read_thread', 'send_message']);
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[1]?.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false });
  });

  it('reads only the configured thread and strips unrelated metadata', async () => {
    const run = vi.fn<T3Runner>().mockResolvedValue(history());
    const client = await connect(run);
    const result = await client.callTool({ name: 'read_thread', arguments: { limit: 5 } });
    expect(result.isError).not.toBe(true);
    expect(run.mock.calls[0]?.[0]).toEqual(['thread', 'show', threadId, '--messages', '5', '--json']);
    expect(result.structuredContent).toMatchObject({ thread: { threadId }, messages: [{ role: 'user', text: 'Synthetic request' }] });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });

  it('defaults to the latest 20 messages', async () => {
    const run = vi.fn<T3Runner>().mockResolvedValue(history());
    const client = await connect(run);
    await client.callTool({ name: 'read_thread', arguments: {} });
    expect(run.mock.calls[0]?.[0]).toContain('20');
  });

  it.each([{ threadId: anotherThread }, { limit: 0 }, { limit: 51 }, { limit: 1.5 }])('rejects out-of-scope read input %j before calling T3', async input => {
    const run = vi.fn<T3Runner>();
    const client = await connect(run);
    expect((await client.callTool({ name: 'read_thread', arguments: input })).isError).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('passes message text literally via stdin, never as CLI flags or shell code', async () => {
    const run = vi.fn<T3Runner>().mockResolvedValue(JSON.stringify({ threadId, runId: 'run-2', status: 'queued' }));
    const client = await connect(run);
    const message = '--wait\n$(secret) & echo "quoted" | more\nA Unicode message: 你好';
    const result = await client.callTool({ name: 'send_message', arguments: { message } });
    expect(result.isError).not.toBe(true);
    expect(run.mock.calls[0]?.slice(0, 2)).toEqual([['thread', 'send', threadId, '-', '--json'], message]);
    expect(result.structuredContent).toMatchObject({ threadId, runId: 'run-2', status: 'queued' });
  });

  it.each([{ message: ' ' }, { message: 'x'.repeat(16001) }, { message: '好'.repeat(6000) }, { message: 'hello', threadId: anotherThread }, { message: 'hello', mode: 'restart' }])('rejects invalid or out-of-scope sends before calling T3', async input => {
    const run = vi.fn<T3Runner>();
    const client = await connect(run);
    expect((await client.callTool({ name: 'send_message', arguments: input })).isError).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('rejects a response for a different thread', async () => {
    const run = vi.fn<T3Runner>().mockResolvedValue(history().replaceAll(threadId, anotherThread));
    const client = await connect(run);
    const result = await client.callTool({ name: 'read_thread', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('Synthetic request');
  });

  it('sanitizes CLI errors and never retries an uncertain send', async () => {
    const run = vi.fn<T3Runner>().mockRejectedValue(Error('PRIVATE TOKEN AND THREAD CONTENT'));
    const client = await connect(run);
    const result = await client.callTool({ name: 'send_message', arguments: { message: 'hello' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    expect(JSON.stringify(result)).toContain('may have been queued');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit valid T3 thread before creating tools', () => {
    expect(() => createThreadMcpServer('', vi.fn())).toThrow();
    expect(() => createThreadMcpServer('thread & command', vi.fn())).toThrow();
  });
});
