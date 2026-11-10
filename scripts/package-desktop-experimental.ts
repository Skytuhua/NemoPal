import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';
import { stageDesktopPayload } from './stage-desktop';

// This local candidate is not the gated package:win release or native proof.
const version = '45.2.3';
const zipName = `electron-v${version}-win32-x64.zip`;
const zipSha256 = '489cd061908e697394b004298bf5ffd345c935d10e8ca197ba819f019ab2dec0';
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

function cachedElectronZip(): string {
  const cache = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'electron', 'Cache');
  if (!cache || !existsSync(cache)) throw Error('Pinned Electron Windows runtime is not cached');
  for (const name of readdirSync(cache)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const dir = join(cache, name);
    if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) continue;
    const file = join(dir, zipName);
    if (!existsSync(file) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) continue;
    if (sha256(readFileSync(file)) === zipSha256) return file;
  }
  throw Error('Pinned Electron Windows runtime is not cached with the required digest');
}

function tree(root: string): Map<string, string> {
  const entries = new Map<string, string>();
  function visit(path: string, prefix: string) {
    for (const name of readdirSync(path)) {
      const absolute = join(path, name), relative = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw Error('Unexpected link in app payload');
      if (stat.isDirectory()) visit(absolute, relative);
      else if (stat.isFile()) entries.set(relative, sha256(readFileSync(absolute)));
      else throw Error('Unexpected object in app payload');
    }
  }
  visit(root, ''); return entries;
}

async function main() {
  if (process.platform !== 'win32' || process.argv.length !== 2) throw Error('Run this no-argument candidate builder on Windows');
  const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
  const temporary = join(root, '.tmp');
  if (!existsSync(temporary)) mkdirSync(temporary);
  if (lstatSync(temporary).isSymbolicLink() || realpathSync(temporary).toLowerCase() !== temporary.toLowerCase()) throw Error('Workspace output directory must be a real directory');
  const sourceZip = cachedElectronZip();
  const output = mkdtempSync(join(temporary, 'nemopal-windows-candidate-'));
  const zipDir = join(output, 'runtime'); mkdirSync(zipDir);
  const zip = join(zipDir, zipName); copyFileSync(sourceZip, zip);
  if (sha256(readFileSync(zip)) !== zipSha256) throw Error('Cached Electron runtime changed during copy');
  const staged = stageDesktopPayload(root, output);
  const bundleDir = join(output, 'bundle'); mkdirSync(bundleDir);
  const paths = await packager({ dir: staged.directory, out: bundleDir, name: 'NemoPal', platform: 'win32', arch: 'x64', electronVersion: version,
    electronZipDir: zipDir, asar: false, prune: false, overwrite: false, sanitizePackageJson: [manifest => manifest], junk: false });
  if (paths.length !== 1 || !paths[0]) throw Error('Expected one Windows candidate');
  const app = join(paths[0], 'resources', 'app');
  const expected = tree(staged.directory), actual = tree(app);
  if (expected.size !== actual.size || [...expected].some(([path, digest]) => actual.get(path) !== digest)) throw Error('Packaged app differs from audited payload');
  console.log(JSON.stringify({ status: 'EXPERIMENTAL', executable: join(paths[0], 'NemoPal.exe'), buildManifestSha256: staged.buildManifestSha256,
    runtimeSha256: zipSha256, nativeVerified: false, signed: false }, null, 2));
}

main().catch(() => { console.error('Experimental package preparation failed. No native or release acceptance is implied.'); process.exitCode = 1; });
