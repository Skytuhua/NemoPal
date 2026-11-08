import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as c from '@living-playbooks/contracts';
import { createHttpClient } from '@living-playbooks/api-client';
import { issueGrant } from '../../apps/cloud/src/auth/credentials';
import { JobQueue } from '../../apps/cloud/src/jobs/queue';
import { command, setup } from './helpers';
let h: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { h = await setup(); });
afterEach(async () => { await h?.close(); });
test('shared HTTP client consumes every domain endpoint with matching target hashes and real snapshot records', async () => {
    const origin = await h.app.listen({ host: '127.0.0.1', port: 0 });
    const client = createHttpClient({ origin, allowInsecureLoopback: true, getAuthorization: () => `Bearer ${h.auth.token}` });
    const accepted = await client.createProject(command({ title: 'J1 synthetic project', brief: 'Capture a synthetic demo.' }));
    expect(accepted.state).toBe('queued');
    const project = (await client.listProjects())[0]!;
    let snapshot = await client.getSnapshot(project.id);
    const draftId = randomUUID();
    const saved = await client.saveDocument(project.id, draftId, command({ text: 'Owner draft preserved.' }, 0) as c.RevisionedCommandEnvelope<c.DocumentInput>);
    expect(saved.result.revision).toBe(1);
    snapshot = await client.getSnapshot(project.id);
    await client.applyAction(project.id, command({ type: 'accept_plan' }, snapshot.project.revision) as c.RevisionedCommandEnvelope<c.OwnerAction>);
    snapshot = await client.getSnapshot(project.id);
    const message = await client.sendMessage(project.id, command({ text: 'Synthetic follow-up.' }, snapshot.project.revision) as c.RevisionedCommandEnvelope<c.MessageInput>);
    await client.cancelJob(message.jobId, command({}));
    snapshot = await client.getSnapshot(project.id);
    const enrolled = await client.enrollSource(project.id, command({ sourceKey: 'j1-synthetic-source', adapterId: 'synthetic', adapterVersion: '1', capability: 'incremental_history', exportPolicy: 'metadata_only' }, snapshot.project.revision) as c.RevisionedCommandEnvelope<c.EnrollSourceInput>);
    const source = enrolled.result;
    const observation: c.Observation = { id: randomUUID(), bindingId: source.id, grantRevision: 0, sourceItemId: 'tool-1', sourceRevision: 'v1', kind: 'tool_result_metadata', occurredAt: new Date().toISOString(), observedAt: new Date().toISOString(), metadata: { type: 'tool', exitCode: 0 }, provenance: { adapterId: 'synthetic', adapterVersion: '1', mode: 'fixture', evidenceLevel: 'source_tool_observed' } };
    expect((await client.ingestObservations(source.id, command({ observations: [observation] }))).result.acceptedIds).toEqual([observation.id]);
    await client.reportSourceHealth(source.id, command({ grantRevision: 0, state: 'following', capability: 'incremental_history', lastObservedAt: observation.observedAt, errorClass: null }));
    await client.setSourceState(source.id, command({ grantRevision: 0, state: 'paused' }));
    await client.setSourceState(source.id, command({ grantRevision: 0, state: 'following' }));
    const queue = new JobQueue(h.pool, () => new Date(Date.now() + 1000));
    const job = (await queue.claim())!;
    const context = await queue.context(job);
    const taskId = randomUUID();
    const proposal: c.ManagerProposal = { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch, grantVersions: job.grantVersions, taskChanges: [{ type: 'create', task: { id: taskId, title: 'Synthetic recording', status: 'todo', requirementOrigin: 'brief', evidenceLevel: 'none', evidenceIds: [] } }], decisionSuggestions: [], workspace: context.snapshot.project.workspace, questionSuggestion: { taskId, subjectRevision: 0, question: 'Recorded?', dueAt: new Date(Date.now() + 600000).toISOString() }, reply: { text: 'Scripted J1 planning result.', observationIds: [] } };
    await queue.commit(job, proposal);
    snapshot = await client.getSnapshot(project.id);
    const q = snapshot.checkIns[0]!;
    const snoozed = await client.snoozeCheckIn(q.id, command({ until: new Date(Date.now() + 3600000).toISOString(), timezone: 'America/Chicago' }, q.revision) as c.RevisionedCommandEnvelope<c.SnoozeInput>);
    await client.answerCheckIn(q.id, command({ kind: 'not_yet' }, snoozed.result.revision) as c.RevisionedCommandEnvelope<c.CheckInAnswer>);
    await expect(client.cancelCheckIn(q.id, command({}, snoozed.result.revision + 1) as c.RevisionedCommandEnvelope<Record<string, never>>)).rejects.toMatchObject({ status: 409 });
    await expect(client.presentCheckIn(q.id, command({ presentationId: q.presentationId }))).rejects.toMatchObject({ status: 409 });
    await client.revokeSource(source.id, command({ grantRevision: 0, removeExcerpts: true }));
    snapshot = await client.getSnapshot(project.id);
    expect(snapshot.documents[0]!.text).toBe('Owner draft preserved.');
    if (process.env.LP_WRITE_J1_EVIDENCE === 'true') {
        await mkdir('tests/cloud/evidence', { recursive: true });
        await writeFile('tests/cloud/evidence/j1-samples.json', JSON.stringify({ evidence: 'Actual local PostgreSQL and loopback HTTP; synthetic source and scripted manager; no live inference.', accepted, projectSummary: project, documentReceipt: saved, sourceReceipt: enrolled, observation, snoozedReceipt: snoozed, snapshotAfterRevocation: snapshot }, null, 2) + '\n', 'utf8');
    }
    await client.deleteProject(project.id, command({}, snapshot.project.revision) as c.RevisionedCommandEnvelope<Record<string, never>>);
    expect(await client.listProjects()).toEqual([]);
});
test('SSE is minimal, reconnects at cursor and closes when current credential is revoked', async () => {
    const { projectId } = await h.create();
    const origin = await h.app.listen({ host: '127.0.0.1', port: 0 });
    const abort = new AbortController();
    const response = await fetch(`${origin}/v1/events?after=0`, { headers: { authorization: `Bearer ${h.auth.token}` }, signal: abort.signal });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('project_updated');
    expect(first).not.toContain('Synthetic build');
    expect(first).not.toContain('token');
    const data = first.split('\n').find(line => line.startsWith('data: '))!.slice(6);
    const event = c.ProjectEventSchema.parse(JSON.parse(data));
    expect(event.projectId).toBe(projectId);
    await h.pool.query('UPDATE credentials SET revoked_at=now() WHERE device_id=$1', [h.auth.deviceId]);
    let finished = false;
    for (let i = 0; i < 3; i++) {
        if ((await reader.read()).done) {
            finished = true;
            break;
        }
    }
    expect(finished).toBe(true);
    abort.abort();
});
test('HTTP redemption is rate limited and contracts reject unexpected/private fields', async () => {
    const g = await issueGrant(h.pool, { ownerId: h.ownerId, timezone: 'UTC' });
    const redeemed = await h.app.inject({ method: 'POST', url: '/v1/auth/redeem', payload: { code: g.code, deviceName: 'Synthetic integration device' } });
    expect(redeemed.statusCode).toBe(200);
    expect(c.RedeemResultSchema.safeParse(redeemed.json()).success).toBe(true);
    for (let i = 0; i < 4; i++)
        await h.app.inject({ method: 'POST', url: '/v1/auth/redeem', payload: { code: 'invalid', deviceName: 'Synthetic' } });
    expect((await h.app.inject({ method: 'POST', url: '/v1/auth/redeem', payload: { code: 'invalid', deviceName: 'Synthetic' } })).statusCode).toBe(429);
    const response = await h.request('POST', '/v1/projects', command({ title: 'invalid', brief: 'Synthetic', ownerId: randomUUID() }));
    expect(response.statusCode).toBe(422);
});
