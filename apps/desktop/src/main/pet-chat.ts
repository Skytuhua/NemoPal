import { createHash, randomUUID } from 'node:crypto';
import { AcceptedJobSchema, CheckInSchema, PetChatCommandSchema, PetChatStateSchema, ProjectSnapshotSchema, type AcceptedJob, type CheckIn, type PetChatCommand, type PetChatConversation, type PetChatState, type PetPreference, type PlaybooksClient, type ProjectSnapshot } from '@living-playbooks/contracts';

type ChatPort = {
  show(current: () => boolean): Promise<void>; hide(restoreFocus: boolean): void; resize(expanded: boolean): void;
  destroy(): void; emit(state: PetChatState): void; visible(open: boolean): void;
};
type Options = {
  client(): PlaybooksClient; project(): string | undefined; owner(): number; authorized(id: string): boolean;
  preference(): PetPreference; recordPresentation(id: string, presentationId: string): Promise<boolean>; port: ChatPort; now?: () => number;
};
export class PetChatController {
  private state: PetChatState = { type: 'pet_chat_state', version: 0, contextId: randomUUID(), visible: false, expanded: false, reducedMotion: false, conversation: null };
  private binding?: { project: string; owner: number; ownerId?: string };
  private snapshot?: ProjectSnapshot;
  private generation = 0;
  private readGeneration = 0;
  private pending = false;
  private stopped = false;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private contextKey: string;
  private rendered = false;
  private retiring = false;
  private retirement?: Promise<void>;
  private flushing?: { id: string; contextId: string; owner: number; promise: Promise<void>; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
  private now: () => number;
  launchId = randomUUID();
  constructor(private options: Options) { this.now = options.now ?? Date.now; this.contextKey = this.key(); }
  private key() { const project = this.options.project(); return `${this.options.owner()}:${project ?? ''}:${project ? this.options.authorized(project) : false}`; }
  current(): PetChatState { return structuredClone(this.state); }
  private publish() { this.state.version++; this.state.reducedMotion = this.options.preference().reducedMotion; this.options.port.emit(PetChatStateSchema.parse(this.current())); }
  private valid(generation: number) {
    return !this.stopped && generation === this.generation && this.state.visible && !this.options.preference().hidden && this.binding?.owner === this.options.owner() && this.binding?.project === this.options.project() && this.options.authorized(this.binding.project);
  }
  private question(snapshot: ProjectSnapshot): CheckIn | undefined {
    return snapshot.checkIns.find(q => ['available', 'presented'].includes(q.state) && Date.parse(q.dueAt) <= this.now() && Date.parse(q.expiresAt) > this.now() && snapshot.project.tasks.some(task => task.id === q.taskId && task.revision === q.subjectRevision && !['done', 'skipped'].includes(task.status)));
  }
  private project(snapshot: ProjectSnapshot, checkIn: CheckIn | null): PetChatConversation {
    const projectId = snapshot.project.id;
    return {
      draftScope: createHash('sha256').update(`pet-chat:${snapshot.project.ownerId}:${projectId}`).digest('hex'),
      projectId, projectRevision: snapshot.project.revision, eventSequence: snapshot.eventSequence, managerName: snapshot.project.manager.displayName,
      messages: snapshot.messages.map(({ observationIds: _sourceReferences, ...message }) => message), checkIn,
      connected: snapshot.connection.sync !== 'offline', inference: snapshot.connection.inference.available ? { available: true } : { available: false, reason: 'Replies unavailable.' }, demoTiming: snapshot.connection.demoTiming,
    };
  }
  async open(): Promise<void> {
    if (this.stopped || this.options.preference().hidden) throw Error('Conversation hidden');
    const activation = this.generation;
    if (this.retiring) await this.retire();
    if (activation !== this.generation || this.stopped || this.options.preference().hidden) throw Error('Conversation context changed');
    clearTimeout(this.closeTimer);
    if (this.state.visible && this.valid(this.generation)) { const generation = this.generation; await this.options.port.show(() => this.valid(generation)); if (this.valid(generation)) this.rendered = true; return; }
    const project = this.options.project();
    this.binding = project ? { project, owner: this.options.owner() } : undefined;
    const generation = ++this.generation;
    this.state = { ...this.state, contextId: randomUUID(), visible: true, expanded: false, loading: !!project && this.options.authorized(project) };
    this.options.port.resize(false);
    this.publish(); this.options.port.visible(true);
    // Focus belongs to this activation, never to a later service completion.
    await Promise.all([this.options.port.show(() => generation === this.generation && this.state.visible && !this.stopped && !this.options.preference().hidden).then(() => { if (generation === this.generation && this.state.visible) this.rendered = true; }), this.refresh()]);
  }
  async read(): Promise<PetChatState> { await this.refresh(); return this.current(); }
  async refresh(): Promise<void> {
    const generation = this.generation, readGeneration = ++this.readGeneration;
    if (!this.valid(generation)) return;
    const project = this.binding!.project;
    let snapshot: ProjectSnapshot | undefined;
    try {
      const client = this.options.client();
      snapshot = ProjectSnapshotSchema.parse(await client.getSnapshot(project));
      if (!this.valid(generation) || readGeneration !== this.readGeneration) return;
      if (snapshot.project.id !== project || (this.binding!.ownerId && snapshot.project.ownerId !== this.binding!.ownerId)) { this.contextChanged(true); return; }
      this.binding!.ownerId = snapshot.project.ownerId;
      const previous = this.state.conversation;
      if (previous && (snapshot.eventSequence < previous.eventSequence || snapshot.project.revision < previous.projectRevision)) return;
      let question = this.question(snapshot) ?? null;
      if (question) {
        const shown = previous?.checkIn;
        if (previous?.connected && shown?.id === question.id && shown.presentationId === question.presentationId && shown.revision >= question.revision) question = shown;
        else {
          const receipt = await client.presentCheckIn(question.id, { operationId: question.presentationId, input: { presentationId: question.presentationId } });
          if (!this.valid(generation) || readGeneration !== this.readGeneration) return;
          const canonical = CheckInSchema.parse(receipt.result);
          if (canonical.id !== question.id || canonical.projectId !== project || canonical.presentationId !== question.presentationId || canonical.subjectRevision !== question.subjectRevision || canonical.revision < question.revision || !['available', 'presented'].includes(canonical.state) || Date.parse(canonical.expiresAt) <= this.now()) throw Error('Question presentation changed');
          await this.options.recordPresentation(canonical.id, canonical.presentationId);
          if (!this.valid(generation) || readGeneration !== this.readGeneration) return;
          question = canonical;
        }
      }
      this.snapshot = snapshot;
      this.state.loading = false;
      this.state.conversation = this.project(snapshot, question);
      this.publish();
    } catch { if (this.valid(generation) && readGeneration === this.readGeneration) { if (snapshot) this.state.conversation = this.project(snapshot, this.question(snapshot) ?? null); this.offline(); } }
  }
  offline() {
    ++this.readGeneration;
    this.state.loading = false;
    if (this.state.conversation) this.state.conversation = { ...this.state.conversation, connected: false };
    this.publish();
  }
  contextChanged(force = false) {
    const key = this.key();
    if (!force && key === this.contextKey) return;
    this.contextKey = key;
    ++this.generation; ++this.readGeneration; clearTimeout(this.closeTimer); this.pending = false; this.launchId = randomUUID();
    this.binding = undefined; this.snapshot = undefined;
    this.options.port.hide(false); this.options.port.visible(false);
    if (this.retiring) return;
    if (!this.rendered) { this.resetContext(); return; }
    this.retiring = true;
    this.state.visible = false;
    // Keep only the old renderer alive, hidden and command-fenced, until its writes are durable.
    void this.retire().catch(() => {});
  }
  private resetContext() {
    this.rendered = false; this.retiring = false;
    this.state = { ...this.state, contextId: randomUUID(), visible: false, expanded: false, conversation: null, loading: false };
    delete this.state.flushRequestId;
    this.options.port.destroy();
  }
  private retire(): Promise<void> {
    if (this.retirement) return this.retirement;
    const task = this.requestFlush().then(() => { this.resetContext(); });
    this.retirement = task;
    void task.finally(() => { if (this.retirement === task) this.retirement = undefined; }).catch(() => {});
    return task;
  }
  close(restoreFocus = true) {
    if (this.retiring) return;
    ++this.generation; ++this.readGeneration; this.pending = false;
    this.state = { ...this.state, contextId: randomUUID(), visible: false };
    this.publish(); this.options.port.visible(false);
    clearTimeout(this.closeTimer);
    const generation = this.generation;
    const hide = () => { if (generation === this.generation) this.options.port.hide(restoreFocus && !this.options.preference().hidden); };
    if (this.options.preference().reducedMotion || !restoreFocus) hide(); else this.closeTimer = setTimeout(hide, 130);
  }
  stop() { this.stopped = true; ++this.generation; ++this.readGeneration; clearTimeout(this.closeTimer); this.resetContext(); this.options.port.visible(false); }
  flush(): Promise<void> { return this.retiring ? this.retire() : this.requestFlush(); }
  resumeAfterFlush() { if (!this.retiring && !this.flushing) { delete this.state.flushRequestId; this.publish(); } }
  private requestFlush(): Promise<void> {
    if (!this.rendered) return Promise.resolve();
    if (this.flushing) return this.flushing.promise;
    let resolve!: () => void, reject!: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    const id = randomUUID();
    const timer = setTimeout(() => { if (this.flushing?.id === id) { this.flushing = undefined; delete this.state.flushRequestId; this.publish(); reject(Error('Draft flush unavailable')); } }, 2000);
    this.flushing = { id, contextId: this.state.contextId, owner: this.options.owner(), promise, resolve, reject, timer };
    this.state.flushRequestId = id; this.publish();
    return promise;
  }
  async command(raw: PetChatCommand): Promise<AcceptedJob | undefined> {
    const input = PetChatCommandSchema.parse(raw), generation = this.generation;
    if (input.type === 'flushed') {
      const flush = this.flushing;
      if (!flush || input.flushId !== flush.id || input.contextId !== flush.contextId || this.state.contextId !== flush.contextId || (!this.retiring && flush.owner !== this.options.owner()) || this.stopped) throw Error('Draft flush context changed');
      clearTimeout(flush.timer); this.flushing = undefined;
      if (input.succeeded) flush.resolve(); else { delete this.state.flushRequestId; this.publish(); flush.reject(Error('Draft storage unavailable')); }
      return;
    }
    if (this.stopped || !this.state.visible || this.options.preference().hidden || input.contextId !== this.state.contextId) throw Error('Conversation context changed');
    if (input.type === 'close') { this.close(); return; }
    if (input.type === 'expand') { this.state.expanded = input.expanded; this.options.port.resize(input.expanded); this.publish(); return; }
    if (!this.valid(generation)) throw Error('Conversation authority changed');
    const conversation = this.state.conversation;
    if (!conversation?.connected || this.pending) throw Error('Conversation unavailable');
    const client = this.options.client();
    if (input.type === 'send') {
      if (!conversation.inference.available || input.command.expectedRevision !== conversation.projectRevision) throw Error('Conversation revision or inference unavailable');
    } else {
      const question = conversation.checkIn;
      if (!question || !this.snapshot || !this.question({ ...this.snapshot, checkIns: [question] }) || question.id !== input.checkInId || question.presentationId !== input.presentationId || question.revision !== input.command.expectedRevision) throw Error('Only the current presented question can be answered');
    }
    this.pending = true;
    try {
      if (input.type === 'send') {
        const job = AcceptedJobSchema.parse(await client.sendMessage(conversation.projectId, input.command));
        if (!this.valid(generation) || job.receipt.operationId !== input.command.operationId) throw Error('Conversation receipt changed');
        void this.refresh();
        return job;
      }
      const receipt = input.type === 'answer' ? await client.answerCheckIn(input.checkInId, input.command) : await client.snoozeCheckIn(input.checkInId, input.command);
      if (!this.valid(generation)) throw Error('Conversation changed');
      const question = CheckInSchema.parse(receipt.result);
      if (question.id !== input.checkInId || question.projectId !== conversation.projectId || question.presentationId !== input.presentationId || question.revision <= input.command.expectedRevision) throw Error('Question receipt changed');
      conversation.checkIn = question; this.publish();
      await this.refresh();
      return;
    } finally { if (generation === this.generation) this.pending = false; }
  }
}
