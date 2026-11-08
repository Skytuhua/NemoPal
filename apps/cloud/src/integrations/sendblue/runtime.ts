/** Schedules one delivery tick at a time. The delivery implementation owns durable
 * claim, authority, revocation and ambiguous-send decisions; this is not a fence
 * across processes. Each runtime is terminal after stop(). */
export function createSendblueRuntime(options: {
  enabled?: boolean;
  tick: (signal: AbortSignal) => Promise<void>;
  intervalMs?: number;
  // Intentionally receives no exception, provider response, or message data.
  onError?: () => void | Promise<void>;
}) {
  const intervalMs = options.intervalMs ?? 15000;
  if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 2147483647) throw new RangeError('Invalid Sendblue polling interval');
  const controller = new AbortController();
  let started = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void> | undefined;

  const report = () => {
    try { void Promise.resolve(options.onError?.()).catch(() => {}); }
    catch { /* Logging must not break the lifecycle. */ }
  };
  const run = () => {
    if (stopped || active) return;
    active = Promise.resolve().then(async () => {
      if (!controller.signal.aborted) await options.tick(controller.signal);
    }).catch(() => { if (!stopped) report(); }).finally(() => {
      active = undefined;
      if (!stopped) timer = setTimeout(run, intervalMs);
    });
  };

  return {
    start() {
      if (started || stopped) return;
      started = true;
      if (options.enabled === true) run();
    },
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
      await active;
    },
  };
}
