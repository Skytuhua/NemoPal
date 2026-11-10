import type { Pool, PoolClient } from 'pg';

// Every mutating T3 transaction locks this project before writing. After a lost
// commit/rollback acknowledgement, a new lock cannot be acquired until the
// old backend transaction has resolved. Failed reconciliation remains pending.
async function reconcile(pool: Pool, projectId: string): Promise<void> {
  let db: PoolClient | undefined;
  try {
    db = await pool.connect();
    await db.query('BEGIN');
    await db.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE', [projectId]);
    await db.query('ROLLBACK');
    db.release();
  } catch {
    db?.release(true);
    await new Promise<never>(() => {});
  }
}

export async function t3Transaction<T>(pool: Pool, projectId: string, work: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  let began = false;
  let committing = false;
  try {
    await db.query('BEGIN'); began = true;
    const result = await work(db);
    committing = true;
    await db.query('COMMIT');
    db.release();
    return result;
  } catch (error) {
    let uncertain = committing;
    if (began && !committing) {
      try { await db.query('ROLLBACK'); } catch { uncertain = true; }
    }
    db.release(uncertain || !began);
    if (uncertain) await reconcile(pool, projectId);
    throw error;
  }
}
