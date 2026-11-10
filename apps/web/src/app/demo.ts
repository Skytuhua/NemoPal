import { ProjectSnapshotSchema } from '@living-playbooks/contracts';

/** Presentation data for the existing explicit development fixture mode only. */
export function workspaceDemo() {
  const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
  const now = Date.now(), time = new Date(now).toISOString();
  const task = (number: number, title: string, status: string) => ({ id: id(number), title, status, revision: 0, requirementOrigin: 'owner', evidenceLevel: status === 'done' ? 'user_reported' : 'none', evidenceIds: [], ownerOverride: status === 'done' });
  const tasks = [task(4, 'Outline the story', 'done'), task(12, 'Build the core flow', 'done'), task(13, 'Record the walkthrough', 'done'), task(14, 'Review the recording', 'in_progress'), task(15, 'Prepare the handoff', 'blocked'), task(16, 'Share the demo', 'todo')];
  return ProjectSnapshotSchema.parse({
    project: {
      id: id(1), ownerId: id(2), title: 'Product demo', goal: 'Review the walkthrough and prepare the handoff.', revision: 0, epoch: 0,
      planState: 'accepted', phase: 'demo', status: 'active', manager: { id: id(3), projectId: id(1), displayName: 'Nemo', petPackId: 'original-nemo-v1', promptVersion: '1' }, tasks, decisions: [], updatedAt: time,
      workspace: { schemaVersion: 1, id: id(5), revision: 0, panels: [
        { id: id(20), type: 'checklist', heading: 'Tasks', taskIds: tasks.map(item => item.id) },
        { id: id(21), type: 'milestone_timeline', heading: 'Project steps', taskIds: tasks.map(item => item.id) },
        { id: id(22), type: 'evidence_card', heading: 'Files & evidence', observationIds: [id(8)] },
        { id: id(23), type: 'question_card', heading: 'Check in', checkInId: id(10) },
        { id: id(24), type: 'document_editor', heading: 'Project notes', documentId: id(9) },
        { id: id(25), type: 'next_action', heading: 'Next action', taskId: id(14) },
      ] },
    },
    brief: 'A synthetic example of a product demo project. No live source or model has run.',
    documents: [{ projectId: id(1), id: id(9), revision: 0, text: 'Review notes\nBefore sharing: check the audio and final screen.\nThe handoff still needs a short setup guide.', updatedBy: 'owner' }],
    messages: [],
    sourceBindings: [{ id: id(6), projectId: id(1), deviceId: id(7), sourceKey: 'demo-example', adapterId: 'fixture-demo', adapterVersion: '1', capability: 'history_only', grantRevision: 1, exportPolicy: 'approved_excerpts', state: 'paused', lastObservedAt: time }],
    observations: [{ id: id(8), bindingId: id(6), grantRevision: 1, sourceItemId: 'demo-review-note', sourceRevision: '1', kind: 'user_visible_message', occurredAt: time, observedAt: time, excerpt: 'Example review note: the walkthrough is recorded. Check the audio and ending before sharing. This is synthetic demo data, not an imported file.', metadata: { type: 'message', role: 'user' }, provenance: { adapterId: 'fixture-demo', adapterVersion: '1', mode: 'fixture', evidenceLevel: 'user_reported' } }],
    checkIns: [{ id: id(10), projectId: id(1), taskId: id(14), revision: 0, subjectRevision: 0, question: 'Have you reviewed the recording?', dueAt: time, expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(), state: 'available', presentationId: id(11), answer: null }],
    eventSequence: 0, connection: { mode: 'fixture', inference: { available: false, reason: 'Demo only; no live model' }, sync: 'current', demoTiming: false },
  });
}
