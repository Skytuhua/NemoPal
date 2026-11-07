import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import * as c from '@living-playbooks/contracts';
export type NemotronSettings={baseUrl:string;model:string;apiKey:string;callBudget:number;tokenBudget:number};
export class ProviderError extends Error { constructor(code:string,public retryAfterSeconds=60){super(code);} }
const schema=z.toJSONSchema(c.ManagerProposalSchema,{unrepresentable:'any'});
const tools=[
  {name:'read_project_state',description:'Read assigned project state and source health.',properties:{}},
  {name:'list_recent_evidence',description:'List currently permitted evidence metadata.',properties:{}},
  {name:'read_evidence',description:'Read one permitted stored evidence record by ID.',properties:{observationId:{type:'string',format:'uuid'}}},
  {name:'read_project_document',description:'Read one assigned project draft by ID.',properties:{documentId:{type:'string',format:'uuid'}}},
].map(tool=>({type:'function',function:{name:tool.name,description:tool.description,parameters:{type:'object',properties:tool.properties,required:Object.keys(tool.properties),additionalProperties:false}}}));
export class HttpNemotronAdapter implements c.NemotronAdapter {
  private calls=0;private tokens=0;private endpoint:string;
  constructor(private settings:NemotronSettings,private fetcher:typeof fetch=fetch,private reserve?:(tokens:number)=>Promise<void>){
    let base:URL;try{base=new URL(settings.baseUrl);}catch{throw new Error('model_configuration');}
    if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!settings.apiKey.trim()||!settings.model.trim()||!Number.isSafeInteger(settings.callBudget)||settings.callBudget<=0||!Number.isSafeInteger(settings.tokenBudget)||settings.tokenBudget<=0)throw new Error('model_configuration');
    this.endpoint=`${base.href.replace(/\/$/,'')}/chat/completions`;
  }
  private async turn(input:c.ModelTurnInput,signal:AbortSignal,forceTool=false):Promise<c.ModelTurnResult>{
    c.ModelTurnInputSchema.parse(input);signal.throwIfAborted();
    if(c.utf8Bytes(JSON.stringify(input.messages))>c.LIMITS.contextBytes)throw new Error('input_budget');
    const messages=input.messages.map(m=>({role:m.role,content:m.content,...(m.toolCallId?{tool_call_id:m.toolCallId}:{}),...(m.toolCalls?{tool_calls:m.toolCalls.map(call=>({id:call.id,type:'function',function:{name:call.name,arguments:JSON.stringify(call.arguments)}}))}:{})}));
    const body={model:this.settings.model,messages,tools,tool_choice:forceTool?{type:'function',function:{name:'read_project_state'}}:'auto',parallel_tool_calls:false,stream:false,max_tokens:4096,response_format:{type:'json_schema',json_schema:{name:'ManagerProposal',strict:true,schema}}};
    const tokenReservation=c.utf8Bytes(JSON.stringify(body))+4096;
    if(this.calls>=this.settings.callBudget||this.tokens+tokenReservation>this.settings.tokenBudget)throw new Error('account_budget');
    await this.reserve?.(tokenReservation);this.calls++;this.tokens+=tokenReservation;
    let response:Response;
    try{response=await this.fetcher(this.endpoint,{method:'POST',headers:{Authorization:`Bearer ${this.settings.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal,redirect:'error'});}
    catch{signal.throwIfAborted();throw new ProviderError('provider_network');}
    if(response.status===202){await response.body?.cancel();throw new ProviderError('unsupported_pending');}
    if(!response.ok){const retry=Number(response.headers.get('retry-after'));await response.body?.cancel();throw new ProviderError(response.status===401||response.status===403?'provider_auth':response.status===429?'provider_rate_limit':response.status===400||response.status===422?'unsupported_schema':'provider_unavailable',Number.isFinite(retry)&&retry>0?Math.min(3600,retry):60);}
    if(response.redirected){await response.body?.cancel();throw new ProviderError('provider_redirect');}
    if(!response.headers.get('content-type')?.startsWith('application/json')){await response.body?.cancel();throw new ProviderError('unsupported_response');}
    if(!response.body)throw new ProviderError('unsupported_response');
    const reader=response.body.getReader();const decoder=new TextDecoder('utf-8',{fatal:true});let text='';let size=0;
    try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>131072)throw new ProviderError('output_budget');text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    try{
      const raw=JSON.parse(text) as {choices?:{message?:{tool_calls?:{id:string;function:{name:string;arguments:string}}[];content?:string;refusal?:unknown}}[];id?:string};
      if(raw.choices?.length!==1)throw new Error();const message=raw.choices[0]!.message;if(!message||message.refusal)throw new Error();
      const requestId=typeof raw.id==='string'&&raw.id.length<=256?{requestId:raw.id}:{};
      if(message.tool_calls?.length)return c.ModelTurnResultSchema.parse({type:'tool_calls',calls:message.tool_calls.map(call=>({id:call.id,name:call.function.name,arguments:JSON.parse(call.function.arguments)})),...requestId});
      if(typeof message.content!=='string')throw new Error();
      return c.ModelTurnResultSchema.parse({type:'proposal',proposal:JSON.parse(message.content),...requestId});
    }catch{throw new ProviderError('unsupported_response');}
  }
  async next(input:c.ModelTurnInput,signal:AbortSignal):Promise<c.ModelTurnResult>{return this.turn(input,signal);}
  async probe(signal:AbortSignal):Promise<c.ModelCapabilityReport>{
    const report={available:false,endpoint:this.endpoint,model:this.settings.model,toolCall:false,toolContinuation:false,structuredProposal:false,reason:'Capability probe did not pass.'};
    const projectId=randomUUID();const jobId=randomUUID();const workspace={schemaVersion:1,id:randomUUID(),revision:0,panels:[]};
    const required={schemaVersion:1,jobId,baseProjectRevision:0,projectEpoch:0,grantVersions:[],taskChanges:[],decisionSuggestions:[],workspace,reply:{text:'Synthetic capability probe.',observationIds:[]}};
    const messages:c.ModelMessage[]=[{role:'system',content:'Use read_project_state, then return the exact synthetic ManagerProposal requested. No other tools or actions.'},{role:'user',content:JSON.stringify({requiredProposal:required,projectId})}];
    try{
      const first=await this.turn({projectId,messages,remainingModelCalls:4,remainingToolCalls:6},signal,true);
      if(first.type!=='tool_calls'||first.calls.length!==1||first.calls[0]!.name!=='read_project_state')throw new Error('probe_tool');report.toolCall=true;
      messages.push({role:'assistant',content:'',toolCalls:first.calls},{role:'tool',toolCallId:first.calls[0]!.id,content:JSON.stringify({projectId,synthetic:true})});
      const second=await this.turn({projectId,messages,remainingModelCalls:3,remainingToolCalls:5},signal);
      if(second.type!=='proposal'||second.proposal.jobId!==jobId)throw new Error('probe_continuation');
      report.toolContinuation=true;report.structuredProposal=true;report.available=true;report.reason='Authenticated tool call, continuation and shared proposal schema passed.';
    }catch{report.reason='Capability unavailable; inspect sanitized operator diagnostics and exact route support.';}
    return c.ModelCapabilityReportSchema.parse(report);
  }
}
