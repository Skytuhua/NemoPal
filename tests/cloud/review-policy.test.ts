import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterEach,beforeEach,expect,test } from 'vitest';
import * as c from '@living-playbooks/contracts';
import { executeReadTool,validateProposal } from '@living-playbooks/nemotron';
import { buildServer } from '../../apps/cloud/src/api/server';
import { JobQueue } from '../../apps/cloud/src/jobs/queue';
import { CheckInScheduler } from '../../apps/cloud/src/checkins/scheduler';
import { inQuietHours,type ReminderPreferences } from '../../apps/cloud/src/checkins/policy';
import { command,setup } from './helpers';
import { migrate } from '../../apps/cloud/src/db/migrate';

let h:Awaited<ReturnType<typeof setup>>;
let app:ReturnType<typeof buildServer>;
let now:Date;
beforeEach(async()=>{
    h=await setup();now=new Date();now.setUTCDate(now.getUTCDate()+1);now.setUTCHours(10,0,0,0);
    app=buildServer(h.pool,{now:()=>now});
});
afterEach(async()=>{await app.close();await h.close();});
const request=(method:'GET'|'POST'|'DELETE',url:string,payload?:unknown)=>app.inject({method,url,headers:{authorization:`Bearer ${h.auth.token}`},...(payload?{payload:payload as object}:{})});
async function schedule(){
    expect((await request('POST','/v1/projects',command({title:'Synthetic policy project',brief:'Record a synthetic demo.'}))).statusCode).toBe(200);
    const queue=new JobQueue(h.pool,()=>now);const job=(await queue.claim())!;expect(job).not.toBeNull();const context=await queue.context(job);const taskId=randomUUID();
    const proposal:c.ManagerProposal={schemaVersion:1,jobId:job.id,baseProjectRevision:job.baseProjectRevision,projectEpoch:job.projectEpoch,grantVersions:job.grantVersions,taskChanges:[{type:'create',task:{id:taskId,title:'Synthetic recording',status:'todo',requirementOrigin:'brief',evidenceLevel:'none',evidenceIds:[]}}],decisionSuggestions:[],workspace:context.snapshot.project.workspace,questionSuggestion:{taskId,subjectRevision:0,question:'Recorded the demo?',dueAt:new Date(now.getTime()+300000).toISOString()},reply:{text:'Scripted policy setup.',observationIds:[]}};
    await queue.commit(job,proposal);
    const q=(await h.pool.query('SELECT data FROM checkins WHERE project_id=$1',[job.projectId])).rows[0].data as c.CheckIn;
    return {projectId:job.projectId,q,job};
}
const snapshot=async(id:string)=>(await request('GET',`/v1/projects/${id}/snapshot`)).json() as c.ProjectSnapshot;

test('read_project_state exposes canonical questions without accepting invented question-card IDs',async()=>{
    await h.pool.query("UPDATE owners SET timezone='UTC',quiet_start=0,quiet_end=0");
    const {projectId,q,job}=await schedule();const s=await snapshot(projectId);
    expect(s.project.workspace.panels).toHaveLength(0);
    const read=executeReadTool({id:'canonical-question',name:'read_project_state',arguments:{}},{snapshot:s,grantVersions:[]}) as {checkIns:c.CheckIn[]};
    expect(read.checkIns).toEqual([q]);
    const proposal:c.ManagerProposal={schemaVersion:1,jobId:job.id,baseProjectRevision:job.baseProjectRevision,projectEpoch:job.projectEpoch,grantVersions:[],taskChanges:[],decisionSuggestions:[],workspace:{...s.project.workspace,panels:[{id:randomUUID(),heading:'Invented question',type:'question_card',checkInId:randomUUID()}]},reply:{text:'Invalid foreign reference.',observationIds:[]}};
    expect(()=>validateProposal(proposal,job,{snapshot:s,grantVersions:[]})).toThrow('proposal_component_references');
    expect((await request('POST',`/v1/checkins/${q.id}/answer`,command({kind:'not_yet'},q.revision))).statusCode).toBe(200);
    expect((await snapshot(projectId)).checkIns[0]!.state).toBe('answered');
});

