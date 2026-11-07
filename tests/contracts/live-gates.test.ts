import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('reports blocked live model access with a failing exit instead of a passing skip', () => {
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-live.ts', 'model'], { encoding: 'utf8', env: { ...process.env, LP_LIVE_TEST_OPT_IN: '', NVIDIA_API_KEY: '', NEMOTRON_MODEL: '', NEMOTRON_BASE_URL: '', LP_MODEL_CALL_BUDGET: '' } });
  expect(run.status).toBe(2);
  expect(run.stderr).toContain('BLOCKED');
  expect(run.stderr).not.toMatch(/Error \[ERR_MODULE_NOT_FOUND\]/);
});
