import { randomUUID } from 'node:crypto';
import * as c from '@living-playbooks/contracts';
import type { Principal } from '../auth/credentials';
import { Store,saveProject } from '../domain/store';
import { reject,revision } from '../domain/errors';
import { eligibility,openStates } from './policy';

export class CheckInCommands {
  constructor(public store:Store){}
  async apply(p:Principal,path:string,id:string,e:c.CommandEnvelope<c.CheckInAnswer|c.SnoozeInput|c.PresentationInput|Record<string,never>>,kind:'answer'|'snooze'|'cancel'|'presented'){
    const row=(await this.store.pool.query('SELECT project_id FROM checkins WHERE id=$1',[id])).rows[0];if(!row)reject(404,'not_found','Question is unavailable.');
    return this.store.command(p,path,e,row.project_id,async(db,project)=>{
      const record=(await db.query('SELECT * FROM checkins WHERE id=$1 FOR UPDATE',[id])).rows[0];const q=c.CheckInSchema.parse(record.data);const x=project!;
      if(!openStates.includes(q.state))reject(409,'question_closed','Question is no longer open.',q.revision);
      if(kind!=='presented')revision(q.revision,e.expectedRevision);
      const task=x.tasks.find(t=>t.id===q.taskId);if(!task||task.revision!==q.subjectRevision||['done','skipped'].includes(task.status)||x.status!=='active'||new Date(q.expiresAt)<=this.store.now())reject(409,'question_stale','Question subject is no longer current.');
      if(kind==='presented'){
        const input=e.input as c.PresentationInput;
        if(input.presentationId!==q.presentationId||!['available','presented'].includes(q.state))reject(409,'presentation_stale','Presentation is unavailable.');
        if(record.authority?.deviceId!==p.deviceId)reject(404,'not_found','Presentation is unavailable on this device.');
        if(await eligibility(db,x,q,record.dependencies,this.store.now())!=='eligible')reject(409,'presentation_suppressed','Presentation is not currently permitted.');
        if(q.state!=='presented'){q.state='presented';q.revision++;}
      }else if(kind==='answer'){
        q.answer=e.input as c.CheckInAnswer;q.state='answered';q.revision++;
        if(q.answer.kind==='recorded'){
          task.status='done';task.evidenceLevel='user_reported';task.evidenceIds=[];task.ownerOverride=true;task.revision++;
          x.decisions.push({id:randomUUID(),text:`Owner reported task ${task.id} recorded.`,origin:'owner',createdAt:this.store.now().toISOString(),observationIds:[]});
        }
        await saveProject(db,x,this.store.now());
      }else if(kind==='snooze'){
        const input=e.input as c.SnoozeInput;const until=new Date(input.until);
        if(until<=this.store.now()||until.getTime()>this.store.now().getTime()+7*86400_000)reject(422,'snooze_bounds','Choose a future time within seven days.');
        q.state='snoozed';q.snoozedUntil=input.until;q.dueAt=input.until;q.expiresAt=new Date(until.getTime()+86400_000).toISOString();q.presentationId=randomUUID();q.revision++;
        await db.query('UPDATE checkins SET snooze_timezone=$2 WHERE id=$1',[id,input.timezone]);
      }else {q.state='cancelled';q.revision++;}
      await db.query('UPDATE checkins SET data=$2 WHERE id=$1',[id,q]);return{result:q,kind:'checkin_updated',resourceId:id};
    });
  }
}
