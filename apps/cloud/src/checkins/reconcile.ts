import type { PoolClient } from 'pg';
import * as c from '@living-playbooks/contracts';
import type { Principal } from '../auth/credentials';
import { eligibility, openStates } from './policy';

// Callers hold owner, then project locks. The same account lock covers policy and admission.
export async function reconcileCheckIns(db: PoolClient, project: c.Project, now: Date, activateDue: boolean): Promise<c.CheckIn[]> {
    const rows = (await db.query("SELECT * FROM checkins WHERE project_id=$1 AND data->>'state'=ANY($2::text[]) FOR UPDATE", [project.id, openStates])).rows;
    const changed: c.CheckIn[] = [];
    for (const row of rows) {
        const q = c.CheckInSchema.parse(row.data);
        let permitted = await eligibility(db, project, q, row.dependencies, now);
        const authority = row.authority as Principal | null;
        if (!authority || !(await db.query('SELECT 1 FROM credentials WHERE id=$1 AND revoked_at IS NULL AND expires_at>$2', [authority.credentialId, now])).rowCount)
            permitted = 'cancelled';
        const old = q.state;
        if (permitted === 'cancelled' || permitted === 'expired') q.state = permitted;
        else if (permitted === 'deferred' && ['available', 'presented'].includes(q.state)) q.state = 'scheduled';
        else if (activateDue && permitted === 'eligible' && ['scheduled', 'snoozed'].includes(q.state) && new Date(q.snoozedUntil ?? q.dueAt) <= now) {
            q.state = 'available';
            await db.query('INSERT INTO checkin_presentations(presentation_id,checkin_id,owner_id,authorized_at) VALUES($1,$2,$3,$4) ON CONFLICT(presentation_id) DO NOTHING', [q.presentationId, q.id, project.ownerId, now]);
        }
        if (q.state !== old) {
            q.revision++;
            await db.query('UPDATE checkins SET data=$2,available_at=CASE WHEN $3 THEN $4 ELSE available_at END WHERE id=$1', [q.id, q, q.state === 'available', now]);
            changed.push(q);
        }
    }
    return changed;
}
