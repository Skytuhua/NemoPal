import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, test } from 'vitest';
import * as c from '@living-playbooks/contracts';
import { goldenSnapshot } from '../../fixtures/contracts/golden';
import { CheckInScheduler } from '../../apps/cloud/src/checkins/scheduler';
import { JobQueue } from '../../apps/cloud/src/jobs/queue';
import { runJob } from '../../apps/cloud/src/jobs/worker';
import { reserveUsage } from '../../apps/cloud/src/jobs/model-settings';
import { BoundedRunner, HttpNemotronAdapter } from '@living-playbooks/nemotron';
import { issueGrant, redeem } from '../../apps/cloud/src/auth/credentials';
import { command, setup } from './helpers';

let h: Awaited<ReturnType<typeof setup>>, now: Date, projectId: string;
const path = () => `/v1/projects/${projectId}/proactivity`;
const tick = () => new CheckInScheduler(h.pool, () => now, true).tick();
const reviews = async () => (await h.pool.query("SELECT * FROM jobs WHERE data->>'kind'='scheduled_review' ORDER BY run_after,id")).rows;
const due = async () => h.pool.query('UPDATE proactive_schedules SET next_run_at=$1 WHERE project_id=$2', [now, projectId]);
const enable = async () => {
  const response = await h.request('PUT', path(), command({ enabled: true, intervalMinutes: 30 }));
  expect(response.statusCode).toBe(200); await due();
};
const finish = async () => h.pool.query("UPDATE jobs SET state='completed',data=jsonb_set(data,'{state}','\"completed\"') WHERE project_id=$1", [projectId]);
const ownerInput = async () => {
  const id = randomUUID();
  return h.pool.query('INSERT INTO messages(id,project_id,data) VALUES($1,$2,$3)', [id, projectId, { id, projectId, role: 'owner', text: 'Continue the authorized task.', createdAt: now.toISOString(), observationIds: [] }]);
};
beforeEach(async () => {
  h = await setup(); now = new Date(Date.now() + 60000); projectId = (await h.create()).projectId;
  await h.pool.query('UPDATE owners SET timezone=$1,quiet_start=0,quiet_end=0 WHERE id=$2', ['UTC', h.ownerId]);
  await h.pool.query("UPDATE projects SET data=jsonb_set(data,'{tasks}',$2::jsonb) WHERE id=$1", [projectId, JSON.stringify([goldenSnapshot.project.tasks[0]])]);
  await finish();
  await h.pool.query("INSERT INTO model_usage(singleton,calls,call_limit,reserved_tokens,token_limit,configuration_hash) VALUES(true,0,40,0,10000000,'synthetic')");
});
afterEach(async () => { await h?.close(); });

test('schedule controls are explicit, bounded, replayable and owner scoped', async () => {
  const initial = await h.request('GET', path());
  expect(initial.statusCode).toBe(200); expect(initial.json()).toMatchObject({ enabled: false, intervalMinutes: 30, nextRunAt: null });
  const envelope = command({ enabled: true, intervalMinutes: 30 });
  const first = await h.request('PUT', path(), envelope);
  expect(first.statusCode).toBe(200);
  expect((await h.request('PUT', path(), envelope)).json()).toEqual(first.json());
  expect((await h.request('PUT', path(), command({ enabled: true, intervalMinutes: 1 }))).statusCode).toBe(422);
  const foreign = await redeem(h.pool, (await issueGrant(h.pool, { timezone: 'UTC' })).code);
  expect((await h.request('GET', path(), undefined, foreign.token)).statusCode).toBe(404);
  expect((await h.request('PUT', path(), command({ enabled: false }), foreign.token)).statusCode).toBe(404);
});

