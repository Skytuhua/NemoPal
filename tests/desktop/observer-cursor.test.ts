import { expect, it } from 'vitest';
import { AppServerObserver } from '../../packages/codex-observer/src/adapter';
import { localBinding, metadata, turn, finalMessage } from '../../fixtures/codex/synthetic';

it('reads fresh completed updates once and blocks truncation, replacement, changed prefixes and partial history', async () => {
  let page: unknown = { data: [turn('turn-1', [])], nextCursor: null };
  let info = structuredClone(metadata);
  const observer = new AppServerObserver({ version: async () => '0.167.0', request: async method => method === 'thread/read' ? info : page, mode: 'fixture' });
  const signal = new AbortController().signal;
  const baseline = await observer.readDelta(localBinding, null, signal);
  page = { data: [turn('turn-1', [finalMessage, finalMessage])], nextCursor: null };
  const fresh = await observer.readDelta(localBinding, baseline.nextCursor, signal);
  expect(fresh.observations.map(o => o.excerpt)).toEqual(['Synthetic build passed.']);
  expect((await observer.readDelta(localBinding, fresh.nextCursor, signal)).observations).toEqual([]);
  page = { data: [turn('turn-1', [])] };
  await expect(observer.readDelta(localBinding, fresh.nextCursor, signal)).rejects.toThrow();
  page = { data: [{ ...turn('turn-1', [finalMessage]), itemsView: 'summary' }] };
  await expect(observer.readDelta(localBinding, fresh.nextCursor, signal)).rejects.toThrow();
  info.thread.createdAt++;
  await expect(observer.readDelta(localBinding, fresh.nextCursor, signal)).rejects.toThrow();
});
it('bounds a large new turn without advancing beyond observations returned', async () => {
  let items: unknown[] = [];
  const observer = new AppServerObserver({ version: async () => '0.167.0', request: async method => method === 'thread/read' ? metadata : { data: [turn('t', items)] }, mode: 'fixture' });
  const signal = new AbortController().signal;
  const baseline = await observer.readDelta(localBinding, null, signal);
  items = Array.from({ length: 23 }, (_, i) => ({ ...finalMessage, id: `message-${i}` }));
  const first = await observer.readDelta(localBinding, baseline.nextCursor, signal);
  const second = await observer.readDelta(localBinding, first.nextCursor, signal);
  expect(first.observations).toHaveLength(20);
  expect(second.observations).toHaveLength(3);
  expect(new Set([...first.observations, ...second.observations].map(o => o.id)).size).toBe(23);
});
it('enrollment during an active turn tolerates completion of skipped baseline items without backfilling them', async () => {
  const baselineItem = { ...finalMessage, id: 'already-present', text: 'Partial progress', phase: 'commentary', completedAtMs: null };
  let page = { data: [turn('t', [baselineItem], 'inProgress')] };
  const observer = new AppServerObserver({ version: async () => '0.167.0', request: async method => method === 'thread/read' ? metadata : page, mode: 'fixture' });
  const signal = new AbortController().signal;
  const baseline = await observer.readDelta(localBinding, null, signal);
  page = { data: [turn('t', [{ ...baselineItem, text: 'Completed progress', completedAtMs: 1794050001000 }, finalMessage])] };
  const fresh = await observer.readDelta(localBinding, baseline.nextCursor, signal);
  expect(fresh.observations.map(o => o.sourceItemId)).toEqual(['t/message-final']);
  page = { data: [turn('t', [{ ...baselineItem, text: 'Completed progress', completedAtMs: 1794050001000 }, { ...finalMessage, text: 'History was rewritten' }])] };
  await expect(observer.readDelta(localBinding, fresh.nextCursor, signal)).rejects.toThrow('prefix changed');
});
