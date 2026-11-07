import { randomUUID } from 'node:crypto';
import type { Pool,PoolClient } from 'pg';
import * as c from '@living-playbooks/contracts';
import { validateProposal,type ToolReceipt } from '@living-playbooks/nemotron';
import { reauthorize,type Principal } from '../auth/credentials';
import { transaction } from '../db/migrate';
import { lockProject,saveProject,appendEvent,queueJob,snapshotData } from '../domain/store';

const grants=(sources:c.SourceBinding[])=>sources.filter(s=>s.state==='following'&&s.exportPolicy!=='off').map(s=>({bindingId:s.id,grantRevision:s.grantRevision})).sort((a,b)=>a.bindingId.localeCompare(b.bindingId));
export async function persistJob(db:PoolClient,job:c.ManagerJob){await db.query('UPDATE jobs SET data=$2,state=$3,run_after=$4,lease_expires_at=$5,generation=$6 WHERE id=$1',[job.id,job,job.state,job.runAfter,job.leaseExpiresAt,job.leaseGeneration]);}

export class JobQueue {
  constructor(public pool:Pool,public now:()=>Date=()=>new Date()){}
  async claim():Promise<c.ManagerJob|null>{
    return transaction(this.pool,async db=>{
      const candidate=(await db.query("SELECT j.id,j.project_id,j.authority,p.owner_id FROM jobs j JOIN projects p ON p.id=j.project_id WHERE NOT p.deleted AND (j.state='queued' AND j.run_after<=$1 OR j.state='running' AND j.lease_expires_at<=$1) ORDER BY j.run_after,j.id LIMIT 1",[this.now()])).rows[0];
      if(!candidate)return null;
      const authority=candidate.authority as Principal|null;
      if(!authority){await db.query("UPDATE jobs SET state='failed',data=data || '{\"state\":\"failed\",\"errorClass\":\"authority_unavailable\"}'::jsonb WHERE id=$1 AND state='queued'",[candidate.id]);return null;}
      await db.query('SELECT id FROM owners WHERE id=$1 FOR UPDATE',[candidate.owner_id]);
      const project=await lockProject(db,candidate.project_id,candidate.owner_id);
      const row=(await db.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE SKIP LOCKED',[candidate.id])).rows[0];
      if(!row||!(row.state==='queued'&&new Date(row.run_after)<=this.now()||row.state==='running'&&new Date(row.lease_expires_at)<=this.now()))return null;
      const job=c.ManagerJobSchema.parse(row.data);
      const valid=(await db.query('SELECT 1 FROM credentials WHERE id=$1 AND revoked_at IS NULL AND expires_at>$2',[authority.credentialId,this.now()])).rowCount;
      if(!valid||project.status!=='active'||job.tries>=2||job.modelCalls>=4){job.state='failed';job.errorClass=!valid?'authority_unavailable':project.status!=='active'?'project_paused':'retry_exhausted';job.leaseExpiresAt=null;job.leaseGeneration++;await persistJob(db,job);return null;}
      const sources=(await db.query('SELECT data FROM source_bindings WHERE project_id=$1',[project.id])).rows.map(r=>c.SourceBindingSchema.parse(r.data));
      job.state='running';job.tries++;job.leaseGeneration++;job.leaseExpiresAt=new Date(this.now().getTime()+180000).toISOString();job.baseProjectRevision=project.revision;job.projectEpoch=project.epoch;job.grantVersions=grants(sources);job.errorClass=null;
      await persistJob(db,job);await appendEvent(db,project,'job_updated',job.id);return job;
    });
  }
  private async locked<T>(job:c.ManagerJob,work:(db:PoolClient,current:c.ManagerJob,project:c.Project,authority:Principal,staleCount:number)=>Promise<T>):Promise<T>{
    return transaction(this.pool,async db=>{
      const authority=(await db.query('SELECT authority FROM jobs WHERE id=$1',[job.id])).rows[0]?.authority as Principal|undefined;
      if(!authority)throw new Error('lease_authority');
      await reauthorize(db,authority,this.now());const project=await lockProject(db,job.projectId,authority.ownerId);
      const row=(await db.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
      if(!row||row.state!=='running'||row.generation!==job.leaseGeneration||!row.lease_expires_at||new Date(row.lease_expires_at)<=this.now())throw new Error('lease_lost');
      return work(db,c.ManagerJobSchema.parse(row.data),project,authority,row.stale_count);
    });
  }
  async context(job:c.ManagerJob):Promise<c.AuthorizedProjectContext>{
    return this.locked(job,async(db,current,project)=>{
      const snapshot=await snapshotData(db,project,this.now());
      const grantVersions=grants(snapshot.sourceBindings);
      if(project.status!=='active'||project.revision!==current.baseProjectRevision||project.epoch!==current.projectEpoch||c.canonicalJson(grantVersions)!==c.canonicalJson(current.grantVersions))throw new Error('proposal_stale');
      return{snapshot,grantVersions};
    });
  }
  async renew(job:c.ManagerJob){return this.locked(job,async(db,current,project)=>{if(project.status!=='active')throw new Error('lease_project_paused');current.leaseExpiresAt=new Date(this.now().getTime()+180000).toISOString();await persistJob(db,current);});}
  async countCall(job:c.ManagerJob){return this.locked(job,async(db,current)=>{if(current.modelCalls>=4)throw new Error('model_budget');current.modelCalls++;await persistJob(db,current);});}
  async countTool(job:c.ManagerJob){return this.locked(job,async(db,current)=>{if(current.toolCalls>=6)throw new Error('tool_budget');current.toolCalls++;await persistJob(db,current);});}
  async receipt(job:c.ManagerJob,receipt:ToolReceipt){return this.locked(job,async db=>{await db.query('UPDATE jobs SET tool_receipts=tool_receipts || $2::jsonb WHERE id=$1',[job.id,JSON.stringify([receipt])]);});}
  async commit(job:c.ManagerJob,raw:c.ManagerProposal):Promise<string>{
    return this.locked(job,async(db,current,project,authority,staleCount)=>{
      const snapshot=await snapshotData(db,project,this.now());const grantVersions=grants(snapshot.sourceBindings);
      if(project.status!=='active'||project.revision!==current.baseProjectRevision||project.epoch!==current.projectEpoch||c.canonicalJson(grantVersions)!==c.canonicalJson(current.grantVersions)){
        current.state='superseded';current.errorClass='stale_proposal';current.leaseExpiresAt=null;await persistJob(db,current);
        if(staleCount<1&&project.status==='active')await queueJob(db,project,'reflection',this.now(),current.inputMessageId,staleCount+1,authority);
        await appendEvent(db,project,'job_updated',job.id);return 'superseded';
      }
      const proposal=validateProposal(raw,current,{snapshot,grantVersions});
      for(const change of proposal.taskChanges){if(change.type==='create')project.tasks.push({...change.task,revision:0,ownerOverride:false});else{const task=project.tasks.find(t=>t.id===change.taskId)!;if(change.title)task.title=change.title;if(change.status)task.status=change.status;task.evidenceLevel=change.evidenceLevel;task.evidenceIds=change.evidenceIds;task.revision++;}}
      for(const suggestion of proposal.decisionSuggestions)project.decisions.push({id:randomUUID(),text:suggestion.text,observationIds:suggestion.observationIds,origin:'manager',createdAt:this.now().toISOString()});
      if(c.canonicalJson(project.workspace.panels)!==c.canonicalJson(proposal.workspace.panels)){project.workspace={...proposal.workspace,id:project.workspace.id,revision:project.workspace.revision+1};}
      const message:c.ChatMessage={id:randomUUID(),projectId:project.id,role:'manager',text:proposal.reply.text,createdAt:this.now().toISOString(),observationIds:proposal.reply.observationIds,jobId:job.id};
      await db.query('INSERT INTO messages(id,project_id,data) VALUES($1,$2,$3)',[message.id,project.id,message]);
      // The check-in policy service consumes this suggestion in the same transaction (T08).
      if(proposal.questionSuggestion)await this.scheduleSuggestion(db,project,proposal);
      await saveProject(db,project,this.now());current.state='completed';current.leaseExpiresAt=null;await persistJob(db,current);await appendEvent(db,project,'project_updated',project.id);return 'completed';
    });
  }
  protected async scheduleSuggestion(_db:PoolClient,_project:c.Project,_proposal:c.ManagerProposal){throw new Error('checkins_unavailable');}
  async fail(job:c.ManagerJob,code:string,retryAfterSeconds=60){
    return this.locked(job,async(db,current,project,authority,staleCount)=>{
      if(code==='proposal_stale'){
        current.state='superseded';if(staleCount<1&&project.status==='active')await queueJob(db,project,'reflection',this.now(),current.inputMessageId,staleCount+1,authority);
      }else{const retry=['provider_rate_limit','provider_network','provider_unavailable','job_aborted'].includes(code)&&current.tries<2&&current.modelCalls<4;current.state=retry?'queued':'failed';if(retry)current.runAfter=new Date(this.now().getTime()+Math.min(3600,Math.max(60,retryAfterSeconds))*1000).toISOString();}
      current.errorClass=code;current.leaseExpiresAt=null;await persistJob(db,current);await appendEvent(db,project,'job_updated',job.id);
    });
  }
}
