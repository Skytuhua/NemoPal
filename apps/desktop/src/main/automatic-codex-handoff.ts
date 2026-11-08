type Request = { id: string; taskId: string; text: string };
type Result = { status: 'completed' | 'failed' | 'interrupted' | 'unknown'; replies: string[] };

export class AutomaticCodexHandoff {
  private running = false;
  constructor(private port: { ready(project: string): string | null; claim(project: string): Promise<Request | null>; send(project: string, text: string): Promise<Result>; finish(project: string, id: string, result: Result): Promise<void> }) {}
  async run(project: string) {
    const session = this.port.ready(project);
    if (this.running || !session) return;
    this.running = true;
    try {
      const request = await this.port.claim(project);
      if (!request) return;
      let result: Result = { status: 'unknown', replies: [] };
      if (this.port.ready(project) === session) {
        try { result = await this.port.send(project, `Manager request for task ${request.taskId}:\n${request.text}`); } catch { /* The send outcome is unknown. */ }
      }
      await this.port.finish(project, request.id, result);
    } finally { this.running = false; }
  }
}
