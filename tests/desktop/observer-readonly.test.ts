import { expect, it } from 'vitest';
import { ReadOnlyRpc, AppServerObserver } from '../../packages/codex-observer/src/adapter';
import { localBinding, metadata, turn, finalMessage } from '../../fixtures/codex/synthetic';

it('forbidden harness methods never reach the transport', async () => {
  const sent: string[] = [];
  const rpc = new ReadOnlyRpc({ request: async (method: string) => { sent.push(method); return {}; } });
  for (const method of ['thread/start', 'thread/resume', 'thread/fork', 'turn/start', 'turn/steer', 'turn/interrupt', 'thread/archive', 'command/exec', 'item/commandExecution/requestApproval', 'config/write', 'thread/list', 'thread/inject']) await expect(rpc.request(method, {})).rejects.toThrow();
  expect(sent).toEqual([]);
  await expect(rpc.request('thread/read', { threadId: localBinding.selectedSource, includeTurns: true })).rejects.toThrow();
  expect(sent).toEqual([]);
});
it('refuses unconsented reads, wrong identities and incompatible installed versions', async () => {
  const requests: unknown[] = [];
  const observer = new AppServerObserver({ version: async () => '0.166.0', request: async (method, params) => { requests.push({ method, params }); return metadata; }, mode: 'fixture' });
  await expect(observer.readDelta({ ...localBinding, localReadConsented: false } as never, null, new AbortController().signal)).rejects.toThrow();
  expect(requests).toEqual([]);
  await expect(observer.readDelta({ ...localBinding, binding: { ...localBinding.binding, adapterId: 'untrusted-adapter' } }, null, new AbortController().signal)).rejects.toThrow();
  expect(requests).toEqual([]);
  const foreign = new AppServerObserver({ version: async () => '0.166.0', request: async () => ({ thread: { ...metadata.thread, id: 'foreign' } }), mode: 'fixture' });
  await expect(foreign.readDelta(localBinding, null, new AbortController().signal)).rejects.toThrow('identity');
  const drift = new AppServerObserver({ version: async () => '0.167.0', request: async () => { throw Error('must not read'); }, mode: 'fixture' });
  expect((await drift.probe()).available).toBe(false);
  await expect(drift.readDelta(localBinding, null, new AbortController().signal)).rejects.toThrow('version');
});
it('enrolls at the current tail instead of importing old visible messages', async () => {
  const observer = new AppServerObserver({ version: async () => '0.166.0', request: async method => method === 'thread/read' ? metadata : { data: [turn('turn-1', [finalMessage])], nextCursor: null }, mode: 'fixture' });
  const batch = await observer.readDelta(localBinding, null, new AbortController().signal);
  expect(batch.observations).toEqual([]);
  expect(batch.nextCursor.offset).toBe(1);
});
