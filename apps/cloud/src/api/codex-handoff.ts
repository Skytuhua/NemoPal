import type { Pool } from 'pg';
import * as c from '@living-playbooks/contracts';
import { reauthorize, type Principal } from '../auth/credentials';
import { transaction } from '../db/transaction';
import { appendEvent, lockProject } from '../domain/store';
import { reject } from '../domain/errors';

export async function claimCodexRequest(pool: Pool, principal: Principal, projectId: string, now: Date) {
  return transaction(pool, async db => {
    await reauthorize(db, principal, now);
    const project = await lockProject(db, projectId, principal.ownerId);
    if (project.status !== 'active') return null;
    const ids = project.tasks.filter(task => !['done', 'skipped'].includes(task.status)).map(task => task.id);
    const row = (await db.query("SELECT * FROM codex_requests WHERE project_id=$1 AND project_epoch=$2 AND task_id=ANY($3::uuid[]) AND state='pending' ORDER BY created_at,id LIMIT 1 FOR UPDATE", [projectId, project.epoch, ids])).rows[0];
    if (!row) return null;
    await db.query("UPDATE codex_requests SET state='claimed',device_id=$2 WHERE id=$1", [row.id, principal.deviceId]);
    await appendEvent(db, project, 'project_updated', projectId);
    return c.CodexRequestSchema.parse({ id: row.id, projectId, taskId: row.task_id, text: row.text, state: 'claimed', output: '' });
  });
}

export async function finishCodexRequest(pool: Pool, principal: Principal, projectId: string, requestId: string, result: c.CodexResult, now: Date) {
  return transaction(pool, async db => {
    await reauthorize(db, principal, now);
    const project = await lockProject(db, projectId, principal.ownerId);
    const row = (await db.query('SELECT * FROM codex_requests WHERE id=$1 AND project_id=$2 FOR UPDATE', [requestId, projectId])).rows[0];
    if (!row || row.device_id !== principal.deviceId) reject(404, 'not_found', 'Request is unavailable.');
    if (row.state !== 'claimed') {
      if (row.state === result.status && row.output === result.output) return;
      reject(409, 'request_finalized', 'Request outcome is already recorded.');
    }
    await db.query('UPDATE codex_requests SET state=$2,output=$3 WHERE id=$1', [requestId, result.status, result.output]);
    await appendEvent(db, project, 'project_updated', projectId);
  });
}
