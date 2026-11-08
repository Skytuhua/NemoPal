import type { Pool } from 'pg';

export class Blocked extends Error {}

export async function bounded<T>(operation: Promise<T>, milliseconds = 10000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Bound exceeded')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function assertSchedulerIsolation(pool: Pick<Pool, 'query'>, ownerId: string) {
  // Reject any foreign excerpt, including one that could expire during this bounded journey.
  const result = await pool.query<{ blocked: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM projects p WHERE p.owner_id<>$1 AND NOT p.deleted AND (
      EXISTS (SELECT 1 FROM checkins c WHERE c.project_id=p.id AND c.data->>'state' IN ('scheduled','available','presented','snoozed'))
      OR EXISTS (SELECT 1 FROM observations o WHERE o.project_id=p.id AND o.data ? 'excerpt')
    )
  ) AS blocked`, [ownerId]);
  if (result.rows.length !== 1 || result.rows[0]?.blocked !== false)
    throw new Blocked('Foreign scheduler inputs must remain untouched');
}
