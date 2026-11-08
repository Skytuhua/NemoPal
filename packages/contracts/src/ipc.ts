import { z } from 'zod';
import { boundedText, IdSchema as id, RevisionSchema as revision, TimestampSchema as timestamp } from './limits';
import { CapabilitySchema, CheckInAnswerSchema, CheckInSchema, ObservationSchema, PetStateSchema, ProjectSnapshotSchema, SourceBindingSchema, SourceCapabilitySchema, ExportPolicySchema } from './domain';
import { commandEnvelopeSchema, revisionedCommandSchema, CreateProjectInputSchema, MessageInputSchema, OwnerActionSchema, DocumentInputSchema, SnoozeInputSchema, EmptyInputSchema, ProjectEventSchema, PairingInputSchema, PairingResultSchema, PhoneLinkInputSchema } from './api';
import type { CommandEnvelope, PairingInput, PairingResult, PlaybooksClient, ProjectEvent } from './api';
import type { CheckIn, ProjectSnapshot, SourceBinding } from './domain';

export const SourceCursorSchema = z.strictObject({ adapterId: boundedText(80, true), identity: boundedText(512, true), offset: revision, fingerprint: boundedText(256, true) });
export const ObservationBatchSchema = z.strictObject({ observations: z.array(ObservationSchema).max(20), nextCursor: SourceCursorSchema, mode: SourceCapabilitySchema, lastObservedAt: timestamp.nullable(), coverage: boundedText(1024, true) });
export const LocalBindingSchema = z.strictObject({ binding: SourceBindingSchema, selectedSource: boundedText(4096, true), sourceIdentity: boundedText(512, true), localReadConsented: z.literal(true) });
export const ObserverCapabilityReportSchema = z.strictObject({ available: z.boolean(), adapterId: boundedText(80, true), adapterVersion: boundedText(40, true), installedVersion: boundedText(80).nullable(), capability: SourceCapabilitySchema, reason: boundedText(1024, true), coverage: boundedText(1024, true) });
export const SourceSelectionPreviewSchema = z.discriminatedUnion('available', [
  z.strictObject({ available: z.literal(false), reason: boundedText(512, true) }),
  z.strictObject({ available: z.literal(true), selectionId: id, projectId: id, displayName: boundedText(160, true), adapterId: boundedText(80, true), adapterVersion: boundedText(40, true), capability: SourceCapabilitySchema, cloudOrigin: boundedText(512), disclosure: boundedText(2048, true) }),
]);
export const ConfirmSourceInputSchema = z.strictObject({ selectionId: id, projectId: id, allowLocalRead: z.literal(true), exportPolicy: ExportPolicySchema, acknowledgedBestEffortFiltering: z.literal(true) });
export const PetPreferenceSchema = z.strictObject({ hidden: z.boolean(), focus: z.boolean(), reducedMotion: z.boolean(), pinnedProjectId: id.nullable() });
export const DesktopCapabilitiesSchema = z.strictObject({ nativePet: CapabilitySchema, sourceObservation: ObserverCapabilityReportSchema, paired: z.boolean(), cloudOrigin: boundedText(512).nullable() });
export const SafePetEventSchema = z.strictObject({ type: z.literal('pet_state'), projectId: id.nullable(), managerName: boundedText(120), petPackId: boundedText(80), state: PetStateSchema, checkIn: CheckInSchema.nullable(), demoTiming: z.boolean(), preference: PetPreferenceSchema, chatContextId: id.optional(), chatOpen: z.boolean().optional() });
export const SafeDesktopEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('open_project'), projectId: id }),
  z.strictObject({ type: z.literal('project_event'), event: ProjectEventSchema }),
  z.strictObject({ type: z.literal('connection'), connected: z.boolean(), reason: boundedText(512).optional() }),
  z.strictObject({ type: z.literal('source_state'), binding: SourceBindingSchema, cloudRevocationPending: z.boolean() }),
]);

