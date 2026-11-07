import { expect, it } from 'vitest';
import { AllowedClientCommandSchema, ReadToolCallSchema, ProjectSnapshotSchema, PairingResultSchema } from '../../packages/contracts/src';
import { fixtureIds, goldenSnapshot } from '../../fixtures/contracts/golden';

it('keeps privileged native and model operations outside their allowlists', () => {
  expect(AllowedClientCommandSchema.safeParse({ type: 'getSnapshot', projectId: fixtureIds.project }).success).toBe(true);
  expect(AllowedClientCommandSchema.safeParse({ type: 'fetch', url: 'file:///private' }).success).toBe(false);
  expect(AllowedClientCommandSchema.safeParse({ type: 'getSnapshot', projectId: fixtureIds.project, ownerId: fixtureIds.owner }).success).toBe(false);
  expect(ReadToolCallSchema.safeParse({ id: 'call-1', name: 'read_project_state', arguments: {} }).success).toBe(true);
  expect(ReadToolCallSchema.safeParse({ id: 'call-1', name: 'read_project_state', arguments: { projectId: crypto.randomUUID() } }).success).toBe(false);
  expect(ReadToolCallSchema.safeParse({ id: 'call-1', name: 'exec', arguments: { command: 'whoami' } }).success).toBe(false);
  expect(PairingResultSchema.safeParse({ paired: true, deviceId: fixtureIds.device, token: 'never-send-to-renderer' }).success).toBe(false);
});

it('rejects old or metadata-only source grants for an excerpt snapshot', () => {
  expect(ProjectSnapshotSchema.safeParse(goldenSnapshot).success).toBe(true);
  const stale = structuredClone(goldenSnapshot);
  stale.sourceBindings[0]!.grantRevision = 2;
  expect(ProjectSnapshotSchema.safeParse(stale).success).toBe(false);
  const metadataOnly = structuredClone(goldenSnapshot);
  metadataOnly.sourceBindings[0]!.exportPolicy = 'metadata_only';
  expect(ProjectSnapshotSchema.safeParse(metadataOnly).success).toBe(false);
  const foreignQuestion = structuredClone(goldenSnapshot);
  foreignQuestion.checkIns[0]!.taskId = crypto.randomUUID();
  expect(ProjectSnapshotSchema.safeParse(foreignQuestion).success).toBe(false);
});
