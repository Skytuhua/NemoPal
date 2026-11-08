import { setImmediate } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { deferred, projectSnapshot, startSyntheticMain } from './main-harness';
import type { ProjectSnapshot } from '@living-playbooks/contracts';

it('main getSnapshot A/B replies B/A leave the native pet on the latest requested B', async () => {
  const main = await startSyntheticMain(); const a = projectSnapshot('A'); const b = projectSnapshot('B');
  const replyA = deferred<ProjectSnapshot>(); const replyB = deferred<ProjectSnapshot>();
  try {
    vi.mocked(main.client.getSnapshot).mockImplementation(id => id === a.project.id ? replyA.promise : replyB.promise);
    const requestA = main.invoke('invoke', { type: 'getSnapshot', projectId: a.project.id });
    const requestB = main.invoke('invoke', { type: 'getSnapshot', projectId: b.project.id });
    replyB.resolve(b); await requestB; replyA.resolve(a); await requestA;
    expect(main.petEvents.at(-1)).toMatchObject({ projectId: b.project.id, managerName: 'Manager B' });
    await expect(main.petInvoke({ type: 'openProject', projectId: a.project.id })).rejects.toThrow();
    await main.petInvoke({ type: 'openProject', projectId: b.project.id });
  } finally { replyA.resolve(a); replyB.resolve(b); await main.close(); }
});

it('latest selection invalidates old pet actions before awaiting sync or the new snapshot', async () => {
  const main = await startSyntheticMain(); const a = projectSnapshot('A'); const b = projectSnapshot('B'); const reply = deferred<ProjectSnapshot>();
  let pending: Promise<unknown> | undefined;
  try {
    await main.invoke('invoke', { type: 'getSnapshot', projectId: a.project.id });
    vi.mocked(main.client.getSnapshot).mockImplementation(() => reply.promise);
    pending = main.invoke('invoke', { type: 'getSnapshot', projectId: b.project.id });
    await expect(main.petInvoke({ type: 'openProject', projectId: a.project.id })).rejects.toThrow();
  } finally { reply.resolve(b); await pending; await main.close(); }
});

it('a late background refresh of A cannot select A after the workspace requests B', async () => {
  const main = await startSyntheticMain(); const a = projectSnapshot('A'); const b = projectSnapshot('B'); const background = deferred<ProjectSnapshot>();
  try {
    await main.invoke('invoke', { type: 'getSnapshot', projectId: a.project.id });
    const prior = vi.mocked(main.client.getSnapshot).mock.calls.length;
    vi.mocked(main.client.getSnapshot).mockImplementation(id => id === a.project.id ? background.promise : Promise.resolve(b));
    main.tick(); await vi.waitFor(() => expect(main.client.getSnapshot).toHaveBeenCalledTimes(prior + 1));
    await main.invoke('invoke', { type: 'getSnapshot', projectId: b.project.id });
    background.resolve(a); await setImmediate();
    expect(main.petEvents.at(-1)).toMatchObject({ projectId: b.project.id });
    vi.mocked(main.client.getSnapshot).mockImplementation(async id => id === a.project.id ? a : b);
    main.tick(); await vi.waitFor(() => expect(vi.mocked(main.client.getSnapshot).mock.calls.at(-1)?.[0]).toBe(b.project.id));
  } finally { background.resolve(a); await setImmediate(); await main.close(); }
});

it('pinned A remains selected while B loads; unpin uses the latest workspace request B', async () => {
  const main = await startSyntheticMain(); const a = projectSnapshot('A'); const b = projectSnapshot('B');
  const preference = { hidden: false, focus: false, reducedMotion: false, pinnedProjectId: a.project.id };
  try {
    await main.invoke('invoke', { type: 'getSnapshot', projectId: a.project.id });
    await main.invoke('setPetPreference', preference);
    await main.invoke('invoke', { type: 'getSnapshot', projectId: b.project.id });
    expect(main.petEvents.at(-1)?.projectId).toBe(a.project.id);
    await main.invoke('setPetPreference', { ...preference, pinnedProjectId: null });
    expect(main.petEvents.at(-1)).toMatchObject({ projectId: b.project.id, managerName: 'Manager B' });
  } finally { await main.close(); }
});