export const AllowedClientCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('listProjects') }),
  z.strictObject({ type: z.literal('createProject'), command: commandEnvelopeSchema(CreateProjectInputSchema) }),
  z.strictObject({ type: z.literal('getSnapshot'), projectId: id }),
  z.strictObject({ type: z.literal('getPhoneStatus'), projectId: id }),
  z.strictObject({ type: z.literal('linkPhone'), projectId: id, command: revisionedCommandSchema(PhoneLinkInputSchema) }),
  z.strictObject({ type: z.literal('revokePhone'), projectId: id, command: revisionedCommandSchema(z.strictObject({ linkId: id })) }),
  z.strictObject({ type: z.literal('sendMessage'), projectId: id, command: revisionedCommandSchema(MessageInputSchema) }),
  z.strictObject({ type: z.literal('applyAction'), projectId: id, command: revisionedCommandSchema(OwnerActionSchema) }),
  z.strictObject({ type: z.literal('saveDocument'), projectId: id, documentId: id, command: revisionedCommandSchema(DocumentInputSchema) }),
  z.strictObject({ type: z.literal('answerCheckIn'), checkInId: id, command: revisionedCommandSchema(CheckInAnswerSchema) }),
  z.strictObject({ type: z.literal('snoozeCheckIn'), checkInId: id, command: revisionedCommandSchema(SnoozeInputSchema) }),
  z.strictObject({ type: z.literal('cancelCheckIn'), checkInId: id, command: revisionedCommandSchema(EmptyInputSchema) }),
  z.strictObject({ type: z.literal('deleteProject'), projectId: id, command: revisionedCommandSchema(EmptyInputSchema) }),
  z.strictObject({ type: z.literal('cancelJob'), jobId: id, command: revisionedCommandSchema(EmptyInputSchema) }),
]);
export const PetCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('openChat'), contextId: id }),
  z.strictObject({ type: z.literal('openProject'), projectId: id }),
  z.strictObject({ type: z.literal('answer'), checkInId: id, command: revisionedCommandSchema(CheckInAnswerSchema) }),
  z.strictObject({ type: z.literal('snooze'), checkInId: id, command: revisionedCommandSchema(SnoozeInputSchema) }),
  z.strictObject({ type: z.literal('setPreference'), preference: PetPreferenceSchema }),
]);
export type SourceCursor = z.infer<typeof SourceCursorSchema>;
export type ObservationBatch = z.infer<typeof ObservationBatchSchema>;
export type LocalBinding = z.infer<typeof LocalBindingSchema>;
export type ObserverCapabilityReport = z.infer<typeof ObserverCapabilityReportSchema>;
export type SourceSelectionPreview = z.infer<typeof SourceSelectionPreviewSchema>;
export type ConfirmSourceInput = z.infer<typeof ConfirmSourceInputSchema>;
export type PetPreference = z.infer<typeof PetPreferenceSchema>;
export type DesktopCapabilities = z.infer<typeof DesktopCapabilitiesSchema>;
export type SafePetEvent = z.infer<typeof SafePetEventSchema>;
export type SafeDesktopEvent = z.infer<typeof SafeDesktopEventSchema>;
export type AllowedClientCommand = z.infer<typeof AllowedClientCommandSchema>;
export type PetCommand = z.infer<typeof PetCommandSchema>;
export type DesktopCommandResult<C extends AllowedClientCommand> = Awaited<ReturnType<PlaybooksClient[C['type']]>>;
export interface DesktopBridge {
  capabilities(): Promise<DesktopCapabilities>;
  pair(input: PairingInput): Promise<PairingResult>;
  selectSource(projectId: string): Promise<SourceSelectionPreview>;
  confirmSource(input: ConfirmSourceInput): Promise<SourceBinding>;
  pauseSource(bindingId: string): Promise<void>;
  revokeSource(bindingId: string): Promise<void>;
  invoke<C extends AllowedClientCommand>(input: C): Promise<DesktopCommandResult<C>>;
  onEvent(listener: (event: SafeDesktopEvent) => void): () => void;
  setPetPreference(input: PetPreference): Promise<void>;
  startCodexDemo?(projectId: string): Promise<'started' | 'cancelled'>;
  sendCodexDemo?(input: { projectId: string; text: string }): Promise<{ status: 'completed' | 'failed' | 'interrupted' | 'unknown'; replies: string[] }>;
  stopCodexDemo?(projectId: string): Promise<void>;
}
export interface PetBridge {
  invoke(input: PetCommand): Promise<void>;
  drag?(phase: 'start' | 'move' | 'end'): Promise<void>;
  onEvent(listener: (event: SafePetEvent) => void): () => void;
  onFocusControls?(listener: () => void): () => void;
}
export interface CodexObserver {
  probe(): Promise<ObserverCapabilityReport>;
  readDelta(binding: LocalBinding, cursor: SourceCursor | null, signal: AbortSignal): Promise<ObservationBatch>;
  stop(bindingId: string): Promise<void>;
}
export type PendingUpload = { id: string; operationId: string; bindingId: string; grantRevision: number; input: { observations: z.infer<typeof ObservationSchema>[] } };
export interface LocalStore {
  commitObservationBatch(bindingId: string, expectedCursor: SourceCursor | null, batch: ObservationBatch): Promise<void>;
  pendingUploads(limit: number): Promise<PendingUpload[]>;
  acknowledgeUploads(ids: string[]): Promise<void>;
  revokeBinding(bindingId: string, grantRevision: number): Promise<void>;
  recordPresentation(checkInId: string, presentationId: string): Promise<boolean>;
  flush(): Promise<void>;
}

declare global {
  interface Window { playbooks?: DesktopBridge; pet?: PetBridge }
}
