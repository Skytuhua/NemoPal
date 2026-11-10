import { expect, it, vi } from 'vitest';
import { startManagerDispatcher } from '../../apps/cloud/src/jobs/worker';

it('observes manager stop return before pending claim resumes work', async () => {
  let release!: (job: any) => void;
  const claim = new Promise<any>(r => { release = r; });
  const context = vi.fn(async () => { throw new Error('synthetic closed pool'); });
  const fail = vi.fn(async () => {});
  const stop = startManagerDispatcher({ claim: () => claim, context, fail } as any, {} as any);
  let stopped = false;
  await stop().then(() => { stopped = true; });
  expect(stopped).toBe(true);
  expect(context).not.toHaveBeenCalled();
  release({});
  await vi.waitFor(() => expect(context).toHaveBeenCalled());
  expect(fail).toHaveBeenCalled();
});

