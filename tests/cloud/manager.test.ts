import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as c from '@living-playbooks/contracts';
import { BoundedRunner } from '@living-playbooks/nemotron';
import { setup } from './helpers';
let h: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { h = await setup(); });
afterEach(async () => { await h?.close(); });
export function proposal(job: c.ManagerJob, snapshot: c.ProjectSnapshot): c.ManagerProposal {
    return { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch, grantVersions: job.grantVersions, taskChanges: [], decisionSuggestions: [], workspace: snapshot.project.workspace, reply: { text: 'Scripted response; no live inference.', observationIds: [] } };
}
test('a scripted model selects a real scoped read tool and receives its stored result before final proposal', async () => {
    const { projectId } = await h.create();
    const snapshot = (await h.request('GET', `/v1/projects/${projectId}/snapshot`)).json() as c.ProjectSnapshot;
    const job = (await h.pool.query('SELECT data FROM jobs')).rows[0].data as c.ManagerJob;
    let turn = 0;
    const adapter: c.NemotronAdapter = { probe: async () => { throw new Error('no live probe'); }, next: async (input) => {
            if (turn++ === 0)
                return { type: 'tool_calls', calls: [{ id: 'read-1', name: 'read_project_state', arguments: {} }] };
            const tool = input.messages.at(-1)!;
            expect(tool.role).toBe('tool');
            expect(JSON.parse(tool.content).project.id).toBe(projectId);
            return { type: 'proposal', proposal: proposal(job, snapshot) };
        } };
    const result = await new BoundedRunner(adapter).run(job, { snapshot, grantVersions: [] }, new AbortController().signal);
    expect(result.reply.text).toContain('Scripted');
    expect(turn).toBe(2);
});
test('model tools cannot read a foreign document/evidence ID or perform source mutation', async () => {
    const { projectId } = await h.create();
    const snapshot = (await h.request('GET', `/v1/projects/${projectId}/snapshot`)).json();
    const job = (await h.pool.query('SELECT data FROM jobs')).rows[0].data;
    for (const call of [{ id: '1', name: 'read_evidence', arguments: { observationId: randomUUID() } }, { id: '1', name: 'read_project_document', arguments: { documentId: randomUUID() } }, { id: '1', name: 'revoke_source', arguments: {} }]) {
        const adapter = { next: async () => ({ type: 'tool_calls', calls: [call] }), probe: async () => { throw new Error('blocked'); } } as c.NemotronAdapter;
        await expect(new BoundedRunner(adapter).run(job, { snapshot, grantVersions: [] }, new AbortController().signal)).rejects.toThrow(/tool|scope|contract/);
    }
});
test('four model calls and six tools are hard limits, even when a model asks repeatedly', async () => {
    const { projectId } = await h.create();
    const snapshot = (await h.request('GET', `/v1/projects/${projectId}/snapshot`)).json();
    const job = (await h.pool.query('SELECT data FROM jobs')).rows[0].data;
    let calls = 0;
    const adapter: c.NemotronAdapter = { probe: async () => { throw new Error('blocked'); }, next: async () => { calls++; return { type: 'tool_calls', calls: [{ id: String(calls), name: 'read_project_state', arguments: {} }] }; } };
    await expect(new BoundedRunner(adapter).run(job, { snapshot, grantVersions: [] }, new AbortController().signal)).rejects.toThrow(/budget/);
    expect(calls).toBe(4);
});
