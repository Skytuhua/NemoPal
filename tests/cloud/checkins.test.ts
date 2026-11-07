import { randomUUID } from 'node:crypto';
import { afterEach,beforeEach,expect,test } from 'vitest';
import * as c from '@living-playbooks/contracts';
import { JobQueue } from '../../apps/cloud/src/jobs/queue';
import { CheckInScheduler } from '../../apps/cloud/src/checkins/scheduler';
import { buildServer } from '../../apps/cloud/src/api/server';
import { command,setup } from './helpers';

let h:Awaited<ReturnType<typeof setup>>;let clock:Date;let app:ReturnType<typeof buildServer>;
beforeEach(async()=>{h=await setup();clock=new Date();await h.pool.query("UPDATE owners SET timezone='UTC',quiet_start=23,quiet_end=0");app=buildServer(h.pool,{now:()=>clock});});
afterEach(async()=>{await app.close();await h?.close();});
const request=(url:string,payload:unknown)=>app.inject({method:'POST',url,payload:payload as object,headers:{authorization:`Bearer ${h.auth.token}`}});
async function question(){
  const {projectId}=await h.create();const queue=new JobQueue(h.pool,()=>new Date(clock.getTime()+1000));const job=(await queue.claim())!;expect(job).not.toBeNull();const context=await queue.context(job);const taskId=randomUUID();
  const p:c.ManagerProposal={schemaVersion:1,jobId:job.id,baseProjectRevision:job.baseProjectRevision,projectEpoch:job.projectEpoch,grantVersions:job.grantVersions,taskChanges:[{type:'create',task:{id:taskId,title:'Capture synthetic demo',status:'in_progress',requirementOrigin:'brief',evidenceLevel:'none',evidenceIds:[]}}],decisionSuggestions:[],workspace:context.snapshot.project.workspace,questionSuggestion:{taskId,subjectRevision:0,question:'Did you record the synthetic demo?',dueAt:new Date(clock.getTime()+600000).toISOString()},reply:{text:'Scripted planned question.',observationIds:[]}};
  await queue.commit(job,p);const row=(await h.pool.query('SELECT data FROM checkins')).rows[0];expect(row).toBeDefined();return {projectId,taskId,q:row.data as c.CheckIn};
}

test('due question becomes available once; restart retains identity and answer-before-display is remembered',async()=>{
  const {projectId,q}=await question();clock=new Date(q.dueAt);await h.pool.query('UPDATE owners SET quiet_start=0,quiet_end=0');
  const scheduler=new CheckInScheduler(h.pool,()=>clock);await scheduler.tick();await new CheckInScheduler(h.pool,()=>clock).tick();
  const available=(await h.pool.query('SELECT data FROM checkins')).rows[0].data;expect(available.state).toBe('available');expect(available.id).toBe(q.id);
  const body=command({kind:'recorded'},available.revision);const answer=await request(`/v1/checkins/${q.id}/answer`,body);expect(answer.statusCode).toBe(200);expect(answer.json().result.state).toBe('answered');
  expect((await request(`/v1/checkins/${q.id}/answer`,body)).json()).toEqual(answer.json());
  expect((await request(`/v1/checkins/${q.id}/presented`,command({presentationId:q.presentationId}))).statusCode).toBe(409);
  const snapshot=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();expect(snapshot.project.tasks[0]).toMatchObject({status:'done',evidenceLevel:'user_reported',ownerOverride:true});expect(snapshot.checkIns[0].answer.kind).toBe('recorded');expect((await h.pool.query('SELECT 1 FROM checkins')).rowCount).toBe(1);
});

test('snooze retains logical question, allocates one new presentation, and survives restart without changing task',async()=>{
  const {projectId,q}=await question();const until=new Date(clock.getTime()+3600000).toISOString();const body=command({until,timezone:'America/Chicago'},q.revision);
  const res=await request(`/v1/checkins/${q.id}/snooze`,body);expect(res.statusCode).toBe(200);const snoozed=res.json().result;expect(snoozed.id).toBe(q.id);expect(snoozed.presentationId).not.toBe(q.presentationId);expect(snoozed.state).toBe('snoozed');
  expect((await request(`/v1/checkins/${q.id}/snooze`,body)).json()).toEqual(res.json());clock=new Date(until);await h.pool.query('UPDATE owners SET quiet_start=0,quiet_end=0');await new CheckInScheduler(h.pool,()=>clock).tick();
  const current=(await h.pool.query('SELECT data FROM checkins')).rows[0].data;expect(current.state).toBe('available');expect(current.presentationId).toBe(snoozed.presentationId);
  const snapshot=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();expect(snapshot.project.tasks[0].status).toBe('in_progress');
});

