import * as c from '@living-playbooks/contracts';
import { goldenSnapshot } from '../../../fixtures/contracts/golden';
import { parseContract } from './client';
import { ClientError, CursorExpiredError, FixtureUnavailableError } from './errors';

export interface FixtureClientOptions { snapshots?: readonly unknown[] }

/** Explicit synthetic client; never selected by the HTTP transport. */
export function createFixtureClient(options: FixtureClientOptions = {}): c.PlaybooksClient {
  const snapshots = new Map<string, c.ProjectSnapshot>();
  const questionIds = new Set<string>();
  for (const seed of options.snapshots ?? [goldenSnapshot]) {
    const snapshot = parseContract(c.ProjectSnapshotSchema, seed);
    if (snapshot.connection.mode !== 'fixture' || snapshot.connection.inference.available || snapshot.observations.some(item => item.provenance.mode !== 'fixture') || snapshots.has(snapshot.project.id)) {
      throw new ClientError('configuration', 'Fixture snapshots must have unique projects, fixture provenance, and unavailable inference.');
    }
    for (const checkIn of snapshot.checkIns) {
      if (questionIds.has(checkIn.id)) throw new ClientError('configuration', 'Fixture questions must have unique identities across projects.');
      questionIds.add(checkIn.id);
    }
    snapshots.set(snapshot.project.id, snapshot);
  }
  const get = (projectId: string) => {
    parseContract(c.IdSchema, projectId);
    const snapshot = snapshots.get(projectId);
    if (!snapshot) throw new ClientError('not_found', 'The requested fixture record is unavailable.');
    return snapshot;
  };
  const unavailable = async (): Promise<never> => { throw new FixtureUnavailableError(); };
  const operations = new Map<string, { hash: string; result: unknown; projectId?: string }>();
  const jobs = new Map<string, { projectId: string; revision: number }>();
  let sequence = Math.max(0, ...[...snapshots.values()].map(item => item.eventSequence));
  const events: c.ProjectEvent[] = [];
  const listeners = new Set<(event: c.ProjectEvent) => void>();
  let tail = Promise.resolve();
  function run<I, R>(target: string, raw: unknown, schema: { parse(value: unknown): c.CommandEnvelope<I> }, perform: (command: c.CommandEnvelope<I>, hash: string) => R): Promise<R> {
    const task = tail.then(async () => {
      const command = parseContract(schema, raw);
      const hash = await c.hashCommand(target, command);
      const previous = operations.get(command.operationId);
      if (previous) {
        if (previous.hash !== hash) throw new ClientError('idempotency_conflict', 'This operation ID was already used for a different fixture command.');
        if (previous.result === undefined) throw new ClientError('not_found', 'The requested fixture record is unavailable.');
        return structuredClone(previous.result) as R;
      }
      const result = perform(command, hash);
      let projectId = target.startsWith('/v1/projects/') ? target.split('/')[3] : undefined;
      if (result && typeof result === 'object') {
        if ('jobId' in result && typeof result.jobId === 'string') projectId = jobs.get(result.jobId)?.projectId;
        if ('result' in result && result.result && typeof result.result === 'object' && 'projectId' in result.result && typeof result.result.projectId === 'string') projectId = result.result.projectId;
      }
      operations.set(command.operationId, { hash, result: structuredClone(result), projectId });
      return structuredClone(result);
    });
    tail = task.then(() => {}, () => {});
    return task;
  }
  function expectRevision(actual: number, expected: number | undefined) {
    if (actual !== expected) throw new ClientError('revision_conflict', 'The fixture record changed. Refresh before retrying.');
  }
  function commit(snapshot: c.ProjectSnapshot, kind: c.ProjectEvent['kind'] = 'project_updated', resourceId = snapshot.project.id, revision = snapshot.project.revision): void {
    snapshot.eventSequence = sequence + 1;
    snapshot.project.updatedAt = new Date().toISOString();
    const valid = parseContract(c.ProjectSnapshotSchema, snapshot);
    sequence = valid.eventSequence;
    if (kind === 'project_deleted') snapshots.delete(valid.project.id);
    else snapshots.set(valid.project.id, valid);
    const event = parseContract(c.ProjectEventSchema, { seq: sequence, projectId: snapshot.project.id, kind, resourceId, revision });
    events.push(event);
    if (events.length > 1000) events.shift();
    for (const listener of listeners) listener(event);
  }
  function receipt<T>(command: c.CommandEnvelope<unknown>, hash: string, snapshot: c.ProjectSnapshot, result: T): c.CommandReceipt<T> {
    return { operationId: command.operationId, requestHash: hash, status: 'completed', result, projectRevision: snapshot.project.revision, eventSequence: snapshot.eventSequence };
  }
  function question<I>(checkInId: string, raw: unknown, schema: { parse(value: unknown): c.CommandEnvelope<I> }, action: string, change: (checkIn: c.CheckIn, snapshot: c.ProjectSnapshot, command: c.CommandEnvelope<I>) => void, projectChange = true) {
    return run(`/v1/checkins/${checkInId}/${action}`, raw, schema, (command, hash) => {
      parseContract(c.IdSchema, checkInId);
      const source = [...snapshots.values()].find(item => item.checkIns.some(checkIn => checkIn.id === checkInId));
      if (!source) throw new ClientError('not_found', 'The requested fixture record is unavailable.');
      const snapshot = structuredClone(source);
      const checkIn = snapshot.checkIns.find(item => item.id === checkInId)!;
      if (action !== 'presented' || command.expectedRevision !== undefined) expectRevision(checkIn.revision, command.expectedRevision);
      const task = snapshot.project.tasks.find(item => item.id === checkIn.taskId)!;
      expectRevision(task.revision, checkIn.subjectRevision);
      if (['answered', 'cancelled', 'expired'].includes(checkIn.state)) throw new ClientError('state_conflict', 'This fixture question is no longer actionable.');
      change(checkIn, snapshot, command);
      checkIn.revision++;
      if (projectChange) snapshot.project.revision++;
      commit(snapshot, 'checkin_updated', checkIn.id, checkIn.revision);
      return parseContract(c.commandReceiptSchema(c.CheckInSchema), receipt(command, hash, snapshot, checkIn));
    });
  }
  return {
    async listProjects(signal) {
      if (signal?.aborted) throw new DOMException('Request aborted.', 'AbortError');
      return [...snapshots.values()].map(({ project, checkIns }) => parseContract(c.ProjectSummarySchema, {
        id: project.id, title: project.title, goal: project.goal, revision: project.revision, status: project.status,
        phase: project.phase, planState: project.planState, managerName: project.manager.displayName, petPackId: project.manager.petPackId,
        unreadCheckIns: checkIns.filter(item => item.state === 'available' || item.state === 'presented').length, updatedAt: project.updatedAt,
      }));
    },
    async getSnapshot(projectId, signal) {
      if (signal?.aborted) throw new DOMException('Request aborted.', 'AbortError');
      return structuredClone(get(projectId));
    },
    createProject: raw => run('/v1/projects', raw, c.commandEnvelopeSchema(c.CreateProjectInputSchema), (command, hash) => {
      const projectId = crypto.randomUUID();
      const jobId = crypto.randomUUID();
      const snapshot = parseContract(c.ProjectSnapshotSchema, {
        project: {
          id: projectId, ownerId: crypto.randomUUID(), title: command.input.title, goal: command.input.brief, revision: 0, epoch: 0,
          planState: 'proposed', phase: 'planning', status: 'active',
          manager: { id: crypto.randomUUID(), projectId, displayName: 'Nemo (fixture)', petPackId: 'original-nemo-v1', promptVersion: '1' },
          tasks: [], decisions: [], workspace: { schemaVersion: 1, id: crypto.randomUUID(), revision: 0, panels: [] }, updatedAt: new Date().toISOString(),
        },
        brief: command.input.brief, documents: [], messages: [], sourceBindings: [], observations: [], checkIns: [], eventSequence: 0,
        connection: { mode: 'fixture', inference: { available: false, reason: 'Fixture mode: no Nemotron call' }, sync: 'current', demoTiming: false },
      });
      commit(snapshot);
      jobs.set(jobId, { projectId, revision: 0 });
      return parseContract(c.AcceptedJobSchema, { receipt: { ...receipt(command, hash, snapshot, null), status: 'accepted' }, jobId, state: 'queued' });
    }),
    sendMessage: (projectId, raw) => run(`/v1/projects/${projectId}/messages`, raw, c.revisionedCommandSchema(c.MessageInputSchema), (command, hash) => {
      const snapshot = structuredClone(get(projectId));
      expectRevision(snapshot.project.revision, command.expectedRevision);
      const jobId = crypto.randomUUID();
      const messageId = crypto.randomUUID();
      snapshot.messages.push({ id: messageId, projectId, role: 'owner', text: command.input.text, createdAt: new Date().toISOString(), observationIds: [], operationId: command.operationId, jobId });
      snapshot.project.revision++;
      commit(snapshot, 'message_added', messageId);
      jobs.set(jobId, { projectId, revision: 0 });
      return parseContract(c.AcceptedJobSchema, { receipt: { ...receipt(command, hash, snapshot, null), status: 'accepted' }, jobId, state: 'queued' });
    }),
    applyAction: (projectId, raw) => run(`/v1/projects/${projectId}/actions`, raw, c.revisionedCommandSchema(c.OwnerActionSchema), (command, hash) => {
      const snapshot = structuredClone(get(projectId));
      expectRevision(snapshot.project.revision, command.expectedRevision);
      const action = command.input;
      switch (action.type) {
        case 'accept_plan': snapshot.project.planState = 'accepted'; break;
        case 'set_project_status': snapshot.project.status = action.status; break;
        case 'set_project_phase': snapshot.project.phase = action.phase; break;
        case 'record_decision':
          snapshot.project.decisions.push({ id: crypto.randomUUID(), text: action.text, origin: 'owner', createdAt: new Date().toISOString(), observationIds: [] });
          break;
        case 'update_task_details': {
          const task = snapshot.project.tasks.find(item => item.id === action.taskId);
          if (!task) throw new ClientError('not_found', 'The requested fixture record is unavailable.');
          expectRevision(task.revision, action.expectedTaskRevision);
          if (action.description !== undefined) task.description = action.description;
          if (action.dueAt === null) delete task.dueAt;
          else if (action.dueAt !== undefined) task.dueAt = action.dueAt;
          if (action.checklist !== undefined) task.checklist = action.checklist;
          task.revision++;
          break;
        }
        case 'update_task': {
          const task = snapshot.project.tasks.find(item => item.id === action.taskId);
          if (!task) throw new ClientError('not_found', 'The requested fixture record is unavailable.');
          task.status = action.status;
          if (action.title !== undefined) task.title = action.title;
          task.revision++;
          task.ownerOverride = true;
          task.evidenceLevel = 'user_reported';
          snapshot.project.decisions.push({ id: crypto.randomUUID(), text: `Owner updated task: ${task.title} (${task.status}).`, origin: 'owner', createdAt: new Date().toISOString(), observationIds: [] });
          break;
        }
      }
      snapshot.project.revision++;
      commit(snapshot);
      return parseContract(c.commandReceiptSchema(c.ProjectSchema), receipt(command, hash, snapshot, snapshot.project));
    }),
    saveDocument: (projectId, documentId, raw) => run(`/v1/projects/${projectId}/documents/${documentId}`, raw, c.revisionedCommandSchema(c.DocumentInputSchema), (command, hash) => {
      parseContract(c.IdSchema, documentId);
      const snapshot = structuredClone(get(projectId));
      const document = snapshot.documents.find(item => item.id === documentId);
      if (!document) throw new ClientError('not_found', 'The requested fixture record is unavailable.');
      expectRevision(document.revision, command.expectedRevision);
      document.text = command.input.text;
      document.revision++;
      snapshot.project.revision++;
      commit(snapshot, 'document_updated', document.id, document.revision);
      return parseContract(c.commandReceiptSchema(c.DocumentDraftSchema), receipt(command, hash, snapshot, document));
    }),
    answerCheckIn: (checkInId, raw) => question(checkInId, raw, c.revisionedCommandSchema(c.CheckInAnswerSchema), 'answer', (checkIn, snapshot, command) => {
      checkIn.state = 'answered';
      checkIn.answer = command.input;
      delete checkIn.snoozedUntil;
      if (command.input.kind === 'recorded') {
        const task = snapshot.project.tasks.find(item => item.id === checkIn.taskId)!;
        task.status = 'done';
        task.ownerOverride = true;
        task.evidenceLevel = 'user_reported';
        task.revision++;
      }
      snapshot.project.decisions.push({ id: crypto.randomUUID(), text: `Owner answered question: ${command.input.kind}.`, origin: 'owner', createdAt: new Date().toISOString(), observationIds: [] });
    }),
    snoozeCheckIn: (checkInId, raw) => question(checkInId, raw, c.revisionedCommandSchema(c.SnoozeInputSchema), 'snooze', (checkIn, _snapshot, command) => {
      checkIn.state = 'snoozed';
      checkIn.snoozedUntil = command.input.until;
      checkIn.presentationId = crypto.randomUUID();
    }),
    cancelCheckIn: (checkInId, raw) => question(checkInId, raw, c.revisionedCommandSchema(c.EmptyInputSchema), 'cancel', checkIn => {
      checkIn.state = 'cancelled';
      delete checkIn.snoozedUntil;
    }),
    presentCheckIn: (checkInId, raw) => question(checkInId, raw, c.commandEnvelopeSchema(c.PresentationInputSchema), 'presented', (checkIn, _snapshot, command) => {
      if (command.input.presentationId !== checkIn.presentationId) throw new ClientError('revision_conflict', 'The fixture presentation changed. Refresh before retrying.');
      checkIn.state = 'presented';
    }, false),
    enrollSource: unavailable,
    setSourceState: unavailable,
    revokeSource: unavailable,
    ingestObservations: unavailable,
    reportSourceHealth: unavailable,
    deleteProject: (projectId, raw) => run(`/v1/projects/${projectId}`, raw, c.revisionedCommandSchema(c.EmptyInputSchema), (command, hash) => {
      const snapshot = structuredClone(get(projectId));
      expectRevision(snapshot.project.revision, command.expectedRevision);
      snapshot.project.revision++;
      snapshot.project.epoch++;
      parseContract(c.ProjectSnapshotSchema, snapshot);
      parseContract(c.RevisionSchema, sequence + 1);
      for (const operation of operations.values()) if (operation.projectId === projectId) operation.result = undefined;
      for (const [jobId, job] of jobs) if (job.projectId === projectId) jobs.delete(jobId);
      commit(snapshot, 'project_deleted');
      return receipt(command, hash, snapshot, null);
    }),
    cancelJob: (jobId, raw) => run(`/v1/jobs/${jobId}/cancel`, raw, c.commandEnvelopeSchema(c.EmptyInputSchema), (command, hash) => {
      parseContract(c.IdSchema, jobId);
      const job = jobs.get(jobId);
      if (!job) throw new ClientError('not_found', 'The requested fixture record is unavailable.');
      if (command.expectedRevision !== undefined) expectRevision(job.revision, command.expectedRevision);
      const snapshot = structuredClone(get(job.projectId));
      snapshot.project.revision++;
      commit(snapshot, 'job_updated', jobId);
      jobs.delete(jobId);
      return receipt(command, hash, snapshot, null);
    }),
    async subscribe(after, onEvent, signal) {
      parseContract(c.RevisionSchema, after);
      if (signal.aborted) throw new DOMException('Request aborted.', 'AbortError');
      const floor = events[0] ? events[0].seq - 1 : sequence;
      if (after < floor || after > sequence) throw new CursorExpiredError();
      return new Promise<void>((_resolve, reject) => {
        const cleanup = () => { listeners.delete(deliver); signal.removeEventListener('abort', stop); };
        const stop = () => { cleanup(); reject(new DOMException('Request aborted.', 'AbortError')); };
        const deliver = (event: c.ProjectEvent) => {
          if (signal.aborted) return;
          try { onEvent(structuredClone(event)); }
          catch { cleanup(); reject(new ClientError('listener', 'The fixture event listener failed.')); }
        };
        listeners.add(deliver);
        signal.addEventListener('abort', stop, { once: true });
        for (const event of events) if (event.seq > after) deliver(event);
      });
    },
  };
}
