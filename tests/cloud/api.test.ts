import { expect, test } from 'vitest';
import { Pool } from 'pg';
import { buildServer } from '../../apps/cloud/src/api/server';
test('project API rejects unauthenticated requests before exposing project data', async () => {
    const pool = new Pool();
    const app = buildServer(pool);
    const response = await app.inject({ method: 'GET', url: '/v1/projects' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'unauthorized', retryable: false });
    await app.close();
    await pool.end();
});
