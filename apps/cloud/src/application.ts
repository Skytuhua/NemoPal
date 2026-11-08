import type { Pool } from 'pg';
import { buildServer } from './api/server';
import { CheckInScheduler, startCheckInDispatcher } from './checkins/scheduler';
import { capability, sendblueConfig, type SendblueConfig } from './integrations/sendblue/config';
import { createSendblueRuntime } from './integrations/sendblue/runtime';
import { configureModel } from './jobs/model-settings';
import { JobQueue } from './jobs/queue';
import { SendblueDelivery } from './jobs/sendblue-delivery';
import { startManagerDispatcher } from './jobs/worker';

const defaults = {
  configureModel,
  buildServer,
  createQueue: (pool: Pool, config: SendblueConfig) => new JobQueue(pool, undefined, config),
  startManager: startManagerDispatcher,
  startCheckins: (pool: Pool) => startCheckInDispatcher(new CheckInScheduler(pool)),
  createDelivery: (pool: Pool, config: SendblueConfig) => new SendblueDelivery(pool, config),
  reportError: () => console.error('Sendblue delivery unavailable.'),
};
export type CloudDependencies = typeof defaults;

/** Owns the cloud resources passed to it, including the pool on failed startup. */
export async function startCloudApplication(options: {
  pool: Pool;
  env: NodeJS.ProcessEnv;
  listen: { host: string; port: number };
  dependencies?: CloudDependencies;
}) {
  const { pool } = options;
  const deps = options.dependencies ?? defaults;
  let app: ReturnType<typeof buildServer> | undefined;
  const stops: Array<() => Promise<void>> = [];
  let closing: Promise<void> | undefined;
  const close = () => {
    if (!closing) closing = (async () => {
      // Initiate all stops promptly, including the Sendblue abort, before awaiting any one worker.
      const invoke = (stop: () => Promise<unknown>) => {
        try { return Promise.resolve(stop()); } catch (error) { return Promise.reject(error); }
      };
      const pending = stops.map(stop => invoke(stop));
      if (app) pending.push(invoke(() => app!.close()));
      const results = await Promise.allSettled(pending);
      try { await pool.end(); } catch { results.push({ status: 'rejected', reason: undefined }); }
      if (results.some(result => result.status === 'rejected')) throw new Error('Cloud shutdown failed.');
    })();
    return closing;
  };

  try {
    const phoneConfig = sendblueConfig(options.env);
    if (phoneConfig.enabled && !capability(phoneConfig).available) throw new Error('Sendblue configuration is invalid.');
    const model = await deps.configureModel(pool);
    app = deps.buildServer(pool, { inference: model.inference, sendblue: phoneConfig });
    stops.push(deps.startManager(deps.createQueue(pool, phoneConfig), model.adapter));
    stops.push(deps.startCheckins(pool));
    const delivery = phoneConfig.enabled ? deps.createDelivery(pool, phoneConfig) : undefined;
    const runtime = createSendblueRuntime({
      enabled: phoneConfig.enabled,
      tick: phoneConfig.enabled ? (signal => delivery!.tick(signal)) : async () => {},
      onError: deps.reportError,
    });
    stops.push(() => runtime.stop());
    await app.listen(options.listen);
    runtime.start();
    return { close, inferenceAvailable: model.inference.available };
  } catch (error) {
    try { await close(); } catch { /* Preserve the startup error after cleanup. */ }
    throw error;
  }
}
