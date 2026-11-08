import { expect, it } from 'vitest';
import { AppServerObserver } from '../../packages/codex-observer/src/adapter';
import { localBinding, metadata } from '../../fixtures/codex/synthetic';

it('uses the installed protocol version rather than the version that created the selected thread', async () => {
  const binding = { ...localBinding, binding: { ...localBinding.binding, adapterVersion: '0.167.0' } };
  const observer = new AppServerObserver({ version: async () => '0.167.0', mode: 'fixture', request: async method => method === 'thread/read' ? { thread: { ...metadata.thread, cliVersion: '0.150.0' } } : { data: [], nextCursor: null } });
  expect((await observer.probe()).available).toBe(true);
  expect((await observer.readDelta(binding, null, new AbortController().signal)).observations).toEqual([]);
});
