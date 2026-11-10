import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { stageDesktopPayload } from '../scripts/stage-desktop';

const files = [
  'apps/cloud/dist/main.js', 'apps/cloud/dist/main.js.map',
  'apps/desktop/dist/main/index.js', 'apps/desktop/dist/main/index.js.map',
  'apps/desktop/dist/preload/pet.cjs', 'apps/desktop/dist/preload/workspace.cjs',
  'apps/web/dist/assets/favicon-test.svg', 'apps/web/dist/assets/index-test.css',
  'apps/web/dist/assets/index-test.js', 'apps/web/dist/index.html',
];
function put(root: string, path: string, contents = 'hello') {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, contents);
}
function fixture(run: (root: string, output: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'nemopal-stage-test-'));
  try {
    const output = join(root, 'output'); mkdirSync(output);
    const source = join(root, 'source'); mkdirSync(source);
    for (const file of files) put(source, file, file.endsWith('.html')
      ? '<link rel="icon" href="./assets/favicon-test.svg"><link rel="stylesheet" href="./assets/index-test.css"><script src="./assets/index-test.js"></script>' : 'hello');
    run(source, output);
  } finally {
    const absolute = realpathSync(root);
    const expectedPrefix = join(realpathSync(tmpdir()), 'nemopal-stage-test-');
    assert.ok(absolute.toLowerCase().startsWith(expectedPrefix.toLowerCase()));
    rmSync(absolute, { recursive: true, force: true });
  }
}

test('stages audited renderer and main/preloads only in a fresh app payload', () => fixture((source, output) => {
  const result = stageDesktopPayload(source, output);
  const manifest = JSON.parse(readFileSync(join(result.directory, 'package.json'), 'utf8'));
  assert.equal(manifest.main, 'apps/desktop/dist/main/index.js');
  assert.equal(manifest.type, 'module');
  assert.equal(readFileSync(join(result.directory, manifest.main), 'utf8'), 'hello');
  assert.ok(existsSync(join(result.directory, 'apps/web/dist/index.html')));
  assert.equal(resolve(dirname(join(result.directory, manifest.main)), '../../../web/dist/index.html'), join(result.directory, 'apps/web/dist/index.html'));
  assert.ok(existsSync(join(result.directory, 'apps/desktop/dist/preload/pet.cjs')));
  assert.equal(existsSync(join(result.directory, 'apps/cloud')), false);
  assert.equal(existsSync(join(result.directory, 'apps/desktop/dist/main/index.js.map')), false);
  assert.notEqual(stageDesktopPayload(source, output).directory, result.directory);
}));

test('rejects unexpected or missing outputs before creating a payload', () => fixture((source, output) => {
  put(source, 'apps/web/dist/.env', 'fake test value');
  assert.throws(() => stageDesktopPayload(source, output), /Build audit blocked/);
  assert.deepEqual(readdirSync(output), []);
}));
