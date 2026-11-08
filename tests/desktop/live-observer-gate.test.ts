import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('general own-thread metadata authorization cannot start a live content reader', () => {
  const selected = '019aa000-0000-7000-8000-000000000001';
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'tests/live/observer.ts'], { encoding: 'utf8', env: { ...process.env, CODEX_THREAD_ID: selected, LP_SELECTED_SOURCE: selected, LP_SYNTHETIC_SOURCE_NAME: '', LP_OBSERVER_LOCAL_READ_CONSENT: '' } });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('metadata only');
});
