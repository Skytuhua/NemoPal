import { expect, it } from 'vitest';
import * as c from '../../packages/contracts/src/index';
import { goldenSnapshot, goldenObservationBatch, revokedBinding, checkInLifecycle } from '../../fixtures/contracts/golden';

it('accepts the six golden panel variants and shared lifecycle/source fixtures', () => {
  expect(c.ProjectSnapshotSchema, 'shared snapshot parser is required').toBeDefined();
  const snapshot = c.ProjectSnapshotSchema.parse(goldenSnapshot);
  expect(snapshot.project.workspace.panels.map(p => p.type)).toEqual(['checklist', 'milestone_timeline', 'evidence_card', 'question_card', 'document_editor', 'next_action']);
  expect(c.ObservationBatchSchema.parse(goldenObservationBatch).observations).toHaveLength(1);
  expect(c.SourceBindingSchema.parse(revokedBinding).state).toBe('revoked');
  expect(checkInLifecycle.map(value => c.CheckInSchema.parse(value).state)).toEqual(['scheduled', 'available', 'presented', 'snoozed', 'answered']);
});
