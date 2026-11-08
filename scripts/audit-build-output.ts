import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync, type Stats } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const roots = ['apps/cloud/dist', 'apps/web/dist', 'apps/desktop/dist'] as const;
const required = [
  'apps/cloud/dist/main.js', 'apps/cloud/dist/main.js.map',
  'apps/desktop/dist/main/index.js', 'apps/desktop/dist/main/index.js.map',
  'apps/desktop/dist/preload/pet.cjs', 'apps/desktop/dist/preload/workspace.cjs', 'apps/desktop/dist/preload/pet-chat.cjs',
  'apps/web/dist/index.html',
];
const directories = new Set([...roots, 'apps/web/dist/assets', 'apps/desktop/dist/main', 'apps/desktop/dist/preload']);
const maxFiles = 512, maxEntries = 1024, maxFileBytes = 16 * 1024 * 1024, maxTotalBytes = 64 * 1024 * 1024;
const mouseAsset = /^apps\/web\/dist\/assets\/pixel-mouse-idle-v1-[A-Za-z0-9_-]+\.png$/;
const mouseSha256 = '215aabdb08587e857d675451f6631afbb4c1d5133cae77c310574eea05778e7e';
const geistAsset = /^apps\/web\/dist\/assets\/geist-variable-[A-Za-z0-9_-]+\.woff2$/;
const geistSha256 = '2ffebe993e969069a9789d15164b7715d42491b5835516c5e3b935d5f81b05f1';
const forbiddenName = /(?:^|[._-])(?:env|credentials?|secrets?|tokens?|pairing|journal|history|sessions?|logs?|device|id_rsa|id_ed25519)(?:[._-]|$)|^\.(?:git|codex|ssh)$|\.(?:jsonl|pem|key|pfx|p12|protected|sqlite3?|db|log)$/i;
const credentialPatterns = [
  /\b(?:nvapi-|sk-(?:proj-)?|ghp_|github_pat_)[A-Za-z0-9_-]{20,}/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}/,
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|https?):\/\/[^\s/"'<>:]+:[^\s/"'<>@]+@/i,
  /\bBearer\s+[A-Za-z0-9._~-]{20,}/i,
  /["'`]?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|pairing[_-]?code|token|secret|password)["'`]?\s*[:=]\s*["'`][A-Za-z0-9_./+~=-]{12,}["'`]/i,
];

class AuditFailure extends Error {
  constructor(reason: string) { super(`Build audit blocked: ${reason}.`); }
}
function block(reason: string): never { throw new AuditFailure(reason); }
function hash(bytes: string | Buffer) { return createHash('sha256').update(bytes).digest('hex'); }
function compare(a: string, b: string) { return a < b ? -1 : a > b ? 1 : 0; }
type ManifestFile = { path: string; bytes: number; sha256: string };

/** A quiescent build only. The caller supplies a test anchor; the CLI has no path option. */
export function auditBuildOutput(root: string) {
  try { return inspect(root); }
  catch (error) {
    if (error instanceof AuditFailure) throw error;
    // Filesystem/decoder exceptions can contain absolute paths or source text.
    throw new AuditFailure('missing or unreadable output');
  }
}

