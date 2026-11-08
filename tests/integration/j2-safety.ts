import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { assertSchedulerIsolation, Blocked } from './j1-safety';

export const STARTUP_MS = 135000;
export const JOB_MS = 150000;
export const MAX_CALLS = 7; // One production startup probe (<=3), one initial_plan (<=4).
export const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
export type Configuration = ReturnType<typeof configuration>;

// Does not inspect any provider key. Only the live child environment builder touches that key.
export function configuration(env: NodeJS.ProcessEnv, args: string[]) {
  if (!args.includes('--live') || !args.includes('--db-released') || env.LP_MODEL_LIVE_OPT_IN !== 'true')
    throw new Blocked('Lead review, live opt-in and exclusive DB release are required');
  const database = env.LP_J2_DATABASE ?? '';
  if (!/^playbooks_j2_[a-z0-9_]+$/.test(database) || database.length > 63)
    throw new Blocked('An explicitly owned J2 database name is required');
  let db: URL, base: URL;
  try { db = new URL(env.DATABASE_URL ?? ''); base = new URL(env.NEMOTRON_BASE_URL ?? ''); }
  catch { throw new Blocked('Explicit database and HTTPS model configuration are required'); }
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || db.hostname !== '127.0.0.1' ||
    db.port !== '55432' || db.username !== 'playbooks' || db.search || db.hash)
    throw new Blocked('Only the authorized local PostgreSQL endpoint is allowed');
  // The supplied URL is a connection template, never authority to touch its original database.
  db.pathname = `/${database}`;
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash ||
    !env.NEMOTRON_MODEL?.trim()) throw new Blocked('Explicit HTTPS provider and model are required');
  const callBudget = Number(env.LP_MODEL_CALL_BUDGET), tokenBudget = Number(env.LP_MODEL_TOKEN_BUDGET);
  if (callBudget !== MAX_CALLS || !Number.isSafeInteger(tokenBudget) || tokenBudget <= 0)
    throw new Blocked('Explicit seven-call ceiling and positive finite token allowance are required');
  // Preserve the EXACT supplied base string, including a trailing slash, in the production hash.
  const baseUrl = env.NEMOTRON_BASE_URL!;
  return { databaseUrl: db.href, baseUrl, model: env.NEMOTRON_MODEL!, callBudget, tokenBudget,
    configurationHash: sha256(JSON.stringify({ baseUrl, model: env.NEMOTRON_MODEL! })) };
}

export type UsageRow = { calls: number; reserved_tokens: string | number; call_limit: number;
  token_limit: string | number; configuration_hash: string };
export function usageReceipt(rows: UsageRow[], config: Configuration, beforeStartup = false) {
  if (rows.length > 1) throw new Blocked('Unexpected usage ledger cardinality');
  const row = rows[0];
  if (!row) {
    if (!beforeStartup) throw new Blocked('Charged usage ledger is missing');
    return { present: false, calls: 0, reservedTokens: 0, callLimit: config.callBudget,
      tokenLimit: config.tokenBudget, remainingCalls: config.callBudget,
      remainingTokens: config.tokenBudget, configurationHash: config.configurationHash };
  }
  const { calls, call_limit: storedCallLimit } = row;
  const reservedTokens = Number(row.reserved_tokens), storedTokenLimit = Number(row.token_limit);
  if (row.configuration_hash !== config.configurationHash ||
    ![calls, reservedTokens, storedCallLimit, storedTokenLimit].every(Number.isSafeInteger) ||
    calls < 0 || reservedTokens < 0 || storedCallLimit <= 0 || storedTokenLimit <= 0)
    throw new Blocked('Incompatible usage ledger configuration');
  const callLimit = Math.min(storedCallLimit, config.callBudget);
  const tokenLimit = Math.min(storedTokenLimit, config.tokenBudget);
  const remainingCalls = callLimit - calls, remainingTokens = tokenLimit - reservedTokens;
  if (beforeStartup && (remainingCalls < MAX_CALLS || remainingTokens <= 0))
    throw new Blocked('Insufficient remaining allowance; never replenish or repeat a charged start');
  if (remainingCalls < 0 || remainingTokens < 0) throw new Blocked('Usage exceeds effective allowance');
  return { present: true, calls, reservedTokens, storedCallLimit, storedTokenLimit, callLimit,
    tokenLimit, remainingCalls, remainingTokens, configurationHash: row.configuration_hash };
}

