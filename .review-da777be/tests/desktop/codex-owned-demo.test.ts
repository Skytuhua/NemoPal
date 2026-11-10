import { expect, it } from 'vitest';
import { createDemoSession } from '../../apps/desktop/src/main/codex-demo';
import { resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { runDemo } from '../../apps/desktop/src/main/codex-demo-cli';

const fixture = resolve('tests/desktop/fixtures/demo-app-server.cjs');

it('starts one new thread and keeps multiple messages and replies in that thread', async () => {
  const replies: string[] = [];
  const demo = await createDemoSession({ executable: process.execPath, args: [fixture], workspace: process.cwd(), onReply: text => replies.push(text) });
  try {
    expect(demo.threadId).toBe('demo-owned');
    expect(await demo.send('first')).toEqual({ status: 'completed' });
    expect(await demo.send('second')).toEqual({ status: 'completed' });
    expect(replies).toEqual(['reply first', 'reply second']);
    expect(await demo.send('fail')).toEqual({ status: 'failed', error: 'synthetic failure' });
  } finally { demo.close(); }
});

it('stops without answering a server approval request', async () => {
  const demo = await createDemoSession({ executable: process.execPath, args: [fixture], workspace: process.cwd(), onReply: () => {} });
  try {
    await expect(demo.send('approval')).rejects.toThrow('server request');
    await expect(demo.send('again')).rejects.toThrow();
  } finally { demo.close(); }
});

it('runs the terminal interaction only after consent and can show the conversation', async () => {
  let output = '';
  const writable = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
  await runDemo({ workspace: process.cwd(), executable: process.execPath, args: [fixture], input: Readable.from(['START\nfirst\n/history\n/quit\n']), output: writable });
  expect(output).toContain('demo-owned');
  expect(output).toContain('reply first');
  expect(output).toMatch(/Conversation[\s\S]*You: first[\s\S]*Codex: reply first/);
});

it('does not start a process when the user declines the demo', async () => {
  let output = '';
  const writable = new Writable({ write(chunk, _encoding, done) { output += chunk.toString(); done(); } });
  await runDemo({ workspace: process.cwd(), executable: 'does-not-exist', args: [], input: Readable.from(['no\n']), output: writable });
  expect(output).toContain('Demo cancelled');
});
