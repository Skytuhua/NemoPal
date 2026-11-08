import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import * as c from '@living-playbooks/contracts';
import { transaction } from '../db/transaction';
import { authorize, reauthorize, type Principal } from '../auth/credentials';
import { reject, revision } from './errors';
import { reconcileCheckIns } from '../checkins/reconcile';
export async function lockProject(db: PoolClient, id: string, ownerId: string): Promise<c.Project> {
    const row = (await db.query('SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, ownerId])).rows[0];
    if (!row || row.deleted)
        reject(404, 'not_found', 'Project is unavailable.');
    return c.ProjectSchema.parse(row.data);
}
export async function saveProject(db: PoolClient, project: c.Project, now: Date) {
    project.revision++;
    project.updatedAt = now.toISOString();
    c.ProjectSchema.parse(project);
    await db.query('UPDATE projects SET data=$2,revision=$3,epoch=$4 WHERE id=$1', [project.id, project, project.revision, project.epoch]);
}
export async function appendEvent(db: PoolClient, project: c.Project, kind: c.ProjectEvent['kind'], resourceId: string) {
    const event = { projectId: project.id, kind, resourceId, revision: project.revision };
    const row = (await db.query('INSERT INTO events(owner_id,project_id,data) VALUES($1,$2,$3) RETURNING seq', [project.ownerId, project.id, event])).rows[0];
    return Number(row.seq);
}
export async function queueJob(db: PoolClient, project: c.Project, kind: c.ManagerJob['kind'], now: Date, inputMessageId: string | null = null, staleCount = 0, authority?: Principal) {
    if (kind === 'reflection') {
        const existing = (await db.query("SELECT id FROM jobs WHERE project_id=$1 AND state IN ('queued','running') AND data->>'kind'='reflection' LIMIT 1", [project.id])).rows[0];
        if (existing)
            return existing.id as string;
    }
    const id = randomUUID();
    const job: c.ManagerJob = { id, projectId: project.id, kind, baseProjectRevision: project.revision, projectEpoch: project.epoch, grantVersions: [], state: 'queued', leaseGeneration: 0, tries: 0, runAfter: new Date(now.getTime() + (kind === 'reflection' ? c.LIMITS.coalesceMs : 0)).toISOString(), leaseExpiresAt: null, inputMessageId, modelCalls: 0, toolCalls: 0, errorClass: null };
    await db.query('INSERT INTO jobs(id,project_id,data,state,run_after,stale_count,authority) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, project.id, job, job.state, job.runAfter, staleCount, authority ?? null]);
    return id;
}
export type Mutation<T> = {
    result: T;
    kind: c.ProjectEvent['kind'];
    resourceId: string;
    acceptedJob?: string;
};
export class Store {
    constructor(public pool: Pool, public now: () => Date = () => new Date()) { }
    inference: c.ProjectSnapshot['connection']['inference'] = { available: false, reason: 'Live Nemotron capability gate has not passed.' };
    async command<T>(principal: Principal, path: string, envelope: c.CommandEnvelope<unknown>, projectId: string | null, mutate: (db: PoolClient, project: c.Project | null) => Promise<Mutation<T>>) {
        const hash = await c.hashCommand(path, envelope);
        return transaction(this.pool, async (db) => {
            await reauthorize(db, principal, this.now());
            let project: c.Project | null = null;
            if (projectId) {
                const row = (await db.query('SELECT * FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE', [projectId, principal.ownerId])).rows[0];
                if (!row)
                    reject(404, 'not_found', 'Project is unavailable.');
                if (!row.deleted)
                    project = c.ProjectSchema.parse(row.data);
            }
            const old = (await db.query('SELECT * FROM command_receipts WHERE actor_id=$1 AND operation_id=$2', [principal.deviceId, envelope.operationId])).rows[0];
            if (old) {
                if (old.request_hash !== hash)
                    reject(409, 'operation_conflict', 'Operation ID was already used with different arguments.');
                if (!old.response)
                    reject(409, 'receipt_unavailable', 'Content was withdrawn; this operation cannot be replayed.');
                return old.response;
            }
            if (projectId && !project)
                reject(404, 'not_found', 'Project is unavailable.');
            const changed = await mutate(db, project);
            if (!project) {
                const row = (await db.query('SELECT data FROM projects WHERE id=$1', [changed.resourceId])).rows[0];
                project = c.ProjectSchema.parse(row.data);
                projectId = project.id;
            }
            const seq = await appendEvent(db, project, changed.kind, changed.resourceId);
            const receipt: c.CommandReceipt<T> = { operationId: envelope.operationId, requestHash: hash, status: changed.acceptedJob ? 'accepted' : 'completed', result: changed.result, projectRevision: project.revision, eventSequence: seq };
            const response = changed.acceptedJob ? { receipt, jobId: changed.acceptedJob, state: 'queued' } : receipt;
            await db.query('INSERT INTO command_receipts(actor_id,operation_id,project_id,request_hash,response) VALUES($1,$2,$3,$4,$5)', [principal.deviceId, envelope.operationId, projectId, hash, response]);
            return response;
        });
    }
    async createProject(p: Principal, path: string, e: c.CommandEnvelope<c.CreateProjectInput>) {
        return this.command(p, path, e, null, async (db) => {
            const count = Number((await db.query('SELECT count(*) FROM projects WHERE owner_id=$1 AND NOT deleted', [p.ownerId])).rows[0].count);
            if (count >= 20)
                reject(429, 'project_limit', 'Project limit reached.');
            const id = randomUUID();
            const project: c.Project = { id, ownerId: p.ownerId, title: e.input.title, goal: e.input.brief, revision: 0, epoch: 0, planState: 'proposed', phase: 'planning', status: 'active', manager: { id: randomUUID(), projectId: id, displayName: 'Project manager', petPackId: 'baseline', promptVersion: '1' }, tasks: [], decisions: [], workspace: { schemaVersion: 1, id: randomUUID(), revision: 0, panels: [] }, updatedAt: this.now().toISOString() };
            await db.query('INSERT INTO projects(id,owner_id,data,revision,epoch) VALUES($1,$2,$3,0,0)', [id, p.ownerId, project]);
            const job = await queueJob(db, project, 'initial_plan', this.now(), null, 0, p);
            return { result: null, kind: 'project_updated', resourceId: id, acceptedJob: job };
        });
    }
    async action(p: Principal, path: string, id: string, e: c.RevisionedCommandEnvelope<c.OwnerAction>) {
        return this.command(p, path, e, id, async (db, project) => {
            const x = project!;
            revision(x.revision, e.expectedRevision);
            const input = e.input;
            if (input.type === 'accept_plan')
                x.planState = 'accepted';
            if (input.type === 'update_task') {
                const task = x.tasks.find(t => t.id === input.taskId);
                if (!task)
                    reject(404, 'not_found', 'Task is unavailable.');
                task.status = input.status;
                if (input.title) {
                    task.title = input.title;
                    await db.query("DELETE FROM generated_dependencies WHERE project_id=$1 AND resource_id=$2 AND kind='task_title'", [id, task.id]);
                }
                task.revision++;
                task.ownerOverride = true;
                if (task.status === 'done') {
                    task.evidenceLevel = 'user_reported';
                    task.evidenceIds = [];
                }
                x.decisions.push({ id: randomUUID(), text: `Owner updated task ${task.id} to ${task.status}.`, origin: 'owner', createdAt: this.now().toISOString(), observationIds: [] });
            }
            if (input.type === 'update_task_details') {
                const task = x.tasks.find(t => t.id === input.taskId);
                if (!task)
                    reject(404, 'not_found', 'Task is unavailable.');
                revision(task.revision, input.expectedTaskRevision);
                if (input.description !== undefined)
                    task.description = input.description;
                if (input.dueAt === null)
                    delete task.dueAt;
                else if (input.dueAt !== undefined)
                    task.dueAt = input.dueAt;
                if (input.checklist !== undefined)
                    task.checklist = input.checklist;
                task.revision++;
            }
            if (input.type === 'record_decision')
                x.decisions.push({ id: randomUUID(), text: input.text, origin: 'owner', createdAt: this.now().toISOString(), observationIds: [] });
            if (input.type === 'set_project_status') {
                x.status = input.status;
                x.epoch++;
            }
            if (input.type === 'set_project_phase')
                x.phase = input.phase;
            await saveProject(db, x, this.now());
            return { result: x, kind: 'project_updated', resourceId: id };
        });
    }
    async message(p: Principal, path: string, id: string, e: c.RevisionedCommandEnvelope<c.MessageInput>) {
        return this.command(p, path, e, id, async (db, project) => {
            const x = project!;
            revision(x.revision, e.expectedRevision);
            if (x.status !== 'active')
                reject(409, 'project_paused', 'Resume this project before requesting inference.');
            const message: c.ChatMessage = { id: randomUUID(), projectId: id, role: 'owner', text: e.input.text, createdAt: this.now().toISOString(), observationIds: [], operationId: e.operationId };
            await saveProject(db, x, this.now());
            const job = await queueJob(db, x, 'owner_message', this.now(), message.id, 0, p);
            message.jobId = job;
            await db.query('INSERT INTO messages(id,project_id,data) VALUES($1,$2,$3)', [message.id, id, message]);
            return { result: null, kind: 'message_added', resourceId: message.id, acceptedJob: job };
        });
    }
    async document(p: Principal, path: string, id: string, documentId: string, e: c.RevisionedCommandEnvelope<c.DocumentInput>) {
        return this.command(p, path, e, id, async (db, project) => {
            const old = (await db.query('SELECT data FROM documents WHERE project_id=$1 AND id=$2', [id, documentId])).rows[0]?.data as c.DocumentDraft | undefined;
            revision(old?.revision ?? 0, e.expectedRevision);
            if (!old && Number((await db.query('SELECT count(*) FROM documents WHERE project_id=$1', [id])).rows[0].count) >= 40)
                reject(429, 'document_limit', 'Document limit reached.');
            const document: c.DocumentDraft = { projectId: id, id: documentId, revision: (old?.revision ?? 0) + 1, text: e.input.text, updatedBy: 'owner' };
            await db.query('INSERT INTO documents(id,project_id,data) VALUES($1,$2,$3) ON CONFLICT(project_id,id) DO UPDATE SET data=excluded.data', [documentId, id, document]);
            await saveProject(db, project!, this.now());
            return { result: document, kind: 'document_updated', resourceId: documentId };
        });
    }
    async enroll(p: Principal, path: string, id: string, e: c.RevisionedCommandEnvelope<c.EnrollSourceInput>) {
        return this.command(p, path, e, id, async (db, project) => {
            revision(project!.revision, e.expectedRevision);
            if (Number((await db.query('SELECT count(*) FROM source_bindings WHERE project_id=$1', [id])).rows[0].count) >= 10)
                reject(429, 'source_limit', 'Source limit reached.');
            if (/[\\/]|^[A-Za-z]:/.test(e.input.sourceKey))
                reject(422, 'source_identity', 'Use an opaque source identity.');
            const source: c.SourceBinding = { id: randomUUID(), projectId: id, deviceId: p.deviceId, ...e.input, grantRevision: 0, state: e.input.exportPolicy === 'off' ? 'awaiting_consent' : 'following', lastObservedAt: null };
            await db.query('INSERT INTO source_bindings(id,project_id,data) VALUES($1,$2,$3)', [source.id, id, source]);
            project!.epoch++;
            await saveProject(db, project!, this.now());
            return { result: source, kind: 'source_updated', resourceId: source.id };
        });
    }
    async sourceProject(p: Principal, id: string, deviceOnly = false) {
        const row = (await this.pool.query('SELECT s.data,p.owner_id,p.deleted FROM source_bindings s JOIN projects p ON p.id=s.project_id WHERE s.id=$1', [id])).rows[0];
        if (!row || row.deleted)
            reject(404, 'not_found', 'Source is unavailable.');
        const source = c.SourceBindingSchema.parse(row.data);
        authorize(p, 'source', { ownerId: row.owner_id, ...(deviceOnly ? { deviceId: source.deviceId } : {}) });
        return source.projectId;
    }
    async sourceCommand(p: Principal, path: string, id: string, e: c.CommandEnvelope<c.SourceStateInput | c.RevokeSourceInput | c.SourceHealthInput | c.IngestObservationsInput>, mode: 'state' | 'revoke' | 'health' | 'observations') {
        const projectId = await this.sourceProject(p, id, mode === 'health' || mode === 'observations');
        return this.command<c.IngestionResult | c.SourceBinding>(p, path, e, projectId, async (db, project) => {
            const source = c.SourceBindingSchema.parse((await db.query('SELECT data FROM source_bindings WHERE id=$1 FOR UPDATE', [id])).rows[0].data);
            const x = project!;
            if (source.state === 'revoked')
                reject(409, 'source_revoked', 'Source grant was revoked.');
            if (mode === 'observations') {
                const input = e.input as c.IngestObservationsInput;
                if(new Set(input.observations.map(observation=>observation.id)).size!==input.observations.length)
                    reject(422,'duplicate_observation','Each observation ID must occur once per batch.');
                if (source.state !== 'following' || source.exportPolicy === 'off' || x.status !== 'active')
                    reject(409, 'source_unavailable', 'Source export is not currently permitted.');
                const acceptedIds: string[] = [];
                const duplicateIds: string[] = [];
                for (const observation of input.observations) {
                    revision(source.grantRevision, observation.grantRevision);
                    if (observation.bindingId !== id || observation.provenance.adapterId !== source.adapterId || observation.provenance.adapterVersion !== source.adapterVersion)
                        reject(422, 'observation_scope', 'Observation provenance does not match the grant.');
                    if (observation.excerpt !== undefined && source.exportPolicy !== 'approved_excerpts')
                        reject(403, 'excerpt_denied', 'Excerpt export requires explicit consent.');
                    const old = (await db.query('SELECT id,data FROM observations WHERE binding_id=$1 AND source_item=$2 AND source_revision=$3', [id, observation.sourceItemId, observation.sourceRevision])).rows[0];
                    if (old) {
                        duplicateIds.push(observation.id);
                        continue;
                    }
                    if ((await db.query('SELECT 1 FROM observations WHERE id=$1', [observation.id])).rowCount)
                        reject(409, 'observation_identity', 'Observation identity already exists.');
                    if (Number((await db.query('SELECT count(*) FROM observations WHERE project_id=$1 AND data IS NOT NULL', [projectId])).rows[0].count) >= 100)
                        reject(429, 'evidence_limit', 'Evidence retention limit reached.');
                    const stored = { ...observation };
                    if (stored.excerpt !== undefined && new Date(stored.observedAt).getTime() < this.now().getTime() - 7 * 86400000)
                        delete stored.excerpt;
                    await db.query('INSERT INTO observations(id,project_id,binding_id,source_item,source_revision,data,received_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [observation.id, projectId, id, observation.sourceItemId, observation.sourceRevision, stored, this.now()]);
                    acceptedIds.push(observation.id);
                }
                const meaningful = input.observations.some(o => acceptedIds.includes(o.id) && o.kind !== 'activity');
                if (acceptedIds.length) {
                    await saveProject(db, x, this.now());
                    if (meaningful)
                        await queueJob(db, x, 'reflection', this.now(), null, 0, p);
                }
                return { result: { acceptedIds, duplicateIds }, kind: 'observations_added', resourceId: id };
            }
            const input = e.input as c.SourceStateInput | c.SourceHealthInput | c.RevokeSourceInput;
            revision(source.grantRevision, input.grantRevision);
            if (mode === 'revoke') {
                source.grantRevision++;
                source.state = 'revoked';
                source.exportPolicy = 'off';
                x.epoch++;
                await withdrawEvidence(db, x, id, this.now());
            }
            else if (mode === 'state') {
                source.state = (input as c.SourceStateInput).state;
                x.epoch++;
            }
            else {
                const health = input as c.SourceHealthInput;
                if (health.state === 'revoked' || health.state === 'following' && (source.state === 'paused' || source.exportPolicy === 'off' || !['following','stale','blocked'].includes(source.state)))
                    reject(409, 'health_authority', 'Health cannot change source permission.');
                if(health.state==='following'){
                    if(health.errorClass!==null||health.capability==='unavailable')
                        reject(422,'health_inconsistent','Healthy recovery requires an available source with no error.');
                    source.state='following';
                }
                source.capability = health.capability;
                source.lastObservedAt = health.lastObservedAt;
                if (source.state !== 'paused' && ['blocked', 'stale'].includes(health.state))
                    source.state = health.state;
            }
            await db.query('UPDATE source_bindings SET data=$2 WHERE id=$1', [id, source]);
            if (mode !== 'health')
                await saveProject(db, x, this.now());
            return { result: source, kind: 'source_updated', resourceId: id };
        });
    }
    async delete(p: Principal, path: string, id: string, e: c.RevisionedCommandEnvelope<Record<string, never>>) {
        return this.command(p, path, e, id, async (db, project) => {
            const x = project!;
            revision(x.revision, e.expectedRevision);
            x.epoch++;
            x.revision++;
            await db.query("UPDATE jobs SET state='cancelled',generation=generation+1,lease_expires_at=NULL,data=jsonb_build_object('id',id,'projectId',project_id,'state','cancelled') WHERE project_id=$1", [id]);
            for (const table of ['generated_dependencies', 'checkins', 'messages', 'documents', 'observations', 'source_bindings'])
                await db.query(`DELETE FROM ${table} WHERE project_id=$1`, [id]);
            await db.query('UPDATE command_receipts SET response=NULL WHERE project_id=$1', [id]);
            await db.query('UPDATE projects SET data=NULL,deleted=true,epoch=$2,revision=$3 WHERE id=$1', [id, x.epoch, x.revision]);
            return { result: null, kind: 'project_deleted', resourceId: id };
        });
    }
    async cancelJob(p: Principal, path: string, id: string, e: c.CommandEnvelope<Record<string, never>>) {
        const row = (await this.pool.query('SELECT project_id FROM jobs WHERE id=$1', [id])).rows[0];
        if (!row)
            reject(404, 'not_found', 'Job is unavailable.');
        return this.command(p, path, e, row.project_id, async (db) => {
            await db.query("UPDATE jobs SET state='cancelled',generation=generation+1,lease_expires_at=NULL,data=data || jsonb_build_object('state','cancelled','leaseGeneration',generation+1,'leaseExpiresAt',NULL) WHERE id=$1", [id]);
            return { result: null, kind: 'job_updated', resourceId: id };
        });
    }
    async snapshot(p: Principal, id: string): Promise<c.ProjectSnapshot> {
        return transaction(this.pool, async (db) => {
            await reauthorize(db, p, this.now());
            const project = await lockProject(db, id, p.ownerId);
            await purgeExpiredEvidence(db, project, this.now());
            const snapshot = await snapshotData(db, project, this.now());
            snapshot.connection.inference = this.inference;
            return snapshot;
        });
    }
    async list(p: Principal) {
        return transaction(this.pool, async (db) => {
            await reauthorize(db, p, this.now());
            const rows = (await db.query('SELECT data FROM projects WHERE owner_id=$1 AND NOT deleted ORDER BY id LIMIT 1000', [p.ownerId])).rows;
            const results: c.ProjectSummary[] = [];
            for (const row of rows) {
                const x = c.ProjectSchema.parse(row.data);
                const unread = Number((await db.query("SELECT count(*) FROM checkins WHERE project_id=$1 AND data->>'state' IN ('available','presented')", [x.id])).rows[0].count);
                results.push({ id: x.id, title: x.title, goal: x.goal, revision: x.revision, status: x.status, phase: x.phase, planState: x.planState, managerName: x.manager.displayName, petPackId: x.manager.petPackId, unreadCheckIns: unread, updatedAt: x.updatedAt });
            }
            return results;
        });
    }
}
export async function snapshotData(db: PoolClient, project: c.Project, now: Date): Promise<c.ProjectSnapshot> {
    for(const q of await reconcileCheckIns(db,project,now,false))
        await appendEvent(db,project,'checkin_updated',q.id);
    const id = project.id;
    const load = async (table: string, max: number) => (await db.query(`SELECT data FROM ${table} WHERE project_id=$1 ${table === 'observations' ? 'AND data IS NOT NULL' : ''} ORDER BY ${table === 'messages' ? "data->>'createdAt' DESC" : 'id'} LIMIT $2`, [id, max])).rows.map(r => r.data);
    const sourceBindings = await load('source_bindings', 10) as c.SourceBinding[];
    const observations = await load('observations', 100) as c.Observation[];
    for (const o of observations)
        if (o.excerpt !== undefined && new Date(o.observedAt).getTime() < now.getTime() - 7 * 86400000)
            delete o.excerpt;
    const seq = Number((await db.query('SELECT coalesce(max(seq),0) AS seq FROM events WHERE owner_id=$1', [project.ownerId])).rows[0].seq);
    return c.ProjectSnapshotSchema.parse({ project, brief: project.goal, documents: await load('documents', 40), messages: (await load('messages', 200)).reverse(), sourceBindings, observations, checkIns: await load('checkins', 40), eventSequence: seq, connection: { mode: 'live', inference: { available: false, reason: 'Live Nemotron capability gate has not passed.' }, sync: 'current', demoTiming: process.env.LP_DEMO_TIMING === 'true' } });
}
export async function withdrawEvidence(db: PoolClient, project: c.Project, bindingId: string, now: Date) {
    const ids = new Set<string>((await db.query('SELECT id FROM observations WHERE binding_id=$1', [bindingId])).rows.map(r => r.id));
    await withdrawObservations(db, project, ids, false);
    void now;
}
export async function purgeExpiredEvidence(db: PoolClient, project: c.Project, now: Date) {
    const ids = new Set<string>((await db.query("SELECT id FROM observations WHERE project_id=$1 AND data ? 'excerpt' AND received_at<=$2", [project.id, new Date(now.getTime() - 7 * 86400000)])).rows.map(r => r.id));
    if (!ids.size)
        return;
    await withdrawObservations(db, project, ids, true);
    project.epoch++;
    await saveProject(db, project, now);
    await appendEvent(db, project, 'observations_added', project.id);
}
async function withdrawObservations(db: PoolClient, project: c.Project, ids: Set<string>, redactOnly: boolean) {
    const affected = (refs: string[]) => refs.some(ref => ids.has(ref));
    const dependencies = (await db.query('SELECT resource_id,kind FROM generated_dependencies WHERE project_id=$1 AND observation_id=ANY($2::uuid[])', [project.id, [...ids]])).rows;
    const derived = (resourceId: string, kind: string) => dependencies.some(d => d.resource_id === resourceId && d.kind === kind);
    for (const task of project.tasks) {
        const title = derived(task.id, 'task_title');
        const evidence = affected(task.evidenceIds) || derived(task.id, 'task');
        if (title)
            task.title = 'Source-derived task requires owner review.';
        if (evidence) {
            task.evidenceIds = [];
            if (!task.ownerOverride) {
                task.evidenceLevel = 'none';
                task.status = 'blocked';
            }
        }
        if (title || evidence)
            task.revision++;
    }
    for (const decision of project.decisions)
        if (affected(decision.observationIds)) {
            decision.text = 'Source-derived decision withdrawn.';
            decision.observationIds = [];
        }
    project.workspace.panels = project.workspace.panels.filter(panel => !('observationIds' in panel && affected(panel.observationIds)));
    if (derived(project.workspace.id, 'workspace')) {
        project.workspace.panels = [];
        project.workspace.revision++;
    }
    const rows = (await db.query('SELECT id,data FROM messages WHERE project_id=$1', [project.id])).rows;
    for (const row of rows) {
        const message = c.ChatMessageSchema.parse(row.data);
        if (affected(message.observationIds)) {
            message.text = 'Source-derived reply withdrawn.';
            message.observationIds = [];
            await db.query('UPDATE messages SET data=$2 WHERE id=$1', [row.id, message]);
        }
    }
    const questions = (await db.query('SELECT id,data,dependencies FROM checkins WHERE project_id=$1', [project.id])).rows;
    for (const row of questions)
        if (affected(row.dependencies)) {
            const q = c.CheckInSchema.parse(row.data);
            q.question = 'Source-derived question withdrawn.';
            if (q.state !== 'answered')
                q.state = 'cancelled';
            q.revision++;
            await db.query('UPDATE checkins SET data=$2,dependencies=$3 WHERE id=$1', [row.id, q, []]);
        }
    await db.query('DELETE FROM generated_dependencies WHERE project_id=$1 AND observation_id=ANY($2::uuid[])', [project.id, [...ids]]);
    await db.query(redactOnly ? "UPDATE observations SET data=data - 'excerpt' WHERE id=ANY($1::uuid[])" : 'UPDATE observations SET data=NULL WHERE id=ANY($1::uuid[])', [[...ids]]);
    await db.query('UPDATE command_receipts SET response=NULL WHERE project_id=$1', [project.id]);
    // Purge stored inputs from jobs as well; grant/epoch checks fence any in-flight completion.
    await db.query("UPDATE jobs SET tool_receipts='[]' WHERE project_id=$1", [project.id]);
    await db.query("UPDATE jobs SET state='cancelled',generation=generation+1,data=data || jsonb_build_object('state','cancelled','leaseGeneration',generation+1) WHERE project_id=$1 AND state='queued' AND data->>'kind'='reflection'", [project.id]);
}