export async function readUsage(db: Pick<Pool, 'query'>) {
  return (await db.query<UsageRow>('SELECT calls,reserved_tokens,call_limit,token_limit,configuration_hash FROM model_usage')).rows;
}

export async function assertDatabaseIsolation(db: Pick<Pool, 'query'>, ownerId: string) {
  // No run_after predicate: future-due jobs are also unsafe for the global dispatcher.
  const jobs = await db.query<{ blocked: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM jobs j JOIN projects p ON p.id=j.project_id
    WHERE p.owner_id<>$1 AND (j.state IN ('queued','running') OR j.data->>'state' IN ('queued','running'))
  ) AS blocked`, [ownerId]);
  if (jobs.rows.length !== 1 || jobs.rows[0]?.blocked !== false)
    throw new Blocked('Foreign queued or running jobs are present');
  await assertSchedulerIsolation(db, ownerId);
  // A parent-migrated NEW database must have no application content, even idle foreign rows.
  const content = await db.query<{ blocked: boolean }>(`SELECT
    EXISTS(SELECT 1 FROM owners) OR EXISTS(SELECT 1 FROM credentials) OR EXISTS(SELECT 1 FROM projects)
    OR EXISTS(SELECT 1 FROM jobs) OR EXISTS(SELECT 1 FROM checkins) OR EXISTS(SELECT 1 FROM checkin_presentations)
    OR EXISTS(SELECT 1 FROM source_bindings) OR EXISTS(SELECT 1 FROM observations) OR EXISTS(SELECT 1 FROM messages)
    OR EXISTS(SELECT 1 FROM documents) OR EXISTS(SELECT 1 FROM events) OR EXISTS(SELECT 1 FROM command_receipts)
    OR EXISTS(SELECT 1 FROM generated_dependencies) AS blocked`);
  if (content.rows.length !== 1 || content.rows[0]?.blocked !== false)
    throw new Blocked('Parent must supply a separate empty migrated J2 database');
}

export function systemEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => value !== undefined &&
    /^(path|systemroot|windir|comspec|temp|tmp|userprofile|localappdata|appdata|programdata|programfiles|programfiles\(x86\)|systemdrive|username|userdomain)$/i.test(key))) as Record<string, string>;
}
export function cloudEnvironment(config: Configuration, origin: string, env: NodeJS.ProcessEnv) {
  if (!env.NVIDIA_API_KEY?.trim()) throw new Blocked('Lead must supply the cloud child credential');
  return { ...systemEnvironment(env), DATABASE_URL: config.databaseUrl, PUBLIC_ORIGIN: origin,
    PORT: new URL(origin).port, LP_MODEL_LIVE_OPT_IN: 'true', NEMOTRON_BASE_URL: config.baseUrl,
    NEMOTRON_MODEL: config.model, LP_MODEL_CALL_BUDGET: String(config.callBudget),
    LP_MODEL_TOKEN_BUDGET: String(config.tokenBudget), NVIDIA_API_KEY: env.NVIDIA_API_KEY };
}

// Pure/fake-query checks only. No pg connection, fetch, Electron launch or real environment access.
export async function checkGuards() {
  const env = { LP_MODEL_LIVE_OPT_IN: 'true', LP_J2_DATABASE: 'playbooks_j2_synthetic',
    DATABASE_URL: 'postgresql://playbooks@127.0.0.1:55432/playbooks_test',
    NEMOTRON_BASE_URL: 'https://synthetic.invalid/v1/', NEMOTRON_MODEL: 'synthetic',
    LP_MODEL_CALL_BUDGET: '7', LP_MODEL_TOKEN_BUDGET: '100000', NVIDIA_API_KEY: 'synthetic-sentinel' };
  const args = ['--live', '--db-released'];
  let checks = 0;
  const reject = (operation: () => unknown) => { assert.throws(operation, Blocked); checks++; };
  const config = configuration(env, args);
  assert.equal(new URL(config.databaseUrl).pathname, '/playbooks_j2_synthetic'); checks++;
  const parentPlan = configuration({ ...env, LP_J2_DATABASE: 'playbooks_j2_20261108_68866455', LP_MODEL_TOKEN_BUDGET: '524288' }, args);
  assert.equal(new URL(parentPlan.databaseUrl).pathname, '/playbooks_j2_20261108_68866455');
  assert.equal(parentPlan.tokenBudget, 524288); checks++;
  for (const name of ['', 'playbooks_test', 'playbooks_j2_', 'playbooks_j2_UPPER', 'playbooks_j2_a/b', `playbooks_j2_${'a'.repeat(60)}`])
    reject(() => configuration({ ...env, LP_J2_DATABASE: name }, args));
  for (const databaseUrl of ['', 'postgresql://playbooks@localhost:55432/x', 'postgresql://other@127.0.0.1:55432/x',
    'postgresql://playbooks@127.0.0.1:5432/x', 'postgresql://playbooks@127.0.0.1:55432/x?host=foreign'])
    reject(() => configuration({ ...env, DATABASE_URL: databaseUrl }, args));
  for (const flag of args) reject(() => configuration(env, args.filter(arg => arg !== flag)));
  for (const key of ['LP_MODEL_LIVE_OPT_IN', 'NEMOTRON_BASE_URL', 'NEMOTRON_MODEL', 'LP_MODEL_CALL_BUDGET', 'LP_MODEL_TOKEN_BUDGET'])
    reject(() => configuration({ ...env, [key]: '' }, args));
  for (const budget of ['6', '8', 'Infinity', 'NaN']) reject(() => configuration({ ...env, LP_MODEL_CALL_BUDGET: budget }, args));
  for (const budget of ['0', '-1', 'Infinity', '1.5']) reject(() => configuration({ ...env, LP_MODEL_TOKEN_BUDGET: budget }, args));
  reject(() => configuration({ ...env, NEMOTRON_BASE_URL: 'http://synthetic.invalid/v1' }, args));
  assert.notEqual(config.configurationHash, configuration({ ...env, NEMOTRON_BASE_URL: env.NEMOTRON_BASE_URL.slice(0, -1) }, args).configurationHash); checks++;
  const row: UsageRow = { calls: 0, reserved_tokens: '0', call_limit: 9, token_limit: '200000', configuration_hash: config.configurationHash };
  const before = usageReceipt([row], config, true);
  assert.equal(before.remainingCalls, 7); assert.equal(before.remainingTokens, 100000); checks++;
  assert.equal(usageReceipt([], config, true).present, false); checks++;
  reject(() => usageReceipt([], config));
  for (const changed of [{ configuration_hash: 'other' }, { calls: 1 }, { call_limit: 6 }, { reserved_tokens: '100000' }, { token_limit: '0' }])
    reject(() => usageReceipt([{ ...row, ...changed }], config, true));
  const after = usageReceipt([{ ...row, calls: 5, reserved_tokens: '45000', token_limit: '90000' }], config);
  assert.equal(after.remainingCalls, 2); assert.equal(after.remainingTokens, 45000); checks++;
  assert.equal(row.calls, 0); checks++; // Accounting inspection never mutates a row.
  const desktopEnv = { ...systemEnvironment({ ...env, PATH: 'synthetic-path', LP_TEMPORARY_PAIRING: '1', LP_RENDERER_URL: 'fixture' }), LP_API_ORIGIN: 'http://127.0.0.1:4310' };
  assert.deepEqual(Object.keys(desktopEnv).sort(), ['LP_API_ORIGIN', 'PATH']); checks++;
  assert.equal(cloudEnvironment(config, 'http://127.0.0.1:4310', env).NVIDIA_API_KEY, 'synthetic-sentinel'); checks++;
  assert.equal('LP_DEMO_TIMING' in cloudEnvironment(config, 'http://127.0.0.1:4310', env), false); checks++;
  reject(() => cloudEnvironment(config, 'http://127.0.0.1:4310', {}));
  for (const blockedAt of [-1, 0, 1, 2]) {
    const sql: string[] = [];
    const db = { query: async (text: string) => { sql.push(text); return { rows: [{ blocked: sql.length - 1 === blockedAt }] }; } } as unknown as Pick<Pool, 'query'>;
    if (blockedAt < 0) await assertDatabaseIsolation(db, 'synthetic-owner');
    else await assert.rejects(assertDatabaseIsolation(db, 'synthetic-owner'), Blocked);
    assert.match(sql[0]!, /'queued','running'/); assert.doesNotMatch(sql[0]!, /run_after|now\(/i); checks++;
  }
  return checks;
}
