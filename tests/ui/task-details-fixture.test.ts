import { expect, it } from 'vitest';
import * as c from '../../packages/contracts/src/index';
import { createFixtureClient } from '../../packages/api-client/src/index';
import { fixtureIds, goldenSnapshot } from '../../fixtures/contracts/golden';

const op = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = { id: op(90), text: 'Record narration', completed: true };
const command = (n: number, expectedRevision: number, input: Record<string, unknown>) => c.revisionedCommandSchema(c.OwnerActionSchema).parse({ operationId: op(n), expectedRevision, input: { type: 'update_task_details', taskId: fixtureIds.task, expectedTaskRevision: expectedRevision, ...input } });
function seed() {
  const value = c.ProjectSnapshotSchema.parse(goldenSnapshot);
  Object.assign(value.project.tasks[0]!, { status: 'in_progress', evidenceLevel: 'agent_reported', evidenceIds: [fixtureIds.observation], ownerOverride: true });
  return value;
}

it('persists fixture details and explicit clears without inventing completion or evidence', async () => {
  const initial = seed();
  const original = structuredClone(initial.project.tasks[0]!);
  const client = createFixtureClient({ snapshots: [initial] });
  const first = command(1, 0, { description: 'Owner notes', dueAt: '2026-11-10T12:00:00.000Z', checklist: [item] });
  const saved = await client.applyAction(fixtureIds.project, first);
  expect(saved.result.tasks[0]).toEqual({ ...original, revision: 1, description: 'Owner notes', dueAt: '2026-11-10T12:00:00.000Z', checklist: [item] });
  expect(saved).toMatchObject({ projectRevision: 1, eventSequence: 1 });
  expect(saved.result.decisions).toEqual([]);
  await client.applyAction(fixtureIds.project, command(2, 1, { description: 'Updated notes' }));
  expect((await client.getSnapshot(fixtureIds.project)).project.tasks[0]).toMatchObject({ description: 'Updated notes', dueAt: '2026-11-10T12:00:00.000Z', checklist: [item] });
  const cleared = await client.applyAction(fixtureIds.project, command(3, 2, { description: '', dueAt: null, checklist: [] }));
  expect(cleared.result.tasks[0]).toEqual({ ...original, revision: 3, description: '', checklist: [] });
  expect(await client.applyAction(fixtureIds.project, first)).toEqual(saved);
  expect((await client.getSnapshot(fixtureIds.project)).project.revision).toBe(3);
});

it('serializes fixture edits and rejects stale task/project revisions, changed replay bodies, and missing tasks', async () => {
  const client = createFixtureClient({ snapshots: [seed()] });
  const first = command(4, 0, { description: 'First owner edit' });
  const second = command(5, 0, { description: 'Concurrent stale edit' });
  const results = await Promise.allSettled([client.applyAction(fixtureIds.project, first), client.applyAction(fixtureIds.project, second)]);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  await expect(client.applyAction(fixtureIds.project, command(6, 1, { expectedTaskRevision: 0, checklist: [] }))).rejects.toMatchObject({ code: 'revision_conflict' });
  await expect(client.applyAction(fixtureIds.project, command(7, 0, { expectedTaskRevision: 1, checklist: [] }))).rejects.toMatchObject({ code: 'revision_conflict' });
  await expect(client.applyAction(fixtureIds.project, command(4, 0, { description: 'Changed body' }))).rejects.toMatchObject({ code: 'idempotency_conflict' });
  await expect(client.applyAction(fixtureIds.project, command(8, 1, { taskId: op(99), checklist: [] }))).rejects.toMatchObject({ code: 'not_found' });
  const snapshot = await client.getSnapshot(fixtureIds.project);
  expect(snapshot.project.tasks[0]).toMatchObject({ description: 'First owner edit', revision: 1 });
  expect(snapshot.eventSequence).toBe(1);
});

it('rejects malformed fixture commands before any project mutation', async () => {
  const client = createFixtureClient({ snapshots: [seed()] });
  const before = await client.getSnapshot(fixtureIds.project);
  const valid = command(10, 0, { checklist: [item] });
  for (const input of [{ ...valid.input, checklist: [item, item] }, { ...valid.input, checklist: [{ ...item, status: 'done' }] }, { ...valid.input, description: 'a'.repeat(4097) }]) {
    await expect(client.applyAction(fixtureIds.project, { ...valid, input } as c.RevisionedCommandEnvelope<c.OwnerAction>)).rejects.toMatchObject({ code: 'invalid_command' });
  }
  expect(await client.getSnapshot(fixtureIds.project)).toEqual(before);
});