test('quiet hours, consent, project pause and account cap suppress availability without inference',async()=>{
  const {q}=await question();clock=new Date(q.dueAt);const hour=clock.getUTCHours();await h.pool.query('UPDATE owners SET quiet_start=$1,quiet_end=$2',[hour,(hour+1)%24]);
  const scheduler=new CheckInScheduler(h.pool,()=>clock);await scheduler.tick();expect((await h.pool.query('SELECT data FROM checkins')).rows[0].data.state).toBe('scheduled');
  await h.pool.query('UPDATE owners SET quiet_start=0,quiet_end=0,attention_limit=0');await scheduler.tick();expect((await h.pool.query('SELECT data FROM checkins')).rows[0].data.state).toBe('scheduled');
  await h.pool.query('UPDATE owners SET attention_limit=6,reminders=false');await scheduler.tick();expect((await h.pool.query('SELECT data FROM checkins')).rows[0].data.state).toBe('cancelled');
  expect((await h.pool.query('SELECT 1 FROM jobs')).rowCount).toBe(1);
});

test('task correction before due fences answer/display; cancellation never completes a task',async()=>{
  const {projectId,taskId,q}=await question();const s=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();
  await h.request('POST',`/v1/projects/${projectId}/actions`,command({type:'update_task',taskId,status:'blocked'},s.project.revision));
  expect((await request(`/v1/checkins/${q.id}/answer`,command({kind:'recorded'},q.revision))).statusCode).toBe(409);
  clock=new Date(q.dueAt);await new CheckInScheduler(h.pool,()=>clock).tick();const cancelled=(await h.pool.query('SELECT data FROM checkins')).rows[0].data;expect(cancelled.state).toBe('cancelled');
  const current=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();expect(current.project.tasks[0].status).toBe('blocked');
});

test('not yet and explicit cancel record scope without inventing completion or deadline',async()=>{
  const {projectId,q}=await question();const response=await request(`/v1/checkins/${q.id}/answer`,command({kind:'not_yet',note:'Still building'},q.revision));expect(response.statusCode).toBe(200);
  const snapshot=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();expect(snapshot.project.tasks[0].status).toBe('in_progress');expect(snapshot.project.tasks[0].dueAt).toBeUndefined();
  expect((await request(`/v1/checkins/${q.id}/cancel`,command({},response.json().result.revision))).statusCode).toBe(409);
});

test('duplicate proposals cannot create a second open question; pause suppresses until resumed; account attention is charged once',async()=>{
  const {projectId,q}=await question();const queue=new JobQueue(h.pool,()=>new Date(clock.getTime()+1000));
  const current=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();await h.request('POST',`/v1/projects/${projectId}/messages`,command({text:'Synthetic explicit review'},current.project.revision));
  const job=(await queue.claim())!;const context=await queue.context(job);
  await queue.commit(job,{schemaVersion:1,jobId:job.id,baseProjectRevision:job.baseProjectRevision,projectEpoch:job.projectEpoch,grantVersions:job.grantVersions,taskChanges:[],decisionSuggestions:[],workspace:context.snapshot.project.workspace,questionSuggestion:{taskId:q.taskId,subjectRevision:q.subjectRevision,question:'Duplicate?',dueAt:q.dueAt},reply:{text:'Scripted duplicate question.',observationIds:[]}});
  expect((await h.pool.query('SELECT 1 FROM checkins')).rowCount).toBe(1);
  const before=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();await h.request('POST',`/v1/projects/${projectId}/actions`,command({type:'set_project_status',status:'paused'},before.project.revision));
  clock=new Date(q.dueAt);await h.pool.query('UPDATE owners SET quiet_start=0,quiet_end=0');await new CheckInScheduler(h.pool,()=>clock).tick();expect((await h.pool.query('SELECT data FROM checkins')).rows[0].data.state).toBe('scheduled');
  const paused=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();await h.request('POST',`/v1/projects/${projectId}/actions`,command({type:'set_project_status',status:'active'},paused.project.revision));
  const scheduler=new CheckInScheduler(h.pool,()=>clock);await scheduler.tick();await scheduler.tick();
  expect((await h.pool.query('SELECT 1 FROM checkin_presentations')).rowCount).toBe(1);
  const available=(await h.pool.query('SELECT data FROM checkins')).rows[0].data;
  expect((await request(`/v1/checkins/${q.id}/presented`,command({presentationId:available.presentationId}))).statusCode).toBe(200);
  expect((await request(`/v1/checkins/${q.id}/presented`,command({presentationId:available.presentationId}))).statusCode).toBe(200);
  expect((await h.pool.query('SELECT 1 FROM checkin_presentations')).rowCount).toBe(1);
});

test('explicit cancellation and expiration do not complete the task',async()=>{
  const {projectId,q}=await question();expect((await request(`/v1/checkins/${q.id}/cancel`,command({},q.revision))).json().result.state).toBe('cancelled');
  clock=new Date(new Date(q.expiresAt).getTime()+1);await new CheckInScheduler(h.pool,()=>clock).tick();
  const snapshot=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();expect(snapshot.project.tasks[0].status).toBe('in_progress');
});
