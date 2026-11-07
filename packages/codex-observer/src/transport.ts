import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AppServerObserver, ReadOnlyRpc } from './adapter';
import { VERSION } from './cursor';

export function resolveCodexExecutable(): string {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const target = process.platform === 'win32' ? `${arch}-pc-windows-msvc` : process.platform === 'darwin' ? `${arch}-apple-darwin` : `${arch}-unknown-linux-musl`;
  const platform = `${process.platform}-${process.arch}`;
  const roots = [process.env.CODEX_MANAGED_PACKAGE_ROOT, process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex') : undefined].filter((s): s is string => Boolean(s));
  for (const root of roots) for (const path of [join(root, 'node_modules', '@openai', `codex-${platform}`, 'vendor', target, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'), join(root, 'vendor', target, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex')]) if (existsSync(path)) return path;
  throw Error('Pinned installed Codex executable unavailable');
}
export class StdioReadTransport {
  private process?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  private id = 0;
  private fail(): void { for (const waiter of this.pending.values()) waiter.reject(Error('App Server read transport stopped')); this.pending.clear(); this.process?.kill(); this.process = undefined; }
  constructor(private executable: string) {}
  private async initialize(): Promise<void> {
    this.process = spawn(this.executable, ['app-server', '--listen', 'stdio://', '-c', 'analytics.enabled=false'], { stdio: 'pipe', windowsHide: true });
    let partial = '';
    this.process.stdout.setEncoding('utf8');
    this.process.stdout.on('data', (chunk: string) => {
      partial += chunk;
      if (Buffer.byteLength(partial) > 4 * 1024 * 1024) { this.fail(); return; }
      let newline: number;
      while ((newline = partial.indexOf('\n')) >= 0) {
        const line = partial.slice(0, newline); partial = partial.slice(newline + 1);
        try {
          const response = JSON.parse(line) as Record<string, unknown>;
          if (response.method && response.id !== undefined) { this.fail(); return; } // Never answer approval/tool requests.
          const waiter = typeof response.id === 'number' ? this.pending.get(response.id) : undefined;
          if (waiter) { this.pending.delete(response.id as number); if (response.error || !('result' in response)) waiter.reject(Error('App Server read unavailable')); else waiter.resolve(response.result); }
        } catch { this.fail(); return; }
      }
    });
    this.process.stderr.on('data', () => {}); // No profile paths, credentials or source data in diagnostics.
    this.process.on('error', () => this.fail()); this.process.on('exit', () => this.fail());
    await new ReadOnlyRpc({ request: (method, params) => this.send(method, params) }).request('initialize', { clientInfo: { name: 'living_playbooks_observer', version: VERSION }, capabilities: { experimentalApi: false, explicitGatewayOauth: true } });
    this.process?.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  }
  private send(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted || !this.process) { reject(Error('App Server read aborted')); return; }
      const id = ++this.id;
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      const abort = () => { this.pending.delete(id); finish(); this.fail(); reject(Error('App Server read aborted')); };
      const timer = setTimeout(abort, 15000);
      this.pending.set(id, { resolve: value => { finish(); resolve(value); }, reject: error => { finish(); reject(error); } });
      signal?.addEventListener('abort', abort, { once: true });
      this.process.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
    // Validate BEFORE starting a process, even when used without the observer facade.
    return new ReadOnlyRpc({ request: async (safeMethod, safeParams) => { await (this.ready ??= this.initialize()); return this.send(safeMethod, safeParams, signal); } }).request(method, params, signal);
  }
  async close(): Promise<void> { this.fail(); this.ready = undefined; }
}
export function createInstalledObserver(executable = resolveCodexExecutable()): AppServerObserver {
  const transport = new StdioReadTransport(executable);
  let checked: Promise<string> | undefined;
  return new AppServerObserver({ version: () => checked ??= promisify(execFile)(executable, ['--version'], { timeout: 5000, windowsHide: true, maxBuffer: 4096 }).then(({ stdout }) => stdout.trim().replace(/^codex-cli /, '')), request: (method, params, signal) => transport.request(method, params, signal), close: () => transport.close(), mode: 'observed' });
}

