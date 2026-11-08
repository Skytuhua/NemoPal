import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as c from '@living-playbooks/contracts';
import { JobQueue } from '../../apps/cloud/src/jobs/queue';
import { command, setup } from './helpers';
import { issueGrant,redeem } from '../../apps/cloud/src/auth/credentials';
let h: Awaited<ReturnType<typeof setup>>;
let now: Date;
let queue: JobQueue;
beforeEach(async () => { h = await setup(); now = new Date(Date.now() + 1000); queue = new JobQueue(h.pool, () => now); });
afterEach(async () => { await h?.close(); });
const makeProposal = (job: c.ManagerJob, s: c.ProjectSnapshot): c.ManagerProposal => ({ schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch, grantVersions: job.grantVersions, taskChanges: [], decisionSuggestions: [], workspace: s.project.workspace, reply: { text: 'Scripted no-op reflection.', observationIds: [] } });
test.each(['same project','different projects','different owners'])('independent connections reserve one durable global active slot across two jobs: %s',async(scope)=>{
    const {projectId}=await h.create();
    if(scope==='same project')
        expect((await h.request('POST',`/v1/projects/${projectId}/messages`,command({text:'Second due job'},0))).statusCode).toBe(200);
    else if(scope==='different projects')
        expect((await h.request('POST','/v1/projects',command({title:'Second project',brief:'Synthetic competing job.'}))).statusCode).toBe(200);
    else{
        const other=await redeem(h.pool,(await issueGrant(h.pool,{timezone:'UTC'})).code);
        expect((await h.request('POST','/v1/projects',command({title:'Other synthetic owner',brief:'Separate owner competing job.'}),other.token)).statusCode).toBe(200);
    }
    const firstPool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
    const secondPool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
    try{
        const first=new JobQueue(firstPool,()=>now);const second=new JobQueue(secondPool,()=>now);
        const pids=await Promise.all([firstPool.query('SELECT pg_backend_pid() AS pid'),secondPool.query('SELECT pg_backend_pid() AS pid')]);
        expect(pids[0].rows[0].pid).not.toBe(pids[1].rows[0].pid);
        const claimed=await Promise.all([first.claim(),second.claim()]);
        expect(claimed.filter(Boolean)).toHaveLength(1);
        const active=claimed.find(Boolean)!;
        expect(await new JobQueue(secondPool,()=>now).claim()).toBeNull();
        expect((await h.pool.query("SELECT 1 FROM jobs WHERE state='running' AND lease_expires_at>$1",[now])).rowCount).toBe(1);
        const context=await first.context(active);const oldProposal=makeProposal(active,context.snapshot);
        now=new Date(now.getTime()+181000);
        const reclaimed=(await second.claim())!;
        expect(reclaimed.id).toBe(active.id);expect(reclaimed.leaseGeneration).toBeGreaterThan(active.leaseGeneration);
        await expect(first.commit(active,oldProposal)).rejects.toThrow('lease_lost');
        expect(await first.claim()).toBeNull();
        const current=await second.context(reclaimed);await second.commit(reclaimed,makeProposal(reclaimed,current.snapshot));
        const next=await first.claim();expect(next).not.toBeNull();expect(next!.id).not.toBe(active.id);
    }finally{await firstPool.end();await secondPool.end();}
});
test('owner cancellation releases the global slot and fences the cancelled generation',async()=>{
    const {projectId}=await h.create();await h.request('POST',`/v1/projects/${projectId}/messages`,command({text:'Queued follow-up'},0));
    const active=(await queue.claim())!;const context=await queue.context(active);
    expect(await queue.claim()).toBeNull();
    expect((await h.request('POST',`/v1/jobs/${active.id}/cancel`,command({}))).statusCode).toBe(200);
    expect(await queue.claim()).not.toBeNull();
    await expect(queue.commit(active,makeProposal(active,context.snapshot))).rejects.toThrow('lease_lost');
});
test('two claimers get one job; expired lease generation fences old completion', async () => {
    const { projectId } = await h.create();
    const [a, b] = await Promise.all([queue.claim(), queue.claim()]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    const job = (a ?? b)!;
    const s = (await h.request('GET', `/v1/projects/${projectId}/snapshot`)).json();
    const proposed = makeProposal(job, s);
    now = new Date(now.getTime() + 181000);
    const replacement = await queue.claim();
    expect(replacement).not.toBeNull();
    expect(replacement!.leaseGeneration).toBeGreaterThan(job.leaseGeneration);
    await expect(queue.commit(job, proposed)).rejects.toThrow(/lease/);
    expect((await h.pool.query('SELECT 1 FROM messages')).rowCount).toBe(0);
});
test('owner correction while model is delayed supersedes output and creates at most one bounded replacement', async () => {
    const { projectId } = await h.create();
    const job = await queue.claim();
    expect(job).not.toBeNull();
    const s = (await h.request('GET', `/v1/projects/${projectId}/snapshot`)).json();
    const p = makeProposal(job!, s);
    const task = { id: randomUUID(), title: 'Synthetic task', status: 'todo' as const, requirementOrigin: 'model_suggestion' as const, evidenceLevel: 'none' as const, evidenceIds: [] };
    p.taskChanges = [{ type: 'create', task }];
    expect((await h.request('POST', `/v1/projects/${projectId}/actions`, command({ type: 'record_decision', text: 'Owner correction' }, s.project.revision))).statusCode).toBe(200);
    expect(await queue.commit(job!, p)).toBe('superseded');
    const current = (await h.request('GET', `/v1/projects/${projectId}/snapshot`)).json();
    expect(current.project.tasks).toHaveLength(0);
    expect((await h.pool.query("SELECT 1 FROM jobs WHERE state='queued'")).rowCount).toBe(1);
});
test('successful commit derives task authority and revisions, preserves draft, and does not queue itself', async () => {
    const { projectId } = await h.create();
    const documentId = randomUUID();
    await h.request('PUT', `/v1/projects/${projectId}/documents/${documentId}`, command({ text: 'Owner draft' }, 0));
    const job = await queue.claim();
    expect(job).not.toBeNull();
    const s = (await h.request('GET', `/v1/projects/${projectId}/snapshot`)).json();
    const p = makeProposal(job!, s);
    p.taskChanges = [{ type: 'create', task: { id: randomUUID(), title: 'Build the demo', status: 'todo', requirementOrigin: 'brief', evidenceLevel: 'none', evidenceIds: [] } }];
    expect(await queue.commit(job!, p)).toBe('completed');
    const snapshot = (await h.request('GET', `/v1/projects/${projectId}/snapshot`)).json();
    expect(snapshot.project.tasks[0]).toMatchObject({ revision: 0, ownerOverride: false });
    expect(snapshot.documents[0].text).toBe('Owner draft');
    expect((await h.pool.query('SELECT 1 FROM jobs')).rowCount).toBe(1);
    await expect(queue.commit(job!, p)).rejects.toThrow(/lease/);
});
test('owner overrides, fabricated evidence and invalid workspace references reject atomically', async () => {
    const { projectId } = await h.create();
    const job = await queue.claim();
    expect(job).not.toBeNull();
    const s = (await h.request('GET', `/v1/projects/${projectId}/snapshot`)).json();
    const invalid = makeProposal(job!, s);
    invalid.reply.observationIds = [randomUUID()];
    await expect(queue.commit(job!, invalid)).rejects.toThrow(/evidence/);
    const panel = makeProposal(job!, s);
    panel.workspace = { ...panel.workspace, panels: [{ id: randomUUID(), heading: 'Foreign draft', type: 'document_editor', documentId: randomUUID() }] };
    await expect(queue.commit(job!, panel)).rejects.toThrow(/references/);
    expect((await h.pool.query('SELECT 1 FROM messages')).rowCount).toBe(0);
});
