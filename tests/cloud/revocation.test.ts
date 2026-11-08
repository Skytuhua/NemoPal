import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as c from '@living-playbooks/contracts';
import { JobQueue } from '../../apps/cloud/src/jobs/queue';
import { command, setup } from './helpers';
let h: Awaited<ReturnType<typeof setup>>;
let queue: JobQueue;
beforeEach(async () => { h = await setup(); queue = new JobQueue(h.pool, () => new Date(Date.now() + 1000)); });
afterEach(async () => { await h?.close(); });
async function evidence() {
    const { projectId } = await h.create();
    const source = (await h.request('POST', `/v1/projects/${projectId}/sources`, command({ sourceKey: 'synthetic-source', adapterId: 'synthetic', adapterVersion: '1', capability: 'incremental_history', exportPolicy: 'approved_excerpts' }, 0))).json().result as c.SourceBinding;
    const o: c.Observation = { id: randomUUID(), bindingId: source.id, grantRevision: 0, sourceItemId: '1', sourceRevision: '1', kind: 'assistant_report', occurredAt: new Date().toISOString(), observedAt: new Date().toISOString(), excerpt: 'SYNTHETIC_SOURCE_DERIVED_CONTENT', metadata: { type: 'message', role: 'assistant' }, provenance: { adapterId: 'synthetic', adapterVersion: '1', mode: 'fixture', evidenceLevel: 'agent_reported' } };
    await h.request('POST', `/v1/sources/${source.id}/observations`, command({ observations: [o] }));
    return { projectId, source, o };
}
test('revocation removes all generated dependencies even when model omits its own evidence citations', async () => {
    const { projectId, source, o } = await evidence();
    const job = (await queue.claim())!;
    const context = await queue.context(job);
    const taskId = randomUUID();
    const p: c.ManagerProposal = { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch, grantVersions: job.grantVersions, taskChanges: [{ type: 'create', task: { id: taskId, title: o.excerpt!, status: 'todo', requirementOrigin: 'model_suggestion', evidenceLevel: 'none', evidenceIds: [] } }], decisionSuggestions: [{ text: o.excerpt!, observationIds: [] }], workspace: { ...context.snapshot.project.workspace, panels: [{ id: randomUUID(), type: 'checklist', heading: o.excerpt!, taskIds: [taskId] }] }, questionSuggestion: { taskId, subjectRevision: 0, question: o.excerpt!, dueAt: new Date(Date.now() + 600000).toISOString() }, reply: { text: o.excerpt!, observationIds: [] } };
    await queue.commit(job, p);
    await h.request('POST', `/v1/sources/${source.id}/revoke`, command({ grantRevision: 0, removeExcerpts: true }));
    const snapshot = (await h.request('GET', `/v1/projects/${projectId}/snapshot`)).json();
    expect(c.ProjectSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain(o.excerpt);
});
test('revocation during an in-flight proposal rejects completion and revoked offline upload cannot restore content', async () => {
    const { projectId, source, o } = await evidence();
    const job = (await queue.claim())!;
    const context = await queue.context(job);
    await h.request('POST', `/v1/sources/${source.id}/revoke`, command({ grantRevision: 0, removeExcerpts: true }));
    const p: c.ManagerProposal = { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch, grantVersions: job.grantVersions, taskChanges: [], decisionSuggestions: [], workspace: context.snapshot.project.workspace, reply: { text: o.excerpt!, observationIds: [o.id] } };
    expect(await queue.commit(job, p)).toBe('superseded');
    expect((await h.request('POST', `/v1/sources/${source.id}/observations`, command({ observations: [o] }))).statusCode).toBe(409);
    expect(JSON.stringify((await h.request('GET', `/v1/projects/${projectId}/snapshot`)).json())).not.toContain(o.excerpt);
});
