import { expect, it } from 'vitest';
import { AppServerObserver } from '../../packages/codex-observer/src/adapter';
import { localBinding, metadata, turn, finalMessage, command } from '../../fixtures/codex/synthetic';

it.each(['failed', 'interrupted'])('enrollment on a %s turn advances to later completed work without repeating it', async status => {
  const terminal = { ...turn('terminal', [], status), completedAt: 1794050001 };
  let page: { data: ReturnType<typeof turn>[] } = { data: [terminal] };
  const observer = new AppServerObserver({ version: async () => '0.166.0', mode: 'fixture', request: async method => method === 'thread/read' ? metadata : page });
  const signal = new AbortController().signal; const baseline = await observer.readDelta(localBinding, null, signal);
  page = { data: [turn('later', [finalMessage]), terminal] };
  const batch = await observer.readDelta(localBinding, baseline.nextCursor, signal);
  expect(batch.observations.map(o => o.sourceItemId)).toEqual(['later/message-final']);
  expect((await observer.readDelta(localBinding, batch.nextCursor, signal)).observations).toEqual([]);
});

it.each(['failed', 'interrupted'])('%s turns retain completed items, exclude incomplete final output, and respect the batch bound', async status => {
  const base = turn('base', []); let page = { data: [base] };
  const observer = new AppServerObserver({ version: async () => '0.166.0', mode: 'fixture', request: async method => method === 'thread/read' ? metadata : page });
  const signal = new AbortController().signal; const baseline = await observer.readDelta(localBinding, null, signal);
  const complete = Array.from({ length: 22 }, (_, i) => ({ ...finalMessage, id: `terminal-${i}` }));
  page = { data: [turn('later', [{ ...finalMessage, id: 'later' }]), { ...turn('terminal', [...complete, command, { ...finalMessage, id: 'unfinished', text: 'DO NOT EXPORT UNFINISHED', completedAtMs: null }], status), completedAt: 1794050001 }, base] };
  const first = await observer.readDelta(localBinding, baseline.nextCursor, signal);
  const second = await observer.readDelta(localBinding, first.nextCursor, signal);
  expect(first.observations).toHaveLength(20); expect(second.observations).toHaveLength(4);
  expect(second.observations.map(o => o.sourceItemId)).toEqual(['terminal/terminal-20', 'terminal/terminal-21', 'terminal/command', 'later/later']);
  expect(second.observations[2]).toMatchObject({ metadata: { type: 'tool', exitCode: 0 }, provenance: { evidenceLevel: 'source_tool_observed' } });
  expect(JSON.stringify([...first.observations, ...second.observations])).not.toContain('DO NOT EXPORT UNFINISHED');
  expect((await observer.readDelta(localBinding, second.nextCursor, signal)).observations).toEqual([]);
});

it('waits at in-progress work and fails closed on unknown turn or item statuses', async () => {
  const base = turn('base', []); let page = { data: [base] };
  const observer = new AppServerObserver({ version: async () => '0.166.0', mode: 'fixture', request: async method => method === 'thread/read' ? metadata : page });
  const signal = new AbortController().signal; const baseline = await observer.readDelta(localBinding, null, signal);
  page = { data: [turn('later', [finalMessage]), turn('active', [], 'inProgress'), base] };
  const waiting = await observer.readDelta(localBinding, baseline.nextCursor, signal);
  expect(waiting.observations).toEqual([]);
  page = { data: [turn('unknown', [], 'newVendorStatus'), base] };
  await expect(observer.readDelta(localBinding, baseline.nextCursor, signal)).rejects.toThrow();
  page = { data: [{ ...turn('terminal', [{ ...command, status: 'newVendorStatus' }], 'failed'), completedAt: 1794050001 }, base] };
  await expect(observer.readDelta(localBinding, baseline.nextCursor, signal)).rejects.toThrow();
});
