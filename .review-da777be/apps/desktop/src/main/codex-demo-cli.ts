import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { createDemoSession } from './codex-demo';

export async function runDemo(options: { workspace: string; executable: string; args: string[]; input: Readable; output: Writable }) {
  const write = (text: string) => options.output.write(text);
  write(`NemoPal Codex demo: a NEW local thread, not an existing T3 thread.\nWorkspace: ${options.workspace}\n`);
  write('Codex runs with read-only sandbox and approval policy never. It may read outside the workspace; configured tools and integrations may have their own permissions. No approval requests will be accepted. Messages may use your signed-in provider and incur usage.\n');
  write('Type START to create the thread, or anything else to cancel: ');
  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  let session: Awaited<ReturnType<typeof createDemoSession>> | undefined;
  const history: string[] = [];
  try {
    const iterator = lines[Symbol.asyncIterator]();
    const consent = await iterator.next();
    if (consent.done || consent.value !== 'START') { write('\nDemo cancelled.\n'); return; }
    session = await createDemoSession({ ...options, onReply: text => { history.push(`Codex: ${text}`); write(`\nCodex: ${text}\n`); } });
    write(`\nNew demo thread: ${session.threadId}\nType a message, /history, or /quit.\n`);
    while (true) {
      write('You: ');
      const line = await iterator.next();
      if (line.done || line.value === '/quit') break;
      if (line.value === '/history') { write(`\nConversation\n${history.join('\n')}\n`); continue; }
      if (!line.value.trim()) continue;
      if (Buffer.byteLength(line.value) > 65536) { write('\nMessage exceeds 65536 bytes.\n'); continue; }
      history.push(`You: ${line.value}`);
      const result = await session.send(line.value);
      write(`\nTurn ${result.status}${result.error ? `: ${result.error}` : ''}\n`);
    }
  } finally { session?.close(); lines.close(); }
}
