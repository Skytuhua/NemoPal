import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSendblueRuntime } from '../../apps/cloud/src/integrations/sendblue/runtime';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
afterEach(() => vi.useRealTimers());

describe('Sendblue runtime lifecycle (synthetic only)', () => {
  it('rejects intervals that would overflow Node timers', () => {
    expect(() => createSendblueRuntime({ enabled: true, tick: async () => {}, intervalMs: 2147483648 })).toThrow(RangeError);
  });

  it('does no work unless explicitly enabled', async () => {
    vi.useFakeTimers();
    const tick = vi.fn(async () => {});
    const runtime = createSendblueRuntime({ tick });
    runtime.start();
    await vi.advanceTimersByTimeAsync(60000);
    await runtime.stop();
    expect(tick).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('serializes ticks even when startup is repeated and a tick is slow', async () => {
    vi.useFakeTimers();
    const first = deferred();
    const tick = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    const runtime = createSendblueRuntime({ enabled: true, tick, intervalMs: 10 });
    runtime.start(); runtime.start();
    await flush();
    await vi.advanceTimersByTimeAsync(100);
    expect(tick).toHaveBeenCalledTimes(1);
    first.resolve(); await flush();
    await vi.advanceTimersByTimeAsync(10);
    expect(tick).toHaveBeenCalledTimes(2);
    await runtime.stop();
  });

  it('aborts and waits for an in-flight tick before shutdown finishes', async () => {
    vi.useFakeTimers();
    const done = deferred();
    let signal!: AbortSignal;
    const tick = vi.fn((s: AbortSignal) => { signal = s; return done.promise; });
    const runtime = createSendblueRuntime({ enabled: true, tick, intervalMs: 10 });
    runtime.start(); await flush();
    let stopped = false;
    const stopping = runtime.stop().then(() => { stopped = true; });
    expect(signal.aborted).toBe(true);
    await flush(); expect(stopped).toBe(false);
    done.resolve(); await stopping;
    runtime.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it('does not start a queued tick after shutdown', async () => {
    const tick = vi.fn(async () => {});
    const runtime = createSendblueRuntime({ enabled: true, tick });
    runtime.start();
    await runtime.stop();
    expect(tick).not.toHaveBeenCalled();
  });

  it('reports failures without leaking the error and continues polling', async () => {
    vi.useFakeTimers();
    const report = vi.fn(() => { throw new Error('reporter failed'); });
    const tick = vi.fn().mockRejectedValueOnce(new Error('sensitive synthetic detail')).mockResolvedValue(undefined);
    const runtime = createSendblueRuntime({ enabled: true, tick, intervalMs: 10, onError: report });
    runtime.start(); await flush();
    expect(report).toHaveBeenCalledWith();
    await vi.advanceTimersByTimeAsync(10);
    expect(tick).toHaveBeenCalledTimes(2);
    await runtime.stop();
  });
});
