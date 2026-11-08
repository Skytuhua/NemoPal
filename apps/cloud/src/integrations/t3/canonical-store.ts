import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { ProjectSchema, SourceBindingSchema } from '@living-playbooks/contracts';
import { reauthorize, type Principal } from '../../auth/credentials';
import { transaction } from '../../db/transaction';
import { appendEvent, saveProject, withdrawEvidence } from '../../domain/store';
import { contextSchema, id, itemSchema, parse, statusSchema, T3Error, type T3Context } from './model';
import { bindingKey, type T3Observation } from './observer';
import type { T3Selection, T3ServiceStore } from './service';

const nonnegative = z.number().int().nonnegative().safe();
const enrollmentSchema = z.strictObject({ sourceGrantRevision: nonnegative, expectedT3GrantRevision: nonnegative, expectedMappingRevision: nonnegative, taskId: id, taskRevision: nonnegative,
  environmentId: id, t3ProjectId: id, threadId: id, startPosition: nonnegative, runId: id,
  runOrdinal: z.number().int().positive().safe(), expiresAt: z.number().int().positive().safe(), localReadConsented: z.literal(true) });
export type T3Enrollment = z.infer<typeof enrollmentSchema>;
const MAX_GRANT_MS = 24 * 60 * 60 * 1000;
const checkpointSchema = z.object({ bindingKey: z.string().regex(/^[a-f0-9]{64}$/), mode: z.enum(['current', 'unmapped']),
  cursor: nonnegative, lastSeenAt: nonnegative.nullable(), threadUpdatedAt: z.iso.datetime().nullable(), runId: id.nullable(),
  runOrdinal: z.number().int().positive().safe().nullable(), status: z.union([statusSchema, z.literal('unknown')]),
  runStatus: z.union([statusSchema, z.literal('unknown')]), items: z.array(itemSchema).max(100), hasMore: z.boolean() });

/** Bind this object to a principal obtained from authentication, never to user-supplied identity. */
export class CanonicalT3Store implements T3ServiceStore {
  constructor(private readonly pool: Pool, private readonly principal: Principal, private readonly now: () => Date = () => new Date()) {}