test('concurrent ticks and process recreation admit one review without catch-up bursts or self-triggering', async () => {
  await enable(); await Promise.all([tick(), tick()]);
  expect(await reviews()).toHaveLength(1);
  const queue = new JobQueue(h.pool, () => now); const job = (await queue.claim())!;
  expect(job.kind).toBe('scheduled_review'); const context = await queue.context(job);
  await queue.commit(job, { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch, grantVersions: [], taskChanges: [], decisionSuggestions: [], workspace: context.snapshot.project.workspace, reply: { text: 'Synthetic proactive progress check.', observationIds: [] } });
  now = new Date(now.getTime() + 3600000); await due(); await tick();
  expect(await reviews()).toHaveLength(1);
  await ownerInput(); await due(); await tick();
  expect(await reviews()).toHaveLength(2);
  expect(new Date((await h.request('GET', path())).json().nextRunAt).getTime()).toBe(now.getTime() + 1800000);
});

test('quiet hours, global budget headroom, pending manager work and unavailable inference suppress admission', async () => {
  await enable(); await h.pool.query('UPDATE owners SET quiet_start=$1,quiet_end=$2 WHERE id=$3', [now.getUTCHours(), (now.getUTCHours() + 1) % 24, h.ownerId]);
  await tick(); expect(await reviews()).toHaveLength(0);
  await h.pool.query('UPDATE owners SET quiet_start=0,quiet_end=0'); await due();
  await h.pool.query('UPDATE model_usage SET calls=39'); await tick(); expect(await reviews()).toHaveLength(0);
  await h.pool.query('UPDATE model_usage SET calls=0'); await due();
  await new CheckInScheduler(h.pool, () => now, false).tick(); expect(await reviews()).toHaveLength(0);
  await h.request('POST', `/v1/projects/${projectId}/messages`, command({ text: 'Owner request wins.' }, 0));
  await due(); await tick(); expect(await reviews()).toHaveLength(0);
  await finish(); await due(); await tick(); expect(await reviews()).toHaveLength(1);
});

test('owner review spacing and daily caps apply across projects', async () => {
  await enable(); await tick(); await finish();
  now = new Date(now.getTime() + 1800000); await ownerInput(); await due(); await tick(); expect(await reviews()).toHaveLength(1);
  for (let i = 0; i < 3; i++) {
    now = new Date(now.getTime() + 3600000); await ownerInput(); await due(); await tick(); await finish();
  }
  expect(await reviews()).toHaveLength(3);
  projectId = (await h.create()).projectId; await finish(); await enable(); await tick();
  expect(await reviews()).toHaveLength(3);
});

test('disable cancels only scheduled work and expired authority disables future reviews', async () => {
  await enable(); await tick(); const job = (await reviews())[0];
  await h.request('POST', `/v1/projects/${projectId}/messages`, command({ text: 'Preserve this owner request.' }, 0));
  expect((await h.request('PUT', path(), command({ enabled: false }))).statusCode).toBe(200);
  expect((await h.pool.query('SELECT state,generation FROM jobs WHERE id=$1', [job.id])).rows[0]).toMatchObject({ state: 'cancelled', generation: 1 });
  expect((await h.pool.query("SELECT state FROM jobs WHERE data->>'kind'='owner_message'")).rows[0].state).toBe('queued');
  await enable(); await finish(); await h.pool.query("UPDATE credentials SET revoked_at=$1 WHERE kind='access'", [now]);
  await tick(); expect((await h.pool.query('SELECT enabled FROM proactive_schedules')).rows[0].enabled).toBe(false);
});

test('scheduled reviews can report pending coding work without creating another coding request', async () => {
  const initialJob = (await h.pool.query('SELECT id FROM jobs LIMIT 1')).rows[0].id;
  const task = goldenSnapshot.project.tasks[0]!;
  await h.pool.query('INSERT INTO codex_requests(id,project_id,job_id,task_id,project_epoch,text) VALUES($1,$2,$3,$4,0,$5)', [randomUUID(), projectId, initialJob, task.id, 'Synthetic pending work']);
  await enable(); await tick(); expect(await reviews()).toHaveLength(1);
  const queue = new JobQueue(h.pool, () => now), job = (await queue.claim())!, context = await queue.context(job);
  await queue.commit(job, { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch, grantVersions: [], taskChanges: [], decisionSuggestions: [], workspace: context.snapshot.project.workspace, codexTask: { taskId: task.id, text: 'Duplicate work must be suppressed.' }, reply: { text: 'Work remains pending; check the coding session.', observationIds: [] } });
  expect((await h.pool.query('SELECT id FROM codex_requests')).rowCount).toBe(1);
  expect((await h.pool.query("SELECT id FROM messages WHERE data->>'role'='manager'")).rowCount).toBe(1);
});

