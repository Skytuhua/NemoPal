import { z } from 'zod';
import { boundedText, IdSchema as id, RevisionSchema as revision, TimestampSchema as timestamp } from './limits';
import { TaskSchema, TaskStatusSchema, EvidenceLevelSchema, WorkspaceSpecSchema, ProjectSnapshotSchema } from './domain';

export const GrantVersionSchema = z.strictObject({ bindingId: id, grantRevision: revision });
export const ModelCreatedTaskSchema = TaskSchema.omit({ ownerOverride: true, revision: true, description: true, checklist: true }).extend({ requirementOrigin: z.enum(['brief', 'model_suggestion']) });
export const TaskChangeSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('create'), task: ModelCreatedTaskSchema }),
  z.strictObject({ type: z.literal('update'), taskId: id, expectedRevision: revision, status: TaskStatusSchema.optional(), title: boundedText(512, true).optional(), evidenceLevel: EvidenceLevelSchema, evidenceIds: z.array(id).max(100) }),
]);
export const ManagerProposalSchema = z.strictObject({ schemaVersion: z.literal(1), jobId: id, baseProjectRevision: revision, projectEpoch: revision, grantVersions: z.array(GrantVersionSchema).max(10), taskChanges: z.array(TaskChangeSchema).max(40), decisionSuggestions: z.array(z.strictObject({ text: boundedText(2048, true), observationIds: z.array(id).max(100) })).max(20), workspace: WorkspaceSpecSchema, questionSuggestion: z.strictObject({ taskId: id, subjectRevision: revision, question: boundedText(512, true), dueAt: timestamp }).optional(), codexTask: z.strictObject({ taskId: id, text: boundedText(8192, true) }).optional(), reply: z.strictObject({ text: boundedText(16384, true), observationIds: z.array(id).max(100) }) });
export const ProactivityInputSchema = z.strictObject({ enabled: z.boolean(), intervalMinutes: z.number().int().min(30).max(1440).default(30) });
export const ManagerJobSchema = z.strictObject({ id, projectId: id, kind: z.enum(['initial_plan', 'reflection', 'owner_message', 'scheduled_review']), baseProjectRevision: revision, projectEpoch: revision, grantVersions: z.array(GrantVersionSchema).max(10), state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'superseded']), leaseGeneration: revision, tries: z.number().int().min(0).max(2), runAfter: timestamp, leaseExpiresAt: timestamp.nullable(), inputMessageId: id.nullable(), modelCalls: z.number().int().min(0).max(4), toolCalls: z.number().int().min(0).max(6), errorClass: boundedText(80).nullable() });
export const ReadToolCallSchema = z.discriminatedUnion('name', [
  z.strictObject({ id: boundedText(128, true), name: z.literal('read_project_state'), arguments: z.strictObject({}) }),
  z.strictObject({ id: boundedText(128, true), name: z.literal('list_recent_evidence'), arguments: z.strictObject({}) }),
  z.strictObject({ id: boundedText(128, true), name: z.literal('read_evidence'), arguments: z.strictObject({ observationId: id }) }),
  z.strictObject({ id: boundedText(128, true), name: z.literal('read_project_document'), arguments: z.strictObject({ documentId: id }) }),
]);
export const ModelMessageSchema = z.strictObject({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: boundedText(65536), toolCallId: boundedText(128, true).optional(), toolCalls: z.array(ReadToolCallSchema).max(6).optional() });
export const ModelTurnInputSchema = z.strictObject({ projectId: id, messages: z.array(ModelMessageSchema).max(30), remainingModelCalls: z.number().int().min(1).max(4), remainingToolCalls: z.number().int().min(0).max(6) });
export const ModelTurnResultSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('tool_calls'), calls: z.array(ReadToolCallSchema).min(1).max(6), requestId: boundedText(256).optional() }),
  z.strictObject({ type: z.literal('proposal'), proposal: ManagerProposalSchema, requestId: boundedText(256).optional() }),
]);
export const ModelCapabilityReportSchema = z.strictObject({ available: z.boolean(), endpoint: boundedText(512, true), model: boundedText(256, true), toolCall: z.boolean(), toolContinuation: z.boolean(), structuredProposal: z.boolean(), reason: boundedText(1024, true) });
export const AuthorizedProjectContextSchema = z.strictObject({ snapshot: ProjectSnapshotSchema, grantVersions: z.array(GrantVersionSchema).max(10) });
export type GrantVersion = z.infer<typeof GrantVersionSchema>;
export type ManagerProposal = z.infer<typeof ManagerProposalSchema>;
export type ManagerJob = z.infer<typeof ManagerJobSchema>;
export type ReadToolCall = z.infer<typeof ReadToolCallSchema>;
export type ModelMessage = z.infer<typeof ModelMessageSchema>;
export type ModelTurnInput = z.infer<typeof ModelTurnInputSchema>;
export type ModelTurnResult = z.infer<typeof ModelTurnResultSchema>;
export type ModelCapabilityReport = z.infer<typeof ModelCapabilityReportSchema>;
export type AuthorizedProjectContext = z.infer<typeof AuthorizedProjectContextSchema>;
export interface NemotronAdapter { probe(signal: AbortSignal): Promise<ModelCapabilityReport>; next(input: ModelTurnInput, signal: AbortSignal): Promise<ModelTurnResult> }
export interface ProjectManagerRunner { run(job: ManagerJob, context: AuthorizedProjectContext, signal: AbortSignal): Promise<ManagerProposal> }
