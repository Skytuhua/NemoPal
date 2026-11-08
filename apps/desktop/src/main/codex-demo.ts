import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { z } from 'zod';

type TurnResult = { status: 'completed' | 'failed' | 'interrupted'; error?: string };
type Event = { method: string; params: Record<string, unknown> };
type ActiveTurn = { id?: string; events: Event[]; eventBytes: number; resolve(result: TurnResult): void; reject(error: Error): void; timer: NodeJS.Timeout; seen: Set<string> };

export async function createDemoSession(options: { executable: string; args: string[]; workspace: string; onReply(text: string): void; signal?: AbortSignal }) {
  if (options.signal?.aborted) throw Error('Demo session closed');
  const child: ChildProcessWithoutNullStreams = spawn(options.executable, options.args, { stdio: 'pipe', windowsHide: true });
  let alive = true;
  let threadId = '';
  let active: ActiveTurn | undefined;
  let nextId = 0;
  let partial = '';
  let resolveEnded!: (error: Error) => void;
  const ended = new Promise<Error>(resolve => { resolveEnded = resolve; });
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  function stop(error: Error) {
    if (!alive) return;
    alive = false;
    resolveEnded(error);
    options.signal?.removeEventListener('abort', abort);
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
    if (active) { clearTimeout(active.timer); active.reject(error); active = undefined; }
    child.kill();
  }
  const abort = () => stop(Error('Demo session closed'));
  options.signal?.addEventListener('abort', abort, { once: true });
  function request(method: string, params: unknown): Promise<unknown> {
    if (!alive) return Promise.reject(Error('Demo session stopped'));
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => stop(Error('App-server request timed out')), 15000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  function deliver(event: Event) {
    if (!active || !active.id || event.params.threadId !== threadId) return;
    if (event.method === 'item/completed' && event.params.turnId === active.id) {
      const item = z.object({ id: z.string(), type: z.literal('agentMessage'), text: z.string() }).safeParse(event.params.item);
      if (item.success && !active.seen.has(item.data.id)) { active.seen.add(item.data.id); options.onReply(item.data.text); }
    }
    if (event.method === 'turn/completed') {
      const turn = z.object({ id: z.string(), status: z.enum(['completed', 'failed', 'interrupted']), error: z.object({ message: z.string() }).nullable().optional() }).safeParse(event.params.turn);
      if (turn.success && turn.data.id === active.id) {
        const finished = active; active = undefined; clearTimeout(finished.timer);
        finished.resolve({ status: turn.data.status, ...(turn.data.error ? { error: turn.data.error.message } : {}) });
      }
    }
  }
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    partial += chunk;
    if (Buffer.byteLength(partial) > 4 * 1024 * 1024) return stop(Error('App-server message too large'));
    let index: number;
    while ((index = partial.indexOf('\n')) >= 0 && alive) {
      const line = partial.slice(0, index); partial = partial.slice(index + 1);
      try {
        const message = JSON.parse(line) as Record<string, unknown>;
        if (typeof message.method === 'string' && message.id !== undefined) { stop(Error('Unexpected server request; demo stopped without approval')); return; }
        if (typeof message.id === 'number') {
          const waiting = pending.get(message.id);
          if (waiting) {
            pending.delete(message.id); clearTimeout(waiting.timer);
            if ('error' in message && !('result' in message) && z.object({ code: z.number().int(), message: z.string() }).safeParse(message.error).success)
              waiting.reject(Error('App-server rejected request'));
            else if (!('error' in message) && 'result' in message) waiting.resolve(message.result);
            else waiting.reject(Error('Malformed app-server response'));
          }
        } else if ((message.method === 'item/completed' || message.method === 'turn/completed') && message.params && typeof message.params === 'object' && active) {
          const event = { method: message.method, params: message.params as Record<string, unknown> };
          if (event.params.threadId !== threadId) continue;
          if (!active.id) {
            active.eventBytes += Buffer.byteLength(line);
            if (active.events.length >= 10000 || active.eventBytes > 4 * 1024 * 1024) { stop(Error('Too many app-server events')); return; }
            active.events.push(event);
          } else deliver(event);
        }
      } catch { stop(Error('Invalid app-server message')); }
    }
  });
  child.stderr.on('data', () => {});
  child.stdin.on('error', () => stop(Error('App-server input closed')));
  child.on('error', () => stop(Error('Could not start app-server')));
  child.on('exit', () => stop(Error('App-server exited')));
  try {
    await request('initialize', { clientInfo: { name: 'nemopal_demo', version: '0.1.0' }, capabilities: { experimentalApi: false } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const started = z.object({ thread: z.object({ id: z.string().min(1) }) }).parse(await request('thread/start', { cwd: options.workspace, approvalPolicy: 'never', sandbox: 'read-only' }));
    threadId = started.thread.id;
  } catch (error) { stop(Error('Demo startup failed')); throw error; }
  return {
    threadId,
    ended,
    async send(text: string): Promise<TurnResult> {
      if (!alive) throw Error('Demo session stopped');
      if (active) throw Error('A turn is already running');
      if (!text.trim() || Buffer.byteLength(text) > 65536) throw Error('Message must contain 1–65536 bytes');
      let resolve!: (value: TurnResult) => void;
      let reject!: (error: Error) => void;
      const completion = new Promise<TurnResult>((yes, no) => { resolve = yes; reject = no; });
      void completion.catch(() => {});
      active = { events: [], eventBytes: 0, resolve, reject, seen: new Set(), timer: setTimeout(() => stop(Error('Turn timed out')), 10 * 60 * 1000) };
      try {
        const response = z.object({ turn: z.object({ id: z.string().min(1) }) }).parse(await request('turn/start', { threadId, input: [{ type: 'text', text }] }));
        if (!active) return await completion;
        active.id = response.turn.id;
        const events = active.events; active.events = [];
        for (const event of events) deliver(event);
        return await completion;
      } catch (error) {
        stop(Error('Turn could not be completed'));
        if (error instanceof Error && error.message === 'App-server rejected request') throw error;
        throw Error(`${error instanceof Error ? error.message : 'Turn failed'}. Message may have been accepted; do not resend until checked.`);
      }
    },
    close() { stop(Error('Demo session closed')); },
  };
}
