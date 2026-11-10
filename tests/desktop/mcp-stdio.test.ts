import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, it } from 'vitest';

it('speaks real MCP stdio and preserves literal stdin through a CLI launcher with spaces', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nemopal mcp '));
  const threadId = '11111111-1111-4111-8111-111111111111';
  const received = join(directory, 'received.txt');
  const script = join(directory, 'fake-t3.mjs');
  const launcher = process.platform === 'win32' ? join(directory, 't3.cmd') : script;
  await writeFile(script, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] !== 'thread' || args[2] !== ${JSON.stringify(threadId)}) process.exit(1);
if (args[1] === 'show') console.log(JSON.stringify({ thread: { threadId: args[2], title: 'Fixture', status: 'idle', link: 'https://example.test/thread' }, messages: [] }));
else if (args[1] === 'send' && args[3] === '-') {
  writeFileSync(${JSON.stringify(received)}, readFileSync(0));
  console.log(JSON.stringify({ threadId: args[2], runId: 'fixture-run', status: 'queued' }));
} else process.exit(1);
`);
  if (process.platform === 'win32') await writeFile(launcher, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  else await chmod(script, 0o700);
  const transport = new StdioClientTransport({
    command: process.execPath, args: ['--import', 'tsx', resolve('packages/mcp-bridge/src/main.ts')],
    env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), NEMOPAL_T3_THREAD_ID: threadId, NEMOPAL_T3_CLI: launcher },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stdio-fixture', version: '0.1.0' });
  try {
    await client.connect(transport);
    const read = await client.callTool({ name: 'read_thread', arguments: {} });
    expect(read.isError).not.toBe(true);
    expect(read.structuredContent).toMatchObject({ thread: { threadId }, messages: [] });
    const message = '--wait\r\n$(secret) & echo "quoted" | more\n你好';
    const send = await client.callTool({ name: 'send_message', arguments: { message } });
    expect(send.isError).not.toBe(true);
    expect(send.structuredContent).toMatchObject({ threadId, status: 'queued' });
    expect(await readFile(received, 'utf8')).toBe(message);
  } finally {
    await client.close();
    expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
    expect(basename(directory)).toMatch(/^nemopal mcp /);
    await rm(directory, { recursive: true, force: true });
  }
});
