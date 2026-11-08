import { expect, it } from 'vitest';
import * as c from '../../packages/contracts/src/index';
import { createFixtureClient } from '../../packages/api-client/src/index';
import { fixtureIds, goldenSnapshot } from '../../fixtures/contracts/golden';

const operationId = '10000000-0000-4000-8000-000000000001';
const op = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

it('uses the shared fixture schemas and returns isolated, visibly synthetic snapshots', async () => {
  const client: c.PlaybooksClient = createFixtureClient();
  const snapshot = await client.getSnapshot(fixtureIds.project);
  expect(c.ProjectSnapshotSchema.parse(snapshot)).toEqual(goldenSnapshot);
  expect(snapshot.connection).toMatchObject({ mode: 'fixture', inference: { available: false } });
  snapshot.documents[0]!.text = 'caller mutation';
  expect((await client.getSnapshot(fixtureIds.project)).documents[0]!.text).toBe('Explain the project, then show one real loop.');
});

it('queues fixture work truthfully, replays its receipt, and rejects changed payload reuse', async () => {
  const client = createFixtureClient();
  const command = { operationId, expectedRevision: 0, input: { text: 'Owner supplied this message.' } };
  const result = await client.sendMessage(fixtureIds.project, command);
  expect(c.AcceptedJobSchema.parse(result)).toMatchObject({ state: 'queued', receipt: { status: 'accepted', operationId, projectRevision: 1 } });
  expect(await client.sendMessage(fixtureIds.project, command)).toEqual(result);
  await expect(client.sendMessage(fixtureIds.project, { ...command, input: { text: 'Different message.' } })).rejects.toMatchObject({ code: 'idempotency_conflict' });
  const snapshot = await client.getSnapshot(fixtureIds.project);
  expect(snapshot.messages.map(message => message.role)).toEqual(['manager', 'owner']);
  expect(snapshot.connection.inference.available).toBe(false);
});

it('keeps document revisions independent and rejects stale drafts without losing owner text', async () => {
  const client = createFixtureClient();
  await client.applyAction(fixtureIds.project, { operationId: op(2), expectedRevision: 0, input: { type: 'accept_plan' } });
  const saved = await client.saveDocument(fixtureIds.project, fixtureIds.document, { operationId: op(3), expectedRevision: 0, input: { text: 'Owner draft survives.' } });
  expect(c.DocumentDraftSchema.parse(saved.result)).toMatchObject({ revision: 1, updatedBy: 'owner', text: 'Owner draft survives.' });
  await expect(client.saveDocument(fixtureIds.project, fixtureIds.document, { operationId: op(4), expectedRevision: 0, input: { text: 'Stale overwrite.' } })).rejects.toMatchObject({ code: 'revision_conflict' });
  expect((await client.getSnapshot(fixtureIds.project)).documents[0]!.text).toBe('Owner draft survives.');
});

it('creates only an owner brief and a queued fixture job with no invented manager plan', async () => {
  const client = createFixtureClient({ snapshots: [] });
  const result = await client.createProject({ operationId, input: { title: 'Owner project', brief: 'The actual owner brief.' } });
  expect(c.AcceptedJobSchema.parse(result).state).toBe('queued');
  const [summary] = await client.listProjects();
  const snapshot = await client.getSnapshot(summary!.id);
  expect(snapshot).toMatchObject({ brief: 'The actual owner brief.', project: { tasks: [], planState: 'proposed' }, messages: [], connection: { mode: 'fixture', inference: { available: false } } });
});

it('snoozes by question revision, records an owner answer, and fences stale subjects', async () => {
  const client = createFixtureClient();
  const snoozed = await client.snoozeCheckIn(fixtureIds.checkIn, { operationId: op(5), expectedRevision: 0, input: { until: '2026-11-07T13:00:00.000Z', timezone: 'America/Chicago' } });
  expect(c.CheckInSchema.parse(snoozed.result)).toMatchObject({ revision: 1, state: 'snoozed', snoozedUntil: '2026-11-07T13:00:00.000Z' });
  const answered = await client.answerCheckIn(fixtureIds.checkIn, { operationId: op(6), expectedRevision: 1, input: { kind: 'recorded' } });
  expect(answered.result).toMatchObject({ revision: 2, state: 'answered', answer: { kind: 'recorded' } });
  const snapshot = await client.getSnapshot(fixtureIds.project);
  expect(snapshot.project.tasks[0]).toMatchObject({ status: 'done', ownerOverride: true, evidenceLevel: 'user_reported', revision: 1 });
  expect(snapshot.project.decisions[0]?.origin).toBe('owner');

  const stale = createFixtureClient();
  await stale.applyAction(fixtureIds.project, { operationId: op(7), expectedRevision: 0, input: { type: 'update_task', taskId: fixtureIds.task, status: 'in_progress' } });
  await expect(stale.answerCheckIn(fixtureIds.checkIn, { operationId: op(8), expectedRevision: 0, input: { kind: 'recorded' } })).rejects.toMatchObject({ code: 'revision_conflict' });
});

