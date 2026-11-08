import { z } from 'zod';
import { boundedText, IdSchema as id, RevisionSchema as revision, utf8Bytes } from './limits';
import { CapabilitySchema, ChatMessageSchema, CheckInAnswerSchema, CheckInSchema } from './domain';
import { MessageInputSchema, revisionedCommandSchema, SnoozeInputSchema, type AcceptedJob } from './api';

// No project title, source references, documents, credentials or generic client cross this boundary.
export const PetChatConversationSchema = z.strictObject({
  draftScope: boundedText(128, true), projectId: id, projectRevision: revision, eventSequence: revision,
  managerName: boundedText(120, true), messages: z.array(ChatMessageSchema.omit({ observationIds: true })).max(200),
  checkIn: CheckInSchema.nullable(), connected: z.boolean(), inference: CapabilitySchema, demoTiming: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.messages.some(message => message.projectId !== value.projectId) || (value.checkIn && value.checkIn.projectId !== value.projectId)) ctx.addIssue({ code: 'custom', message: 'Foreign conversation record' });
  if (new Set(value.messages.map(message => message.id)).size !== value.messages.length) ctx.addIssue({ code: 'custom', message: 'Duplicate message' });
});
export const PetChatStateSchema = z.strictObject({
  type: z.literal('pet_chat_state'), version: revision, contextId: id, visible: z.boolean(), expanded: z.boolean(),
  reducedMotion: z.boolean(), conversation: PetChatConversationSchema.nullable(),
  flushRequestId: id.optional(),
  loading: z.boolean().optional(),
}).refine(value => utf8Bytes(JSON.stringify(value)) <= 4 * 1024 * 1024, 'Conversation projection too large');
export const PetChatCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('flushed'), contextId: id, flushId: id, succeeded: z.boolean() }),
  z.strictObject({ type: z.literal('close'), contextId: id }),
  z.strictObject({ type: z.literal('expand'), contextId: id, expanded: z.boolean() }),
  z.strictObject({ type: z.literal('send'), contextId: id, command: revisionedCommandSchema(MessageInputSchema) }),
  z.strictObject({ type: z.literal('answer'), contextId: id, checkInId: id, presentationId: id, command: revisionedCommandSchema(CheckInAnswerSchema) }),
  z.strictObject({ type: z.literal('snooze'), contextId: id, checkInId: id, presentationId: id, command: revisionedCommandSchema(SnoozeInputSchema) }),
]);
export type PetChatState = z.infer<typeof PetChatStateSchema>;
export type PetChatConversation = z.infer<typeof PetChatConversationSchema>;
export type PetChatCommand = z.infer<typeof PetChatCommandSchema>;
export interface PetChatBridge {
  read(): Promise<PetChatState>;
  invoke(command: PetChatCommand): Promise<AcceptedJob | undefined>;
  onEvent(listener: (state: PetChatState) => void): () => void;
}
declare global { interface Window { petChat?: PetChatBridge } }
