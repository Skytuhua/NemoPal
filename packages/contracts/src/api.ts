import { z } from 'zod';
import { boundedText, IdSchema as id, LIMITS, RevisionSchema as revision, TimestampSchema as timestamp, utf8Bytes } from './limits';
import { CheckInAnswerSchema, CheckInSchema, DocumentDraftSchema, ExportPolicySchema, ObservationSchema, ProjectPhaseSchema, ProjectSchema, ProjectSnapshotSchema, ProjectStatusSchema, SourceBindingSchema, SourceCapabilitySchema, SourceStateSchema, TaskStatusSchema } from './domain';

export const commandEnvelopeSchema = <T extends z.ZodType>(input: T) => z.strictObject({ operationId: id, expectedRevision: revision.optional(), input });
export const revisionedCommandSchema = <T extends z.ZodType>(input: T) => z.strictObject({ operationId: id, expectedRevision: revision, input });
export type CommandEnvelope<T> = { operationId: string; expectedRevision?: number; input: T };
export type RevisionedCommandEnvelope<T> = CommandEnvelope<T> & { expectedRevision: number };
export const commandReceiptSchema = <T extends z.ZodType>(result: T) => z.strictObject({ operationId: id, requestHash: z.string().regex(/^[a-f0-9]{64}$/), status: z.enum(['accepted', 'completed']), result, projectRevision: revision, eventSequence: revision });
export type CommandReceipt<T> = { operationId: string; requestHash: string; status: 'accepted' | 'completed'; result: T; projectRevision: number; eventSequence: number };
export const AcceptedJobSchema = z.strictObject({ receipt: commandReceiptSchema(z.null()).extend({ status: z.literal('accepted') }), jobId: id, state: z.enum(['queued', 'running']) });
export const CreateProjectInputSchema = z.strictObject({ title: boundedText(160, true), brief: boundedText(LIMITS.briefBytes, true), format: z.enum(['prompt', 'txt', 'md']).optional() });
export const MessageInputSchema = z.strictObject({ text: boundedText(16384, true) });
export const DocumentInputSchema = z.strictObject({ text: boundedText(LIMITS.briefBytes) });
export const OwnerActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('accept_plan') }),
  z.strictObject({ type: z.literal('update_task'), taskId: id, status: TaskStatusSchema, title: boundedText(512, true).optional() }),
  z.strictObject({ type: z.literal('record_decision'), text: boundedText(2048, true) }),
  z.strictObject({ type: z.literal('set_project_status'), status: ProjectStatusSchema }),
  z.strictObject({ type: z.literal('set_project_phase'), phase: ProjectPhaseSchema }),
]);
export const SnoozeInputSchema = z.strictObject({ until: timestamp, timezone: boundedText(100, true).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }, 'Invalid IANA timezone') });
export const EmptyInputSchema = z.strictObject({});
export const EnrollSourceInputSchema = z.strictObject({ sourceKey: boundedText(128, true), adapterId: boundedText(80, true), adapterVersion: boundedText(40, true), capability: SourceCapabilitySchema, exportPolicy: ExportPolicySchema });
export const SourceStateInputSchema = z.strictObject({ state: z.enum(['paused', 'following']), grantRevision: revision });
export const RevokeSourceInputSchema = z.strictObject({ grantRevision: revision, removeExcerpts: z.boolean() });
export const SourceHealthInputSchema = z.strictObject({ grantRevision: revision, state: SourceStateSchema, capability: SourceCapabilitySchema, lastObservedAt: timestamp.nullable(), errorClass: z.enum(['unavailable', 'unsupported_schema', 'source_changed', 'permission_denied', 'queue_full', 'network']).nullable() });
export const IngestObservationsInputSchema = z.strictObject({ observations: z.array(ObservationSchema).min(1).max(LIMITS.ingestionCount) })
  .refine(value => utf8Bytes(JSON.stringify(value)) <= LIMITS.ingestionBytes, 'Ingestion batch byte limit exceeded');
export const IngestionResultSchema = z.strictObject({ acceptedIds: z.array(id).max(20), duplicateIds: z.array(id).max(20) });
export const PresentationInputSchema = z.strictObject({ presentationId: id });
export const ProjectSummarySchema = z.strictObject({ id, title: boundedText(160, true), goal: boundedText(LIMITS.briefBytes, true), revision, status: ProjectStatusSchema, phase: ProjectPhaseSchema, planState: z.enum(['proposed', 'accepted']), managerName: boundedText(120, true), petPackId: boundedText(80, true), unreadCheckIns: z.number().int().nonnegative().max(40), updatedAt: timestamp });
export const ProjectEventSchema = z.strictObject({ seq: revision, projectId: id, kind: z.enum(['project_updated', 'message_added', 'document_updated', 'source_updated', 'observations_added', 'job_updated', 'checkin_updated', 'project_deleted']), resourceId: id, revision });
export const PairingInputSchema = z.strictObject({ code: boundedText(256, true), deviceName: boundedText(120, true) });
export const PairingResultSchema = z.strictObject({ paired: z.boolean(), deviceId: id.optional(), expiresAt: timestamp.optional(), reason: boundedText(512).optional() });
export const RedeemResultSchema = z.strictObject({ token: boundedText(512, true), deviceId: id, expiresAt: timestamp });
export const ApiErrorSchema = z.strictObject({ code: boundedText(80, true), message: boundedText(1024, true), retryable: z.boolean(), currentRevision: revision.optional(), capability: SourceCapabilitySchema.optional() });
export type ApiError = z.infer<typeof ApiErrorSchema>;

