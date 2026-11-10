import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import * as c from '@living-playbooks/contracts';
import { BoundedRunner } from '@living-playbooks/nemotron';
import { goldenSnapshot } from '../../fixtures/contracts/golden';

test('existing runner supplies a bounded canonical conversation for a follow-up without a phone persona', async () => {
  const snapshot = c.ProjectSnapshotSchema.parse(goldenSnapshot);
  snapshot.messages = Array.from({ length: 20 }, (_, i) => ({ id: randomUUID(), projectId: snapshot.project.id, role: i % 2 ? 'manager' : 'owner',
    text: `Canonical turn ${i}. ` + 'x'.repeat(700), createdAt: new Date(Date.UTC(2026, 10, 8, 0, i)).toISOString(), observationIds: [] }));
  const last = snapshot.messages.at(-1)!;
  last.role = 'owner'; last.text = 'What about my previous question?';
  const job = c.ManagerJobSchema.parse({ id: randomUUID(), projectId: snapshot.project.id, kind: 'owner_message', baseProjectRevision: snapshot.project.revision,
    projectEpoch: snapshot.project.epoch, grantVersions: [], state: 'running', leaseGeneration: 1, tries: 1, runAfter: last.createdAt,
    leaseExpiresAt: new Date(Date.now() + 60000).toISOString(), inputMessageId: last.id, modelCalls: 0, toolCalls: 0, errorClass: null });
  let supplied: any;
  let instruction = '';
  const adapter: c.NemotronAdapter = { probe: async () => { throw Error('offline_fixture_no_probe'); }, next: async input => {
    instruction = input.messages[0]!.content;
    supplied = JSON.parse(input.messages[1]!.content);
    return { type: 'proposal', proposal: { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch,
      grantVersions: [], taskChanges: [], decisionSuggestions: [], workspace: snapshot.project.workspace, reply: { text: 'Synthetic reply.', observationIds: [] } } };
  } };
  await new BoundedRunner(adapter).run(job, { snapshot, grantVersions: [] }, new AbortController().signal);
  expect(supplied.conversation).toHaveLength(8);
  expect(supplied.conversation.at(-1)).toMatchObject({ role: 'owner', text: last.text });
  expect(supplied.conversation[0].text).toContain('Canonical turn 12.');
  expect(JSON.stringify(supplied.conversation)).not.toContain('Canonical turn 0.');
  expect(Buffer.byteLength(JSON.stringify(supplied.conversation))).toBeLessThanOrEqual(8192);
  expect(supplied.latestOwnerInput[0].id).toBe(last.id);
  expect(instruction).toMatch(/reply\.text.*latestOwnerInput/i);
});
