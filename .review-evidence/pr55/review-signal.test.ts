import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ started: false, resolve: undefined as undefined | ((value: any) => void) }));
vi.mock('pg', () => ({ Pool: class { on() {} } }));
vi.mock('../../apps/cloud/src/application', () => ({ startCloudApplication: () => {
  state.started = true;
  return new Promise(resolve => { state.resolve = resolve; });
} }));
it('observes no shutdown handlers while application startup is pending', async () => {
  vi.stubEnv('DATABASE_URL', 'synthetic');
  vi.stubEnv('PUBLIC_ORIGIN', 'http://127.0.0.1:4310');
  const beforeTerm = process.listeners('SIGTERM');
  const beforeInt = process.listeners('SIGINT');
  const loading = import('../../apps/cloud/src/main');
  await vi.waitFor(() => expect(state.started).toBe(true));
  expect(process.listeners('SIGTERM')).toEqual(beforeTerm);
  expect(process.listeners('SIGINT')).toEqual(beforeInt);
  state.resolve!({ close: async () => {}, inferenceAvailable: false });
  await loading;
  const addedTerm = process.listeners('SIGTERM').filter(x => !beforeTerm.includes(x));
  const addedInt = process.listeners('SIGINT').filter(x => !beforeInt.includes(x));
  expect(addedTerm).toHaveLength(1);
  expect(addedInt).toHaveLength(1);
  for (const listener of addedTerm) process.removeListener('SIGTERM', listener);
  for (const listener of addedInt) process.removeListener('SIGINT', listener);
  vi.unstubAllEnvs();
});
