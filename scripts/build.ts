import { existsSync } from 'node:fs';
import { build } from 'esbuild';
import { build as buildWeb } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

function requireFile(path: string) {
  if (!existsSync(path)) throw new Error(`Build blocked: ${path} is not implemented yet.`);
}
export async function buildDesktop() {
  for (const path of ['apps/desktop/src/main/index.ts', 'apps/desktop/src/preload/workspace.ts', 'apps/desktop/src/preload/pet.ts']) requireFile(path);
  await build({ entryPoints: ['apps/desktop/src/main/index.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['electron', '@modelcontextprotocol/sdk/*'], outfile: 'apps/desktop/dist/main/index.js', sourcemap: true });
  await build({ entryPoints: ['apps/desktop/src/preload/workspace.ts', 'apps/desktop/src/preload/pet.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], outdir: 'apps/desktop/dist/preload', outExtension: { '.js': '.cjs' } });
}
async function buildAll() {
  requireFile('apps/web/vite.config.ts');
  requireFile('apps/cloud/src/main.ts');
  await buildWeb({ configFile: resolve('apps/web/vite.config.ts') });
  await build({ entryPoints: ['apps/cloud/src/main.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['fastify', 'pg'], outfile: 'apps/cloud/dist/main.js', sourcemap: true });
  await buildDesktop();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildAll();
