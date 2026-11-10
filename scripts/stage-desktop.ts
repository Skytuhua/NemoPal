import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { auditBuildOutput } from './audit-build-output';

// This is an app payload, not an Electron runtime or a release package.
// The build audit rejects unexpected files and checks each admitted file.
export function stageDesktopPayload(root: string, outputParent: string) {
  const audit = auditBuildOutput(root);
  const files = audit.files.filter(file => (file.path.startsWith('apps/web/dist/') || file.path.startsWith('apps/desktop/dist/')) && !file.path.endsWith('.map'));
  const checked = files.map(file => {
    const contents = readFileSync(join(root, file.path));
    const digest = createHash('sha256').update(contents).digest('hex');
    if (contents.length !== file.bytes || digest !== file.sha256) throw Error('Build output changed after audit');
    return { path: file.path, contents };
  });
  const directory = mkdtempSync(join(outputParent, 'nemopal-payload-'));
  for (const file of checked) {
    const target = join(directory, file.path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, file.contents, { flag: 'wx' });
  }
  const manifest = { name: 'nemopal', productName: 'NemoPal', version: '0.1.0', private: true, type: 'module', main: 'apps/desktop/dist/main/index.js' };
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return { directory, buildManifestSha256: audit.manifestSha256, fileCount: checked.length };
}
