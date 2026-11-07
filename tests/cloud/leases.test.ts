import { randomUUID } from 'node:crypto';
import { afterEach,beforeEach,expect,test } from 'vitest';
import * as c from '@living-playbooks/contracts';
import { JobQueue } from '../../apps/cloud/src/jobs/queue';
import { command,setup } from './helpers';

let h:Awaited<ReturnType<typeof setup>>;let now:Date;let queue:JobQueue;
beforeEach(async()=>{h=await setup();now=new Date(Date.now()+1000);queue=new JobQueue(h.pool,()=>now);});afterEach(async()=>{await h?.close();});
const makeProposal=(job:c.ManagerJob,s:c.ProjectSnapshot):c.ManagerProposal=>({schemaVersion:1,jobId:job.id,baseProjectRevision:job.baseProjectRevision,projectEpoch:job.projectEpoch,grantVersions:job.grantVersions,taskChanges:[],decisionSuggestions:[],workspace:s.project.workspace,reply:{text:'Scripted no-op reflection.',observationIds:[]}});

test('two claimers get one job; expired lease generation fences old completion',async()=>{
  const {projectId}=await h.create();const [a,b]=await Promise.all([queue.claim(),queue.claim()]);expect([a,b].filter(Boolean)).toHaveLength(1);const job=(a??b)!;
  const s=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();const proposed=makeProposal(job,s);
  now=new Date(now.getTime()+181000);const replacement=await queue.claim();expect(replacement).not.toBeNull();expect(replacement!.leaseGeneration).toBeGreaterThan(job.leaseGeneration);
  await expect(queue.commit(job,proposed)).rejects.toThrow(/lease/);
  expect((await h.pool.query('SELECT 1 FROM messages')).rowCount).toBe(0);
});

test('owner correction while model is delayed supersedes output and creates at most one bounded replacement',async()=>{
  const {projectId}=await h.create();const job=await queue.claim();expect(job).not.toBeNull();
  const s=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();const p=makeProposal(job!,s);
  const task={id:randomUUID(),title:'Synthetic task',status:'todo' as const,requirementOrigin:'model_suggestion' as const,evidenceLevel:'none' as const,evidenceIds:[]};p.taskChanges=[{type:'create',task}];
  expect((await h.request('POST',`/v1/projects/${projectId}/actions`,command({type:'record_decision',text:'Owner correction'},s.project.revision))).statusCode).toBe(200);
  expect(await queue.commit(job!,p)).toBe('superseded');
  const current=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();expect(current.project.tasks).toHaveLength(0);
  expect((await h.pool.query("SELECT 1 FROM jobs WHERE state='queued'")).rowCount).toBe(1);
});

test('successful commit derives task authority and revisions, preserves draft, and does not queue itself',async()=>{
  const {projectId}=await h.create();const documentId=randomUUID();await h.request('PUT',`/v1/projects/${projectId}/documents/${documentId}`,command({text:'Owner draft'},0));
  const job=await queue.claim();expect(job).not.toBeNull();const s=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();const p=makeProposal(job!,s);
  p.taskChanges=[{type:'create',task:{id:randomUUID(),title:'Build the demo',status:'todo',requirementOrigin:'brief',evidenceLevel:'none',evidenceIds:[]}}];
  expect(await queue.commit(job!,p)).toBe('completed');
  const snapshot=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();expect(snapshot.project.tasks[0]).toMatchObject({revision:0,ownerOverride:false});expect(snapshot.documents[0].text).toBe('Owner draft');
  expect((await h.pool.query('SELECT 1 FROM jobs')).rowCount).toBe(1);
  await expect(queue.commit(job!,p)).rejects.toThrow(/lease/);
});

test('owner overrides, fabricated evidence and invalid workspace references reject atomically',async()=>{
  const {projectId}=await h.create();const job=await queue.claim();expect(job).not.toBeNull();const s=(await h.request('GET',`/v1/projects/${projectId}/snapshot`)).json();
  const invalid=makeProposal(job!,s);invalid.reply.observationIds=[randomUUID()];
  await expect(queue.commit(job!,invalid)).rejects.toThrow(/evidence/);
  const panel=makeProposal(job!,s);panel.workspace={...panel.workspace,panels:[{id:randomUUID(),heading:'Foreign draft',type:'document_editor',documentId:randomUUID()}]};
  await expect(queue.commit(job!,panel)).rejects.toThrow(/references/);
  expect((await h.pool.query('SELECT 1 FROM messages')).rowCount).toBe(0);
});
