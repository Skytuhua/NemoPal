import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { migrate } from '../../apps/cloud/src/db/migrate';
import { issueGrant, redeem } from '../../apps/cloud/src/auth/credentials';
import { buildServer } from '../../apps/cloud/src/api/server';
import type { CommandEnvelope, RevisionedCommandEnvelope } from '@living-playbooks/contracts';
export function command<const T>(input: T, expectedRevision: number, operationId?: string): RevisionedCommandEnvelope<T>;
export function command<const T>(input: T, expectedRevision?: undefined, operationId?: string): CommandEnvelope<T>;
export function command<T>(input: T, expectedRevision?: number, operationId = randomUUID() as string): CommandEnvelope<T> { return { operationId, ...(expectedRevision === undefined ? {} : { expectedRevision }), input }; }
export async function setup() {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/playbooks_test' || url.username !== 'playbooks')
        throw new Error('Tests require the dedicated local playbooks_test database.');
    const pool = new Pool({ connectionString: url.href });
    await migrate(pool);
    // Confined to the explicitly supplied disposable database; no other databases/containers.
    await pool.query('TRUNCATE owners,credentials,projects,source_bindings,observations,messages,documents,jobs,checkins,command_receipts,events,model_usage,generated_dependencies RESTART IDENTITY CASCADE');
    const grant = await issueGrant(pool, { timezone: 'America/Chicago', reminders: true });
    const auth = await redeem(pool, grant.code);
    const app = buildServer(pool);
    const request = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, token = auth.token) => app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }), headers: { authorization: `Bearer ${token}` } });
    const create = async () => {
        const res = await request('POST', '/v1/projects', command({ title: 'Synthetic build', brief: 'Build a local synthetic demonstration.' }));
        if (res.statusCode !== 200)
            throw new Error(`Create failed: ${res.statusCode} ${res.body}`);
        const projectId = (await pool.query('SELECT id FROM projects')).rows[0].id as string;
        return { projectId, accepted: res.json() };
    };
    return { pool, app, request, create, auth, ownerId: grant.ownerId, close: async () => { await app.close(); await pool.end(); } };
}
