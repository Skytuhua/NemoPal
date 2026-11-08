import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkSync, mkdirSync, mkdtempSync, openSync, closeSync, ftruncateSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditBuildOutput } from '../scripts/audit-build-output';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const outputs = [
  'apps/cloud/dist/main.js', 'apps/cloud/dist/main.js.map',
  'apps/desktop/dist/main/index.js', 'apps/desktop/dist/main/index.js.map',
  'apps/desktop/dist/preload/pet.cjs', 'apps/desktop/dist/preload/workspace.cjs',
  'apps/web/dist/assets/favicon-test.svg', 'apps/web/dist/assets/index-test.css',
  'apps/web/dist/assets/index-test.js', 'apps/web/dist/index.html',
];
const html = '<link rel="icon" href="./assets/favicon-test.svg"><link rel="stylesheet" href="./assets/index-test.css"><script type="module" src="./assets/index-test.js"></script>';
function write(root: string, path: string, text = 'hello') {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, text);
}
function fixture(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'lp-build-audit-'));
  try {
    for (const path of outputs) write(root, path, path.endsWith('.html') ? html : 'hello');
    run(root);
  } finally {
    // This exact fixture root is owned by this test; no profile or real output tree.
    rmSync(root, { recursive: true, force: true });
  }
}

test('missing compiled outputs block the audit instead of producing a passing manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'lp-build-audit-'));
  try {
    assert.throws(() => auditBuildOutput(root), /Build audit blocked/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('complete outputs produce sorted exact counts and known SHA-256 bytes, without absolute paths', () => fixture(root => {
  const result = auditBuildOutput(root);
  assert.equal(result.status, 'PASS');
  assert.equal(result.secretAbsenceProven, false);
  assert.equal(result.fileCount, 10);
  assert.equal(result.totalBytes, 45 + Buffer.byteLength(html));
  assert.deepEqual(result.files.map(file => file.path), outputs);
  assert.deepEqual(result.files[0], {
    path: outputs[0], bytes: 5,
    sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  });
  assert.deepEqual(result.roots, [
    { path: 'apps/cloud/dist', fileCount: 2, bytes: 10 },
    { path: 'apps/web/dist', fileCount: 4, bytes: 15 + Buffer.byteLength(html) },
    { path: 'apps/desktop/dist', fileCount: 4, bytes: 20 },
  ]);
  assert.match(result.manifestSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(auditBuildOutput(root), result);
  assert.equal(JSON.stringify(result).includes(root), false);
  fixture(other => assert.deepEqual(auditBuildOutput(other), result));
  write(root, outputs[0]!, 'hello!');
  const changed = auditBuildOutput(root);
  assert.equal(changed.totalBytes, result.totalBytes + 1);
  assert.notEqual(changed.manifestSha256, result.manifestSha256);
}));

for (const path of outputs) test(`missing intended output rejects: ${path}`, () => fixture(root => {
  rmSync(join(root, path));
  assert.throws(() => auditBuildOutput(root), /Build audit blocked/);
}));

for (const path of [
  '.env', '.env.production', 'credentials.json', 'device.protected', 'journal.json.previous',
  'history.jsonl', 'sessions', '.git', 'private.pem', 'debug.log',
]) test(`forbidden inventory rejects before reading content: ${path}`, () => fixture(root => {
  // The credential-like text in an earlier allowed file must not be read first.
  write(root, outputs[0]!, 'nvapi-' + 'SYNTHETIC'.repeat(8));
  write(root, `apps/web/dist/${path}`);
  assert.throws(() => auditBuildOutput(root), /forbidden file name/);
}));

for (const text of [
  'nvapi-' + 'SYNTHETIC'.repeat(8),
  'sk-' + 'SYNTHETIC'.repeat(8),
  'ghp_' + 'SYNTHETIC'.repeat(8),
  'github_pat_' + 'SYNTHETIC'.repeat(8),
  'AKIA' + 'A'.repeat(16),
  'eyJ' + 'a'.repeat(20) + '.eyJ' + 'b'.repeat(20) + '.' + 'c'.repeat(30),
  '-----BEGIN ' + 'RSA PRIVATE KEY-----',
  'postgresql://synthetic:synthetic-password@127.0.0.1/example',
  'Authorization: Bearer ' + 'SYNTHETIC'.repeat(8),
  '"apiKey":"' + 'SYNTHETIC'.repeat(8) + '"',
  '"pairingCode":"' + 'SYNTHETIC'.repeat(8) + '"',
  '"token":"' + 'SYNTHETIC'.repeat(8) + '"',
]) test('obvious synthetic credential format rejects with a content-free diagnostic', () => fixture(root => {
  write(root, outputs[1]!, JSON.stringify({ sourcesContent: [text] }));
  assert.throws(() => auditBuildOutput(root), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'Build audit blocked: credential-like text.');
    assert.equal(error.message.includes(text), false);
    return true;
  });
}));

test('unexpected files and nested output directories are not admitted', () => fixture(root => {
  write(root, 'apps/web/dist/assets/notes.txt');
  assert.throws(() => auditBuildOutput(root), /unexpected output/);
  rmSync(join(root, 'apps/web/dist/assets/notes.txt'));
  write(root, 'apps/web/dist/assets/nested/extra.js');
  assert.throws(() => auditBuildOutput(root), /unexpected output directory/);
}));

test('HTML references must point to inventoried local assets', () => fixture(root => {
  for (const target of ['./assets/missing.js', '../outside.js', 'https://example.invalid/app.js', '/assets/index-test.js']) {
    write(root, 'apps/web/dist/index.html', html.replace('./assets/index-test.js', target));
    assert.throws(() => auditBuildOutput(root), /asset reference/);
  }
}));

test('a non-build sibling is neither inventoried nor read', () => fixture(root => {
  write(root, 'outside/.env', 'nvapi-' + 'SYNTHETIC'.repeat(8));
  assert.equal(auditBuildOutput(root).fileCount, 10);
}));

test('file size and aggregate size are bounded before any content read', () => fixture(root => {
  const resize = (path: string, size: number) => {
    const fd = openSync(join(root, path), 'r+');
    try { ftruncateSync(fd, size); } finally { closeSync(fd); }
  };
  resize(outputs[0]!, 16 * 1024 * 1024 + 1);
  assert.throws(() => auditBuildOutput(root), /size limit/);
  resize(outputs[0]!, 16 * 1024 * 1024);
  for (const path of outputs.slice(1, 4)) resize(path, 16 * 1024 * 1024);
  assert.throws(() => auditBuildOutput(root), /size limit/);
}));

test('file count is bounded', () => fixture(root => {
  for (let i = 0; i < 513; i++) write(root, `apps/web/dist/assets/extra-${i}.js`);
  assert.throws(() => auditBuildOutput(root), /inventory limit/);
}));

test('empty compiled outputs reject', () => fixture(root => {
  write(root, outputs[0]!, '');
  assert.throws(() => auditBuildOutput(root), /empty output/);
}));

test('hard links are rejected, including a link to an outside synthetic file', () => fixture(root => {
  write(root, 'outside/synthetic.txt');
  rmSync(join(root, outputs[0]!));
  linkSync(join(root, 'outside/synthetic.txt'), join(root, outputs[0]!));
  assert.throws(() => auditBuildOutput(root), /hard link/);
}));

test('directory junctions cannot redirect an output root or its ancestors', () => fixture(root => {
  mkdirSync(join(root, 'outside'), { recursive: true });
  rmSync(join(root, 'apps/cloud/dist'), { recursive: true });
  symlinkSync(join(root, 'outside'), join(root, 'apps/cloud/dist'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => auditBuildOutput(root), /symbolic link/);
  rmSync(join(root, 'apps/cloud'), { recursive: true });
  symlinkSync(join(root, 'outside'), join(root, 'apps/cloud'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => auditBuildOutput(root), /symbolic link/);
}));

test('an interior junction and a linked audit anchor are rejected', () => fixture(root => {
  mkdirSync(join(root, 'outside'), { recursive: true });
  rmSync(join(root, 'apps/web/dist/assets'), { recursive: true });
  symlinkSync(join(root, 'outside'), join(root, 'apps/web/dist/assets'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => auditBuildOutput(root), /symbolic link/);
  const alias = join(root, 'alias');
  symlinkSync(join(root, 'apps'), alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => auditBuildOutput(alias), /symbolic link/);
}));

test('invalid UTF-8 is blocked without echoing decoder input', () => fixture(root => {
  writeFileSync(join(root, outputs[0]!), Buffer.from([0xff, 0xfe]));
  assert.throws(() => auditBuildOutput(root), { message: 'Build audit blocked: missing or unreadable output.' });
}));

test('relative anchors cannot redirect the scan', () => {
  assert.throws(() => auditBuildOutput('..'), /absolute audit anchor required/);
});

test('CLI rejects path options before inspecting an arbitrary target', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('../scripts/audit-build-output.ts', import.meta.url)), '--root', 'synthetic-outside'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr.trim(), 'Build audit blocked: no arguments supported.');
});

test('credential-shaped asset names are blocked without disclosing the name', () => fixture(root => {
  write(root, `apps/web/dist/assets/nvapi-${'SYNTHETIC'.repeat(8)}.js`);
  assert.throws(() => auditBuildOutput(root), { message: 'Build audit blocked: credential-like file name.' });
}));

test('directory enumeration stops at the first over-limit entry', () => fixture(root => {
  for (let i = 0; i < 2048; i++) write(root, `apps/web/dist/assets/extra-${i}.js`);
  let enumerated = 0;
  const readDirectory = fs.readdirSync, openDirectory = fs.opendirSync;
  fs.readdirSync = ((...args: Parameters<typeof readDirectory>) => {
    const names = readDirectory(...args); enumerated += names.length; return names;
  }) as typeof readDirectory;
  fs.opendirSync = ((...args: Parameters<typeof openDirectory>) => {
    const directory = openDirectory(...args), read = directory.readSync.bind(directory);
    directory.readSync = () => { const entry = read(); if (entry) enumerated++; return entry; };
    return directory;
  }) as typeof openDirectory;
  syncBuiltinESMExports();
  try {
    assert.throws(() => auditBuildOutput(root), /inventory limit/);
    assert.ok(enumerated <= 1025, `enumerated ${enumerated} entries`);
  } finally { fs.readdirSync = readDirectory; fs.opendirSync = openDirectory; syncBuiltinESMExports(); }
}));

for (const layers of [0, 1, 2]) test(`recognizes Unicode credential text with ${layers} JSON escape layers`, () => fixture(root => {
  const synthetic = 'nvapi-' + 'SYNTHETIC'.repeat(5);
  let encoded = [...synthetic].map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  for (let i = 0; i < layers; i++) encoded = JSON.stringify({ sourcesContent: [encoded] });
  write(root, outputs[1]!, encoded);
  assert.throws(() => auditBuildOutput(root), { message: 'Build audit blocked: credential-like text.' });
}));

const spritePath = 'apps/web/dist/assets/pixel-mouse-idle-v1-test.png';
function approvedSprite() {
  // Public reviewed fixture from PR29; full Git history avoids duplicating the binary.
  const result = spawnSync('git', ['show', '811cd5a63b985b74cbdd0897895fa823d3aeda5d:assets/pet/pixel-mouse-idle-v1.png'],
    { cwd: fileURLToPath(new URL('../', import.meta.url)), maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, 'The pinned approved asset must be available in Git history');
  return result.stdout;
}
test('the digest-pinned approved mouse PNG is included as opaque bytes', () => fixture(root => {
  writeFileSync(join(root, spritePath), approvedSprite());
  const result = auditBuildOutput(root);
  assert.equal(result.fileCount, 11);
  assert.deepEqual(result.files.find(file => file.path === spritePath), { path: spritePath, bytes: 960766,
    sha256: '215aabdb08587e857d675451f6631afbb4c1d5133cae77c310574eea05778e7e' });
}));
for (const change of ['changed', 'appended', 'other-name'] as const) test(`a ${change} PNG is rejected`, () => fixture(root => {
  const bytes = Buffer.from(approvedSprite());
  if (change === 'changed') bytes[100] = bytes[100]! ^ 1;
  writeFileSync(join(root, change === 'other-name' ? 'apps/web/dist/assets/other-image.png' : spritePath),
    change === 'appended' ? Buffer.concat([bytes, Buffer.from('extra')]) : bytes);
  assert.throws(() => auditBuildOutput(root), /Build audit blocked/);
}));

const fontPath = 'apps/web/dist/assets/geist-variable-Test_123.woff2';
const approvedFont = () => readFileSync(new URL('../apps/web/src/app/fonts/geist-variable.woff2', import.meta.url));

test('only the exact reviewed Geist font is inventoried as opaque bytes', () => fixture(root => {
  writeFileSync(join(root, fontPath), approvedFont());
  const result = auditBuildOutput(root);
  assert.equal(result.fileCount, 11);
  assert.deepEqual(result.files.find(file => file.path === fontPath), {
    path: fontPath, bytes: 69760,
    sha256: '2ffebe993e969069a9789d15164b7715d42491b5835516c5e3b935d5f81b05f1',
  });
}));

for (const change of ['changed', 'appended', 'truncated', 'other-name', 'no-suffix', 'other-format'] as const)
  test(`a ${change} font is rejected`, () => fixture(root => {
    let bytes = Buffer.from(approvedFont());
    let path = fontPath;
    if (change === 'changed') bytes[100] = bytes[100]! ^ 1;
    if (change === 'appended') bytes = Buffer.concat([bytes, Buffer.from('extra')]);
    if (change === 'truncated') bytes = bytes.subarray(0, -1);
    if (change === 'other-name') path = 'apps/web/dist/assets/other-font-Test_123.woff2';
    if (change === 'no-suffix') path = 'apps/web/dist/assets/geist-variable.woff2';
    if (change === 'other-format') path = 'apps/web/dist/assets/geist-variable-Test_123.ttf';
    writeFileSync(join(root, path), bytes);
    assert.throws(() => auditBuildOutput(root), /Build audit blocked/);
  }));

test('font admission does not exempt ordinary text outputs from credential scanning', () => fixture(root => {
  writeFileSync(join(root, fontPath), approvedFont());
  write(root, outputs[0]!, 'nvapi-' + 'SYNTHETIC'.repeat(8));
  assert.throws(() => auditBuildOutput(root), { message: 'Build audit blocked: credential-like text.' });
}));

test('arbitrary binary output with a font-shaped name is rejected', () => fixture(root => {
  writeFileSync(join(root, fontPath), Buffer.alloc(69760));
  assert.throws(() => auditBuildOutput(root), /Build audit blocked/);
}));
