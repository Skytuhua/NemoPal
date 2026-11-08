import { spawn,type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp,rmdir,unlink } from 'node:fs/promises';
import { connect,createServer,type Socket } from 'node:net';
import { join,resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { Pool } from 'pg';
import { expect,test } from 'vitest';

const safeLog='Cloud database connection unavailable.';
function database(){
    const url=new URL(process.env.DATABASE_URL??'');
    if(url.hostname!=='127.0.0.1'||url.port!=='55432'||url.pathname!=='/playbooks_test'||url.username!=='playbooks')
        throw new Error('Resilience tests require the dedicated local playbooks_test database.');
    return url;
}
async function eventually(check:()=>boolean|Promise<boolean>,timeout=5000){
    const until=Date.now()+timeout;
    while(Date.now()<until){if(await check())return true;await delay(25);}
    return false;
}
async function port(){
    const server=createServer();await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
    const result=(server.address() as {port:number}).port;await new Promise<void>(done=>server.close(()=>done()));return result;
}
async function withCloud(url:URL,run:(cloud:{child:ChildProcess;status:(path:string)=>Promise<number>;unavailable:()=>Promise<boolean>;logs:()=>string;started:()=>string})=>Promise<void>){
    const directory=await mkdtemp(join(resolve('tests/cloud'),'.resilience-'));const entry=join(directory,'cloud.mjs');
    let child:ChildProcess|undefined;
    try{
        await build({entryPoints:['apps/cloud/src/main.ts'],bundle:true,platform:'node',format:'esm',target:'node24',external:['fastify','pg'],outfile:entry});
        const httpPort=await port();let stderr='';let stdout='';
        child=spawn(process.execPath,[entry],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,DATABASE_URL:url.href,PORT:String(httpPort),PUBLIC_ORIGIN:`http://127.0.0.1:${httpPort}`}});
        // Keep raw child output private in memory, including RED runs; assertions only expose booleans/statuses.
        child.stderr!.on('data',(bytes:Buffer)=>{stderr=(stderr+bytes.toString()).slice(0,65536);});
        child.stdout!.on('data',(bytes:Buffer)=>{stdout=(stdout+bytes.toString()).slice(0,65536);});
        expect(await eventually(()=>stdout.includes('cloud started.')),'Bundled cloud must start without live model configuration.').toBe(true);
        const status=async(path:string)=>{
            try{const response=await fetch(`http://127.0.0.1:${httpPort}${path}`,{signal:AbortSignal.timeout(1500)});await response.body?.cancel();return response.status;}
            catch{return 0;}
        };
        const unavailable=async()=>{
            try{
                const response=await fetch(`http://127.0.0.1:${httpPort}/health/ready`,{signal:AbortSignal.timeout(1500)});
                const body=await response.json() as Record<string,unknown>;
                return response.status===503&&Object.keys(body).length===3&&body.code==='unavailable'&&body.message==='A required dependency is unavailable.'&&body.retryable===true;
            }catch{return false;}
        };
        await run({child,status,unavailable,logs:()=>stderr,started:()=>stdout});
    }finally{
        if(child&&child.exitCode===null&&!child.killed){const exited=once(child,'exit');child.kill();await exited;}
        await unlink(entry).catch(()=>{});await rmdir(directory);
    }
}

test('bundled cloud survives termination of its uniquely tagged idle PostgreSQL client after readiness without exposing raw errors',async()=>{
    const url=database();const admin=new Pool({connectionString:url.href,max:1});
    const tag=`lp-idle-regression-${randomUUID()}`;url.searchParams.set('application_name',tag);
    try{
        await withCloud(url,async cloud=>{
            expect(await cloud.status('/health/ready')).toBe(200);
            const owned=(await admin.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND datname=current_database() AND usename=current_user AND state='idle'",[tag])).rows;
            expect(owned.length>0,'Readiness must have returned an app-owned client to idle.').toBe(true);
            // No shared service is stopped. The WHERE clause admits only this exact synthetic app tag.
            const killed=await admin.query("SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE pid=$1 AND application_name=$2 AND datname=current_database() AND usename=current_user AND state='idle'",[owned[0]!.pid,tag]);
            expect(killed.rows[0]?.terminated).toBe(true);
            expect(await eventually(()=>cloud.child.exitCode!==null||cloud.logs().length>0)).toBe(true);
            expect(cloud.child.exitCode,'An idle-client connection loss must not terminate the process.').toBeNull();
            expect(cloud.logs().trim().split(/\r?\n/).every(line=>line===safeLog),'Only the fixed sanitized connection diagnostic may be emitted.').toBe(true);
            expect(await cloud.status('/health/live')).toBe(200);
            expect(await cloud.status('/health/ready')).toBe(200);
            expect(await cloud.status('/v1/projects')).toBe(401);
            expect(cloud.started().includes('Nemotron capability: BLOCKED.')).toBe(true);
        });
    }finally{await admin.end();}
});

test('bundled cloud stays live with ready503 during an isolated database connectivity outage and recovers ready200 without restarting',async()=>{
    const url=database();let online=true;const sockets=new Set<Socket>();
    // Test-owned TCP fixture forwards only this cloud process to the existing dedicated database.
    const proxy=createServer(client=>{
        if(!online){client.destroy();return;}
        const upstream=connect({host:'127.0.0.1',port:55432});
        for(const socket of [client,upstream]){sockets.add(socket);socket.on('error',()=>{client.destroy();upstream.destroy();});socket.on('close',()=>sockets.delete(socket));}
        client.pipe(upstream);upstream.pipe(client);
    });
    await new Promise<void>(done=>proxy.listen(0,'127.0.0.1',done));
    url.port=String((proxy.address() as {port:number}).port);url.searchParams.set('application_name',`lp-outage-regression-${randomUUID()}`);
    try{
        await withCloud(url,async cloud=>{
            expect(await cloud.status('/health/ready')).toBe(200);
            online=false;for(const socket of sockets)socket.destroy();
            expect(await eventually(()=>cloud.child.exitCode!==null||cloud.logs().length>0)).toBe(true);
            expect(cloud.child.exitCode,'Connectivity loss must leave process liveness available.').toBeNull();
            expect(await cloud.status('/health/live')).toBe(200);
            expect(await cloud.status('/health/ready')).toBe(503);
            expect(await cloud.unavailable(),'Readiness must return only the fixed sanitized API error while the database is unreachable.').toBe(true);
            expect(await cloud.status('/v1/projects')).toBe(401);
            online=true;
            expect(await eventually(async()=>await cloud.status('/health/ready')===200),'A fresh database query must prove readiness after connectivity returns.').toBe(true);
            expect(cloud.child.exitCode).toBeNull();
            expect(await cloud.status('/v1/projects')).toBe(401);
            expect(cloud.logs().trim().split(/\r?\n/).every(line=>line===safeLog),'No stack, client object, connection configuration or provider body may be logged.').toBe(true);
            expect(cloud.started().includes('Nemotron capability: BLOCKED.')).toBe(true);
        });
    }finally{
        for(const socket of sockets)socket.destroy();await new Promise<void>(done=>proxy.close(()=>done()));
    }
});
