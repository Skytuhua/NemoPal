import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { migrate } from '../../apps/cloud/src/db/migrate';
import { issueGrant, redeem, revokeDevice } from '../../apps/cloud/src/auth/credentials';
import { buildServer } from '../../apps/cloud/src/api/server';
import { JobQueue } from '../../apps/cloud/src/jobs/queue';

let pool: Pool;
let app: ReturnType<typeof buildServer>;
let queue: JobQueue;
let now: Date;
let ownerId: string;
let deviceId: string;

// Opt in only with a dedicated disposable database; never reuse DATABASE_URL.
describe.skipIf(!process.env.QUEUE_RELEASE_TEST_DATABASE_URL)('isolated PostgreSQL claim release', () => {
beforeEach(async () => {
  const url = new URL(process.env.QUEUE_RELEASE_TEST_DATABASE_URL ?? '');
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.username !== 'queue_test' || !url.port || url.search || url.hash || !/^\/queue_release_[a-z0-9_]+$/.test(url.pathname)) throw Error('Expected the isolated queue release database');
  pool = new Pool({ connectionString: url.href });
  await migrate(pool);
  await pool.query('TRUNCATE owners CASCADE');
  const grant = await issueGrant(pool, { timezone: 'UTC' });
  const auth = await redeem(pool, grant.code);
  ownerId = grant.ownerId; deviceId = auth.deviceId;
  app = buildServer(pool);
  const response = await app.inject({ method: 'POST', url: '/v1/projects', headers: { authorization: `Bearer ${auth.token}` }, payload: { operationId: randomUUID(), input: { title: 'Synthetic', brief: 'Synthetic release test' } } });
  expect(response.statusCode).toBe(200);
  now = new Date(Date.now() + 1000);
  queue = new JobQueue(pool, () => now);
});
afterEach(async () => { await app?.close(); await pool?.end(); });

test('releases an unstarted claim once, refunds its try, and fences that generation', async () => {
  const job = (await queue.claim())!;
  expect(job).toBeTruthy();
  expect(await queue.releaseUnstarted(job)).toBe(true);
  expect(await queue.releaseUnstarted(job)).toBe(false);
  const next = (await queue.claim())!;
  expect(next.id).toBe(job.id);
  expect(next.tries).toBe(job.tries);
  expect(next.leaseGeneration).toBeGreaterThan(job.leaseGeneration);
  await expect(queue.context(job)).rejects.toThrow('lease_lost');
});

test('a stale release cannot touch a reclaimed generation', async () => {
  const old = (await queue.claim())!;
  now = new Date(now.getTime() + 181000);
  const current = (await queue.claim())!;
  expect(await queue.releaseUnstarted(old)).toBe(false);
  expect((await pool.query('SELECT state, generation FROM jobs WHERE id=$1', [old.id])).rows[0]).toMatchObject({ state: 'running', generation: current.leaseGeneration });
});

test('concurrent releases and claim admit only one new generation', async () => {
  const job = (await queue.claim())!;
  const released = await Promise.all([queue.releaseUnstarted(job), queue.releaseUnstarted(job)]);
  expect(released.filter(Boolean)).toHaveLength(1);
  const claimed = await Promise.all([queue.claim(), queue.claim()]);
  expect(claimed.filter(Boolean)).toHaveLength(1);
  expect(claimed.find(Boolean)!.tries).toBe(job.tries);
});

test('a claim racing release never receives the old generation', async () => {
  const job = (await queue.claim())!;
  const [released, competing] = await Promise.all([queue.releaseUnstarted(job), queue.claim()]);
  expect(released).toBe(true);
  const next = competing ?? await queue.claim();
  expect(next?.id).toBe(job.id);
  expect(next!.leaseGeneration).toBeGreaterThan(job.leaseGeneration);
  expect(next!.tries).toBe(job.tries);
});

test('work that entered the queue cannot be released, even before model calls', async () => {
  const job = (await queue.claim())!;
  await queue.context(job);
  expect(await queue.releaseUnstarted(job)).toBe(false);
  expect((await pool.query('SELECT state FROM jobs WHERE id=$1', [job.id])).rows[0].state).toBe('running');
});

test('revoked authority cannot be requeued', async () => {
  const job = (await queue.claim())!;
  await revokeDevice(pool, ownerId, deviceId);
  await expect(queue.releaseUnstarted(job)).rejects.toThrow();
  expect((await pool.query('SELECT state, generation FROM jobs WHERE id=$1', [job.id])).rows[0]).toMatchObject({ state: 'running', generation: job.leaseGeneration });
});

test('authority expiring while release waits for a row is not requeued', async () => {
  const job = (await queue.claim())!;
  await pool.query('UPDATE credentials SET expires_at=$2 WHERE device_id=$1', [deviceId, new Date(now.getTime() + 1000)]);
  const delayedPool = { connect: async () => {
    const client = await pool.connect();
    return {
      query: async (sql: string, args?: unknown[]) => {
        if (sql.startsWith('SELECT * FROM jobs WHERE id=')) now = new Date(now.getTime() + 2000);
        return client.query(sql, args);
      },
      release: () => client.release(),
    };
  } } as unknown as Pool;
  await expect(new JobQueue(delayedPool, () => now).releaseUnstarted(job)).rejects.toThrow();
  expect((await pool.query('SELECT state, generation FROM jobs WHERE id=$1', [job.id])).rows[0]).toMatchObject({ state: 'running', generation: job.leaseGeneration });
});

test('a revoked phone link cannot be restored by release', async () => {
  const original = (await queue.claim())!;
  await queue.releaseUnstarted(original);
  const linkId = randomUUID();
  const authority = { kind: 'sendblue', linkId, linkRevision: 0, ownerId, projectId: original.projectId, account: 'synthetic@example.invalid', line: '+15550000001', sender: '+15550000002' };
  await pool.query('INSERT INTO sendblue_links(id,owner_id,project_id,account,receiving_line,sender,actions,revision,active,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,0,true,$8)', [linkId, ownerId, original.projectId, authority.account, authority.line, authority.sender, ['manager'], new Date(now.getTime() + 3600000)]);
  await pool.query('UPDATE jobs SET authority=$2 WHERE id=$1', [original.id, authority]);
  const phoneQueue = new JobQueue(pool, () => now, { enabled: true, account: authority.account, line: authority.line, keyId: 'synthetic', apiSecret: 'synthetic', signingSecret: 'synthetic' });
  const job = (await phoneQueue.claim())!;
  expect(job).toBeTruthy();
  await pool.query('UPDATE sendblue_links SET active=false,revision=revision+1 WHERE id=$1', [linkId]);
  await expect(phoneQueue.releaseUnstarted(job)).rejects.toThrow();
  expect((await pool.query('SELECT state, generation FROM jobs WHERE id=$1', [job.id])).rows[0]).toMatchObject({ state: 'running', generation: job.leaseGeneration });
});

test('database errors do not claim success or alter the fence', async () => {
  const job = (await queue.claim())!;
  const faultyPool = { connect: async () => { throw Error('synthetic database outage'); } } as unknown as Pool;
  await expect(new JobQueue(faultyPool, () => now).releaseUnstarted(job)).rejects.toThrow('synthetic database outage');
  expect((await pool.query('SELECT state, generation FROM jobs WHERE id=$1', [job.id])).rows[0]).toMatchObject({ state: 'running', generation: job.leaseGeneration });
});

test('a failed work operation still leaves the start fence committed', async () => {
  const job = (await queue.claim())!;
  await pool.query("UPDATE projects SET data=jsonb_set(data,'{revision}',to_jsonb((data->>'revision')::integer + 1)) WHERE id=$1", [job.projectId]);
  await expect(queue.context(job)).rejects.toThrow('proposal_stale');
  expect(await queue.releaseUnstarted(job)).toBe(false);
});

test('legacy running claims without an eligibility marker are not released', async () => {
  const job = (await queue.claim())!;
  await pool.query("UPDATE jobs SET authority=authority - 'unstartedGeneration' WHERE id=$1", [job.id]);
  expect(await queue.releaseUnstarted(job)).toBe(false);
});

test('start and release serialize: only the winner can use the generation', async () => {
  const job = (await queue.claim())!;
  const [release, start] = await Promise.allSettled([queue.releaseUnstarted(job), queue.context(job)]);
  expect(release.status).toBe('fulfilled');
  if (release.status !== 'fulfilled') throw Error('unexpected release failure');
  if (release.value) {
    expect(start.status).toBe('rejected');
    const next = (await queue.claim())!;
    expect(next.leaseGeneration).toBeGreaterThan(job.leaseGeneration);
  } else {
    expect(start.status).toBe('fulfilled');
    expect((await pool.query('SELECT state FROM jobs WHERE id=$1', [job.id])).rows[0].state).toBe('running');
  }
});

test('a lost commit acknowledgement reports an error and a retry cannot release a newer claim', async () => {
  const job = (await queue.claim())!;
  const uncertainPool = { connect: async () => {
    const client = await pool.connect();
    return {
      query: async (sql: string, args?: unknown[]) => {
        const result = await client.query(sql, args);
        if (sql === 'COMMIT') throw Error('synthetic lost commit acknowledgement');
        return result;
      },
      release: () => client.release(),
    };
  } } as unknown as Pool;
  await expect(new JobQueue(uncertainPool, () => now).releaseUnstarted(job)).rejects.toThrow('synthetic lost commit acknowledgement');
  const next = (await queue.claim())!;
  expect(next.leaseGeneration).toBeGreaterThan(job.leaseGeneration);
  expect(await queue.releaseUnstarted(job)).toBe(false);
  expect((await pool.query('SELECT generation, state FROM jobs WHERE id=$1', [job.id])).rows[0]).toMatchObject({ generation: next.leaseGeneration, state: 'running' });
});

test('a failed event write rolls back the release and retains its fence', async () => {
  const job = (await queue.claim())!;
  const faultyPool = { connect: async () => {
    const client = await pool.connect();
    return {
      query: async (sql: string, args?: unknown[]) => {
        if (sql.startsWith('INSERT INTO events')) throw Error('synthetic event failure');
        return client.query(sql, args);
      },
      release: () => client.release(),
    };
  } } as unknown as Pool;
  await expect(new JobQueue(faultyPool, () => now).releaseUnstarted(job)).rejects.toThrow('synthetic event failure');
  const row = (await pool.query('SELECT state, generation, data, authority FROM jobs WHERE id=$1', [job.id])).rows[0];
  expect(row).toMatchObject({ state: 'running', generation: job.leaseGeneration, data: { tries: job.tries }, authority: { unstartedGeneration: job.leaseGeneration } });
  expect(await queue.releaseUnstarted(job)).toBe(true);
});
});
