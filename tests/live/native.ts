import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildDesktop } from '../../scripts/build';

if (process.platform !== 'win32') { console.error('BLOCKED: Windows native smoke requires Windows.'); process.exit(2); }
const directory = await mkdtemp(join(tmpdir(), 'lp-native-'));
try {
  await buildDesktop();
  await build({ entryPoints: ['tests/desktop/native-smoke-app.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['electron'], outfile: 'apps/desktop/dist/native-smoke.mjs' });
  const electron = createRequire(import.meta.url)('electron') as string;
  const environment: NodeJS.ProcessEnv = { ...process.env, LP_NATIVE_SMOKE_DIR: directory, LP_NATIVE_PRELOAD_DIR: resolve('apps/desktop/dist/preload') };
  delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, ['apps/desktop/dist/native-smoke.mjs'], { env: environment, stdio: 'pipe', windowsHide: false });
  let diagnostics = ''; child.stderr.on('data', data => { if (diagnostics.length < 4096) diagnostics += String(data); });
  child.stdout.on('data', data => { if (diagnostics.length < 4096) diagnostics += String(data); });
  const timeout = setTimeout(() => child.kill(), 25000);
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); clearTimeout(timeout);
  if (code !== 0) { console.error('FAIL: native smoke process', code, diagnostics); process.exitCode = 1; }
  else console.log(await readFile(join(directory, 'receipt.json'), 'utf8'));
} finally { await rm(directory, { recursive: true, force: true }); }
