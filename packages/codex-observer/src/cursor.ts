import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SourceCursorSchema, type SourceCursor } from '@living-playbooks/contracts';

export const ADAPTER = 'codex-app-server';
export const VERSION = '0.167.0';
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const Anchor = z.strictObject({ birth: z.string().length(64), turn: z.string().max(80).nullable(), prefix: z.string().length(64), baseline: z.boolean().optional() });
export function prefixDigest(items: unknown[], baseline = false): string {
  return digest(baseline ? items.map(item => { const value = item as Record<string, unknown>; return [value.id, value.type]; }) : items);
}
export function decodeCursor(cursor: SourceCursor, identity: string) {
  SourceCursorSchema.parse(cursor);
  if (cursor.adapterId !== ADAPTER || cursor.identity !== identity) throw Error('Source identity changed');
  return Anchor.parse(JSON.parse(cursor.fingerprint));
}
export function makeCursor(identity: string, birth: string, turn: string | null, items: unknown[], offset: number, baseline = false): SourceCursor {
  return SourceCursorSchema.parse({ adapterId: ADAPTER, identity, offset, fingerprint: JSON.stringify({ birth, turn, prefix: prefixDigest(items.slice(0, offset), baseline), ...(baseline ? { baseline: true } : {}) }) });
}
