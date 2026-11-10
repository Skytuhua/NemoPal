import { afterEach, expect, it, vi } from 'vitest';
import { createLocalThreadClient } from '../../packages/mcp-bridge/src/client';
import type { T3Runner } from '../../packages/mcp-bridge/src/index';

const threadId = '11111111-1111-4111-8111-111111111111';
const history = { thread: { threadId, title: 'Synthetic thread', status: 'idle', link: 'https://example.test/thread' }, messages: [] };
const receipt = { threadId, runId: 'synthetic-run', status: 'queued' };
const clients: ReturnType<typeof createLocalThreadClient>[] = [];
afterEach(async () => { await Promise.all(clients.splice(0).map(client => client.close())); });
function local(run: T3Runner, selected: string | undefined = threadId) {
  const client = createLocalThreadClient(selected, run); clients.push(client); return client;
}

it('NemoPal connects lazily and reads/sends through the MCP tools', async () => {
  const run = vi.fn<T3Runner>().mockResolvedValueOnce(JSON.stringify(history)).mockResolvedValueOnce(JSON.stringify(receipt));
  const client = local(run);
  expect(run).not.toHaveBeenCalled();
  expect(await client.read({ limit: 10 })).toEqual(history);
  expect(await client.send({ message: 'Synthetic owner message' })).toEqual(receipt);
  expect(run.mock.calls.map(call => call.slice(0, 2))).toEqual([
    [['thread', 'show', threadId, '--messages', '10', '--json'], undefined],
    [['thread', 'send', threadId, '-', '--json'], 'Synthetic owner message'],
  ]);
});

it('fails closed without local configuration or after close', async () => {
  const run = vi.fn<T3Runner>();
  const unconfigured = createLocalThreadClient(undefined, run); clients.push(unconfigured);
  await expect(unconfigured.read({})).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
  const client = local(run); await client.close();
  await expect(client.read({})).rejects.toThrow();
  await expect(client.send({ message: 'hello' })).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});

it('retains unknown send delivery without an automatic retry', async () => {
  const run = vi.fn<T3Runner>().mockRejectedValue(Error('PRIVATE error'));
  await expect(local(run).send({ message: 'hello' })).rejects.toThrow(/may have been queued/);
  expect(run).toHaveBeenCalledTimes(1);
});

it('denies concurrent sends even if renderer invokes twice', async () => {
  let finish!: (value: string) => void;
  const run = vi.fn<T3Runner>(() => new Promise(resolve => { finish = resolve; }));
  const client = local(run);
  const first = client.send({ message: 'one' });
  void first.catch(() => {});
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  await expect(client.send({ message: 'two' })).rejects.toThrow();
  finish(JSON.stringify(receipt));
  expect(await first).toEqual(receipt);
  expect(run).toHaveBeenCalledTimes(1);
});