export type AcceptedJob = z.infer<typeof AcceptedJobSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;
export type MessageInput = z.infer<typeof MessageInputSchema>;
export type DocumentInput = z.infer<typeof DocumentInputSchema>;
export type OwnerAction = z.infer<typeof OwnerActionSchema>;
export type SnoozeInput = z.infer<typeof SnoozeInputSchema>;
export type EnrollSourceInput = z.infer<typeof EnrollSourceInputSchema>;
export type SourceStateInput = z.infer<typeof SourceStateInputSchema>;
export type RevokeSourceInput = z.infer<typeof RevokeSourceInputSchema>;
export type SourceHealthInput = z.infer<typeof SourceHealthInputSchema>;
export type IngestObservationsInput = z.infer<typeof IngestObservationsInputSchema>;
export type IngestionResult = z.infer<typeof IngestionResultSchema>;
export type PresentationInput = z.infer<typeof PresentationInputSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type ProjectEvent = z.infer<typeof ProjectEventSchema>;
export type PairingInput = z.infer<typeof PairingInputSchema>;
export type PairingResult = z.infer<typeof PairingResultSchema>;

export interface PlaybooksClient {
  listProjects(signal?: AbortSignal): Promise<ProjectSummary[]>;
  createProject(input: CommandEnvelope<CreateProjectInput>): Promise<AcceptedJob>;
  getSnapshot(projectId: string, signal?: AbortSignal): Promise<z.infer<typeof ProjectSnapshotSchema>>;
  sendMessage(projectId: string, input: RevisionedCommandEnvelope<MessageInput>): Promise<AcceptedJob>;
  applyAction(projectId: string, input: RevisionedCommandEnvelope<OwnerAction>): Promise<CommandReceipt<z.infer<typeof ProjectSchema>>>;
  saveDocument(projectId: string, documentId: string, input: RevisionedCommandEnvelope<DocumentInput>): Promise<CommandReceipt<z.infer<typeof DocumentDraftSchema>>>;
  answerCheckIn(id: string, input: RevisionedCommandEnvelope<z.infer<typeof CheckInAnswerSchema>>): Promise<CommandReceipt<z.infer<typeof CheckInSchema>>>;
  snoozeCheckIn(id: string, input: RevisionedCommandEnvelope<SnoozeInput>): Promise<CommandReceipt<z.infer<typeof CheckInSchema>>>;
  cancelCheckIn(id: string, input: RevisionedCommandEnvelope<Record<string, never>>): Promise<CommandReceipt<z.infer<typeof CheckInSchema>>>;
  presentCheckIn(id: string, input: CommandEnvelope<PresentationInput>): Promise<CommandReceipt<z.infer<typeof CheckInSchema>>>;
  enrollSource(projectId: string, input: RevisionedCommandEnvelope<EnrollSourceInput>): Promise<CommandReceipt<z.infer<typeof SourceBindingSchema>>>;
  setSourceState(id: string, input: CommandEnvelope<SourceStateInput>): Promise<CommandReceipt<z.infer<typeof SourceBindingSchema>>>;
  revokeSource(id: string, input: CommandEnvelope<RevokeSourceInput>): Promise<CommandReceipt<z.infer<typeof SourceBindingSchema>>>;
  ingestObservations(id: string, input: CommandEnvelope<IngestObservationsInput>): Promise<CommandReceipt<IngestionResult>>;
  reportSourceHealth(id: string, input: CommandEnvelope<SourceHealthInput>): Promise<CommandReceipt<z.infer<typeof SourceBindingSchema>>>;
  deleteProject(id: string, input: RevisionedCommandEnvelope<Record<string, never>>): Promise<CommandReceipt<null>>;
  cancelJob(id: string, input: CommandEnvelope<Record<string, never>>): Promise<CommandReceipt<null>>;
  subscribe(after: number, onEvent: (event: ProjectEvent) => void, signal: AbortSignal): Promise<void>;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  throw new Error('Command arguments must be finite JSON values');
}
export async function hashCommand(target: string, envelope: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson({ target, envelope })));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
