import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import * as c from '@living-playbooks/contracts';
import type { Principal } from '../auth/credentials';
import { transaction } from '../db/transaction';
import { appendEvent, lockProject, purgeExpiredEvidence } from '../domain/store';
import { eligibility, openStates } from './policy';
export async function scheduleSuggestion(db: PoolClient, project: c.Project, proposal: c.ManagerProposal, authority: Principal, now: Date, dependencies: string[] = []) {
    const suggestion = proposal.questionSuggestion;
    if (!suggestion)
        return;
    const owner = (await db.query('SELECT reminders FROM owners WHERE id=$1', [project.ownerId])).rows[0];
    if (!owner?.reminders || project.status !== 'active')
        return;
    if ((await db.query("SELECT id FROM checkins WHERE project_id=$1 AND data->>'state'=ANY($2::text[])", [project.id, openStates])).rowCount)
        return;
    if (Number((await db.query('SELECT count(*) FROM checkins WHERE project_id=$1', [project.id])).rows[0].count) >= 40)
        return;
    const task = project.tasks.find(t => t.id === suggestion.taskId);
    if (!task || task.revision !== suggestion.subjectRevision || ['done', 'skipped'].includes(task.status))
        return;
    const minimum = process.env.LP_DEMO_TIMING === 'true' ? 20000 : 300000;
    const requested = new Date(suggestion.dueAt).getTime();
    const dueAt = new Date(Math.max(now.getTime() + minimum, Math.min(requested, now.getTime() + 7 * 86400000))).toISOString();
    const q: c.CheckIn = { id: randomUUID(), projectId: project.id, taskId: task.id, revision: 0, subjectRevision: task.revision, question: suggestion.question, dueAt, expiresAt: new Date(new Date(dueAt).getTime() + 86400000).toISOString(), state: 'scheduled', presentationId: randomUUID(), answer: null };
    const refs = [...new Set([...dependencies, ...proposal.reply.observationIds, ...proposal.decisionSuggestions.flatMap(d => d.observationIds), ...proposal.taskChanges.flatMap(t => t.type === 'create' ? t.task.evidenceIds : t.evidenceIds)])];
    await db.query('INSERT INTO checkins(id,project_id,data,dependencies,authority) VALUES($1,$2,$3,$4,$5)', [q.id, project.id, q, JSON.stringify(refs), authority]);
}
export class CheckInScheduler {
    constructor(public pool: Pool, public now: () => Date = () => new Date()) { }
    async tick() {
        const expired = (await this.pool.query("SELECT DISTINCT p.id,p.owner_id FROM observations o JOIN projects p ON p.id=o.project_id WHERE NOT p.deleted AND o.data ? 'excerpt' AND o.received_at<=$1 LIMIT 100", [new Date(this.now().getTime() - 7 * 86400000)])).rows;
        for (const row of expired)
            await transaction(this.pool, async (db) => { await db.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [row.owner_id]); const project = await lockProject(db, row.id, row.owner_id); await purgeExpiredEvidence(db, project, this.now()); });
        const candidates = (await this.pool.query("SELECT c.id,c.project_id,p.owner_id FROM checkins c JOIN projects p ON p.id=c.project_id WHERE NOT p.deleted AND c.data->>'state'=ANY($1::text[]) ORDER BY c.data->>'dueAt' LIMIT 100", [openStates])).rows;
        for (const candidate of candidates)
            await transaction(this.pool, async (db) => {
                await db.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE', [candidate.owner_id]);
                const project = await lockProject(db, candidate.project_id, candidate.owner_id);
                const row = (await db.query('SELECT * FROM checkins WHERE id=$1 FOR UPDATE SKIP LOCKED', [candidate.id])).rows[0];
                if (!row)
                    return;
                const q = c.CheckInSchema.parse(row.data);
                if (!openStates.includes(q.state))
                    return;
                let permitted = await eligibility(db, project, q, row.dependencies, this.now());
                const auth = row.authority as Principal | null;
                if (!auth || !(await db.query('SELECT 1 FROM credentials WHERE id=$1 AND revoked_at IS NULL AND expires_at>$2', [auth.credentialId, this.now()])).rowCount)
                    permitted = 'cancelled';
                const old = q.state;
                if (permitted === 'cancelled' || permitted === 'expired')
                    q.state = permitted;
                else if (permitted === 'eligible' && ['scheduled', 'snoozed'].includes(q.state) && new Date(q.snoozedUntil ?? q.dueAt) <= this.now()) {
                    q.state = 'available';
                    await db.query('INSERT INTO checkin_presentations(presentation_id,checkin_id,owner_id,authorized_at) VALUES($1,$2,$3,$4) ON CONFLICT(presentation_id) DO NOTHING', [q.presentationId, q.id, project.ownerId, this.now()]);
                }
                if (q.state !== old) {
                    q.revision++;
                    await db.query('UPDATE checkins SET data=$2,available_at=CASE WHEN $3 THEN $4 ELSE available_at END WHERE id=$1', [q.id, q, q.state === 'available', this.now()]);
                    await appendEvent(db, project, 'checkin_updated', q.id);
                }
            });
    }
}
export function startCheckInDispatcher(scheduler: CheckInScheduler) {
    let active: Promise<void> | null = null;
    let stopped = false;
    const tick = () => { if (stopped || active)
        return; active = scheduler.tick().catch(() => { }).finally(() => { active = null; }); };
    const timer = setInterval(tick, 15000);
    tick();
    return async () => { stopped = true; clearInterval(timer); await active; };
}
