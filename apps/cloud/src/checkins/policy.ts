import type { PoolClient } from 'pg';
import type * as c from '@living-playbooks/contracts';
export type ReminderPreferences = {
    timezone: string;
    reminders: boolean;
    quiet_start: number;
    quiet_end: number;
    attention_limit: number;
};
export function inQuietHours(now: Date, p: ReminderPreferences) {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: p.timezone, hour: 'numeric', hourCycle: 'h23' }).format(now));
    if (p.quiet_start === p.quiet_end)
        return false;
    return p.quiet_start < p.quiet_end ? hour >= p.quiet_start && hour < p.quiet_end : hour >= p.quiet_start || hour < p.quiet_end;
}
export function nextEligibleTime(now: Date, p: ReminderPreferences) {
    if (!inQuietHours(now, p))
        return now;
    // Absolute minute stepping handles skipped/repeated local DST hours without inventing local timestamps.
    const start = Math.floor(now.getTime() / 60000) * 60000;
    for (let i = 1; i <= 48 * 60; i++) {
        const candidate = new Date(start + i * 60000);
        if (!inQuietHours(candidate, p))
            return candidate;
    }
    throw new Error('reminder_timezone');
}
export const openStates = ['scheduled', 'available', 'presented', 'snoozed'];
export async function eligibility(db: PoolClient, project: c.Project, q: c.CheckIn, dependencies: string[], now: Date): Promise<'eligible' | 'deferred' | 'cancelled' | 'expired'> {
    if (new Date(q.expiresAt) <= now)
        return 'expired';
    const task = project.tasks.find(t => t.id === q.taskId);
    if (!task || task.revision !== q.subjectRevision || ['done', 'skipped'].includes(task.status))
        return 'cancelled';
    const prefs = (await db.query('SELECT * FROM owners WHERE id=$1', [project.ownerId])).rows[0] as ReminderPreferences;
    if (!prefs?.reminders)
        return 'cancelled';
    if (project.status !== 'active')
        return 'deferred';
    if (dependencies.length) {
        const records = (await db.query("SELECT o.id FROM observations o JOIN source_bindings s ON s.id=o.binding_id WHERE o.project_id=$1 AND o.id=ANY($2::uuid[]) AND o.data IS NOT NULL AND s.data->>'state'='following' AND s.data->>'exportPolicy'<>'off' AND o.data->>'grantRevision'=s.data->>'grantRevision'", [project.id, dependencies])).rows;
        if (records.length !== new Set(dependencies).size)
            return 'cancelled';
    }
    if (inQuietHours(now, prefs))
        return 'deferred';
    const count = Number((await db.query('SELECT count(*) FROM checkin_presentations WHERE owner_id=$1 AND authorized_at>$2 AND presentation_id<>$3', [project.ownerId, new Date(now.getTime() - 86400000), q.presentationId])).rows[0].count);
    if (count >= prefs.attention_limit)
        return 'deferred';
    return 'eligible';
}
