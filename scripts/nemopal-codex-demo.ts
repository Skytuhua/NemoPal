import { isAbsolute } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { resolveCodexExecutable } from '../packages/codex-observer/src/transport';
import { runDemo } from '../apps/desktop/src/main/codex-demo-cli';

try {
  const workspace = process.argv[2];
  if (!workspace || !isAbsolute(workspace) || process.argv.length !== 3) throw Error('Provide exactly one absolute workspace directory.');
  const directory = await realpath(workspace);
  if (!(await stat(directory)).isDirectory()) throw Error('Workspace must be a directory.');
  const executable = resolveCodexExecutable();
  await runDemo({ workspace: directory, executable, args: ['app-server', '--listen', 'stdio://', '-c', 'analytics.enabled=false'], input: process.stdin, output: process.stdout });
} catch (error) {
  console.error(`Demo stopped: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
}
