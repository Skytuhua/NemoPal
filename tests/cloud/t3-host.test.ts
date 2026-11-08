import { expect, it } from 'vitest';
import { T3Host, postgresT3Gate } from '../../apps/cloud/src/integrations/t3/host';
import { buildServer } from '../../apps/cloud/src/api/server';

const principal = { ownerId: 'owner', deviceId: 'device', credentialId: 'credential' };
const selection = { projectId: 'project', bindingId: 'binding' };
const enrollment = { sourceGrantRevision: 0, expectedT3GrantRevision: 0, expectedMappingRevision: 0, taskId: 'task', taskRevision: 0, environmentId: 'env', t3ProjectId: 'source', threadId: 'thread', startPosition: 0, runId: 'run', runOrdinal: 1, expiresAt: Date.now() + 60000, localReadConsented: true as const };

function fixture() {
  let held = false, current = true, closeFails = false, opened = 0;
  const gate = { async claim() { if (held) throw Error('held'); held = true; return async () => { held = false; }; } };
  const context = { grant: { environmentId: 'env', t3ProjectId: 'source', threadId: 'thread' }, mapping: { taskId: 'task', runId: 'run', runOrdinal: 1 } };
  const store = { async enroll() { return context; }, async load() { if (!current) throw Error('revoked'); return { context }; } };
  let finish!: () => void;
  const authorization = new Promise<void>(resolve => { finish = resolve; });
  const service = { status: () => 'active', activity: () => ({ mode: 'current' }), async start(_selection: unknown, connection: { onAuthorization(url: string): void }) { opened++; connection.onAuthorization('private link'); await authorization; }, async stop() { if (closeFails) throw Error('uncertain'); finish(); } };
  const host = new T3Host({ gate, makeStore: () => store as never, makeService: () => service as never });
  return { host, gate, store, service, held: () => held, opened: () => opened, revoke: () => { current = false; }, failClose: () => { closeFails = true; } };
}

it('requires explicit consent and authenticated owner selection before opening', async () => {
  const h = fixture();
  expect(() => h.host.start(principal, { ...selection, endpoint: 'http://127.0.0.1:1234/mcp', enrollment: { ...enrollment, localReadConsented: false } })).toThrow();
  expect(h.opened()).toBe(0); expect(h.held()).toBe(false);
});

it('limits presentation to the initiating credential and current authority', async () => {
  const h = fixture();
  h.host.start(principal, { ...selection, endpoint: 'http://127.0.0.1:1234/mcp', enrollment });
  await viWait(() => h.opened() === 1);
  await expect(h.host.view({ ...principal, credentialId: 'other' })).rejects.toThrow();
  expect(await h.host.view(principal)).toMatchObject({ authorizationUrl: 'private link', activity: { mode: 'current' } });
  h.revoke(); await expect(h.host.view(principal)).rejects.toThrow();
  await h.host.shutdown(); expect(h.held()).toBe(false);
});

it('keeps the durable fence when closure cannot be confirmed', async () => {
  const h = fixture();
  h.host.start(principal, { ...selection, endpoint: 'http://127.0.0.1:1234/mcp', enrollment });
  await viWait(() => h.opened() === 1); h.failClose();
  await expect(h.host.stop(principal)).rejects.toThrow();
  expect(h.held()).toBe(true);
});

it('does not enroll or connect if shutdown wins while acquiring the fence', async () => {
  let releaseClaim!: () => void, released = false, enrolled = false, opened = false;
  const claim = new Promise<void>(resolve => { releaseClaim = resolve; });
  const host = new T3Host({ gate: { async claim() { await claim; return async () => { released = true; }; } },
    makeStore: () => ({ async enroll() { enrolled = true; }, async load() {} }) as never,
    makeService: () => ({ async start() { opened = true; }, async stop() {}, status: () => 'idle', activity: () => undefined }) as never });
  host.start(principal, { ...selection, endpoint: 'http://127.0.0.1:1234/mcp', enrollment });
  const closing = host.shutdown(); releaseClaim(); await closing;
  expect(released).toBe(true); expect(enrolled).toBe(false); expect(opened).toBe(false);
});

it('uses a database fence that prevents a second host until confirmed release', async () => {
  let token: string | undefined;
  const pool = { async query(sql: string, args: string[]) {
    if (sql.startsWith('INSERT')) { if (token) throw Error('duplicate'); token = args[0]; return { rowCount: 1 }; }
    if (token !== args[0]) return { rowCount: 0 };
    token = undefined; return { rowCount: 1 };
  } };
  const first = postgresT3Gate(pool as never); const second = postgresT3Gate(pool as never);
  const release = await first.claim();
  await expect(second.claim()).rejects.toThrow();
  await release(); const releaseSecond = await second.claim(); await releaseSecond();
});

it('registers local controls only by opt-in and requires authentication and loopback', async () => {
  const pool = { async query() { return { rows: [{ id: 'credential', owner_id: 'owner', device_id: 'device' }] }; } };
  const disabled = buildServer(pool as never);
  const noRoute = await disabled.inject({ method: 'POST', url: '/v1/local/t3/start', headers: { authorization: 'Bearer token' } });
  expect(noRoute.statusCode).toBe(404); await disabled.close();
  const enabled = buildServer(pool as never, { localT3: true });
  expect((await enabled.inject({ method: 'POST', url: '/v1/local/t3/start' })).statusCode).toBe(401);
  const remote = await enabled.inject({ method: 'POST', url: '/v1/local/t3/start', remoteAddress: '192.0.2.1', headers: { authorization: 'Bearer token' }, payload: {} });
  expect(remote.statusCode).toBe(403); await enabled.close();
});

async function viWait(condition: () => boolean) { for (let i = 0; i < 30 && !condition(); i++) await new Promise(resolve => setTimeout(resolve, 0)); expect(condition()).toBe(true); }
