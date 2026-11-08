import { z } from 'zod';
import { boundedText, IdSchema as id, LIMITS, RevisionSchema as revision, TimestampSchema as timestamp } from './limits';

export const PlanStateSchema = z.enum(['proposed', 'accepted']);
export const ProjectStatusSchema = z.enum(['active', 'paused', 'archived']);
export const ProjectPhaseSchema = z.enum(['planning', 'building', 'demo', 'review']);
export const TaskStatusSchema = z.enum(['todo', 'in_progress', 'blocked', 'done', 'skipped']);
export const EvidenceLevelSchema = z.enum(['none', 'agent_reported', 'user_reported', 'source_tool_observed']);
export const RequirementOriginSchema = z.enum(['brief', 'owner', 'model_suggestion']);
export const ExportPolicySchema = z.enum(['off', 'metadata_only', 'approved_excerpts']);
export const SourceCapabilitySchema = z.enum(['unavailable', 'history_only', 'incremental_history']);
export const SourceStateSchema = z.enum(['unlinked', 'awaiting_consent', 'following', 'paused', 'stale', 'blocked', 'revoked']);
export const ObservationKindSchema = z.enum(['user_visible_message', 'assistant_report', 'tool_result_metadata', 'activity']);
export const CheckInStateSchema = z.enum(['scheduled', 'available', 'presented', 'snoozed', 'answered', 'cancelled', 'expired']);
export const PetStateSchema = z.enum(['idle', 'reviewing', 'waiting_for_you', 'milestone', 'snoozed', 'offline']);
export const PanelTypeSchema = z.enum(['checklist', 'milestone_timeline', 'evidence_card', 'question_card', 'document_editor', 'next_action']);
export const CapabilitySchema = z.discriminatedUnion('available', [z.strictObject({ available: z.literal(true) }), z.strictObject({ available: z.literal(false), reason: boundedText(512, true) })]);

export const ManagerIdentitySchema = z.strictObject({ id, projectId: id, displayName: boundedText(120, true), petPackId: boundedText(80, true), promptVersion: boundedText(40, true) });
export const TaskChecklistItemSchema = z.strictObject({ id, text: boundedText(512, true), completed: z.boolean() });
export const TaskSchema = z.strictObject({ id, title: boundedText(512, true), description: boundedText(4096).optional(), status: TaskStatusSchema, revision, requirementOrigin: RequirementOriginSchema, evidenceLevel: EvidenceLevelSchema, evidenceIds: z.array(id).max(100), dueAt: timestamp.optional(), checklist: z.array(TaskChecklistItemSchema).max(40).refine(items => new Set(items.map(item => item.id)).size === items.length, 'Duplicate checklist item identity').optional(), ownerOverride: z.boolean() });
export const DecisionSchema = z.strictObject({ id, text: boundedText(2048, true), origin: z.enum(['owner', 'manager']), createdAt: timestamp, observationIds: z.array(id).max(100) });
const panelBase = { id, heading: boundedText(160, true) };
export const WorkspacePanelSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...panelBase, type: z.literal('checklist'), taskIds: z.array(id).max(LIMITS.tasks) }),
  z.strictObject({ ...panelBase, type: z.literal('milestone_timeline'), taskIds: z.array(id).max(LIMITS.tasks) }),
  z.strictObject({ ...panelBase, type: z.literal('evidence_card'), observationIds: z.array(id).max(100) }),
  z.strictObject({ ...panelBase, type: z.literal('question_card'), checkInId: id }),
  z.strictObject({ ...panelBase, type: z.literal('document_editor'), documentId: id }),
  z.strictObject({ ...panelBase, type: z.literal('next_action'), taskId: id }),
]);
export const WorkspaceSpecSchema = z.strictObject({ schemaVersion: z.literal(1), id, revision, panels: z.array(WorkspacePanelSchema).max(LIMITS.panels) })
  .refine(value => new Set(value.panels.map(panel => panel.id)).size === value.panels.length, 'Duplicate panel identity');