test.each(['scheduler','snapshot'])('available questions lose authorization on quiet hours before any display acknowledgment: %s',async(path)=>{
    await h.pool.query("UPDATE owners SET timezone='UTC',quiet_start=12,quiet_end=13");
    const {projectId,q}=await schedule();now=new Date(q.dueAt);const scheduler=new CheckInScheduler(h.pool,()=>now);await scheduler.tick();
    const available=(await snapshot(projectId)).checkIns[0]!;expect(available.state).toBe('available');
    now.setUTCHours(12,0,0,0);
    if(path==='scheduler')await scheduler.tick();
    const suppressed=(await snapshot(projectId)).checkIns[0]!;
    expect(suppressed.state).toBe('scheduled');expect(suppressed.id).toBe(q.id);expect(suppressed.presentationId).toBe(q.presentationId);
    expect((await h.pool.query('SELECT data FROM checkins WHERE id=$1',[q.id])).rows[0].data.state).toBe('scheduled');
    now.setUTCHours(13,0,0,0);await new CheckInScheduler(h.pool,()=>now).tick();
    expect((await snapshot(projectId)).checkIns[0]).toMatchObject({id:q.id,presentationId:q.presentationId,state:'available'});
    expect((await h.pool.query('SELECT 1 FROM checkin_presentations')).rowCount).toBe(1);
});

test('snapshot withdraws a previously available question immediately on pause, preserving the canonical inbox record',async()=>{
    await h.pool.query("UPDATE owners SET timezone='UTC',quiet_start=0,quiet_end=0");
    const {projectId,q}=await schedule();now=new Date(q.dueAt);await new CheckInScheduler(h.pool,()=>now).tick();const before=await snapshot(projectId);expect(before.checkIns[0]!.state).toBe('available');
    await request('POST',`/v1/projects/${projectId}/actions`,command({type:'set_project_status',status:'paused'},before.project.revision));
    const paused=await snapshot(projectId);expect(paused.checkIns[0]).toMatchObject({id:q.id,presentationId:q.presentationId,state:'scheduled'});
    expect(paused.eventSequence).toBeGreaterThan(before.eventSequence);
    await request('POST',`/v1/projects/${projectId}/actions`,command({type:'set_project_status',status:'active'},paused.project.revision));
    await new CheckInScheduler(h.pool,()=>now).tick();expect((await snapshot(projectId)).checkIns[0]!.state).toBe('available');
});

test('new and legacy-default owners use three/day and 21:00-09:00 quiet boundaries',async()=>{
    const prefs=(await h.pool.query('SELECT * FROM owners WHERE id=$1',[h.ownerId])).rows[0] as ReminderPreferences;
    expect(prefs).toMatchObject({attention_limit:3,quiet_start:21,quiet_end:9});
    for(const hour of ['21:30','08:30'])expect(inQuietHours(new Date(`2026-11-08T${hour}:00Z`),{...prefs,timezone:'UTC'})).toBe(true);
    await h.pool.query('UPDATE owners SET quiet_start=22,quiet_end=8,attention_limit=6 WHERE id=$1',[h.ownerId]);
    await migrate(h.pool);
    expect((await h.pool.query('SELECT * FROM owners WHERE id=$1',[h.ownerId])).rows[0]).toMatchObject({attention_limit:3,quiet_start:21,quiet_end:9});
    await h.pool.query('UPDATE owners SET quiet_start=20,quiet_end=10,attention_limit=1 WHERE id=$1',[h.ownerId]);
    await migrate(h.pool);
    expect((await h.pool.query('SELECT * FROM owners WHERE id=$1',[h.ownerId])).rows[0]).toMatchObject({attention_limit:1,quiet_start:20,quiet_end:10});
});

