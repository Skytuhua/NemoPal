import { expect, it } from 'vitest';
import * as c from '../../packages/contracts/src/index';
import { goldenSnapshot } from '../../fixtures/contracts/golden';

it('rejects cross-project panel references and foreign records in snapshots', () => {
  expect(c.ProjectSnapshotSchema, 'contextual snapshot validator is required').toBeDefined();
  const snapshot = structuredClone(goldenSnapshot);
  snapshot.project.workspace.panels[0] = { id: crypto.randomUUID(), type: 'checklist', heading: 'Tasks', taskIds: [crypto.randomUUID()] };
  expect(c.ProjectSnapshotSchema.safeParse(snapshot).success).toBe(false);
  const foreign = structuredClone(goldenSnapshot);
  foreign.documents[0]!.projectId = crypto.randomUUID();
  expect(c.ProjectSnapshotSchema.safeParse(foreign).success).toBe(false);
});

it('canonical request hashes include target, ignore object key order, and preserve array order', async () => {
  expect(c.hashCommand, 'canonical command hashing is required').toBeTypeOf('function');
  const first = await c.hashCommand('/project/a', { input: { a: 1, b: 2 }, operationId: 'op' });
  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(first).toBe(await c.hashCommand('/project/a', { operationId: 'op', input: { b: 2, a: 1 } }));
  expect(first).not.toBe(await c.hashCommand('/project/b', { input: { a: 1, b: 2 }, operationId: 'op' }));
  expect(await c.hashCommand('/a', [1, 2])).not.toBe(await c.hashCommand('/a', [2, 1]));
});