test('scheduled prompts retain conversation without treating an old owner request as a new command', async () => {
  await ownerInput(); await enable(); await tick();
  const queue = new JobQueue(h.pool, () => now), job = (await queue.claim())!, context = await queue.context(job);
  const adapter: c.NemotronAdapter = { probe: async () => { throw Error('No live probe'); }, next: async input => {
    expect(input.messages[0]!.content).toContain('scheduled review');
    expect(JSON.parse(input.messages[1]!.content)).toMatchObject({ latestOwnerInput: [], conversation: [{ role: 'owner', text: 'Continue the authorized task.' }] });
    return { type: 'proposal', proposal: { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch, grantVersions: [], taskChanges: [], decisionSuggestions: [], workspace: context.snapshot.project.workspace, reply: { text: 'Synthetic review.', observationIds: [] } } };
  } };
  await new BoundedRunner(adapter).run(job, context, new AbortController().signal);
});

test('atomic scheduled reservations preserve the last call even under concurrent attempts', async () => {
  await h.pool.query('DELETE FROM model_usage');
  const settings = { baseUrl: 'https://synthetic.example/v1', model: 'synthetic', apiKey: 'fixture', callBudget: 2, tokenBudget: 10000 };
  const results = await Promise.allSettled([reserveUsage(h.pool, settings, 100, 1), reserveUsage(h.pool, settings, 100, 1)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  await reserveUsage(h.pool, settings, 100);
  expect((await h.pool.query('SELECT calls FROM model_usage')).rows[0].calls).toBe(2);
});

test.each(['commit', 'fail'])('stale %s replacements retain scheduled authority and disable fencing', async method => {
  await enable(); await tick();
  const queue = new JobQueue(h.pool, () => now), job = (await queue.claim())!, context = await queue.context(job);
  if (method === 'commit') {
    await h.pool.query("UPDATE projects SET revision=revision+1,data=jsonb_set(data,'{revision}',to_jsonb(revision+1)) WHERE id=$1", [projectId]);
    await queue.commit(job, { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch, grantVersions: [], taskChanges: [], decisionSuggestions: [], workspace: context.snapshot.project.workspace, reply: { text: 'Stale review.', observationIds: [] } });
  } else await queue.fail(job, 'proposal_stale');
  expect((await reviews()).map(row => row.state).sort()).toEqual(['queued', 'superseded']);
  await h.request('PUT', path(), command({ enabled: false }));
  expect(await queue.claim()).toBeNull();
  expect((await h.pool.query("SELECT id FROM jobs WHERE state='queued'")).rowCount).toBe(0);
});

test('disable during an outstanding model response prevents its reply and coding work from committing', async () => {
  await enable(); await tick();
  const queue = new JobQueue(h.pool, () => now), job = (await queue.claim())!, context = await queue.context(job);
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { started = resolve; });
  const adapter: c.NemotronAdapter = { probe: async () => { throw Error('No live probe'); }, next: async () => {
    started(); await waiting;
    return { type: 'proposal', proposal: { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch, grantVersions: [], taskChanges: [], decisionSuggestions: [], workspace: context.snapshot.project.workspace, reply: { text: 'Late response must not appear.', observationIds: [] } } };
  } };
  const running = runJob(queue, adapter, job, new AbortController().signal);
  await entered; await h.request('PUT', path(), command({ enabled: false })); release(); await running;
  expect((await h.pool.query('SELECT id FROM messages')).rowCount).toBe(0);
  expect((await reviews())[0].state).toBe('cancelled');
});

test('budget depletion while queued is checked again before scheduled work starts', async () => {
  await enable(); await tick(); await h.pool.query('UPDATE model_usage SET calls=39');
  expect(await new JobQueue(h.pool, () => now).claim()).toBeNull();
  expect((await reviews())[0].data.errorClass).toBe('account_budget');
});

test('the real worker passes last-call protection through the HTTP adapter on every tool continuation', async () => {
  await enable(); await tick();
  const queue = new JobQueue(h.pool, () => now), job = (await queue.claim())!;
  const settings = { baseUrl: 'https://synthetic.example/v1', model: 'synthetic', apiKey: 'fixture', callBudget: 8, tokenBudget: 10000000 };
  await h.pool.query('DELETE FROM model_usage'); await reserveUsage(h.pool, settings, 0);
  await h.pool.query('UPDATE model_usage SET calls=6');
  let calls = 0;
  const adapter = new HttpNemotronAdapter(settings, async () => {
    calls++;
    return Response.json({ model: 'synthetic', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'read_project_state', arguments: '{}' } }] } }] });
  }, (tokens, retainedCalls) => reserveUsage(h.pool, settings, tokens, retainedCalls));
  await runJob(queue, adapter, job, new AbortController().signal);
  expect(calls).toBe(1);
  expect((await h.pool.query('SELECT calls FROM model_usage')).rows[0].calls).toBe(7);
  expect((await reviews())[0].data.errorClass).toBe('account_budget');
  await reserveUsage(h.pool, settings, 0);
});

