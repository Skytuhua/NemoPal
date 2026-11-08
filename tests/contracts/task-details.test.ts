import { expect, it } from 'vitest';
import * as c from '../../packages/contracts/src/index';
import { fixtureIds, goldenSnapshot } from '../../fixtures/contracts/golden';

const item = { id: '40000000-0000-4000-8000-000000000001', text: 'Record narration', completed: false };
const details = { type: 'update_task_details', taskId: fixtureIds.task, expectedTaskRevision: 0 };
const legacyTask = goldenSnapshot.project.tasks[0]!;

it('round trips owner task details without injecting fields into legacy tasks or commands', async () => {
  expect(c.TaskChecklistItemSchema.parse(item)).toEqual(item);
  expect(c.TaskSchema.parse(legacyTask)).toEqual(legacyTask);
  expect(c.TaskSchema.parse({ ...legacyTask, description: '', checklist: [] })).toEqual({ ...legacyTask, description: '', checklist: [] });
  const action = { ...details, description: 'Owner notes', dueAt: '2026-11-10T12:00:00.000Z', checklist: [item] };
  expect(c.OwnerActionSchema.parse(action)).toEqual(action);
  expect(c.TaskSchema.parse({ ...legacyTask, description: action.description, dueAt: action.dueAt, checklist: action.checklist })).toMatchObject({ description: 'Owner notes', checklist: [item] });
  const legacy = { operationId: item.id, expectedRevision: 0, input: { type: 'update_task', taskId: fixtureIds.task, status: 'todo' } };
  const parsed = c.revisionedCommandSchema(c.OwnerActionSchema).parse(legacy);
  expect(parsed).toEqual(legacy);
  expect(await c.hashCommand('/v1/projects/p/actions', parsed)).toBe(await c.hashCommand('/v1/projects/p/actions', legacy));
});

it('accepts explicit detail clears but requires at least one supplied detail and a task revision', () => {
  for (const change of [{ description: '' }, { dueAt: null }, { checklist: [] }]) {
    expect(c.OwnerActionSchema.safeParse({ ...details, ...change }).success).toBe(true);
  }
  for (const change of [details, { ...details, description: undefined }, { ...details, checklist: undefined }, { ...details, expectedTaskRevision: undefined, description: 'Note' }]) {
    expect(c.OwnerActionSchema.safeParse(change).success).toBe(false);
  }
});

it('bounds UTF-8 task descriptions and checklist text, count, and identity', () => {
  expect(c.TaskSchema.safeParse({ ...legacyTask, description: 'a'.repeat(4096) }).success).toBe(true);
  expect(c.TaskSchema.safeParse({ ...legacyTask, description: '界'.repeat(1366) }).success).toBe(false);
  expect(c.TaskSchema.safeParse({ ...legacyTask, checklist: [{ ...item, text: 'a'.repeat(512) }] }).success).toBe(true);
  const forty = Array.from({ length: 40 }, (_, n) => ({ ...item, id: `40000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}` }));
  expect(c.OwnerActionSchema.safeParse({ ...details, checklist: forty }).success).toBe(true);
  const invalidLists = [
    [...forty, { ...item, id: '40000000-0000-4000-8000-000000000041' }],
    [item, item], [{ ...item, id: 'not-an-id' }], [{ ...item, text: ' ' }],
    [{ ...item, text: '界'.repeat(171) }], [{ ...item, completed: 'true' }],
    [{ ...item, extra: true }], [{ ...item, evidenceLevel: 'user_reported' }],
  ];
  for (const checklist of invalidLists) {
    expect(c.TaskSchema.safeParse({ ...legacyTask, checklist }).success).toBe(false);
    expect(c.OwnerActionSchema.safeParse({ ...details, checklist }).success).toBe(false);
  }
});

it('rejects unknown detail authority, invalid clears, and malformed deadlines', () => {
  for (const extra of [{ status: 'done' }, { title: 'Renamed' }, { evidenceLevel: 'user_reported' }, { ownerOverride: true }, { description: null }, { description: 'a'.repeat(4097) }, { dueAt: '' }, { dueAt: '2026-11-10' }, { checklist: null }]) {
    expect(c.OwnerActionSchema.safeParse({ ...details, description: 'Owner note', ...extra }).success).toBe(false);
  }
});

it('keeps descriptions and checklists outside model task creation authority while preserving dueAt', () => {
  const { revision: _revision, ownerOverride: _ownerOverride, ...modelTask } = legacyTask;
  const dueAt = '2026-11-10T12:00:00.000Z';
  expect(c.ModelCreatedTaskSchema.safeParse({ ...modelTask, dueAt }).success).toBe(true);
  for (const extra of [{ description: 'Model note' }, { checklist: [item] }, { checklist: [] }]) {
    expect(c.ModelCreatedTaskSchema.safeParse({ ...modelTask, ...extra }).success).toBe(false);
  }
  expect(c.TaskChangeSchema.safeParse({ type: 'update', taskId: fixtureIds.task, expectedRevision: 0, evidenceLevel: 'none', evidenceIds: [], description: 'Model note' }).success).toBe(false);
});
