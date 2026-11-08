import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp,unlink,rmdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { build } from 'esbuild';
import { expect, test } from 'vitest';
import type * as c from '@living-playbooks/contracts';
import { JobQueue } from '../../apps/cloud/src/jobs/queue';
import { command, setup } from './helpers';
async function freePort() { const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as {
    port: number;
}).port; await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); return port; }
async function start(port: number,entry:string): Promise<ChildProcess> {
    const child = spawn(process.execPath, [entry], { cwd: process.cwd(), windowsHide: true, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, DATABASE_URL: process.env.DATABASE_URL, PORT: String(port), PUBLIC_ORIGIN: `http://127.0.0.1:${port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { child.kill(); reject(new Error('Cloud process start timeout.')); }, 10000);
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('exit', () => { clearTimeout(timeout); reject(new Error('Cloud process failed to start.')); });
        child.stdout!.on('data', (data: Buffer) => { if (data.toString().includes('cloud started.')) {
            clearTimeout(timeout);
            resolve();
        } });
    });
    return child;
}
async function stop(child: ChildProcess) { if (child.exitCode === null && !child.killed) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
} }
test('actual bundled cloud process restart preserves a snoozed question and a later durable answer', async () => {
    const h = await setup();
    let child: ChildProcess | undefined;
    const directory=await mkdtemp(join(resolve('tests/cloud'),'.bundle-'));
    const entry=join(directory,'cloud.mjs');
    try {
        await build({entryPoints:['apps/cloud/src/main.ts'],bundle:true,platform:'node',format:'esm',target:'node24',external:['fastify','pg'],outfile:entry});
        const { projectId } = await h.create();
        const queue = new JobQueue(h.pool, () => new Date(Date.now() + 1000));
        const job = (await queue.claim())!;
        const context = await queue.context(job);
        const taskId = randomUUID();
        const p: c.ManagerProposal = { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch, grantVersions: job.grantVersions, taskChanges: [{ type: 'create', task: { id: taskId, title: 'Synthetic process restart task', status: 'in_progress', requirementOrigin: 'brief', evidenceLevel: 'none', evidenceIds: [] } }], decisionSuggestions: [], workspace: context.snapshot.project.workspace, questionSuggestion: { taskId, subjectRevision: 0, question: 'Recorded the demo?', dueAt: new Date(Date.now() + 600000).toISOString() }, reply: { text: 'Scripted process restart setup.', observationIds: [] } };
        await queue.commit(job, p);
        const q = (await h.pool.query('SELECT data FROM checkins')).rows[0].data as c.CheckIn;
        const port = await freePort();
        child = await start(port,entry);
        const request = async (path: string, body?: unknown) => fetch(`http://127.0.0.1:${port}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${h.auth.token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
        expect((await request('/health/ready')).status).toBe(200);
        const snoozed = await (await request(`/v1/checkins/${q.id}/snooze`, command({ until: new Date(Date.now() + 3600000).toISOString(), timezone: 'America/Chicago' }, q.revision))).json() as c.CommandReceipt<c.CheckIn>;
        expect(snoozed.result.state).toBe('snoozed');
        await stop(child);
        child = await start(port,entry);
        const restored = await (await request(`/v1/projects/${projectId}/snapshot`)).json() as c.ProjectSnapshot;
        expect(restored.checkIns[0]).toEqual(snoozed.result);
        expect(restored.connection.inference.available).toBe(false);
        const answered = await (await request(`/v1/checkins/${q.id}/answer`, command({ kind: 'recorded' }, snoozed.result.revision))).json() as c.CommandReceipt<c.CheckIn>;
        expect(answered.result.state).toBe('answered');
        await stop(child);
        child = await start(port,entry);
        const final = await (await request(`/v1/projects/${projectId}/snapshot`)).json() as c.ProjectSnapshot;
        expect(final.checkIns).toHaveLength(1);
        expect(final.checkIns[0]!.answer?.kind).toBe('recorded');
        expect(final.project.tasks[0]!.status).toBe('done');
    }
    finally {
        if (child)
            await stop(child);
        await unlink(entry).catch(()=>{});await rmdir(directory);
        await h.close();
    }
});