export const ProjectSchema = z.strictObject({ id, ownerId: id, title: boundedText(160, true), goal: boundedText(LIMITS.briefBytes, true), revision, epoch: revision, planState: PlanStateSchema, phase: ProjectPhaseSchema, status: ProjectStatusSchema, manager: ManagerIdentitySchema, tasks: z.array(TaskSchema).max(LIMITS.tasks), decisions: z.array(DecisionSchema).max(100), workspace: WorkspaceSpecSchema, updatedAt: timestamp })
  .superRefine((value, ctx) => {
    if (value.manager.projectId !== value.id) ctx.addIssue({ code: 'custom', message: 'Manager belongs to another project' });
    if (new Set(value.tasks.map(task => task.id)).size !== value.tasks.length) ctx.addIssue({ code: 'custom', message: 'Duplicate task identity' });
    const tasks = new Set(value.tasks.map(task => task.id));
    for (const panel of value.workspace.panels) {
      const refs = 'taskIds' in panel ? panel.taskIds : 'taskId' in panel ? [panel.taskId] : [];
      if (refs.some(ref => !tasks.has(ref))) ctx.addIssue({ code: 'custom', message: 'Workspace references an unknown task' });
    }
  });
export const SourceBindingSchema = z.strictObject({ id, projectId: id, deviceId: id, sourceKey: boundedText(128, true), adapterId: boundedText(80, true), adapterVersion: boundedText(40, true), capability: SourceCapabilitySchema, grantRevision: revision, exportPolicy: ExportPolicySchema, state: SourceStateSchema, lastObservedAt: timestamp.nullable() });
export const ObservationMetadataSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('message'), role: z.enum(['user', 'assistant']) }),
  z.strictObject({ type: z.literal('tool'), exitCode: z.number().int().min(-2147483648).max(2147483647).nullable() }),
  z.strictObject({ type: z.literal('activity'), state: z.enum(['active', 'idle', 'unknown']) }),
]);
export const ProvenanceSchema = z.strictObject({ adapterId: boundedText(80, true), adapterVersion: boundedText(40, true), mode: z.enum(['observed', 'imported_history', 'fixture']), evidenceLevel: EvidenceLevelSchema });
export const ObservationSchema = z.strictObject({ id, bindingId: id, grantRevision: revision, sourceItemId: boundedText(256, true), sourceRevision: boundedText(128, true), kind: ObservationKindSchema, occurredAt: timestamp, observedAt: timestamp, excerpt: boundedText(LIMITS.excerptBytes).optional(), metadata: ObservationMetadataSchema, provenance: ProvenanceSchema })
  .superRefine((value, ctx) => {
    const reject = () => ctx.addIssue({ code: 'custom', message: 'Observation content, metadata, and provenance disagree' });
    if (value.kind === 'assistant_report' && (value.metadata.type !== 'message' || value.metadata.role !== 'assistant' || value.provenance.evidenceLevel !== 'agent_reported')) reject();
    if (value.kind === 'user_visible_message' && (value.metadata.type !== 'message' || value.metadata.role !== 'user' || value.provenance.evidenceLevel !== 'user_reported')) reject();
    if (value.kind === 'tool_result_metadata' && (value.metadata.type !== 'tool' || value.excerpt !== undefined || value.provenance.evidenceLevel !== 'source_tool_observed')) reject();
    if (value.kind === 'activity' && (value.metadata.type !== 'activity' || value.excerpt !== undefined || value.provenance.evidenceLevel !== 'none')) reject();
  });
