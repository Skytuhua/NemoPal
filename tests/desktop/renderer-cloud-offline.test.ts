import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { ProjectSchema, type DesktopBridge, type PlaybooksClient } from '@living-playbooks/contracts';
import { createHttpClient } from '../../packages/api-client/src/client';
import { buildServer } from '../../apps/cloud/src/api/server';
import { runtime } from '../../apps/web/src/app/runtime';
import { fixtureIds, goldenSnapshot } from '../../fixtures/contracts/golden';
import { startSyntheticMain } from './main-harness';

// This is a test-owned SQL boundary, not a database or a provider connection.
it('routes a renderer owner edit through preload, native IPC, main authorization, HTTP validation and the cloud route', async () => {
  const token = 'synthetic-main-port-token';
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const credentialId = '80000000-0000-4000-8000-000000000001';
  const operationId = '80000000-0000-4000-8000-000000000002';
  let project = ProjectSchema.parse(structuredClone(goldenSnapshot.project));
  let revoked = false;
  const receipts = new Map<string, { request_hash: string; response: unknown }>();
  const calls: Array<{ path: string; authorization: string | null }> = [];
  const query = async (sql: string, values: readonly unknown[] = []) => {
    if (sql.startsWith('SELECT * FROM credentials WHERE secret_hash=')) return { rows: !revoked && values[0] === tokenHash ? [{ id: credentialId, owner_id: fixtureIds.owner, device_id: fixtureIds.device }] : [] };
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.startsWith('SELECT id FROM credentials WHERE id=')) return { rows: !revoked && values[0] === credentialId && values[1] === fixtureIds.owner && values[2] === fixtureIds.device ? [{ id: credentialId }] : [] };
    if (sql === 'SELECT id FROM owners WHERE id=$1 FOR UPDATE') return { rows: [{ id: fixtureIds.owner }] };
    if (sql === 'SELECT data FROM projects WHERE owner_id=$1 AND NOT deleted ORDER BY id LIMIT 1000') return { rows: values[0] === project.ownerId ? [{ data: structuredClone(project) }] : [] };
    if (sql.startsWith('SELECT count(*) FROM checkins')) return { rows: [{ count: 0 }] };
    if (sql === 'SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE') return { rows: values[0] === project.id && values[1] === project.ownerId ? [{ data: structuredClone(project), deleted: false }] : [] };
    if (sql === 'SELECT * FROM command_receipts WHERE actor_id=$1 AND operation_id=$2') return { rows: receipts.has(String(values[1])) ? [receipts.get(String(values[1]))!] : [] };
    if (sql === 'UPDATE projects SET data=$2,revision=$3,epoch=$4 WHERE id=$1') { project = structuredClone(values[1]) as typeof project; return { rows: [] }; }
    if (sql === 'INSERT INTO events(owner_id,project_id,data) VALUES($1,$2,$3) RETURNING seq') return { rows: [{ seq: 1 }] };
    if (sql === 'INSERT INTO command_receipts(actor_id,operation_id,project_id,request_hash,response) VALUES($1,$2,$3,$4,$5)') { receipts.set(String(values[1]), { request_hash: String(values[3]), response: structuredClone(values[4]) }); return { rows: [] }; }
    throw Error(`Unexpected synthetic SQL: ${sql}`);
  };
  const pool = { query, async connect() { return { query, release() {} }; } } as unknown as Pool;
  const cloud = buildServer(pool, { now: () => new Date('2026-11-08T18:00:00Z') });
  const syntheticFetch: typeof fetch = async (url, init) => {
    const parsed = new URL(String(url));
    const headers = new Headers(init?.headers);
    calls.push({ path: parsed.pathname, authorization: headers.get('authorization') });
    const result = await cloud.inject({ method: init?.method as 'GET' | 'POST', url: parsed.pathname + parsed.search, headers: Object.fromEntries(headers.entries()), ...(init?.body ? { payload: String(init.body) } : {}) });
    return new Response(result.body, { status: result.statusCode, headers: { 'content-type': String(result.headers['content-type'] ?? 'application/json') } });
  };
  vi.stubGlobal('fetch', syntheticFetch);
  const main = await startSyntheticMain({ clientFactory(configuration, defaults) {
    const http = createHttpClient(configuration);
    return { ...http, getSnapshot: defaults.getSnapshot!, subscribe: defaults.subscribe! };
  } });
  try {
    let bridge: DesktopBridge | undefined;
    vi.doMock('electron', () => ({ contextBridge: { exposeInMainWorld: (_name: string, value: DesktopBridge) => { bridge = value; } }, ipcRenderer: { invoke: (channel: string, operation: string, input?: unknown) => { expect(channel).toBe('lp:workspace'); return main.invoke(operation, input); }, on() {}, removeListener() {} } }));
    await import('../../apps/desktop/src/preload/workspace');
    expect(bridge).toBeDefined();
    expect(Object.keys(bridge!)).not.toContain('token');
    const renderer = runtime(bridge, false, false);
    expect(renderer.fixture).toBe(false);
    const client: PlaybooksClient = renderer.client!;
    expect((await client.listProjects()).map(item => item.id)).toContain(project.id);
    const command = { operationId, expectedRevision: project.revision, input: { type: 'update_task_details' as const, taskId: fixtureIds.task, expectedTaskRevision: project.tasks[0]!.revision, description: 'Synthetic owner detail' } };
    const receipt = await client.applyAction(project.id, command);
    expect(receipt.result.tasks[0]?.description).toBe('Synthetic owner detail');
    expect(project.tasks[0]?.description).toBe('Synthetic owner detail');
    expect(calls.some(call => call.path === `/v1/projects/${project.id}/actions` && call.authorization === `Bearer ${token}`)).toBe(true);
    expect(JSON.stringify(receipt)).not.toContain(token);
    const before = structuredClone(project);
    revoked = true;
    await expect(client.applyAction(project.id, { ...command, operationId: '80000000-0000-4000-8000-000000000003', expectedRevision: project.revision })).rejects.toThrow('Native request rejected');
    expect(project).toEqual(before);
  } finally {
    vi.unstubAllGlobals();
    await main.close();
    await cloud.close();
  }
});
