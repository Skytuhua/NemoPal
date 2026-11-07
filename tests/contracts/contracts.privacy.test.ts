import { expect, it } from 'vitest';
import { ObservationSchema, ManagerProposalSchema, SnoozeInputSchema, ApiErrorSchema, IngestObservationsInputSchema, AcceptedJobSchema } from '../../packages/contracts/src';
import { goldenObservation, goldenSnapshot, fixtureIds } from '../../fixtures/contracts/golden';

it('never transports tool output or activity text through the message excerpt field', () => {
  expect(ObservationSchema.safeParse({ ...goldenObservation, kind: 'tool_result_metadata', metadata: { type: 'tool', exitCode: 0 }, provenance: { ...goldenObservation.provenance, evidenceLevel: 'source_tool_observed' }, excerpt: 'arbitrary tool stdout' }).success).toBe(false);
  expect(ObservationSchema.safeParse({ ...goldenObservation, provenance: { ...goldenObservation.provenance, evidenceLevel: 'source_tool_observed' } }).success).toBe(false);
});

it('does not let model-created tasks manufacture owner authority', () => {
  const proposal = { schemaVersion: 1, jobId: crypto.randomUUID(), baseProjectRevision: 0, projectEpoch: 0, grantVersions: [], taskChanges: [{ type: 'create', task: { ...goldenSnapshot.project.tasks[0], ownerOverride: true, requirementOrigin: 'owner' } }], decisionSuggestions: [], workspace: goldenSnapshot.project.workspace, reply: { text: 'Plan', observationIds: [] } };
  expect(ManagerProposalSchema.safeParse(proposal).success).toBe(false);
});

it('uses the exact snooze and safe error contract from the supplied plan', () => {
  expect(SnoozeInputSchema.safeParse({ until: '2026-11-07T14:00:00.000Z', timezone: 'America/Chicago' }).success).toBe(true);
  expect(ApiErrorSchema.safeParse({ code: 'REVISION_CONFLICT', message: 'Refresh the project.', retryable: true, currentRevision: 2, capability: 'unavailable' }).success).toBe(true);
});

it('rejects a local cursor on an otherwise valid cloud payload', () => {
  const input = { observations: [goldenObservation] };
  expect(IngestObservationsInputSchema.safeParse(input).success).toBe(true);
  expect(IngestObservationsInputSchema.safeParse({ ...input, cursor: { offset: 1 } }).success).toBe(false);
  expect(IngestObservationsInputSchema.safeParse({ ...input, path: 'C:\\private' }).success).toBe(false);
});

it('never describes a queued job as a completed receipt', () => {
  const receipt = { operationId: crypto.randomUUID(), requestHash: 'a'.repeat(64), status: 'accepted', result: null, projectRevision: 0, eventSequence: 0 };
  const accepted = { receipt, jobId: crypto.randomUUID(), state: 'queued' };
  expect(AcceptedJobSchema.safeParse(accepted).success).toBe(true);
  expect(AcceptedJobSchema.safeParse({ ...accepted, receipt: { ...receipt, status: 'completed' } }).success).toBe(false);
});
