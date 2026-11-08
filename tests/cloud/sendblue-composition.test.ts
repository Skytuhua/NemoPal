import type { Pool } from 'pg';
import { afterEach, expect, it, vi } from 'vitest';
import { startCloudApplication, type CloudDependencies } from '../../apps/cloud/src/application';
import type { SendblueConfig } from '../../apps/cloud/src/integrations/sendblue/config';

const configured = { NEMOPAL_SENDBLUE_ENABLED: 'true', SENDBLUE_ACCOUNT_EMAIL: 'synthetic@example.test', SENDBLUE_RECEIVING_LINE: '+15555550123', SENDBLUE_API_KEY_ID: 'synthetic-key', SENDBLUE_API_SECRET_KEY: 'synthetic-secret', SENDBLUE_WEBHOOK_SECRET: 'synthetic-hook' };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup(env: NodeJS.ProcessEnv = {}) {
  const order: string[] = [];
  const pool = { end: vi.fn(async () => { order.push('pool'); }) } as unknown as Pool;
  const app = { listen: vi.fn(async () => {}), close: vi.fn(async () => { order.push('app'); }) };
  const delivery = { tick: vi.fn(async (_signal: AbortSignal) => {}) };
  const stopManager = vi.fn(async () => { order.push('manager'); });
  const stopCheckins = vi.fn(async () => { order.push('checkins'); });
  const dependencies = {
    configureModel: vi.fn(async () => ({ inference: { available: false }, adapter: {} })),
    buildServer: vi.fn((_pool: Pool, _options: { sendblue: SendblueConfig }) => app),
    createQueue: vi.fn((_pool: Pool, config: unknown) => ({ config })),
    startManager: vi.fn(() => stopManager),
    startCheckins: vi.fn(() => stopCheckins),
    createDelivery: vi.fn((_pool: Pool, _config: SendblueConfig) => delivery),
    reportError: vi.fn(),
  };
  const start = () => startCloudApplication({ pool, env, listen: { host: 'fixture', port: 1 }, dependencies: dependencies as unknown as CloudDependencies });
  return { start, env, pool, app, delivery, dependencies, stopManager, stopCheckins, order };
}
afterEach(() => vi.useRealTimers());

it('captures one disabled configuration for server and manager, and never starts delivery', async () => {
  vi.useFakeTimers();
  const s = setup();
  const running = await s.start();
  s.env.NEMOPAL_SENDBLUE_ENABLED = 'true';
  await vi.advanceTimersByTimeAsync(60000);
  const config = s.dependencies.buildServer.mock.calls[0]![1].sendblue;
  expect(config.enabled).toBe(false);
  expect(s.dependencies.createQueue.mock.calls[0]![1]).toBe(config);
  expect(s.dependencies.createDelivery).not.toHaveBeenCalled();
  await running.close();
  expect(s.order.at(-1)).toBe('pool');
});

it('runs one serialized delivery scheduler and waits for its aborted tick before closing the pool', async () => {
  vi.useFakeTimers();
  const s = setup({ ...configured });
  let finish!: () => void;
  let signal!: AbortSignal;
  s.delivery.tick.mockImplementation((current: AbortSignal) => { signal = current; return new Promise<void>(resolve => { finish = resolve; }); });
  const running = await s.start();
  await flush();
  await vi.advanceTimersByTimeAsync(60000);
  expect(s.delivery.tick).toHaveBeenCalledTimes(1);
  expect(s.dependencies.createDelivery).toHaveBeenCalledTimes(1);
  const config = s.dependencies.buildServer.mock.calls[0]![1].sendblue;
  expect(s.dependencies.createQueue.mock.calls[0]![1]).toBe(config);
  expect(s.dependencies.createDelivery.mock.calls[0]![1]).toBe(config);
  const closing = running.close();
  const closingAgain = running.close();
  expect(signal.aborted).toBe(true);
  await flush();
  expect(s.pool.end).not.toHaveBeenCalled();
  finish();
  await Promise.all([closing, closingAgain]);
  expect(s.pool.end).toHaveBeenCalledTimes(1);
  expect(s.order.at(-1)).toBe('pool');
  await vi.advanceTimersByTimeAsync(60000);
  expect(s.delivery.tick).toHaveBeenCalledTimes(1);
});

it('rejects enabled invalid configuration before starting workers and closes the pool', async () => {
  const s = setup({ NEMOPAL_SENDBLUE_ENABLED: 'true' });
  await expect(s.start()).rejects.toThrow('Sendblue configuration is invalid');
  expect(s.dependencies.configureModel).not.toHaveBeenCalled();
  expect(s.dependencies.createDelivery).not.toHaveBeenCalled();
  expect(s.pool.end).toHaveBeenCalledTimes(1);
});

it('cleans up every started worker and the database when listening fails', async () => {
  const s = setup({ ...configured });
  s.app.listen.mockRejectedValueOnce(new Error('synthetic listen failure'));
  await expect(s.start()).rejects.toThrow('synthetic listen failure');
  expect(s.stopManager).toHaveBeenCalledTimes(1);
  expect(s.stopCheckins).toHaveBeenCalledTimes(1);
  expect(s.app.close).toHaveBeenCalledTimes(1);
  expect(s.pool.end).toHaveBeenCalledTimes(1);
  expect(s.delivery.tick).not.toHaveBeenCalled();
});

it('still closes the app and pool when a worker shutdown fails', async () => {
  const s = setup();
  s.stopManager.mockRejectedValueOnce(new Error('synthetic stop failure'));
  const running = await s.start();
  await expect(running.close()).rejects.toThrow();
  expect(s.stopCheckins).toHaveBeenCalledTimes(1);
  expect(s.app.close).toHaveBeenCalledTimes(1);
  expect(s.pool.end).toHaveBeenCalledTimes(1);
  expect(s.order.at(-1)).toBe('pool');
});

it('mounts the production webhook with the captured disabled configuration without opening a socket', async () => {
  const s = setup();
  const { buildServer } = await import('../../apps/cloud/src/api/server');
  let app!: ReturnType<typeof buildServer>;
  const dependencies = { ...s.dependencies, buildServer: (pool: Pool, options: Parameters<typeof buildServer>[1]) => {
    app = buildServer(pool, options);
    app.listen = vi.fn(async () => 'synthetic');
    return app;
  } };
  const running = await startCloudApplication({ pool: s.pool, env: s.env, listen: { host: 'fixture', port: 1 }, dependencies: dependencies as unknown as CloudDependencies });
  try {
    s.env.NEMOPAL_SENDBLUE_ENABLED = 'true';
    const response = await app.inject({ method: 'POST', url: '/webhooks/sendblue', payload: {} });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('sendblue_disabled');
  } finally { await running.close(); }
});

it('closes already started resources when a later worker fails to start', async () => {
  const s = setup();
  s.dependencies.startCheckins.mockImplementationOnce(() => { throw new Error('synthetic worker startup'); });
  await expect(s.start()).rejects.toThrow('synthetic worker startup');
  expect(s.stopManager).toHaveBeenCalledTimes(1);
  expect(s.app.close).toHaveBeenCalledTimes(1);
  expect(s.pool.end).toHaveBeenCalledTimes(1);
});
