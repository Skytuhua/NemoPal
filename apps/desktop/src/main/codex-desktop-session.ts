import { createDemoSession } from './codex-demo';

export class CodexDesktopSession {
  private generation = 0;
  private session?: Awaited<ReturnType<typeof createDemoSession>>;
  private project?: string;
  private replies: string[] = [];
  private sending = false;
  private starting?: AbortController;
  constructor(private command: () => { executable: string; args: string[] }) {}

  async start(project: string, workspace: string) {
    this.close();
    const generation = this.generation;
    const starting = new AbortController(); this.starting = starting;
    let session: Awaited<ReturnType<typeof createDemoSession>>;
    try { session = await createDemoSession({ ...this.command(), workspace, signal: starting.signal, onReply: text => {
        if (this.generation !== generation) return;
        if (Buffer.byteLength(text) + this.replies.reduce((size, reply) => size + Buffer.byteLength(reply), 0) > 262144) throw Error('Demo reply limit exceeded');
        this.replies.push(text);
      } });
    } catch (error) { if (this.generation !== generation) throw Error('Demo activation cancelled'); throw error; }
    finally { if (this.starting === starting) this.starting = undefined; }
    if (this.generation !== generation) { session.close(); throw Error('Demo activation cancelled'); }
    this.session = session; this.project = project;
  }

  async send(project: string, text: string): Promise<{ status: 'completed' | 'failed' | 'interrupted' | 'unknown'; replies: string[] }> {
    if (!this.session || this.project !== project || this.sending) throw Error('Demo session unavailable');
    const session = this.session, generation = this.generation;
    this.sending = true; this.replies = [];
    try {
      const result = await session.send(text);
      if (this.generation !== generation) throw Error('Demo session closed');
      return { status: result.status, replies: this.replies };
    } catch {
      const replies = this.generation === generation ? this.replies : [];
      if (this.generation === generation) this.close();
      return { status: 'unknown', replies };
    } finally { if (this.generation === generation) this.sending = false; }
  }

  close() { this.generation++; this.starting?.abort(); this.starting = undefined; this.session?.close(); this.session = undefined; this.project = undefined; this.replies = []; this.sending = false; }
}