function inspect(root: string) {
  if (!isAbsolute(root)) block('absolute audit anchor required');
  root = resolve(root);
  const anchor = lstatSync(root);
  if (anchor.isSymbolicLink()) block('symbolic link');
  if (!anchor.isDirectory() || realpathSync(root) !== root) block('outside audit anchor');

  // Check every component before descending; do not resolve a link's target.
  function checked(path: string): { absolute: string; stat: Stats } {
    const parts = path.split('/');
    if (parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..')) block('invalid output path');
    let absolute = root, stat = anchor;
    for (const [index, part] of parts.entries()) {
      absolute = join(absolute, part);
      const local = relative(root, absolute);
      if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) block('outside audit anchor');
      stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) block('symbolic link');
      if (index < parts.length - 1 && !stat.isDirectory()) block('invalid output ancestor');
    }
    return { absolute, stat };
  }

  const inventory: { path: string; stat: Stats }[] = [];
  let entries = 0, totalBytes = 0;
  function walk(path: string) {
    const { absolute, stat } = checked(path);
    if (stat.isDirectory()) {
      if (!directories.has(path)) block('unexpected output directory');
      const names: string[] = [], directory = opendirSync(absolute);
      try {
        let entry;
        while ((entry = directory.readSync()) !== null) {
          if (++entries > maxEntries) block('inventory limit');
          names.push(entry.name);
        }
      } finally { directory.closeSync(); }
      names.sort(compare);
      for (const name of names) {
        if (forbiddenName.test(name)) block('forbidden file name');
        if (credentialPatterns.some(pattern => pattern.test(name))) block('credential-like file name');
        walk(`${path}/${name}`);
      }
      return;
    }
    if (!stat.isFile()) block('non-regular output');
    if (stat.nlink !== 1) block('hard link');
    if (!required.includes(path) && !/^apps\/web\/dist\/assets\/[A-Za-z0-9_-]+\.(?:js|css|svg)$/.test(path) && !mouseAsset.test(path) && !geistAsset.test(path)) block('unexpected output file');
    if (stat.size === 0) block('empty output');
    totalBytes += stat.size;
    if (stat.size > maxFileBytes || totalBytes > maxTotalBytes) block('size limit');
    inventory.push({ path, stat });
    if (inventory.length > maxFiles) block('inventory limit');
  }
  for (const path of roots) {
    if (!checked(path).stat.isDirectory()) block('missing output directory');
    walk(path);
  }
  inventory.sort((a, b) => compare(a.path, b.path));
  const paths = new Set(inventory.map(file => file.path));
  if (required.some(path => !paths.has(path)) || !inventory.some(file => file.path.startsWith('apps/web/dist/assets/') && file.path.endsWith('.js')) || !inventory.some(file => file.path.endsWith('.css'))) block('missing compiled outputs');

  // Inventory, names, link checks and all bounds pass BEFORE any file content read.
  const files: ManifestFile[] = [];
  let indexHtml = '';
  for (const file of inventory) {
    const { absolute } = checked(file.path);
    const fd = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    let bytes: Buffer;
    try {
      const current = fstatSync(fd);
      if (!current.isFile() || current.nlink !== 1 || current.ino !== file.stat.ino || current.dev !== file.stat.dev || current.size !== file.stat.size || current.mtimeMs !== file.stat.mtimeMs) block('output changed during audit');
      bytes = Buffer.alloc(current.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!count) block('output changed during audit');
        offset += count;
      }
      const after = fstatSync(fd);
      if (after.size !== current.size || after.mtimeMs !== current.mtimeMs) block('output changed during audit');
    } finally { closeSync(fd); }
    const sha256 = hash(bytes);
    if (mouseAsset.test(file.path)) {
      // Only the reviewed immutable sprite may bypass text decoding; no general PNG admission.
      if (bytes.length !== 960766 || sha256 !== mouseSha256) block('sprite digest mismatch');
      files.push({ path: file.path, bytes: bytes.length, sha256 });
      continue;
    }
    if (geistAsset.test(file.path)) {
      // This immutable OFL font is the only font admitted; all bounds/link checks still apply.
      if (bytes.length !== 69760 || sha256 !== geistSha256) block('font digest mismatch');
      files.push({ path: file.path, bytes: bytes.length, sha256 });
      continue;
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // Also inspect ordinary JSON/source-map escaped quotes and unicode escapes.
    let decoded = text;
    if (credentialPatterns.some(pattern => pattern.test(text))) block('credential-like text');
    for (let pass = 0; pass < 2; pass++) {
      decoded = decoded.replace(/\\([\\"'/])/g, '$1');
      const unicode = decoded.replace(/\\u([a-f0-9]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      if (credentialPatterns.some(pattern => pattern.test(decoded) || pattern.test(unicode))) block('credential-like text');
    }
    if (file.path === 'apps/web/dist/index.html') indexHtml = text;
    files.push({ path: file.path, bytes: bytes.length, sha256 });
  }
  const references = [...indexHtml.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]!);
  if (!references.some(ref => ref.endsWith('.js')) || !references.some(ref => ref.endsWith('.css'))) block('missing web asset reference');
  for (const ref of references) {
    if (!/^\.\/assets\/[A-Za-z0-9_-]+\.(?:js|css|svg)$/.test(ref) || !paths.has(`apps/web/dist/${ref.slice(2)}`)) block('invalid web asset reference');
  }
  return {
    status: 'PASS' as const, secretAbsenceProven: false, algorithm: 'sha256' as const,
    roots: roots.map(path => {
      const members = files.filter(file => file.path.startsWith(`${path}/`));
      return { path, fileCount: members.length, bytes: members.reduce((sum, file) => sum + file.bytes, 0) };
    }),
    fileCount: files.length, totalBytes,
    // Canonical bytes: UTF-8 JSON.stringify(files) + one LF; sorted relative paths.
    manifestSha256: hash(`${JSON.stringify(files)}\n`), files,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) block('no arguments supported');
    console.log(JSON.stringify(auditBuildOutput(fileURLToPath(new URL('../', import.meta.url))), null, 2));
  } catch (error) {
    console.error(error instanceof AuditFailure ? error.message : 'Build audit blocked: audit unavailable.');
    process.exitCode = 1;
  }
}
