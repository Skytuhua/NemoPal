import { expect, it } from 'vitest';
import { createDemoSession } from '../../apps/desktop/src/main/codex-demo';
import { resolve } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
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

it('reports uncertain delivery if the server exits after receiving a send', async () => {
  const demo = await createDemoSession({ executable: process.execPath, args: [fixture], workspace: process.cwd(), onReply: () => {} });
  try { await expect(demo.send('lost')).rejects.toThrow('may have been accepted'); }
  finally { demo.close(); }
});

it('distinguishes a malformed acknowledgement from an explicit rejection', async () => {
  const options = { executable: process.execPath, args: [fixture], workspace: process.cwd(), onReply: () => {} };
  const malformed = await createDemoSession(options);
  try { await expect(malformed.send('malformed')).rejects.toThrow('may have been accepted'); }
  finally { malformed.close(); }
  const rejected = await createDemoSession(options);
  try { await expect(rejected.send('rejected')).rejects.toThrow('App-server rejected request'); }
  finally { rejected.close(); }
});

it('reports an idle server exit without waiting for another input', async () => {
  const input = new PassThrough();
  const output = new Writable({ write(_chunk, _encoding, done) { done(); } });
  input.write('START\n');
  try {
    const result = runDemo({ workspace: process.cwd(), executable: process.execPath, args: [fixture, 'exit-idle'], input, output });
    await expect(Promise.race([result, new Promise((_, reject) => setTimeout(() => reject(Error('idle exit not reported')), 1500))])).rejects.toThrow('App-server exited');
  } finally { input.destroy(); }
});