it.each(['todo', 'in_progress', 'blocked'] as const)('preserves the entire %s task when answering not yet, including receipt replay', async status => {
  const seed = c.ProjectSnapshotSchema.parse(structuredClone(goldenSnapshot));
  seed.project.tasks[0]!.status = status;
  seed.project.tasks[0]!.revision = 3;
  seed.project.tasks[0]!.evidenceLevel = 'agent_reported';
  seed.project.tasks[0]!.evidenceIds = [fixtureIds.observation];
  seed.project.tasks[0]!.dueAt = '2026-11-08T12:00:00.000Z';
  seed.checkIns[0]!.subjectRevision = 3;
  const originalTask = structuredClone(seed.project.tasks[0]);
  const client = createFixtureClient({ snapshots: [seed] });
  const command = { operationId: op(9), expectedRevision: 0, input: { kind: 'not_yet' as const, note: 'Still reviewing.' } };

  const answered = await client.answerCheckIn(fixtureIds.checkIn, command);
  expect(answered.result).toMatchObject({ revision: 1, state: 'answered', answer: { kind: 'not_yet', note: 'Still reviewing.' } });
  const snapshot = await client.getSnapshot(fixtureIds.project);
  expect(snapshot.project.tasks[0]).toEqual(originalTask);
  expect(snapshot.project.revision).toBe(1);
  expect(snapshot.eventSequence).toBe(1);
  expect(snapshot.project.decisions).toHaveLength(1);
  expect(snapshot.project.decisions[0]?.origin).toBe('owner');
  expect(await client.answerCheckIn(fixtureIds.checkIn, command)).toEqual(answered);
  expect(await client.getSnapshot(fixtureIds.project)).toEqual(snapshot);
});

it('delivers local fixture invalidations once and replays them from a cursor', async () => {
  const client = createFixtureClient();
  const events: c.ProjectEvent[] = [];
  const controller = new AbortController();
  const subscription = client.subscribe(0, event => events.push(event), controller.signal);
  const stopped = subscription.catch(error => error);
  const command = { operationId, expectedRevision: 0, input: { text: 'Fixture event only.' } };
  await client.sendMessage(fixtureIds.project, command);
  await client.sendMessage(fixtureIds.project, command);
  controller.abort();
  expect(await stopped).toMatchObject({ name: 'AbortError' });
  expect(events).toHaveLength(1);
  expect(c.ProjectEventSchema.parse(events[0])).toMatchObject({ seq: 1, projectId: fixtureIds.project, kind: 'message_added', revision: 1 });

  const replay: c.ProjectEvent[] = [];
  const replayController = new AbortController();
  const replaySubscription = client.subscribe(0, event => replay.push(event), replayController.signal);
  const replayStopped = replaySubscription.catch(error => error);
  replayController.abort();
  expect(await replayStopped).toMatchObject({ name: 'AbortError' });
  expect(replay).toEqual(events);
});

it('supports optional presentation envelopes without changing project revision', async () => {
  const client = createFixtureClient();
  const result = await client.presentCheckIn(fixtureIds.checkIn, { operationId, input: { presentationId: fixtureIds.presentation } });
  expect(result.result).toMatchObject({ state: 'presented', revision: 1 });
  expect((await client.getSnapshot(fixtureIds.project)).project.revision).toBe(0);
});

it('cancels fixture jobs and deletes project content without replaying deleted drafts', async () => {
  const client = createFixtureClient();
  const queued = await client.sendMessage(fixtureIds.project, { operationId: op(20), expectedRevision: 0, input: { text: 'Owner message.' } });
  const cancelled = await client.cancelJob(queued.jobId, { operationId: op(21), input: {} });
  expect(cancelled).toMatchObject({ result: null, projectRevision: 2 });
  const save = { operationId: op(22), expectedRevision: 0, input: { text: 'Deleted owner draft.' } };
  await client.saveDocument(fixtureIds.project, fixtureIds.document, save);
  const deletion = { operationId: op(23), expectedRevision: 3, input: {} };
  const deleted = await client.deleteProject(fixtureIds.project, deletion);
  expect(deleted.result).toBeNull();
  expect(await client.deleteProject(fixtureIds.project, deletion)).toEqual(deleted);
  expect(await client.listProjects()).toEqual([]);
  await expect(client.getSnapshot(fixtureIds.project)).rejects.toMatchObject({ code: 'not_found' });
  await expect(client.saveDocument(fixtureIds.project, fixtureIds.document, save)).rejects.toMatchObject({ code: 'not_found' });
});

it('rejects unsupported source mutation explicitly and prevents cross-project replay', async () => {
  const client = createFixtureClient();
  await expect(client.setSourceState(fixtureIds.binding, { operationId, input: { state: 'paused', grantRevision: 1 } })).rejects.toMatchObject({ code: 'fixture_unavailable' });
  const command = { operationId: op(30), expectedRevision: 0, input: { text: 'Project scoped.' } };
  await client.sendMessage(fixtureIds.project, command);
  await expect(client.sendMessage(fixtureIds.owner, command)).rejects.toMatchObject({ code: 'idempotency_conflict' });
  expect((await client.getSnapshot(fixtureIds.project)).sourceBindings[0]!.state).toBe('following');
});

it('rejects ambiguous fixture question identities across different projects', () => {
  const other = structuredClone(goldenSnapshot);
  other.project.id = fixtureIds.owner;
  other.project.manager.projectId = fixtureIds.owner;
  for (const records of [other.documents, other.messages, other.sourceBindings, other.checkIns]) for (const record of records) record.projectId = fixtureIds.owner;
  expect(() => createFixtureClient({ snapshots: [goldenSnapshot, other] })).toThrow(/unique/);
});
