import { z } from 'zod';
import { boundedText, IdSchema } from './limits';

export const LocalThreadReadInputSchema = z.strictObject({ limit: z.number().int().min(1).max(50).default(20) });
export const LocalThreadSendInputSchema = z.strictObject({ message: boundedText(16000, true) });
export const LocalThreadHistorySchema = z.object({
  thread: z.object({ threadId: IdSchema, title: z.string(), status: z.string(), link: z.string().url() }),
  messages: z.array(z.object({ role: z.string(), text: z.string(), runId: z.string().nullable().optional() })).max(50),
});
export const LocalThreadReceiptSchema = z.object({ threadId: IdSchema, runId: z.string(), status: z.string(), messageId: z.string().optional(), delivery: z.string().optional() });
export type LocalThreadReadInput = z.input<typeof LocalThreadReadInputSchema>;
export type LocalThreadSendInput = z.infer<typeof LocalThreadSendInputSchema>;
export type LocalThreadHistory = z.infer<typeof LocalThreadHistorySchema>;
export type LocalThreadReceipt = z.infer<typeof LocalThreadReceiptSchema>;
