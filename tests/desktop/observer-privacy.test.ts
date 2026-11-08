import { expect, it } from 'vitest';
import { AppServerObserver } from '../../packages/codex-observer/src/adapter';
import { normalizeItem } from '../../packages/codex-observer/src/normalizer';
import { localBinding, metadata, turn, finalMessage, hidden, command, secretMessage } from '../../fixtures/codex/synthetic';

it('excludes hidden reasoning, raw tool data, credentials, diffs and commentary; labels fixture and report evidence', async () => {
  let items: unknown[] = [];
  const observer = new AppServerObserver({ version: async () => '0.167.0', request: async method => method === 'thread/read' ? metadata : { data: [turn('t', items)] }, mode: 'fixture' });
  const signal = new AbortController().signal;
  const baseline = await observer.readDelta(localBinding, null, signal);
  items = [hidden, command, secretMessage, { ...finalMessage, id: 'commentary', phase: 'commentary' }, { ...finalMessage, id: 'diff', text: 'diff --git a/x b/x\n@@ -1 +1 @@' }];
  const batch = await observer.readDelta(localBinding, baseline.nextCursor, signal);
  const json = JSON.stringify(batch);
  for (const secret of ['PRIVATE REASONING', 'NEVER EXPORT', 'RAW SECRET OUTPUT', 'secret arguments', 'top-secret-value', 'sk-test', 'diff --git']) expect(json).not.toContain(secret);
  expect(batch.observations.find(o => o.kind === 'tool_result_metadata')).toMatchObject({ metadata: { type: 'tool', exitCode: 0 }, provenance: { mode: 'fixture', evidenceLevel: 'source_tool_observed' } });
  expect(batch.observations.find(o => o.kind === 'assistant_report')?.provenance.evidenceLevel).toBe('agent_reported');
});
it('metadata exports do not fingerprint withheld text or raw command arguments/output', () => {
  const binding = { ...localBinding, binding: { ...localBinding.binding, exportPolicy: 'metadata_only' as const } };
  const time = '2026-11-07T12:00:00.000Z';
  const first = normalizeItem(command, 't', 1794050001, binding, 'fixture', time);
  const second = normalizeItem({ ...command, command: 'different secret command', aggregatedOutput: 'different private output' }, 't', 1794050001, binding, 'fixture', time);
  expect(first).toEqual(second);
  const message = normalizeItem(finalMessage, 't', 1794050001, binding, 'fixture', time);
  expect(normalizeItem({ ...finalMessage, text: 'different private message' }, 't', 1794050001, binding, 'fixture', time)).toEqual(message);
});
it('metadata mode never emits excerpts and unknown formats fail closed', async () => {
  let items: unknown[] = [];
  const observer = new AppServerObserver({ version: async () => '0.167.0', request: async method => method === 'thread/read' ? metadata : { data: [turn('t', items)] }, mode: 'fixture' });
  const binding = { ...localBinding, binding: { ...localBinding.binding, exportPolicy: 'metadata_only' as const } };
  const signal = new AbortController().signal;
  const baseline = await observer.readDelta(binding, null, signal);
  items = [finalMessage];
  expect((await observer.readDelta(binding, baseline.nextCursor, signal)).observations[0]).not.toHaveProperty('excerpt');
  items = [{ ...finalMessage, phase: 'partial_answer' }];
  expect((await observer.readDelta(binding, baseline.nextCursor, signal)).observations).toEqual([]);
  items = [{ id: 'future', type: 'newPrivatePayload', content: 'secret' }];
  await expect(observer.readDelta(binding, baseline.nextCursor, signal)).rejects.toThrow('schema');
});
