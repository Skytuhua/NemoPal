import { randomUUID } from 'node:crypto';
import { afterEach,beforeEach,expect,test } from 'vitest';
import { command,setup } from './helpers';
let h:Awaited<ReturnType<typeof setup>>;
beforeEach(async()=>{h=await setup();});afterEach(async()=>{await h.close();});
async function source(exportPolicy:'metadata_only'|'off'='metadata_only'){
    const {projectId}=await h.create();
    return (await h.request('POST',`/v1/projects/${projectId}/sources`,command({sourceKey:'health-synthetic',adapterId:'synthetic',adapterVersion:'1',capability:'incremental_history',exportPolicy},0))).json().result;
}
const healthy={grantRevision:0,state:'following',capability:'incremental_history',lastObservedAt:null,errorClass:null};
const ingest=(id:string)=>h.request('POST',`/v1/sources/${id}/observations`,command({observations:[{id:randomUUID(),bindingId:id,grantRevision:0,sourceItemId:randomUUID(),sourceRevision:'1',kind:'activity',occurredAt:new Date().toISOString(),observedAt:new Date().toISOString(),metadata:{type:'activity',state:'active'},provenance:{adapterId:'synthetic',adapterVersion:'1',mode:'fixture',evidenceLevel:'none'}}]}));
test.each(['stale','blocked'])('healthy report restores %s within the existing grant and permits ingestion without requesting inference',async(state)=>{
    const s=await source();const path=`/v1/sources/${s.id}/health`;
    await h.request('POST',path,command({...healthy,state,errorClass:'network'}));expect((await ingest(s.id)).statusCode).toBe(409);
    const jobs=(await h.pool.query('SELECT 1 FROM jobs')).rowCount;
    const recovered=await h.request('POST',path,command(healthy));expect(recovered.statusCode).toBe(200);expect(recovered.json().result).toMatchObject({state:'following',grantRevision:0,exportPolicy:'metadata_only',deviceId:s.deviceId});
    expect((await ingest(s.id)).statusCode).toBe(200);expect((await h.pool.query('SELECT 1 FROM jobs')).rowCount).toBe(jobs);
});
test.each(['paused','revoked','off'])('healthy source report cannot restore %s permission',async(state)=>{
    const s=await source(state==='off'?'off':'metadata_only');
    if(state==='paused')await h.request('POST',`/v1/sources/${s.id}/state`,command({grantRevision:0,state:'paused'}));
    if(state==='revoked')await h.request('POST',`/v1/sources/${s.id}/revoke`,command({grantRevision:0,removeExcerpts:true}));
    expect((await h.request('POST',`/v1/sources/${s.id}/health`,command(healthy))).statusCode).toBe(409);
    expect((await ingest(s.id)).statusCode).toBe(409);
});
