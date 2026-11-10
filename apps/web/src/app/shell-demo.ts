import { ProjectSnapshotSchema, type ProjectSnapshot } from '@living-playbooks/contracts';
import { goldenSnapshot } from '../../../../fixtures/contracts/golden';

// Renderer-only sample. The development+explicit-fixture gate remains in runtime;
// native capability failure cannot select this data and inference stays disabled.
export function shellDemo(): ProjectSnapshot {
  const sample = ProjectSnapshotSchema.parse(goldenSnapshot);
  const id = (n: number) => `00000000-0000-4000-8000-${String(200 + n).padStart(12, '0')}`;
  sample.project.title = 'Product demo';
  sample.project.goal = 'A short walkthrough, reviewed recording, and a clean handoff.';
  sample.brief = sample.project.goal;
  sample.project.planState = 'accepted';
  sample.project.phase = 'demo';
  const titles = ['Outline the demo', 'Build the main flow', 'Record the walkthrough', 'Review the recording', 'Prepare the handoff', 'Share the demo'];
  const statuses = ['done', 'done', 'done', 'in_progress', 'blocked', 'todo'] as const;
  sample.project.tasks = titles.map((title, index) => ({
    id: id(index), title, status: statuses[index]!, revision: 0, requirementOrigin: 'brief',
    evidenceLevel: index < 3 ? 'user_reported' : 'none', evidenceIds: [], ownerOverride: index < 3,
    description: [
      'Choose the problem and the main flow to demonstrate.',
      'Build the core project flow and verify the happy path.',
      'Capture a short walkthrough of the working project.',
      'Check the audio, pacing and final screen before sharing.',
      'Collect the setup guide and the final project links.',
      'Share the reviewed walkthrough and handoff with the team.',
    ][index],
    dueAt: index >= 3 ? '2026-11-10T17:00:00.000Z' : undefined,
    checklist: (index === 3 ? ['Check the audio', 'Review the ending', 'Confirm the final links'] : ['Prepare the work', 'Review the result']).map((text, item) => ({ id: id(600 + index * 10 + item), text, completed: index < 3 || (index === 3 && item === 0) })),
  }));
  const panels = sample.project.workspace.panels;
  sample.project.workspace.panels = [
    { ...panels.find(panel => panel.type === 'next_action')!, type: 'next_action', heading: 'Current action', taskId: id(3) },
    { ...panels.find(panel => panel.type === 'milestone_timeline')!, type: 'milestone_timeline', heading: 'Project steps', taskIds: titles.map((_, index) => id(index)) },
    { ...panels.find(panel => panel.type === 'checklist')!, type: 'checklist', heading: 'Tasks', taskIds: titles.map((_, index) => id(index)) },
    { ...panels.find(panel => panel.type === 'document_editor')!, type: 'document_editor', heading: 'Project notes', documentId: sample.documents[0]!.id },
    { ...panels.find(panel => panel.type === 'evidence_card')!, type: 'evidence_card', heading: 'Recent update', observationIds: [sample.observations[0]!.id] },
    { ...panels.find(panel => panel.type === 'question_card')!, type: 'question_card', heading: 'Check-in', checkInId: sample.checkIns[0]!.id },
  ];
  sample.documents[0]!.text = 'Recording review\n\nCheck the audio and final screen before sharing.\n\nHandoff\nSetup guide and final links are still needed.';
  sample.observations[0]!.excerpt = 'The walkthrough is recorded. Audio and ending still need an owner review.';
  sample.observations[0]!.metadata = { type: 'message', role: 'assistant' };
  sample.checkIns[0]!.taskId = id(3);
  sample.checkIns[0]!.question = 'Have you reviewed the recording?';
  sample.checkIns[0]!.expiresAt = '2099-01-01T00:00:00.000Z';
  sample.messages[0]!.text = 'The walkthrough is ready for your review. Once you have checked the audio and ending, we can finish the handoff.';
  return ProjectSnapshotSchema.parse(sample);
}
