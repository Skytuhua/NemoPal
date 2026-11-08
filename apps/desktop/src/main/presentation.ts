import { PetCommandSchema, ProjectSnapshotSchema, SafePetEventSchema, type CheckIn, type PetCommand, type PlaybooksClient, type ProjectSnapshot, type SafePetEvent } from '@living-playbooks/contracts';
import type { JournalStore } from './local-store';

export class QuestionPresentation {
  private snapshot?: ProjectSnapshot;
  private connected = false;
  private displayed?: CheckIn;
  private event?: SafePetEvent;
  private tail: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private ownerGeneration = 0;
  private selectedProject: string | null | undefined;
  constructor(private store: JournalStore, private client: PlaybooksClient, private emit: (event: SafePetEvent) => void, private refreshProject: (projectId: string) => void, private now = Date.now, private openProject: (id: string) => void = () => {}) {}
  refresh(raw: ProjectSnapshot, connected: boolean): Promise<void> {
    const snapshot = ProjectSnapshotSchema.parse(raw);
    if (this.selectedProject !== undefined && snapshot.project.id !== this.selectedProject) return Promise.resolve();
    const generation = ++this.generation;
    const run = this.tail.then(() => this.update(snapshot, connected, generation)); this.tail = run.catch(() => {}); return run;
  }
  private async update(snapshot: ProjectSnapshot, connected: boolean, generation: number): Promise<void> {
    if (generation !== this.generation) return;
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
        if (generation !== this.generation || !this.connected) return;
        const canonical = receipt.result;
        if (canonical.id !== eligible.id || canonical.projectId !== snapshot.project.id || canonical.presentationId !== eligible.presentationId || !['available', 'presented'].includes(canonical.state)) throw Error('Question presentation changed; refresh required');
        await this.store.recordPresentation(canonical.id, canonical.presentationId);
        if (generation !== this.generation || !this.connected) return;
        checkIn = canonical;
      }
      this.displayed = checkIn ?? undefined;
    }
    const event = SafePetEventSchema.parse({ type: 'pet_state', projectId: snapshot.project.id, managerName: snapshot.project.manager.displayName, petPackId: snapshot.project.manager.petPackId,
      state: !connected ? 'offline' : preference.focus || snapshot.checkIns.some(q => q.state === 'snoozed' && q.snoozedUntil && Date.parse(q.snoozedUntil) > this.now()) ? 'snoozed' : checkIn ? 'waiting_for_you' : snapshot.connection.sync === 'updating' ? 'reviewing' : 'idle',
      checkIn, demoTiming: snapshot.connection.demoTiming, preference });
    if (JSON.stringify(event) !== JSON.stringify(this.event)) { this.event = event; this.emit(event); }
  }
  current(): SafePetEvent | undefined { return this.event ? structuredClone(this.event) : undefined; }
  reset(): void {
    ++this.generation; ++this.ownerGeneration; this.snapshot = undefined; this.connected = false; this.displayed = undefined; this.selectedProject = null;
    this.event = SafePetEventSchema.parse({ type: 'pet_state', projectId: null, managerName: '', petPackId: 'original-nemo-v1', state: 'offline', checkIn: null, demoTiming: false, preference: { ...this.store.preference(), pinnedProjectId: null } });
    this.emit(this.event);
  }
  selectProject(projectId?: string): void {
    ++this.generation;
    if (this.selectedProject === (projectId ?? null)) return;
    this.selectedProject = projectId ?? null;
    this.displayed = undefined;
    if (this.event && this.event.projectId !== this.selectedProject) {
      this.event = SafePetEventSchema.parse({ ...this.event, projectId: this.selectedProject, managerName: '', petPackId: 'original-nemo-v1', checkIn: null, state: this.connected ? 'reviewing' : 'offline', demoTiming: false, preference: this.store.preference() });
      this.emit(this.event);
    }
  }
  offline(): void {
    ++this.generation; this.connected = false; this.displayed = undefined;
    if (this.event) { this.event = SafePetEventSchema.parse({ ...this.event, state: 'offline', checkIn: null }); this.emit(this.event); }
  }
  async command(raw: PetCommand): Promise<void> {
    const owner = this.ownerGeneration;
    const input = PetCommandSchema.parse(raw);
    if (input.type === 'openChat') throw Error('Conversation activation belongs to native chat');
    if (input.type === 'setPreference') { await this.store.setPreference(input.preference); if (owner !== this.ownerGeneration) throw Error('Pet pairing changed'); if (this.snapshot) await this.refresh(this.snapshot, this.connected); return; }
    if (input.type === 'openProject') { if (this.snapshot?.project.id !== input.projectId || (this.selectedProject !== undefined && this.selectedProject !== input.projectId)) throw Error('Pet project changed'); this.openProject(input.projectId); return; }
    const question = this.displayed;
    if (!this.connected || !question || question.id !== input.checkInId || question.revision !== input.command.expectedRevision || Date.parse(question.expiresAt) <= this.now()) throw Error('Only the displayed current question can be answered');
    const receipt = input.type === 'answer' ? await this.client.answerCheckIn(question.id, input.command) : await this.client.snoozeCheckIn(question.id, input.command);
    if (owner !== this.ownerGeneration) throw Error('Pet pairing changed');
    if (receipt.result.id !== question.id || receipt.result.projectId !== question.projectId) throw Error('Question response identity changed');
    if (this.snapshot?.project.id === question.projectId && this.displayed?.id === question.id) {
      this.displayed = undefined;
      this.snapshot.checkIns = this.snapshot.checkIns.map(q => q.id === question.id ? receipt.result : q);
      await this.refresh(this.snapshot, this.connected);
    }
    if (owner === this.ownerGeneration) this.refreshProject(question.projectId);
  }
}
