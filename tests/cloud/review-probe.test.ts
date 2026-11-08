import { expect,test } from 'vitest';
import { HttpNemotronAdapter } from '@living-playbooks/nemotron';
import type { ManagerProposal } from '@living-playbooks/contracts';

const settings={baseUrl:'https://synthetic-nemotron.example/v1',model:'owner-selected-nemotron',apiKey:'synthetic-only',callBudget:8,tokenBudget:1000000};
type Body={tool_choice:unknown;messages:{role:string;content:string}[];response_format?:unknown};
function requested(body:Body):ManagerProposal{return JSON.parse(body.messages.find(message=>message.role==='user')!.content).requiredProposal;}
const tool=()=>Response.json({choices:[{message:{tool_calls:[{id:'auto-state',type:'function',function:{name:'read_project_state',arguments:'{}'}}]}}]});
function proposal(body:Body){
    const p=requested(body);const result=body.messages.find(message=>message.role==='tool');
    const goal=result?JSON.parse(result.content).project?.goal:undefined;
    return {...p,reply:{text:goal??p.reply.text,observationIds:[]}};
}
const content=(value:string)=>Response.json({choices:[{message:{content:value}}]});

test('forced-tool success with no automatic tool selection cannot enable inference',async()=>{
    let calls=0;
    const adapter=new HttpNemotronAdapter(settings,async(_url,init)=>{
        calls++;const body=JSON.parse(init!.body as string) as Body;
        return typeof body.tool_choice==='object'?tool():content(JSON.stringify(requested(body)));
    });
    const result=await adapter.probe(new AbortController().signal);
    expect(result.available).toBe(false);expect(result.toolCall).toBe(false);expect(calls).toBe(1);
});

test('scripted automatic selection consumes its real scoped result before a strict raw proposal, without a grammar backend assumption',async()=>{
    const bodies:Body[]=[];
    const adapter=new HttpNemotronAdapter(settings,async(_url,init)=>{
        const body=JSON.parse(init!.body as string) as Body;bodies.push(body);
        expect(new Headers(init!.headers).get('authorization')).toBe(`Bearer ${settings.apiKey}`);
        return body.messages.some(message=>message.role==='tool')?content(JSON.stringify(proposal(body))):tool();
    });
    const report=await adapter.probe(new AbortController().signal);
    expect(report).toMatchObject({available:true,toolCall:true,toolContinuation:true,structuredProposal:true});
    expect(bodies).toHaveLength(2);expect(bodies.every(body=>body.tool_choice==='auto')).toBe(true);
    expect(bodies.every(body=>body.response_format===undefined)).toBe(true);
    expect(bodies[1]!.messages.find(message=>message.role==='tool')!.content).toContain('project');
});

test.each(['ignores tool result','wrong epoch'])('shared shape alone cannot pass semantic probe validation: %s',async(kind)=>{
    let calls=0;
    const adapter=new HttpNemotronAdapter(settings,async(_url,init)=>{
        calls++;const body=JSON.parse(init!.body as string) as Body;
        if(!body.messages.some(message=>message.role==='tool'))return tool();
        const p=kind==='ignores tool result'?requested(body):{...proposal(body),projectEpoch:1};
        return content(JSON.stringify(p));
    });
    const report=await adapter.probe(new AbortController().signal);
    expect(report.available).toBe(false);expect(report.structuredProposal).toBe(false);expect(calls).toBe(3);
});

test('fenced JSON is never stripped; one additional model correction can return valid raw JSON',async()=>{
    let calls=0;
    const adapter=new HttpNemotronAdapter(settings,async(_url,init)=>{
        calls++;const body=JSON.parse(init!.body as string) as Body;
        if(calls===1)return tool();
        const raw=JSON.stringify(proposal(body));return content(calls===2?'```json\n'+raw+'\n```':raw);
    });
    expect((await adapter.probe(new AbortController().signal)).available).toBe(true);expect(calls).toBe(3);
});

test('two invalid raw proposals exhaust the one-repair allowance, and account budget never permits another HTTP submission',async()=>{
    for(const callBudget of [8,2]){
        let calls=0;
        const adapter=new HttpNemotronAdapter({...settings,callBudget},async()=>{calls++;return calls===1?tool():content('```json\n{}\n```');});
        expect((await adapter.probe(new AbortController().signal)).available).toBe(false);expect(calls).toBe(callBudget===2?2:3);
    }
});
