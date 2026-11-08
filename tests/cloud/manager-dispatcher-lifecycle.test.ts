import { expect, it, vi } from 'vitest';
import type { NemotronAdapter, ManagerJob } from '@living-playbooks/contracts';
import { startManagerDispatcher } from '../../apps/cloud/src/jobs/worker';
import type { JobQueue } from '../../apps/cloud/src/jobs/queue';

it('waits for an in-flight claim and does not start a job after shutdown', async () => {
  let release!: (value: ManagerJob | null) => void;
  const claim = vi.fn(() => new Promise<ManagerJob | null>(resolve => { release = resolve; }));
  const context = vi.fn(async () => { throw new Error('unexpected job start'); });
  const fail = vi.fn(async () => {});
  const queue = { claim, context, fail } as unknown as JobQueue;
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
