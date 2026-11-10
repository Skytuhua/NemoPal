import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import * as c from '@living-playbooks/contracts';
import { reauthorize, type Principal } from '../auth/credentials';
import { transaction } from '../db/transaction';
import { DomainError } from '../domain/errors';
import { Store, appendEvent, lockProject, queueJob, snapshotData } from '../domain/store';
import { inQuietHours, type ReminderPreferences } from './policy';

const status = (row?: { enabled: boolean; interval_minutes: number; next_run_at: Date }) => ({
  enabled: row?.enabled ?? false, intervalMinutes: row?.interval_minutes ?? 30,
  nextRunAt: row ? new Date(row.next_run_at).toISOString() : null,
});

export async function scheduledReviewEnabled(db: PoolClient, projectId: string, authority: Principal) {
  return Boolean((await db.query("SELECT 1 FROM proactive_schedules WHERE project_id=$1 AND enabled AND authority->>'credentialId'=$2 AND authority->>'deviceId'=$3", [projectId, authority.credentialId, authority.deviceId])).rowCount);
}

export async function proactiveFingerprint(db: PoolClient, project: c.Project, now: Date) {
  const snapshot = await snapshotData(db, project, now);
  // Manager replies, model-owned task edits and timestamps are not new owner input.
  return createHash('sha256').update(c.canonicalJson({
    title: project.title, goal: project.goal, phase: project.phase, planState: project.planState, epoch: project.epoch, brief: snapshot.brief,
    ownerTasks: project.tasks.filter(t => t.ownerOverride),
    taskDetails: project.tasks.map(({ id, description, dueAt, checklist }) => ({ id, description: description ?? '', dueAt: dueAt ?? null, checklist: checklist ?? [] })),
    decisions: project.decisions.filter(d => d.origin === 'owner'),
    messages: snapshot.messages.filter(m => m.role === 'owner').map(({ id, text }) => ({ id, text })),
    documents: snapshot.documents, evidence: snapshot.observations, coding: snapshot.codexRequests ?? [],
    sources: snapshot.sourceBindings.map(({ id, state, exportPolicy, grantRevision }) => ({ id, state, exportPolicy, grantRevision })),
  })).digest('hex');
}

export class ProactiveReviews {
  constructor(public store: Store) {}
  async read(principal: Principal, projectId: string) {
    return transaction(this.store.pool, async db => {
      await reauthorize(db, principal, this.store.now());
      await lockProject(db, projectId, principal.ownerId);
      return status((await db.query('SELECT * FROM proactive_schedules WHERE project_id=$1', [projectId])).rows[0]);
    });
  }
  async configure(principal: Principal, path: string, projectId: string, envelope: c.CommandEnvelope<unknown>) {
    return this.store.command(principal, path, envelope, projectId, async (db, project) => {
      const input = c.ProactivityInputSchema.parse(envelope.input);
      const row = (await db.query('INSERT INTO proactive_schedules(project_id,owner_id,enabled,interval_minutes,next_run_at,authority) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id) DO UPDATE SET enabled=$3,interval_minutes=$4,next_run_at=$5,authority=$6 RETURNING *', [projectId, principal.ownerId, input.enabled, input.intervalMinutes, new Date(this.store.now().getTime() + input.intervalMinutes * 60000), principal])).rows[0];
      if (!input.enabled)
        await db.query("UPDATE jobs SET state='cancelled',generation=generation+1,lease_expires_at=NULL,data=data || jsonb_build_object('state','cancelled','leaseGeneration',generation+1,'leaseExpiresAt',NULL) WHERE project_id=$1 AND data->>'kind'='scheduled_review' AND state IN ('queued','running')", [projectId]);
      return { result: status(row), kind: 'project_updated', resourceId: project!.id };
    });
  }
  async tick() {
    if (!this.store.inference.available) return;
    const candidates = (await this.store.pool.query('SELECT s.* FROM proactive_schedules s JOIN projects p ON p.id=s.project_id WHERE s.enabled AND NOT p.deleted AND s.next_run_at<=$1 ORDER BY s.next_run_at,s.project_id LIMIT 100', [this.store.now()])).rows;
    for (const candidate of candidates) await transaction(this.store.pool, async db => {
      const now = this.store.now(), authority = candidate.authority as Principal;
      try { await reauthorize(db, authority, now); }
      catch (error) {
        if (!(error instanceof DomainError)) throw error;
        await db.query('UPDATE proactive_schedules SET enabled=false WHERE project_id=$1 AND authority=$2', [candidate.project_id, authority]);
        return;
      }
      const project = await lockProject(db, candidate.project_id, authority.ownerId);
      const schedule = (await db.query('SELECT * FROM proactive_schedules WHERE project_id=$1 FOR UPDATE', [project.id])).rows[0];
      if (!schedule?.enabled || new Date(schedule.next_run_at) > now) return;
      await db.query('UPDATE proactive_schedules SET next_run_at=$2 WHERE project_id=$1', [project.id, new Date(now.getTime() + schedule.interval_minutes * 60000)]);
      const prefs = (await db.query('SELECT * FROM owners WHERE id=$1', [project.ownerId])).rows[0] as ReminderPreferences;
      if (project.status !== 'active' || inQuietHours(now, prefs)) return;
      const attention = (await db.query('SELECT count(*) AS count,max(admitted_at) AS latest FROM proactive_review_runs WHERE owner_id=$1 AND admitted_at>$2', [project.ownerId, new Date(now.getTime() - 86400000)])).rows[0];
      if (Number(attention.count) >= Math.min(3, prefs.attention_limit) || attention.latest && new Date(attention.latest).getTime() + 3600000 > now.getTime()) return;
      if (!(await db.query('SELECT 1 FROM model_usage WHERE calls+$1<call_limit AND reserved_tokens<token_limit', [c.LIMITS.modelCalls])).rowCount) return;
      if ((await db.query("SELECT 1 FROM jobs WHERE project_id=$1 AND state IN ('queued','running') LIMIT 1", [project.id])).rowCount) return;
      const fingerprint = await proactiveFingerprint(db, project, now);
      if (fingerprint === schedule.last_fingerprint) {
        const latest = (await db.query("SELECT state FROM jobs WHERE project_id=$1 AND data->>'kind'='scheduled_review' ORDER BY run_after DESC,id DESC LIMIT 1", [project.id])).rows[0];
        if (latest?.state !== 'failed') return;
      }
      const jobId = await queueJob(db, project, 'scheduled_review', now, null, 0, schedule.authority);
      await db.query('INSERT INTO proactive_review_runs(job_id,owner_id,admitted_at) VALUES($1,$2,$3)', [jobId, project.ownerId, now]);
      await db.query('UPDATE proactive_schedules SET last_fingerprint=$2 WHERE project_id=$1', [project.id, fingerprint]);
      await appendEvent(db, project, 'job_updated', jobId);
    });
  }
}
