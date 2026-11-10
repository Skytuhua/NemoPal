import { expect, test } from 'vitest';
import * as c from '@living-playbooks/contracts';
import { BoundedRunner, executeReadTool } from '@living-playbooks/nemotron';
import { goldenSnapshot } from '../../fixtures/contracts/golden';

function context() {
  const snapshot = c.ProjectSnapshotSchema.parse(goldenSnapshot), task = snapshot.project.tasks[0]!;
  snapshot.project.tasks = Array.from({ length: 3 }, (_, index) => ({ ...task,
    id: index ? `00000000-0000-4000-8000-${String(500 + index).padStart(12, '0')}` : task.id,
    description: 'd'.repeat(4096),
    checklist: Array.from({ length: 40 }, (_, item) => ({ id: `00000000-0000-4000-8000-${String(1000 + index * 40 + item).padStart(12, '0')}`, text: 'x'.repeat(512), completed: false })),
  }));
  return c.AuthorizedProjectContextSchema.parse({ snapshot, grantVersions: [] });
}

test('valid owner metadata cannot consume the model prompt and scoped project-read budgets', async () => {
  const value = context(), before = structuredClone(value);
  const job = c.ManagerJobSchema.parse({ id: '00000000-0000-4000-8000-000000009999', projectId: value.snapshot.project.id,
    kind: 'owner_message', baseProjectRevision: value.snapshot.project.revision, projectEpoch: value.snapshot.project.epoch,
    grantVersions: [], state: 'running', leaseGeneration: 1, tries: 1, runAfter: '2026-11-08T12:00:00.000Z',
    leaseExpiresAt: null, inputMessageId: null, modelCalls: 0, toolCalls: 0, errorClass: null });
  const inputs: c.ModelTurnInput[] = [];
  const adapter: c.NemotronAdapter = {
    probe: async () => { throw new Error('No provider access'); },
    next: async input => {
      inputs.push(structuredClone(input));
      if (inputs.length === 1) return { type: 'tool_calls', calls: [{ id: 'local-read', name: 'read_project_state', arguments: {} }] };
      throw new Error('local_probe_complete');
    },
  };
  await expect(new BoundedRunner(adapter).run(job, value, new AbortController().signal)).rejects.toThrow('local_probe_complete');
  expect(inputs).toHaveLength(2);
  expect(c.utf8Bytes(JSON.stringify(inputs[1]!.messages))).toBeLessThan(c.LIMITS.contextBytes);
  expect(JSON.parse(inputs[0]!.messages[1]!.content).tasks[0]).not.toHaveProperty('checklist');
  expect(JSON.parse(inputs[0]!.messages[1]!.content).tasks[0]).not.toHaveProperty('description');
  expect(value).toEqual(before);
});

test('project read retains canonical task state while excluding owner-only rich fields', () => {
  const value = context();
  const result = executeReadTool({ id: 'read', name: 'read_project_state', arguments: {} }, value) as { project: c.Project };
  expect(c.utf8Bytes(JSON.stringify(result))).toBeLessThan(c.LIMITS.contextBytes);
  expect(result.project.tasks.map(task => ({ id: task.id, status: task.status, revision: task.revision }))).toEqual(value.snapshot.project.tasks.map(task => ({ id: task.id, status: task.status, revision: task.revision })));
  expect(result.project.tasks[0]).not.toHaveProperty('description');
  expect(result.project.tasks[0]).not.toHaveProperty('checklist');
  expect(value.snapshot.project.tasks[0]!.checklist).toHaveLength(40);
});