  private async lock(db: PoolClient, selection: T3Selection) {
    await reauthorize(db, this.principal, this.now());
    if (selection.ownerId !== this.principal.ownerId || selection.deviceId !== this.principal.deviceId) throw new T3Error('wrong_owner');
    const row = (await db.query('SELECT data,deleted FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [selection.projectId, this.principal.ownerId])).rows[0];
    if (!row || row.deleted) throw new T3Error('revoked');
    const project = ProjectSchema.parse(row.data);
    const sourceRow = (await db.query('SELECT data FROM source_bindings WHERE id=$1 AND project_id=$2 FOR UPDATE', [selection.bindingId, selection.projectId])).rows[0];
    if (!sourceRow) throw new T3Error('revoked');
    const source = SourceBindingSchema.parse(sourceRow.data);
    if (source.deviceId !== this.principal.deviceId) throw new T3Error('wrong_owner');
    const enrollment = (await db.query('SELECT * FROM t3_enrollments WHERE binding_id=$1 FOR UPDATE', [selection.bindingId])).rows[0];
    return { project, source, enrollment };
  }

  private current(selection: T3Selection, locked: Awaited<ReturnType<CanonicalT3Store['lock']>>): T3Context {
    const { project, source, enrollment: e } = locked;
    if (!e || e.revoked || !e.consent || e.owner_id !== selection.ownerId || e.device_id !== selection.deviceId || e.project_id !== selection.projectId ||
      project.status !== 'active' || source.state !== 'following' || source.exportPolicy === 'off' ||
      Number(e.project_epoch) !== project.epoch || Number(e.source_grant_revision) !== source.grantRevision || new Date(e.expires_at).getTime() <= this.now().getTime()) throw new T3Error('revoked');
    const context = parse(contextSchema, e.context);
    const task = project.tasks.find(t => t.id === context.mapping.taskId);
    if (!task || task.revision !== context.mapping.taskRevision || context.grant.bindingId !== selection.bindingId || context.grant.projectId !== selection.projectId ||
      context.grant.ownerId !== selection.ownerId || context.grant.deviceId !== selection.deviceId || context.mapping.ownerId !== selection.ownerId ||
      context.mapping.projectId !== selection.projectId || context.grant.revoked || context.grant.expiresAt !== new Date(e.expires_at).getTime() ||
      context.grant.revision !== Number(e.grant_revision) || context.mapping.grantRevision !== context.grant.revision || context.mapping.mappingRevision !== Number(e.mapping_revision)) throw new T3Error('revoked');
    return context;
  }

  /** For a fresh consent flow after expiry or pause; this does not authorize observation. */
  async revisions(selection: T3Selection) {
    return transaction(this.pool, async db => {
      const { enrollment } = await this.lock(db, selection);
      return { t3GrantRevision: Number(enrollment?.grant_revision ?? 0), mappingRevision: Number(enrollment?.mapping_revision ?? 0) };
    });
  }

  async enroll(selection: T3Selection, input: T3Enrollment): Promise<T3Context> {
    const value = parse(enrollmentSchema, input);
    return transaction(this.pool, async db => {
      const locked = await this.lock(db, selection);
      const { project, source, enrollment: old } = locked;
      const now = this.now().getTime();
      if (value.expiresAt <= now || value.expiresAt > now + MAX_GRANT_MS || project.status !== 'active' || source.state !== 'following' || source.exportPolicy === 'off' ||
        source.grantRevision !== value.sourceGrantRevision || !project.tasks.some(t => t.id === value.taskId && t.revision === value.taskRevision)) throw new T3Error('revoked');
      if (value.expectedT3GrantRevision !== Number(old?.grant_revision ?? 0) || value.expectedMappingRevision !== Number(old?.mapping_revision ?? 0)) throw new T3Error('conflict');
      const grantRevision = Number(old?.grant_revision ?? 0) + 1;
      const mappingRevision = Number(old?.mapping_revision ?? 0) + 1;
      if (!Number.isSafeInteger(grantRevision) || !Number.isSafeInteger(mappingRevision)) throw new T3Error('conflict');
      const context = parse(contextSchema, { grant: { ...selection, environmentId: value.environmentId, t3ProjectId: value.t3ProjectId, threadId: value.threadId,
        revision: grantRevision, expiresAt: value.expiresAt, revoked: false, startPosition: value.startPosition },
        mapping: { ownerId: selection.ownerId, projectId: selection.projectId, taskId: value.taskId, taskRevision: value.taskRevision, mappingRevision, grantRevision, runId: value.runId, runOrdinal: value.runOrdinal },
        completionPolicy: { enabled: false, revision: 1, criterionId: 'disabled' } });
      await db.query(`INSERT INTO t3_enrollments(binding_id,owner_id,device_id,project_id,source_grant_revision,project_epoch,grant_revision,mapping_revision,consent,revoked,expires_at,context,checkpoint)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,false,$9,$10,NULL)
        ON CONFLICT(binding_id) DO UPDATE SET owner_id=excluded.owner_id,device_id=excluded.device_id,project_id=excluded.project_id,source_grant_revision=excluded.source_grant_revision,
        project_epoch=excluded.project_epoch,grant_revision=excluded.grant_revision,mapping_revision=excluded.mapping_revision,consent=true,revoked=false,expires_at=excluded.expires_at,context=excluded.context,checkpoint=NULL`,
        [selection.bindingId, selection.ownerId, selection.deviceId, selection.projectId, source.grantRevision, project.epoch, grantRevision, mappingRevision, new Date(value.expiresAt), context]);
      return context;
    });
  }

  async load(selection: T3Selection) {
    return transaction(this.pool, async db => {
      const locked = await this.lock(db, selection);
      const context = this.current(selection, locked);
      const checkpoint = locked.enrollment.checkpoint as T3Observation | null;
      return { context, ...(checkpoint ? { checkpoint } : {}) };
    });
  }

  async commitIfCurrent(expected: T3Context, observation: T3Observation): Promise<boolean> {
    const context = parse(contextSchema, expected);
    const selection = { ownerId: context.grant.ownerId, deviceId: context.grant.deviceId, projectId: context.grant.projectId, bindingId: context.grant.bindingId };
    const metadata = parse(checkpointSchema, observation);
    if (metadata.bindingKey !== bindingKey(context) || metadata.cursor < context.grant.startPosition ||
      metadata.items.some(item => item.visibility !== 'local' || item.sourceThreadId !== context.grant.threadId || item.runId !== context.mapping.runId || item.position <= context.grant.startPosition) ||
      (metadata.mode === 'current' && (metadata.runId !== context.mapping.runId || metadata.runOrdinal !== context.mapping.runOrdinal))) throw new T3Error('invalid_contract');
    const checkpoint = { ...metadata, label: metadata.mode === 'current' ? 'T3 activity observed' : 'T3 run changed; task mapping needs review' };
    return transaction(this.pool, async db => {
      const locked = await this.lock(db, selection);
      let current: T3Context;
      try { current = this.current(selection, locked); } catch (error) { if (error instanceof T3Error && error.code === 'revoked') return false; throw error; }
      if (JSON.stringify(current) !== JSON.stringify(context)) return false;
      await db.query('UPDATE t3_enrollments SET checkpoint=$2 WHERE binding_id=$1', [selection.bindingId, checkpoint]);
      return true;
    });
  }

  async revoke(selection: T3Selection, expected: T3Context): Promise<void> {
    const context = parse(contextSchema, expected);
    await transaction(this.pool, async db => {
      const locked = await this.lock(db, selection);
      const { project, source, enrollment: e } = locked;
      if (!e || e.revoked || JSON.stringify(parse(contextSchema, e.context)) !== JSON.stringify(context) || Number(e.source_grant_revision) !== source.grantRevision || source.state === 'revoked') throw new T3Error('revoked');
      source.grantRevision++; source.state = 'revoked'; source.exportPolicy = 'off'; project.epoch++;
      await withdrawEvidence(db, project, selection.bindingId, this.now());
      await db.query('UPDATE source_bindings SET data=$2 WHERE id=$1', [selection.bindingId, source]);
      await db.query('UPDATE t3_enrollments SET revoked=true,consent=false,checkpoint=NULL WHERE binding_id=$1', [selection.bindingId]);
      await saveProject(db, project, this.now());
      await appendEvent(db, project, 'source_updated', selection.bindingId);
    });
  }
}
