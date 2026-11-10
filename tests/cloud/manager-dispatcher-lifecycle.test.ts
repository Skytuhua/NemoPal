import { expect, it, vi } from 'vitest';
import type { NemotronAdapter, ManagerJob } from '@living-playbooks/contracts';
import { startManagerDispatcher } from '../../apps/cloud/src/jobs/worker';
import type { JobQueue } from '../../apps/cloud/src/jobs/queue';

it('starts newly queued work on the next short polling interval', async () => {
  vi.useFakeTimers();
  try {
    const job = { id: 'fixture-job' } as ManagerJob;
    const claim = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(job).mockResolvedValue(null);
    const context = vi.fn(async () => { throw new Error('model_error'); });
    const fail = vi.fn(async () => {});
    const stop = startManagerDispatcher({ claim, context, fail } as unknown as JobQueue, {} as NemotronAdapter);
    await vi.advanceTimersByTimeAsync(0);
    expect(claim).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(context).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(context).toHaveBeenCalledWith(job);
    await stop();
  } finally {
    vi.useRealTimers();
  }
});

it('does not overlap claims when a claim takes longer than the polling interval', async () => {
  vi.useFakeTimers();
  try {
    let finishClaim!: (job: ManagerJob | null) => void;
    const claim = vi.fn(() => new Promise<ManagerJob | null>(resolve => { finishClaim = resolve; }));
    const stop = startManagerDispatcher({ claim } as unknown as JobQueue, {} as NemotronAdapter);
    await vi.advanceTimersByTimeAsync(6000);
    expect(claim).toHaveBeenCalledTimes(1);
    finishClaim(null);
    await stop();
    await vi.advanceTimersByTimeAsync(4000);
    expect(claim).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it('waits for an in-flight claim and does not start a job after shutdown', async () => {
  let release!: (value: ManagerJob | null) => void;
  const claim = vi.fn(() => new Promise<ManagerJob | null>(resolve => { release = resolve; }));
  const context = vi.fn(async () => { throw new Error('unexpected job start'); });
  const fail = vi.fn(async () => {});
  const releaseUnstarted = vi.fn(async () => true);
  const queue = { claim, context, fail, releaseUnstarted } as unknown as JobQueue;
  const adapter = {} as NemotronAdapter;
  const stop = startManagerDispatcher(queue, adapter);
  await vi.waitFor(() => expect(claim).toHaveBeenCalledOnce());
  let stopped = false;
  const stopping = stop().then(() => { stopped = true; });
  await Promise.resolve(); await Promise.resolve();
  const stoppedBeforeClaimSettled = stopped;
  release({ id: 'fixture-job' } as ManagerJob);
  await stopping;
  await Promise.resolve(); await Promise.resolve();
  expect(stoppedBeforeClaimSettled).toBe(false);
  expect(context).not.toHaveBeenCalled();
  expect(claim).toHaveBeenCalledTimes(1);
});

it('releases an unstarted claim before shutdown completes', async () => {
  let finishClaim!: (job: ManagerJob | null) => void;
  let finishRelease!: (released: boolean) => void;
  const job = { id: 'fixture-job' } as ManagerJob;
  const claim = vi.fn(() => new Promise<ManagerJob | null>(resolve => { finishClaim = resolve; }));
  const releaseUnstarted = vi.fn(() => new Promise<boolean>(resolve => { finishRelease = resolve; }));
  const queue = { claim, releaseUnstarted } as unknown as JobQueue;
  const stop = startManagerDispatcher(queue, {} as NemotronAdapter);
  await vi.waitFor(() => expect(claim).toHaveBeenCalledOnce());
  let stopped = false;
  const stopping = stop().then(() => { stopped = true; });
  finishClaim(job);
  await vi.waitFor(() => expect(releaseUnstarted).toHaveBeenCalledWith(job));
  expect(stopped).toBe(false);
  finishRelease(true);
  await stopping;
  expect(stopped).toBe(true);
});

it('reports an uncertain release failure during shutdown', async () => {
  let finishClaim!: (job: ManagerJob | null) => void;
  const claim = vi.fn(() => new Promise<ManagerJob | null>(resolve => { finishClaim = resolve; }));
  const releaseUnstarted = vi.fn(async () => { throw new Error('private database detail'); });
  const stop = startManagerDispatcher({ claim, releaseUnstarted } as unknown as JobQueue, {} as NemotronAdapter);
  await vi.waitFor(() => expect(claim).toHaveBeenCalledOnce());
  const stopping = stop();
  finishClaim({ id: 'fixture-job' } as ManagerJob);
  await expect(stopping).rejects.toThrow('Manager claim release failed.');
});
