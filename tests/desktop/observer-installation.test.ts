import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { resolveCodexExecutable } from '../../packages/codex-observer/src/transport';

it.runIf(process.platform === 'win32')('finds the installed npm 0.166 layout bin directory without invoking a shell', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-codex-install-'));
  vi.stubEnv('CODEX_MANAGED_PACKAGE_ROOT', dir); vi.stubEnv('APPDATA', dir);
  const binary = join(dir, 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc`, 'bin', 'codex.exe');
  try { await mkdir(join(binary, '..'), { recursive: true }); await writeFile(binary, 'synthetic executable marker'); expect(resolveCodexExecutable()).toBe(binary); }
  finally { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); }
});
