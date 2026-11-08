import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import * as c from '@living-playbooks/contracts';
import { validateProposal } from '@living-playbooks/nemotron';
import { fixtureIds, goldenSnapshot } from '../../fixtures/contracts/golden';

it('accepts only an active project task in a structured manager request', () => {
  const snapshot = c.ProjectSnapshotSchema.parse(goldenSnapshot);
  const job = c.ManagerJobSchema.parse({ id: randomUUID(), projectId: snapshot.project.id, kind: 'owner_message', baseProjectRevision: 0, projectEpoch: 0, grantVersions: [], state: 'running', leaseGeneration: 1, tries: 1, runAfter: new Date().toISOString(), leaseExpiresAt: new Date().toISOString(), inputMessageId: null, modelCalls: 0, toolCalls: 0, errorClass: null });
  const proposal = c.ManagerProposalSchema.parse({ schemaVersion: 1, jobId: job.id, baseProjectRevision: 0, projectEpoch: 0, grantVersions: [], taskChanges: [], decisionSuggestions: [], workspace: snapshot.project.workspace, reply: { text: 'Working on it.', observationIds: [] }, codexTask: { taskId: fixtureIds.task, text: 'Inspect this task.' } });
  expect(validateProposal(proposal, job, { snapshot, grantVersions: [] }).codexTask).toEqual(proposal.codexTask);
  expect(() => validateProposal({ ...proposal, codexTask: { ...proposal.codexTask!, taskId: randomUUID() } }, job, { snapshot, grantVersions: [] })).toThrow('proposal_codex_task');
  expect(c.ManagerProposalSchema.safeParse({ ...proposal, codexTask: { taskId: fixtureIds.task, text: 'x', extra: true } }).success).toBe(false);
});