test('a coding outcome arriving during inference remains eligible for the next scheduled review', async () => {
  const initialJob = (await h.pool.query('SELECT id FROM jobs LIMIT 1')).rows[0].id, requestId = randomUUID();
  await h.pool.query('INSERT INTO codex_requests(id,project_id,job_id,task_id,project_epoch,text) VALUES($1,$2,$3,$4,0,$5)', [requestId, projectId, initialJob, goldenSnapshot.project.tasks[0]!.id, 'Synthetic pending work']);
  expect((await h.request('POST', `/v1/projects/${projectId}/codex/claim`, {})).statusCode).toBe(200);
  await enable(); await tick();
  const queue = new JobQueue(h.pool, () => now), job = (await queue.claim())!, context = await queue.context(job);
  expect((await h.request('POST', `/v1/projects/${projectId}/codex/${requestId}/result`, { status: 'completed', output: 'Fresh synthetic coding result.' })).statusCode).toBe(200);
  await queue.commit(job, { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision, projectEpoch: job.projectEpoch, grantVersions: [], taskChanges: [], decisionSuggestions: [], workspace: context.snapshot.project.workspace, reply: { text: 'Review based on earlier pending state.', observationIds: [] } });
  now = new Date(now.getTime() + 3600000); await due(); await tick();
  expect(await reviews()).toHaveLength(2);
});

test.each(['deadline', 'document'])('fresh owner %s changes trigger another review', async change => {
  await enable(); await tick(); await finish();
  if (change === 'deadline') {
    const task = goldenSnapshot.project.tasks[0]!;
    expect(task.ownerOverride).toBe(false);
    const response = await h.request('POST', `/v1/projects/${projectId}/actions`, command({ type: 'update_task_details', taskId: task.id, expectedTaskRevision: task.revision, dueAt: new Date(now.getTime() + 7200000).toISOString() }, 0));
    expect(response.statusCode).toBe(200);
  } else expect((await h.request('PUT', `/v1/projects/${projectId}/documents/${randomUUID()}`, command({ text: 'Fresh owner requirements.' }, 0))).statusCode).toBe(200);
  now = new Date(now.getTime() + 3600000); await due(); await tick();
  expect(await reviews()).toHaveLength(2);
});

test('a failed review can retry unchanged input after owner spacing without treating failure as a completed review', async () => {
  await enable(); await tick();
  const queue = new JobQueue(h.pool, () => now), job = (await queue.claim())!;
  await queue.fail(job, 'unsupported_response');
  now = new Date(now.getTime() + 1800000); await due(); await tick();
  expect(await reviews()).toHaveLength(1);
  now = new Date(now.getTime() + 1800000); await due(); await tick();
  expect(await reviews()).toHaveLength(2);
});
