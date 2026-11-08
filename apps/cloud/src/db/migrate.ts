import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import { transaction } from './transaction';
export async function migrate(pool: Pool) {
    const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    await transaction(pool, async (db) => {
        await db.query('SELECT pg_advisory_xact_lock(7317501)');
        await db.query(sql);
    });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
        await migrate(pool);
        console.log('Cloud schema v1 migrated.');
    }
    catch {
        console.error('Migration failed; check configured database access.');
        process.exitCode = 1;
    }
    finally {
        await pool.end();
    }
}
