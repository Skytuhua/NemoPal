import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IdSchema, IngestObservationsInputSchema, LIMITS, LocalBindingSchema, ObservationBatchSchema, PetPreferenceSchema, SourceCursorSchema, type LocalBinding, type LocalStore, type ObservationBatch, type PendingUpload, type PetPreference, type SourceCursor } from '@living-playbooks/contracts';
import { ReceivingIdentitySchema, type ReceivingIdentity } from './consent';

const SourceCommand = z.strictObject({ id: IdSchema, operationId: IdSchema, bindingId: IdSchema, grantRevision: z.number().int().nonnegative(), kind: z.enum(['pause', 'revoke']) });
const Upload = z.strictObject({ id: IdSchema, operationId: IdSchema, bindingId: IdSchema, grantRevision: z.number().int().nonnegative(), input: IngestObservationsInputSchema });
// Optional preserves legacy checksums. Absence never supplies receiving consent.
const Entry = z.strictObject({ local: LocalBindingSchema, cursor: SourceCursorSchema.nullable(), cloud: z.boolean(), receivingConsent: z.strictObject({ grantRevision: z.number().int().nonnegative(), identity: ReceivingIdentitySchema }).optional() });
const Journal = z.strictObject({ version: z.literal(1), entries: z.array(Entry).max(10), uploads: z.array(Upload).max(LIMITS.spoolCount), sourceCommands: z.array(SourceCommand).max(20), presentations: z.array(z.strictObject({ checkInId: IdSchema, presentationId: IdSchema })).max(2000), preference: PetPreferenceSchema, position: z.strictObject({ x: z.number().finite(), y: z.number().finite() }).nullable() });
type Data = z.infer<typeof Journal>;
const checksum = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const initial = (): Data => ({ version: 1, entries: [], uploads: [], sourceCommands: [], presentations: [], preference: { hidden: false, focus: false, reducedMotion: false, pinnedProjectId: null }, position: null });
export class JournalStore implements LocalStore {
  private tail: Promise<unknown> = Promise.resolve();
  private fenced = new Set<string>();
  private durabilityFailed = false;
  private constructor(private path: string, private data: Data, private limits: { count: number; bytes: number }) {}
  static async open(path: string, limits: { count?: number; bytes?: number } = {}): Promise<JournalStore> {
    let data = initial();
    try {
      if ((await stat(path)).size > LIMITS.spoolBytes + 1024 * 1024) throw Error('oversized');
      const envelope = z.strictObject({ checksum: z.string(), data: Journal }).parse(JSON.parse(await readFile(path, 'utf8')));
      if (checksum(envelope.data) !== envelope.checksum) throw Error('checksum');
      data = envelope.data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw Error('Local journal corrupt; ingestion paused. Preserve primary and .previous for explicit recovery.');
      try { await stat(`${path}.previous`); throw Error('Local journal corrupt: primary missing with previous snapshot; explicit recovery required.'); }
      catch (previous) { if ((previous as NodeJS.ErrnoException).code !== 'ENOENT') throw previous; }
    }
    return new JournalStore(path, data, { count: limits.count ?? LIMITS.spoolCount, bytes: limits.bytes ?? LIMITS.spoolBytes });
  }
  private mutate(change: (data: Data) => void): Promise<void> {
    const operation = this.tail.then(async () => {
      const next = structuredClone(this.data); change(next); Journal.parse(next);
      const payload = JSON.stringify({ checksum: checksum(next), data: next });
      if (Buffer.byteLength(payload) > LIMITS.spoolBytes + 1024 * 1024) throw Error('Local spool journal limit reached');
      try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(`${this.path}.tmp`, payload, { mode: 0o600, flush: true });
      // Preserve the valid prior primary without a window in which the primary is absent.
      try {
        const previous = z.strictObject({ checksum: z.string(), data: Journal }).parse(JSON.parse(await readFile(this.path, 'utf8')));
        if (previous.checksum !== checksum(this.data) || checksum(previous.data) !== previous.checksum) throw Error('Local journal changed or corrupt');
        const revoked = next.entries.filter(e => e.local.binding.state === 'revoked');
        previous.data.uploads = previous.data.uploads.filter(u => !revoked.some(e => e.local.binding.id === u.bindingId));
        for (const entry of previous.data.entries) { const tombstone = revoked.find(e => e.local.binding.id === entry.local.binding.id); if (tombstone) entry.local = structuredClone(tombstone.local); }
        await writeFile(`${this.path}.previous.tmp`, JSON.stringify({ checksum: checksum(previous.data), data: previous.data }), { mode: 0o600, flush: true });
        await rename(`${this.path}.previous.tmp`, `${this.path}.previous`);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await rename(`${this.path}.tmp`, this.path);
      this.data = next;
      } catch (error) { this.durabilityFailed = true; throw error; }
    });
    this.tail = operation.catch(() => {}); return operation;
  }
  bindings(): LocalBinding[] { return structuredClone(this.data.entries.map(entry => entry.local)); }
  binding(id: string): LocalBinding | undefined { const value = this.data.entries.find(entry => entry.local.binding.id === id)?.local; return value ? structuredClone(value) : undefined; }
  cursor(id: string): SourceCursor | null { return structuredClone(this.data.entries.find(entry => entry.local.binding.id === id)?.cursor ?? null); }
  isFollowing(id: string): boolean { return !this.fenced.has(id) && this.binding(id)?.binding.state === 'following'; }
  async putBinding(input: LocalBinding, cloud: boolean, receiving: ReceivingIdentity | null = null, withdrawal?: 'pause' | 'revoke'): Promise<void> {
    const local = LocalBindingSchema.parse(input);
    const grantRevision = local.binding.grantRevision;
    if (withdrawal) {
      this.fence(local.binding.id);
      local.binding = withdrawal === 'revoke' ? { ...local.binding, state: 'revoked', grantRevision: grantRevision + 1, exportPolicy: 'off' } : { ...local.binding, state: 'paused' };
    }
    const receivingConsent = cloud && local.binding.exportPolicy !== 'off' && receiving ? { grantRevision: local.binding.grantRevision, identity: ReceivingIdentitySchema.parse(receiving) } : undefined;
    await this.mutate(data => {
      if (data.entries.some(entry => entry.local.binding.id === local.binding.id)) throw Error('Source already enrolled');
      if (local.binding.state !== 'revoked' && data.entries.some(entry => entry.local.binding.deviceId === local.binding.deviceId && entry.local.binding.state !== 'revoked')) throw Error('Only one selected source per device is supported');
      data.entries.push({ local, cursor: null, cloud, ...(receivingConsent ? { receivingConsent } : {}) });
      if (cloud && withdrawal) data.sourceCommands.push({ id: randomUUID(), operationId: randomUUID(), bindingId: local.binding.id, grantRevision, kind: withdrawal });
    });
  }
  canExport(bindingId: string, grantRevision: number, current: ReceivingIdentity | null): boolean {
    const consent = this.data.entries.find(entry => entry.local.binding.id === bindingId)?.receivingConsent;
    const identity = ReceivingIdentitySchema.safeParse(current);
    return Boolean(consent && consent.grantRevision === grantRevision && identity.success && consent.identity.cloudOrigin === identity.data.cloudOrigin && consent.identity.modelEndpoint === identity.data.modelEndpoint && consent.identity.disclosure === identity.data.disclosure);
  }
  async commitObservationBatch(bindingId: string, expectedCursor: SourceCursor | null, input: ObservationBatch): Promise<void> {
    const batch = ObservationBatchSchema.parse(input);
    await this.mutate(data => {
      const entry = data.entries.find(entry => entry.local.binding.id === bindingId);
      if (!entry || this.fenced.has(bindingId) || entry.local.binding.state !== 'following') throw Error('Source grant stopped');
      if (checksum(entry.cursor) !== checksum(expectedCursor)) throw Error('Source cursor conflict');
      if (batch.observations.some(o => o.bindingId !== bindingId || o.grantRevision !== entry.local.binding.grantRevision)) throw Error('Source grant mismatch');
      const policy = entry.local.binding.exportPolicy;
      if (policy !== 'approved_excerpts' && batch.observations.some(o => o.excerpt !== undefined)) throw Error('Excerpt consent required');
      if (entry.cloud && policy !== 'off' && batch.observations.length) {
        const upload: PendingUpload = { id: randomUUID(), operationId: randomUUID(), bindingId, grantRevision: entry.local.binding.grantRevision, input: { observations: batch.observations } };
        data.uploads.push(upload);
        if (data.uploads.reduce((sum, u) => sum + u.input.observations.length, 0) > this.limits.count || Buffer.byteLength(JSON.stringify(data.uploads)) > this.limits.bytes) throw Error('Local spool full; collection paused without cursor advance');
      }
      entry.cursor = batch.nextCursor;
      if (batch.lastObservedAt) entry.local.binding.lastObservedAt = batch.lastObservedAt;
    });
  }
  async pendingUploads(limit: number, deviceId?: string): Promise<PendingUpload[]> { await this.tail; return structuredClone(this.data.uploads.filter(u => !this.fenced.has(u.bindingId) && (!deviceId || this.binding(u.bindingId)?.binding.deviceId === deviceId)).slice(0, Math.max(0, Math.min(limit, 20)))); }
  pendingUpload(operationId: string): PendingUpload | undefined { const value = this.data.uploads.find(upload => upload.operationId === operationId); return value ? structuredClone(value) : undefined; }
  async acknowledgeUploads(ids: string[]): Promise<void> { await this.mutate(data => { data.uploads = data.uploads.filter(u => !ids.includes(u.id)); }); }
  fence(id: string): void { this.fenced.add(id); }
  async blockBinding(id: string): Promise<void> {
    this.fence(id);
    await this.mutate(data => { const entry = data.entries.find(e => e.local.binding.id === id); if (entry && entry.local.binding.state === 'following') entry.local.binding.state = 'blocked'; });
  }
  async revokeBinding(bindingId: string, grantRevision: number): Promise<void> {
    this.fence(bindingId);
    await this.mutate(data => {
      const entry = data.entries.find(entry => entry.local.binding.id === bindingId);
      if (!entry) throw Error('Unknown source binding');
      if (entry.local.binding.state === 'revoked') return;
      if (entry.local.binding.grantRevision !== grantRevision) throw Error('Grant revision conflict');
      entry.local.binding = { ...entry.local.binding, state: 'revoked', grantRevision: grantRevision + 1, exportPolicy: 'off' };
      data.uploads = data.uploads.filter(u => u.bindingId !== bindingId);
      data.sourceCommands = data.sourceCommands.filter(c => c.bindingId !== bindingId);
      if (entry.cloud) data.sourceCommands.push({ id: randomUUID(), operationId: randomUUID(), bindingId, grantRevision, kind: 'revoke' });
    });
  }
  async pauseBinding(id: string): Promise<void> {
    this.fence(id);
    await this.mutate(data => {
      const entry = data.entries.find(e => e.local.binding.id === id); if (!entry || entry.local.binding.state === 'revoked') throw Error('Source unavailable');
      entry.local.binding.state = 'paused';
      if (entry.cloud && !data.sourceCommands.some(c => c.bindingId === id && c.kind === 'pause')) data.sourceCommands.push({ id: randomUUID(), operationId: randomUUID(), bindingId: id, grantRevision: entry.local.binding.grantRevision, kind: 'pause' });
    });
  }
  pendingSourceCommands(deviceId?: string): z.infer<typeof SourceCommand>[] { return structuredClone(this.data.sourceCommands.filter(command => !deviceId || this.binding(command.bindingId)?.binding.deviceId === deviceId).sort((a, b) => Number(b.kind === 'revoke') - Number(a.kind === 'revoke'))); }
  async acknowledgeSourceCommand(id: string): Promise<void> { await this.mutate(data => { data.sourceCommands = data.sourceCommands.filter(c => c.id !== id); }); }
  async recordPresentation(checkInId: string, presentationId: string): Promise<boolean> {
    IdSchema.parse(checkInId); IdSchema.parse(presentationId); let fresh = false;
    await this.mutate(data => { if (!data.presentations.some(p => p.checkInId === checkInId && p.presentationId === presentationId)) { data.presentations.push({ checkInId, presentationId }); fresh = true; } }); return fresh;
  }
  preference(): PetPreference { return structuredClone(this.data.preference); }
  async setPreference(input: PetPreference): Promise<void> { const preference = PetPreferenceSchema.parse(input); await this.mutate(data => { data.preference = preference; }); }
  position(): { x: number; y: number } | null { return structuredClone(this.data.position); }
  async setPosition(position: { x: number; y: number }): Promise<void> { await this.mutate(data => { data.position = position; }); }
  async flush(): Promise<void> { await this.tail; if (this.durabilityFailed) throw Error('Local durability failed; explicit recovery required before Quit.'); }
}
