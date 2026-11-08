import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { assertSchedulerIsolation, bounded } from '../integration/j1-safety';
import { setup } from './helpers';

let h: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { h = await setup(); });
afterEach(async () => { await h.close(); });

test.each(['checkin', 'excerpt'] as const)('J1 blocks a foreign %s scheduler input without changing its rows', async kind => {
  const { projectId } = await h.create();
  if (kind === 'checkin') await h.pool.query('INSERT INTO checkins(id,project_id,data) VALUES($1,$2,$3)', [randomUUID(), projectId, { state: 'scheduled' }]);
  else {
    const binding = randomUUID();
    await h.pool.query('INSERT INTO source_bindings(id,project_id,data) VALUES($1,$2,$3)', [binding, projectId, {}]);
    await h.pool.query('INSERT INTO observations(id,project_id,binding_id,source_item,source_revision,data,received_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), projectId, binding, 'synthetic-j1-safety', '1', { excerpt: 'Synthetic fixture only' }, new Date(0)]);
  }
  const before = await h.pool.query('SELECT data FROM projects WHERE owner_id=$1', [h.ownerId]);
  await expect(assertSchedulerIsolation(h.pool, randomUUID())).rejects.toThrow('scheduler');
  expect((await h.pool.query('SELECT data FROM projects WHERE owner_id=$1', [h.ownerId])).rows).toEqual(before.rows);
  expect((await h.pool.query('SELECT 1 FROM checkins')).rowCount).toBe(kind === 'checkin' ? 1 : 0);
  expect((await h.pool.query("SELECT 1 FROM observations WHERE data ? 'excerpt'")).rowCount).toBe(kind === 'excerpt' ? 1 : 0);
});

test('J1 permits idle owners and its own scheduler inputs', async () => {
  await expect(assertSchedulerIsolation(h.pool, randomUUID())).resolves.toBeUndefined();
  const { projectId } = await h.create();
  await h.pool.query('INSERT INTO checkins(id,project_id,data) VALUES($1,$2,$3)', [randomUUID(), projectId, { state: 'scheduled' }]);
  await expect(assertSchedulerIsolation(h.pool, h.ownerId)).resolves.toBeUndefined();
});

test('a stalled native evaluation expires and enters caller cleanup', async () => {
  let cleaned = false;
  const journey = async () => { try { await bounded(new Promise<never>(() => {}), 5); } finally { cleaned = true; } };
  await expect(journey()).rejects.toThrow('Bound exceeded');
  expect(cleaned).toBe(true);
});