test('account spacing is persisted across independent schedulers/projects; demo timing cannot admit a fourth daily question',async()=>{
    await h.pool.query("UPDATE owners SET timezone='UTC',quiet_start=0,quiet_end=0");
    const entries=[];for(let i=0;i<4;i++)entries.push(await schedule());
    now=new Date(now.getTime()+300000);
    const otherPool=new Pool({connectionString:process.env.DATABASE_URL,max:1});
    const previous=process.env.LP_DEMO_TIMING;process.env.LP_DEMO_TIMING='true';
    try{
        const first=new CheckInScheduler(h.pool,()=>now);const second=new CheckInScheduler(otherPool,()=>now);
        await Promise.all([first.tick(),second.tick()]);
        expect((await h.pool.query('SELECT 1 FROM checkin_presentations')).rowCount).toBe(1);
        now=new Date(now.getTime()+3599999);await new CheckInScheduler(otherPool,()=>now).tick();expect((await h.pool.query('SELECT 1 FROM checkin_presentations')).rowCount).toBe(1);
        now=new Date(now.getTime()+1);await first.tick();expect((await h.pool.query('SELECT 1 FROM checkin_presentations')).rowCount).toBe(2);
        now=new Date(now.getTime()+3600000);await second.tick();expect((await h.pool.query('SELECT 1 FROM checkin_presentations')).rowCount).toBe(3);
        now=new Date(now.getTime()+3600000);await first.tick();expect((await h.pool.query('SELECT 1 FROM checkin_presentations')).rowCount).toBe(3);
        const admitted=new Set((await h.pool.query('SELECT checkin_id FROM checkin_presentations')).rows.map(row=>row.checkin_id));
        const fourth=entries.find(entry=>!admitted.has(entry.q.id))!;expect((await snapshot(fourth.projectId)).checkIns[0]!.state).toBe('scheduled');
    }finally{if(previous===undefined)delete process.env.LP_DEMO_TIMING;else process.env.LP_DEMO_TIMING=previous;await otherPool.end();}
});

test.each([1,3])('deleting %i charged projects retains account-wide attention limits after migration',async(charged)=>{
    await h.pool.query("UPDATE owners SET timezone='UTC',quiet_start=0,quiet_end=0");
    const scheduler=new CheckInScheduler(h.pool,()=>now);
    for(let i=0;i<charged;i++){
        const {projectId,q}=await schedule();now=new Date(q.dueAt);await scheduler.tick();
        const before=await snapshot(projectId);expect(before.checkIns[0]!.state).toBe('available');
        // Recreate the deployed legacy relationship with a live charge before upgrading it.
        if(i===0)await h.pool.query('ALTER TABLE checkin_presentations DROP CONSTRAINT checkin_presentations_checkin_id_fkey; ALTER TABLE checkin_presentations ALTER COLUMN checkin_id SET NOT NULL; ALTER TABLE checkin_presentations ADD CONSTRAINT checkin_presentations_checkin_id_fkey FOREIGN KEY(checkin_id) REFERENCES checkins(id) ON DELETE CASCADE');
        await migrate(h.pool);await migrate(h.pool);
        expect((await request('DELETE',`/v1/projects/${projectId}`,command({},before.project.revision))).statusCode).toBe(200);
        if(i+1<charged)now=new Date(now.getTime()+3600000);
    }
    const next=await schedule();now=new Date(next.q.dueAt);await scheduler.tick();
    expect((await snapshot(next.projectId)).checkIns[0]!.state).toBe('scheduled');
    const reservations=await h.pool.query('SELECT checkin_id FROM checkin_presentations WHERE owner_id=$1',[h.ownerId]);
    expect(reservations.rows).toHaveLength(charged);
    expect(reservations.rows.every(row=>row.checkin_id===null)).toBe(true);
    if(charged===1){now=new Date(now.getTime()+3600000);await scheduler.tick();expect((await snapshot(next.projectId)).checkIns[0]!.state).toBe('available');}
    else{now=new Date(now.getTime()+3600000);await scheduler.tick();expect((await snapshot(next.projectId)).checkIns[0]!.state).toBe('scheduled');}
});
