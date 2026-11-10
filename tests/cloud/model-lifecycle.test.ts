import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ManagerJob, NemotronAdapter } from '@living-playbooks/contracts';
import { HttpNemotronAdapter } from '@living-playbooks/nemotron';
import { configureModel } from '../../apps/cloud/src/jobs/model-settings';
import type { JobQueue } from '../../apps/cloud/src/jobs/queue';
import { startManagerDispatcher } from '../../apps/cloud/src/jobs/worker';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const settings = { baseUrl: 'https://synthetic.invalid/v1', model: 'synthetic-nemotron', apiKey: 'synthetic-only', callBudget: 4, tokenBudget: 1000000 };
const toolResponse = () => Response.json({ model: settings.model, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [
  { id: 'read', type: 'function', function: { name: 'read_project_state', arguments: '{}' } },
] } }] });
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

test.each(['resolve', 'reject'] as const)('probe settles on cancellation before a held reservation can %s', async outcome => {
  const entered = deferred(), held = deferred(), controller = new AbortController();
  const send = vi.fn(async () => toolResponse());
  const adapter = new HttpNemotronAdapter(settings, send, async () => { entered.resolve(); await held.promise; });
  let settled = false;
  const pending = adapter.probe(controller.signal).then(report => { settled = true; return report; });
  await entered.promise;
  controller.abort();
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(send).not.toHaveBeenCalled();
  } finally {
    if (outcome === 'resolve') held.resolve(); else held.reject(new Error('synthetic reservation rejected'));
    await pending;
    await vi.advanceTimersByTimeAsync(0);
  }
  expect(await pending).toMatchObject({ available: false, toolCall: false, toolContinuation: false, structuredProposal: false });
  expect(send).not.toHaveBeenCalled();
});

test('probe cancellation also settles a held tool-result continuation without a second send', async () => {
  const entered = deferred(), held = deferred(), controller = new AbortController();
  const send = vi.fn(async () => toolResponse());
  let reservations = 0, settled = false;
  const adapter = new HttpNemotronAdapter(settings, send, async () => {
    if (++reservations === 2) { entered.resolve(); await held.promise; }
  });
  const pending = adapter.probe(controller.signal).then(report => { settled = true; return report; });
  await entered.promise;
  controller.abort();
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  } finally { held.resolve(); await pending; await vi.advanceTimersByTimeAsync(0); }
  expect(await pending).toMatchObject({ available: false, toolCall: true, toolContinuation: false, structuredProposal: false });
  expect(send).toHaveBeenCalledTimes(1);
});

test('configureModel returns unavailable at its probe deadline while pool acquisition is held', async () => {
  const entered = deferred(), connection = deferred<PoolClient>(), released = deferred(), controller = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
  const send = vi.fn(async () => { throw new Error('Unexpected synthetic transport'); });
  vi.stubGlobal('fetch', send);
  const configuration = createHash('sha256').update(JSON.stringify({ baseUrl: settings.baseUrl, model: settings.model })).digest('hex');
  const query = vi.fn(async (sql: string) => ({ rows: sql.startsWith('SELECT') ? [{
    configuration_hash: configuration, calls: 0, call_limit: settings.callBudget, reserved_tokens: 0, token_limit: settings.tokenBudget,
  }] : [] }));
  const db = { query, release: () => released.resolve() } as unknown as PoolClient;
  const pool = { connect: async () => { entered.resolve(); return connection.promise; } } as unknown as Pool;
  let settled = false;
  const pending = configureModel(pool, { LP_MODEL_LIVE_OPT_IN: 'true', NEMOTRON_BASE_URL: settings.baseUrl,
    NEMOTRON_MODEL: settings.model, NVIDIA_API_KEY: settings.apiKey, LP_MODEL_CALL_BUDGET: '4', LP_MODEL_TOKEN_BUDGET: '1000000',
  }).then(result => { settled = true; return result; });
  await entered.promise;
  controller.abort();
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(query).not.toHaveBeenCalled();
  } finally { connection.resolve(db); await released.promise; await pending; await vi.advanceTimersByTimeAsync(0); }
  expect(await pending).toMatchObject({ adapter: null, inference: { available: false } });
  expect(AbortSignal.timeout).toHaveBeenCalledWith(120000);
  expect(send).not.toHaveBeenCalled();
  expect(query).toHaveBeenCalledWith('COMMIT');
});

test.each(['job', 'empty', 'reject'] as const)('dispatcher stop drains a held %s claim before returning', async outcome => {
  const entered = deferred(), claim = deferred<ManagerJob | null>(), cleanupEntered = deferred(), cleanup = deferred();
  const job = { id: randomUUID() } as ManagerJob;
  const fail = vi.fn(async () => { cleanupEntered.resolve(); await cleanup.promise; });
  const context = vi.fn(async () => { throw new Error('proposal_stale'); });
  const queue = { claim: vi.fn(async () => { entered.resolve(); return claim.promise; }), context, fail } as unknown as JobQueue;
  const next = vi.fn(async () => { throw new Error('Unexpected synthetic transport'); });
  const adapter: NemotronAdapter = { probe: async () => { throw new Error('unused'); }, next };
  const stop = startManagerDispatcher(queue, adapter);
  await entered.promise;
  let stopped = false;
  const stopping = stop().then(() => { stopped = true; });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    if (outcome === 'reject') claim.reject(new Error('synthetic claim error'));
    else claim.resolve(outcome === 'job' ? job : null);
    if (outcome === 'job') {
      await cleanupEntered.promise;
      expect(fail).toHaveBeenCalledWith(job, 'job_aborted');
      expect(stopped).toBe(false);
    }
  } finally {
    claim.resolve(outcome === 'job' ? job : null);
    cleanup.resolve();
    await stopping;
    await vi.advanceTimersByTimeAsync(0);
    await stop();
  }
  expect(context).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
  const finishedCalls = fail.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60000);
  expect(queue.claim).toHaveBeenCalledTimes(1);
  expect(fail).toHaveBeenCalledTimes(finishedCalls);
});

test('a pending claim cannot overlap another dispatcher tick', async () => {
  const entered = deferred(), claim = deferred<ManagerJob | null>();
  const queue = { claim: vi.fn(async () => { entered.resolve(); return claim.promise; }) } as unknown as JobQueue;
  const adapter: NemotronAdapter = { probe: async () => { throw new Error('unused'); }, next: async () => { throw new Error('unused'); } };
  const stop = startManagerDispatcher(queue, adapter);
  await entered.promise;
  try { await vi.advanceTimersByTimeAsync(30000); expect(queue.claim).toHaveBeenCalledTimes(1); }
  finally { claim.resolve(null); await vi.advanceTimersByTimeAsync(0); await stop(); }
});

test('unavailable inference does not claim any job', async () => {
  const claim = vi.fn(async () => null);
  const stop = startManagerDispatcher({ claim } as unknown as JobQueue, null);
  await vi.advanceTimersByTimeAsync(30000);
  await stop();
  expect(claim).not.toHaveBeenCalled();
});
