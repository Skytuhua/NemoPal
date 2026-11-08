import { expect, it } from 'vitest';
import type { Pool } from 'pg';
import * as c from '../../packages/contracts/src/index';
import { Store } from '../../apps/cloud/src/domain/store';
import type { Principal } from '../../apps/cloud/src/auth/credentials';
import { fixtureIds, goldenSnapshot } from '../../fixtures/contracts/golden';

const op = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner: Principal = { credentialId: op(80), ownerId: fixtureIds.owner, deviceId: fixtureIds.device };
const now = new Date('2026-11-08T18:00:00.000Z');
const item = { id: op(90), text: 'Record narration', completed: true };
const path = `/v1/projects/${fixtureIds.project}/actions`;
const command = (n: number, expectedRevision: number, input: Record<string, unknown>) => c.revisionedCommandSchema(c.OwnerActionSchema).parse({ operationId: op(n), expectedRevision, input: { type: 'update_task_details', taskId: fixtureIds.task, expectedTaskRevision: expectedRevision, ...input } });
type SavedReceipt = { actorId: string; operationId: string; requestHash: string; response: unknown };
type State = { project: c.Project; receipts: SavedReceipt[]; events: unknown[] };

/** Test-owned SQL boundary: real Store/transaction/auth/hash/save logic, no PostgreSQL connection. */
function offlineStore() {
  const project = c.ProjectSchema.parse(goldenSnapshot.project);
  Object.assign(project.tasks[0]!, { status: 'blocked', evidenceLevel: 'agent_reported', evidenceIds: [fixtureIds.observation], ownerOverride: false });
  let state: State = { project, receipts: [], events: [] };
  let tail = Promise.resolve();
  const pool = {
    async connect() {
      let local: State | undefined;
      let unlock: (() => void) | undefined;
      return {
        async query(sql: string, values: readonly unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> {
          if (sql === 'BEGIN') return { rows: [] };
          if (sql.startsWith('SELECT id FROM credentials')) return { rows: values[0] === owner.credentialId && values[1] === owner.ownerId && values[2] === owner.deviceId ? [{ id: owner.credentialId }] : [] };
          if (sql === 'SELECT id FROM owners WHERE id=$1 FOR UPDATE') {
            const previous = tail;
            tail = new Promise<void>(resolve => { unlock = resolve; });
            await previous;
            local = structuredClone(state);
            return { rows: [{ id: values[0] }] };
          }
          if (sql === 'ROLLBACK') { unlock?.(); unlock = undefined; return { rows: [] }; }
          if (!local) throw new Error(`Unexpected query before owner lock: ${sql}`);
          if (sql === 'COMMIT') { state = structuredClone(local); unlock?.(); unlock = undefined; return { rows: [] }; }
          if (sql === 'SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE') {
            return { rows: values[0] === local.project.id && values[1] === local.project.ownerId ? [{ data: structuredClone(local.project), deleted: false }] : [] };
          }
          if (sql === 'SELECT * FROM command_receipts WHERE actor_id=$1 AND operation_id=$2') {
            const found = local.receipts.find(receipt => receipt.actorId === values[0] && receipt.operationId === values[1]);
            return { rows: found ? [{ request_hash: found.requestHash, response: structuredClone(found.response) }] : [] };
          }
          if (sql === 'UPDATE projects SET data=$2,revision=$3,epoch=$4 WHERE id=$1') {
            if (values[0] !== local.project.id) throw new Error('Project write escaped its lock.');
            local.project = c.ProjectSchema.parse(structuredClone(values[1]));
            if (values[2] !== local.project.revision || values[3] !== local.project.epoch) throw new Error('Project JSON and revision columns diverged.');
            return { rows: [] };
          }
          if (sql === 'INSERT INTO events(owner_id,project_id,data) VALUES($1,$2,$3) RETURNING seq') {
            if (values[0] !== owner.ownerId || values[1] !== local.project.id) throw new Error('Event escaped project ownership.');
            local.events.push(structuredClone(values[2]));
            return { rows: [{ seq: local.events.length }] };
          }
          if (sql === 'INSERT INTO command_receipts(actor_id,operation_id,project_id,request_hash,response) VALUES($1,$2,$3,$4,$5)') {
            if (values[2] !== local.project.id) throw new Error('Receipt escaped project ownership.');
            local.receipts.push({ actorId: String(values[0]), operationId: String(values[1]), requestHash: String(values[3]), response: structuredClone(values[4]) });
            return { rows: [] };
          }
          throw new Error(`Unimplemented test-owned SQL boundary: ${sql}`);
        },
        release() { if (unlock) throw new Error('Transaction released without commit or rollback.'); },
      };
    },
  } as unknown as Pool;
  const store = new Store(pool, () => now);
  const action = async (envelope: c.RevisionedCommandEnvelope<c.OwnerAction>, principal = owner, projectId = fixtureIds.project): Promise<c.CommandReceipt<c.Project>> => store.action(principal, path, projectId, envelope);
  return { action, pool, read: () => structuredClone(state) };
}

it('writes owner details once through validated project persistence and retains task authority', async () => {
  const db = offlineStore();
  const original = db.read().project.tasks[0]!;
  const first = command(1, 0, { description: 'Owner note', dueAt: '2026-11-10T12:00:00.000Z', checklist: [item] });
  const saved = await db.action(first);
  expect(saved.result.tasks[0]).toEqual({ ...original, revision: 1, description: 'Owner note', dueAt: '2026-11-10T12:00:00.000Z', checklist: [item] });
  expect(saved).toMatchObject({ status: 'completed', projectRevision: 1, eventSequence: 1 });
  expect(db.read().project).toEqual(saved.result);
  expect(saved.result.decisions).toEqual([]);
  const nextStore = new Store(db.pool, () => now);
  await nextStore.action(owner, path, fixtureIds.project, command(2, 1, { description: 'Updated note' }));
  expect(db.read().project.tasks[0]).toMatchObject({ revision: 2, description: 'Updated note', dueAt: '2026-11-10T12:00:00.000Z', checklist: [item] });
  const cleared = await db.action(command(3, 2, { description: '', dueAt: null, checklist: [] }));
  expect(cleared.result.tasks[0]).toEqual({ ...original, revision: 3, description: '', checklist: [] });
  expect(await db.action(first)).toEqual(saved);
  expect(db.read().project.revision).toBe(3);
  expect(db.read().events).toHaveLength(3);
  expect(db.read().receipts).toHaveLength(3);
});

it('rejects stale task and project revisions or changed operation bodies without partial writes', async () => {
  const db = offlineStore();
  const first = command(10, 0, { checklist: [item] });
  await db.action(first);
  const before = db.read();
  await expect(db.action(command(11, 1, { expectedTaskRevision: 0, description: 'Stale task' }))).rejects.toMatchObject({ code: 'revision_conflict', currentRevision: 1 });
  await expect(db.action(command(12, 0, { expectedTaskRevision: 1, description: 'Stale project' }))).rejects.toMatchObject({ code: 'revision_conflict', currentRevision: 1 });
  await expect(db.action(command(10, 0, { description: 'Changed replay' }))).rejects.toMatchObject({ code: 'operation_conflict' });
  await expect(db.action(command(13, 1, { taskId: op(99), checklist: [] }))).rejects.toMatchObject({ code: 'not_found' });
  expect(db.read()).toEqual(before);
});

it('serializes concurrent owner detail edits so a stale edit cannot replace the accepted one', async () => {
  const db = offlineStore();
  const results = await Promise.allSettled([
    db.action(command(20, 0, { description: 'First edit' })),
    db.action(command(21, 0, { description: 'Stale concurrent edit' })),
  ]);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  if (results[1]!.status === 'rejected') expect(results[1]!.reason).toMatchObject({ code: 'revision_conflict' });
  expect(db.read().project.tasks[0]).toMatchObject({ description: 'First edit', revision: 1 });
  expect(db.read().project.revision).toBe(1);
  expect(db.read().events).toHaveLength(1);
});

it('checks current authorization and project ownership before editing or replaying details', async () => {
  const db = offlineStore();
  const edit = command(30, 0, { description: 'Owner note' });
  await db.action(edit);
  const before = db.read();
  await expect(db.action(edit, { ...owner, credentialId: op(70) })).rejects.toMatchObject({ code: 'unauthorized' });
  await expect(db.action(command(31, 1, { checklist: [] }), owner, op(71))).rejects.toMatchObject({ code: 'not_found' });
  expect(db.read()).toEqual(before);
});
