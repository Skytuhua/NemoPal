import { PetCommandSchema, ProjectSnapshotSchema, SafePetEventSchema, type CheckIn, type PetCommand, type PlaybooksClient, type ProjectSnapshot, type SafePetEvent } from '@living-playbooks/contracts';
import type { JournalStore } from './local-store';

export class QuestionPresentation {
  private snapshot?: ProjectSnapshot;
  private connected = false;
  private displayed?: CheckIn;
  private event?: SafePetEvent;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private store: JournalStore, private client: PlaybooksClient, private emit: (event: SafePetEvent) => void, private refreshProject: (projectId: string) => void, private now = Date.now, private openProject: (id: string) => void = () => {}) {}
  refresh(raw: ProjectSnapshot, connected: boolean): Promise<void> {
    const snapshot = ProjectSnapshotSchema.parse(raw);
    const run = this.tail.then(() => this.update(snapshot, connected)); this.tail = run.catch(() => {}); return run;
  }
  private async update(snapshot: ProjectSnapshot, connected: boolean): Promise<void> {
    this.snapshot = snapshot; this.connected = connected;
    const preference = this.store.preference();
    const eligible = snapshot.checkIns.find(question => ['available', 'presented'].includes(question.state) && Date.parse(question.dueAt) <= this.now() && Date.parse(question.expiresAt) > this.now() && snapshot.project.tasks.some(task => task.id === question.taskId && task.revision === question.subjectRevision && !['done', 'skipped'].includes(task.status)));
    let checkIn: CheckIn | null = null;
    const previous = this.displayed;
    this.displayed = undefined;
    if (connected && !preference.hidden && !preference.focus && eligible) {
      if (previous?.id === eligible.id && previous.presentationId === eligible.presentationId && previous.revision === eligible.revision) {
        checkIn = previous;
      } else {
        const receipt = await this.client.presentCheckIn(eligible.id, { operationId: eligible.presentationId, input: { presentationId: eligible.presentationId } });
        const canonical = receipt.result;
        if (canonical.id !== eligible.id || canonical.projectId !== snapshot.project.id || canonical.presentationId !== eligible.presentationId || !['available', 'presented'].includes(canonical.state)) throw Error('Question presentation changed; refresh required');
        if (await this.store.recordPresentation(canonical.id, canonical.presentationId)) checkIn = canonical;
      }
      this.displayed = checkIn ?? undefined;
    }
    const event = SafePetEventSchema.parse({ type: 'pet_state', projectId: snapshot.project.id, managerName: snapshot.project.manager.displayName, petPackId: snapshot.project.manager.petPackId,
      state: !connected ? 'offline' : preference.focus ? 'snoozed' : checkIn ? 'waiting_for_you' : snapshot.connection.sync === 'updating' ? 'reviewing' : 'idle',
      checkIn, demoTiming: snapshot.connection.demoTiming, preference });
    if (JSON.stringify(event) !== JSON.stringify(this.event)) { this.event = event; this.emit(event); }
  }
  current(): SafePetEvent | undefined { return this.event ? structuredClone(this.event) : undefined; }
  async command(raw: PetCommand): Promise<void> {
    const input = PetCommandSchema.parse(raw);
    if (input.type === 'setPreference') { await this.store.setPreference(input.preference); if (this.snapshot) await this.refresh(this.snapshot, this.connected); return; }
    if (input.type === 'openProject') { if (this.snapshot?.project.id !== input.projectId) throw Error('Pet project changed'); this.openProject(input.projectId); return; }
    const question = this.displayed;
    if (!this.connected || !question || question.id !== input.checkInId || question.revision !== input.command.expectedRevision || Date.parse(question.expiresAt) <= this.now()) throw Error('Only the displayed current question can be answered');
    const receipt = input.type === 'answer' ? await this.client.answerCheckIn(question.id, input.command) : await this.client.snoozeCheckIn(question.id, input.command);
    if (receipt.result.id !== question.id || receipt.result.projectId !== question.projectId) throw Error('Question response identity changed');
    this.displayed = undefined;
    if (this.snapshot) {
      this.snapshot.checkIns = this.snapshot.checkIns.map(q => q.id === question.id ? receipt.result : q);
      await this.refresh(this.snapshot, this.connected);
    }
    this.refreshProject(question.projectId);
  }
}
