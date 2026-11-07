import { ProjectSnapshotSchema, type ProjectSnapshot } from '@living-playbooks/contracts';
import { goldenSnapshot } from '../../fixtures/contracts/golden';
import type { DraftStore, LocalDraft } from '../../apps/web/src/features/documents/drafts';
export function snapshot(offset = 0): ProjectSnapshot {
  const raw = JSON.stringify(goldenSnapshot).replace(/00000000-0000-4000-8000-(\d{12})/g, (_, n: string) => `00000000-0000-4000-8000-${String(Number(n) + offset).padStart(12, '0')}`);
  const result = ProjectSnapshotSchema.parse(JSON.parse(raw));
  if (offset) result.project.title = 'Second project';
  return result;
}
export function memoryDrafts(): DraftStore {
  const values = new Map<string, LocalDraft>();
  return { async read(key) { return values.get(key); }, async write(key, value) { values.set(key, structuredClone(value)); }, async remove(key) { values.delete(key); }, async flush() {} };
}
export function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