export const DocumentDraftSchema = z.strictObject({ projectId: id, id, revision, text: boundedText(LIMITS.briefBytes), updatedBy: z.literal('owner') });
export const CheckInAnswerSchema = z.strictObject({ kind: z.enum(['recorded', 'not_yet']), note: boundedText(2048).optional() });
export const CheckInSchema = z.strictObject({ id, projectId: id, taskId: id, revision, subjectRevision: revision, question: boundedText(512, true), dueAt: timestamp, expiresAt: timestamp, state: CheckInStateSchema, presentationId: id, snoozedUntil: timestamp.optional(), answer: CheckInAnswerSchema.nullable() });
export const ChatMessageSchema = z.strictObject({ id, projectId: id, role: z.enum(['owner', 'manager']), text: boundedText(16384, true), createdAt: timestamp, observationIds: z.array(id).max(100), operationId: id.optional(), jobId: id.optional() });
export const CodexRequestSchema = z.strictObject({ id, projectId: id, taskId: id, text: boundedText(8192, true), state: z.enum(['pending', 'claimed', 'completed', 'failed', 'interrupted', 'unknown']), output: boundedText(8192) });
export const CodexResultSchema = z.strictObject({ status: z.enum(['completed', 'failed', 'interrupted', 'unknown']), output: boundedText(8192) });
export type CodexResult = z.infer<typeof CodexResultSchema>;
export const ConnectionSchema = z.strictObject({ mode: z.enum(['live', 'fixture']), inference: CapabilitySchema, sync: z.enum(['current', 'offline', 'stale', 'updating']), demoTiming: z.boolean() });
export const ProjectSnapshotSchema = z.strictObject({ project: ProjectSchema, brief: boundedText(LIMITS.briefBytes), documents: z.array(DocumentDraftSchema).max(40), messages: z.array(ChatMessageSchema).max(200), sourceBindings: z.array(SourceBindingSchema).max(10), observations: z.array(ObservationSchema).max(100), checkIns: z.array(CheckInSchema).max(40), codexRequests: z.array(CodexRequestSchema).max(100).optional(), eventSequence: revision, connection: ConnectionSchema })
  .superRefine((value, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    for (const records of [value.documents, value.messages, value.sourceBindings, value.checkIns]) {
      if (records.some(record => record.projectId !== value.project.id)) fail('Foreign project record');
      if (new Set(records.map(record => record.id)).size !== records.length) fail('Duplicate record identity');
    }
    if (value.codexRequests?.some(request => request.projectId !== value.project.id)) fail('Foreign Codex request');
    const bindings = new Map(value.sourceBindings.map(binding => [binding.id, binding]));
    const evidence = new Set(value.observations.map(observation => observation.id));
    const tasks = new Set(value.project.tasks.map(task => task.id));
    for (const observation of value.observations) {
      const binding = bindings.get(observation.bindingId);
      if (!binding || binding.grantRevision !== observation.grantRevision || binding.exportPolicy === 'off' || binding.state === 'revoked') fail('Observation lacks current source grant');
      if (observation.excerpt !== undefined && binding?.exportPolicy !== 'approved_excerpts') fail('Excerpt requires approved-excerpts grant');
    }
    for (const task of value.project.tasks) if (task.evidenceIds.some(ref => !evidence.has(ref))) fail('Task references unavailable evidence');
    for (const record of [...value.messages, ...value.project.decisions]) if (record.observationIds.some(ref => !evidence.has(ref))) fail('Text references unavailable evidence');
    for (const checkIn of value.checkIns) if (!tasks.has(checkIn.taskId)) fail('Question references another project task');
    for (const panel of value.project.workspace.panels) {
      if ('observationIds' in panel && panel.observationIds.some(ref => !evidence.has(ref))) fail('Unknown panel evidence');
      if ('documentId' in panel && !value.documents.some(document => document.id === panel.documentId)) fail('Unknown panel document');
      if ('checkInId' in panel && !value.checkIns.some(checkIn => checkIn.id === panel.checkInId)) fail('Unknown panel question');
    }
  });

export type PlanState = z.infer<typeof PlanStateSchema>;
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;
export type ProjectPhase = z.infer<typeof ProjectPhaseSchema>;
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type EvidenceLevel = z.infer<typeof EvidenceLevelSchema>;
export type RequirementOrigin = z.infer<typeof RequirementOriginSchema>;
export type ExportPolicy = z.infer<typeof ExportPolicySchema>;
export type SourceCapability = z.infer<typeof SourceCapabilitySchema>;
export type SourceState = z.infer<typeof SourceStateSchema>;
export type ObservationKind = z.infer<typeof ObservationKindSchema>;
export type CheckInState = z.infer<typeof CheckInStateSchema>;
export type PetState = z.infer<typeof PetStateSchema>;
export type PanelType = z.infer<typeof PanelTypeSchema>;
export type ManagerIdentity = z.infer<typeof ManagerIdentitySchema>;
export type TaskChecklistItem = z.infer<typeof TaskChecklistItemSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type WorkspacePanel = z.infer<typeof WorkspacePanelSchema>;
export type WorkspaceSpec = z.infer<typeof WorkspaceSpecSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type SourceBinding = z.infer<typeof SourceBindingSchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type DocumentDraft = z.infer<typeof DocumentDraftSchema>;
export type CheckInAnswer = z.infer<typeof CheckInAnswerSchema>;
export type CheckIn = z.infer<typeof CheckInSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;
