const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const fixtureIds = { project: id(1), owner: id(2), manager: id(3), task: id(4), workspace: id(5), binding: id(6), device: id(7), observation: id(8), document: id(9), checkIn: id(10), presentation: id(11) };
const timestamp = '2026-11-07T12:00:00.000Z';
export const goldenBinding = {
  id: id(6), projectId: id(1), deviceId: id(7), sourceKey: 'fixture-selected-source', adapterId: 'fixture-codex', adapterVersion: '1',
  capability: 'incremental_history', grantRevision: 1, exportPolicy: 'approved_excerpts', state: 'following', lastObservedAt: timestamp,
};
export const goldenObservation = {
  id: id(8), bindingId: id(6), grantRevision: 1, sourceItemId: 'synthetic-final-1', sourceRevision: '1', kind: 'assistant_report', occurredAt: timestamp, observedAt: timestamp,
  excerpt: 'The implementation is reported complete; recording is still pending.', metadata: { type: 'message', role: 'assistant' },
  provenance: { adapterId: 'fixture-codex', adapterVersion: '1', mode: 'fixture', evidenceLevel: 'agent_reported' },
};
export const goldenCheckIn = {
  id: id(10), projectId: id(1), taskId: id(4), revision: 0, subjectRevision: 0, question: 'Have you recorded the demo?', dueAt: timestamp,
  expiresAt: '2026-11-08T12:00:00.000Z', state: 'available', presentationId: id(11), answer: null,
};
export const goldenSnapshot = {
  project: {
    id: id(1), ownerId: id(2), title: 'Hackathon demo', goal: 'Build, test, and record the project.', revision: 0, epoch: 0,
    planState: 'proposed', phase: 'planning', status: 'active',
    manager: { id: id(3), projectId: id(1), displayName: 'Nemo', petPackId: 'original-nemo-v1', promptVersion: '1' },
    tasks: [{ id: id(4), title: 'Record the demo', status: 'todo', revision: 0, requirementOrigin: 'brief', evidenceLevel: 'none', evidenceIds: [], ownerOverride: false }],
    decisions: [],
    workspace: { schemaVersion: 1, id: id(5), revision: 0, panels: [
      { id: id(20), type: 'checklist', heading: 'Deliverables', taskIds: [id(4)] },
      { id: id(21), type: 'milestone_timeline', heading: 'Milestones', taskIds: [id(4)] },
      { id: id(22), type: 'evidence_card', heading: 'Latest evidence', observationIds: [id(8)] },
      { id: id(23), type: 'question_card', heading: 'Check in', checkInId: id(10) },
      { id: id(24), type: 'document_editor', heading: 'Demo notes', documentId: id(9) },
      { id: id(25), type: 'next_action', heading: 'Next action', taskId: id(4) },
    ] }, updatedAt: timestamp,
  },
  brief: 'Build, test, and record the project.',
  documents: [{ projectId: id(1), id: id(9), revision: 0, text: 'Explain the project, then show one real loop.', updatedBy: 'owner' }],
  messages: [{ id: id(30), projectId: id(1), role: 'manager', text: 'This is a synthetic fixture. No live model has run.', createdAt: timestamp, observationIds: [] }],
  sourceBindings: [goldenBinding], observations: [goldenObservation], checkIns: [goldenCheckIn], eventSequence: 0,
  connection: { mode: 'fixture', inference: { available: false, reason: 'Fixture mode: no Nemotron call' }, sync: 'current', demoTiming: false },
};
export const goldenObservationBatch = { observations: [goldenObservation], nextCursor: { adapterId: 'fixture-codex', identity: 'synthetic-file', offset: 100, fingerprint: 'synthetic-v1' }, mode: 'incremental_history', lastObservedAt: timestamp, coverage: 'Completed visible messages only; synthetic fixture.' };
export const revokedBinding = { ...goldenBinding, state: 'revoked', grantRevision: 2, exportPolicy: 'off' };
export const goldenOpenProjectEvent = { type: 'open_project' as const, projectId: fixtureIds.project };
export const checkInLifecycle = ['scheduled', 'available', 'presented', 'snoozed', 'answered'].map((state, revision) => ({ ...goldenCheckIn, state, revision, ...(state === 'snoozed' ? { snoozedUntil: '2026-11-07T13:00:00.000Z' } : {}), answer: state === 'answered' ? { kind: 'not_yet' } : null }));
