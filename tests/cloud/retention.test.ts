import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { command, setup } from './helpers';
import { CheckInScheduler } from '../../apps/cloud/src/checkins/scheduler';
test('seven-day retention removes persisted excerpts and fences their generated dependencies', async () => {
    const h = await setup();
    try {
        const { projectId } = await h.create();
        const source = (await h.request('POST', `/v1/projects/${projectId}/sources`, command({ sourceKey: 'retention-synthetic', adapterId: 'synthetic', adapterVersion: '1', capability: 'history_only', exportPolicy: 'approved_excerpts' }, 0))).json().result;
        const now = new Date();
        const observation = { id: randomUUID(), bindingId: source.id, grantRevision: 0, sourceItemId: 'old', sourceRevision: '1', kind: 'assistant_report', occurredAt: now.toISOString(), observedAt: now.toISOString(), excerpt: 'SYNTHETIC_RETENTION_SECRET', metadata: { type: 'message', role: 'assistant' }, provenance: { adapterId: 'synthetic', adapterVersion: '1', mode: 'fixture', evidenceLevel: 'agent_reported' } };
        expect((await h.request('POST', `/v1/sources/${source.id}/observations`, command({ observations: [observation] }))).statusCode).toBe(200);
        await new CheckInScheduler(h.pool, () => new Date(now.getTime() + 8 * 86400000)).tick();
        expect(JSON.stringify((await h.pool.query('SELECT data FROM observations')).rows)).not.toContain('SYNTHETIC_RETENTION_SECRET');
    }
    finally {
        await h.close();
    }
});
