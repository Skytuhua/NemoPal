import type { Pool } from 'pg';
import { buildServer } from './api/server';
import { CheckInScheduler, startCheckInDispatcher } from './checkins/scheduler';
import { capability, sendblueConfig, type SendblueConfig } from './integrations/sendblue/config';
import { createSendblueRuntime } from './integrations/sendblue/runtime';
import { SendbluePoll } from './integrations/sendblue/poll';
import { Messaging } from './domain/messaging';
import { Store } from './domain/store';
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
  createPoll: (pool: Pool, config: SendblueConfig) => new SendbluePoll(pool, config, new Messaging(new Store(pool, undefined, config))),
  reportError: () => console.error('Sendblue delivery unavailable.'),
};
export type CloudDependencies = typeof defaults;

class CloudStartupCancelled extends Error {}
class CloudStartupCleanupError extends Error {
  constructor(readonly startupFailed: boolean) { super('Cloud startup cleanup failed.'); }
}

/** Owns the cloud resources passed to it, including the pool on failed startup. */
export async function startCloudApplication(options: {
  pool: Pool;
  env: NodeJS.ProcessEnv;
  listen: { host: string; port: number };
  signal?: AbortSignal;
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
    if (options.signal?.aborted) throw new CloudStartupCancelled();
    const phoneConfig = sendblueConfig(options.env);
    if (phoneConfig.enabled && !capability(phoneConfig).available) throw new Error('Sendblue configuration is invalid.');
    const model = await deps.configureModel(pool);
    if (options.signal?.aborted) throw new CloudStartupCancelled();
    app = deps.buildServer(pool, { inference: model.inference, sendblue: phoneConfig });
    stops.push(deps.startManager(deps.createQueue(pool, phoneConfig), model.adapter));
    stops.push(deps.startCheckins(pool));
    const delivery = phoneConfig.enabled ? deps.createDelivery(pool, phoneConfig) : undefined;
    const polling = phoneConfig.enabled && options.env.NEMOPAL_SENDBLUE_POLL_ENABLED === 'true';
    const poll = polling ? deps.createPoll(pool, phoneConfig) : undefined;
    const runtime = createSendblueRuntime({
      enabled: phoneConfig.enabled,
      tick: async signal => {
        if (poll) await poll.tick(signal);
        if (delivery && !signal.aborted) await delivery.tick(signal);
      },
      onError: deps.reportError,
    });
    stops.push(() => runtime.stop());
    await app.listen(options.listen);
    if (options.signal?.aborted) throw new CloudStartupCancelled();
    runtime.start();
    return { close, inferenceAvailable: model.inference.available };
  } catch (error) {
    try { await close(); }
    catch { throw new CloudStartupCleanupError(!(error instanceof CloudStartupCancelled)); }
    throw error;
  }
}


type CloudProcessApplication = { close(): Promise<void>; inferenceAvailable: boolean };
type ShutdownSignals = {
  on(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
  removeListener(event: 'SIGTERM' | 'SIGINT', listener: () => void): unknown;
};

/** Install signal handlers before starting; wait for owned startup resources before shutdown. */
export async function runCloudProcess(options: {
  signals: ShutdownSignals;
  start(signal: AbortSignal): Promise<CloudProcessApplication>;
  onStarted(application: CloudProcessApplication): void;
  onShutdownError(): void;
  onStartupError?(): void;
}): Promise<void> {
  const controller = new AbortController();
  let stopping: Promise<void> | undefined;
  let shutdownRequested = false;
  const startup = Promise.resolve().then(() => options.start(controller.signal));
  const detach = () => {
    options.signals.removeListener('SIGTERM', onSignal);
    options.signals.removeListener('SIGINT', onSignal);
  };
  const onSignal = () => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    controller.abort();
    stopping = startup.then(application => application.close(), () => {}).catch(() => {
      try { options.onShutdownError(); } catch { /* Do not leak reporter errors. */ }
    }).finally(detach);
  };
  options.signals.on('SIGTERM', onSignal);
  options.signals.on('SIGINT', onSignal);
  let application: CloudProcessApplication | undefined;
  const report = (callback: (() => void) | undefined) => { try { callback?.(); } catch { /* Keep error reports contained. */ } };
  try {
    application = await startup;
    if (controller.signal.aborted) { if (stopping) await stopping; }
    else options.onStarted(application);
  } catch (error) {
    if (application && !controller.signal.aborted) {
      onSignal();
      if (stopping) await stopping;
      throw error;
    }
    if (controller.signal.aborted) {
      if (stopping) await stopping;
      if (error instanceof CloudStartupCleanupError) {
        report(options.onShutdownError);
        if (error.startupFailed) report(options.onStartupError ?? options.onShutdownError);
      } else if (!(error instanceof CloudStartupCancelled)) report(options.onStartupError ?? options.onShutdownError);
    } else { detach(); throw error; }
  }
}
