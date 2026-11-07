import { z } from 'zod';

export const LIMITS = Object.freeze({ briefBytes: 65536, tasks: 40, panels: 12, excerptBytes: 4096, ingestionCount: 20, ingestionBytes: 131072, spoolCount: 1000, spoolBytes: 10485760, contextBytes: 49152, modelCalls: 4, toolCalls: 6, jobDeadlineMs: 120000, activePollMs: 30000, idlePollMs: 120000, coalesceMs: 10000, dispatcherMs: 15000 });
export const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
export const boundedText = (maxBytes: number, nonempty = false) => z.string()
  .refine(value => !nonempty || value.trim().length > 0, 'Text must not be empty')
  .refine(value => utf8Bytes(value) <= maxBytes, `Text exceeds ${maxBytes} UTF-8 bytes`);
export const IdSchema = z.uuid();
export const RevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const TimestampSchema = z.iso.datetime();
