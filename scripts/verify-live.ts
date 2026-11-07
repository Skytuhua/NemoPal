import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const mode = process.argv[2];
const targets: Record<string, string> = { native: 'tests/live/native.ts', model: 'tests/live/model.ts', observer: 'tests/live/observer.ts', golden: 'tests/live/golden-workflow.ts' };
const block = (reason: string): never => { console.error(`BLOCKED: ${reason}`); process.exit(2); };
if (!mode || !targets[mode]) block(mode === 'package' ? 'Portable packaging is deferred until the verified source build and native smoke pass.' : 'Select native, model, observer, or golden.');
if (mode !== 'native' && process.env.LP_LIVE_TEST_OPT_IN !== '1') block('Live tests require LP_LIVE_TEST_OPT_IN=1 and explicit source/model selection.');
if (mode === 'native' && process.platform !== 'win32') block('Windows native acceptance requires Windows.');
if (mode === 'model' || mode === 'golden') {
  for (const setting of ['NVIDIA_API_KEY', 'NEMOTRON_BASE_URL', 'NEMOTRON_MODEL', 'LP_MODEL_CALL_BUDGET']) if (!process.env[setting]) block(`Missing ${setting}; live Nemotron access is not verified.`);
  const budget = Number(process.env.LP_MODEL_CALL_BUDGET);
  if (!Number.isSafeInteger(budget) || budget <= 0) block('LP_MODEL_CALL_BUDGET must be a positive finite integer.');
}
if ((mode === 'observer' || mode === 'golden') && !process.env.LP_SELECTED_SOURCE) block('A single harmless source must be explicitly selected with LP_SELECTED_SOURCE.');
const target = targets[mode ?? ''] ?? block('Unknown acceptance mode.');
if (!existsSync(target)) block(`The ${mode} acceptance adapter is not implemented; no live proof exists.`);
const result = spawnSync(process.execPath, ['--import', 'tsx', target], { stdio: 'inherit', env: process.env });
if (result.error) block('Acceptance process could not start.');
process.exit(result.status ?? 1);
