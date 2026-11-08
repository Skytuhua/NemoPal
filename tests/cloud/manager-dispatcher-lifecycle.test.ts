import { expect, it, vi } from 'vitest';
import type { NemotronAdapter, ManagerJob } from '@living-playbooks/contracts';
import { startManagerDispatcher } from '../../apps/cloud/src/jobs/worker';
import type { JobQueue } from '../../apps/cloud/src/jobs/queue';

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
