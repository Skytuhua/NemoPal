import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import type { ManagerProposal } from '@living-playbooks/contracts';

const entry = fileURLToPath(new URL('../live/model.ts', import.meta.url));
const environment = {
  LP_LIVE_TEST_OPT_IN: '1', LP_MODEL_LIVE_OPT_IN: 'true',
  NEMOTRON_BASE_URL: 'https://synthetic-nemotron.example/v1',
  NEMOTRON_MODEL: 'synthetic-selected-model', NVIDIA_API_KEY: 'synthetic-key-never-print',
  LP_MODEL_CALL_BUDGET: '4', LP_MODEL_TOKEN_BUDGET: '1000000',
};
const loadGate = async () => {
  expect(existsSync(entry), 'the dispatched live-model entry point must exist').toBe(true);
  return import('../live/model');
};
type Body = {
  model: string; tool_choice: unknown; max_tokens: number; response_format?: unknown;
  messages: { role: string; content: string; tool_call_id?: string; tool_calls?: { id: string }[] }[];
};
const tool = () => Response.json({ model: environment.NEMOTRON_MODEL, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ id: 'synthetic-auto', type: 'function', function: { name: 'read_project_state', arguments: '{}' } }] } }] });
const content = (value: string) => Response.json({ model: environment.NEMOTRON_MODEL, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: value } }] });
function proposal(body: Body): ManagerProposal {
  const required = JSON.parse(body.messages.find(message => message.role === 'user')!.content).requiredProposal as ManagerProposal;
  const result = body.messages.find(message => message.role === 'tool');
  return { ...required, reply: { text: result ? JSON.parse(result.content).project.goal : required.reply.text, observationIds: [] } };
}
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

test('direct invocation cannot bypass either explicit operator opt-in', () => {
  expect(existsSync(entry), 'the dispatched live-model entry point must exist').toBe(true);
  for (const missing of ['LP_LIVE_TEST_OPT_IN', 'LP_MODEL_LIVE_OPT_IN']) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', entry], {
      encoding: 'utf8', timeout: 10000,
      env: { SYSTEMROOT: process.env.SYSTEMROOT, ...environment, NEMOTRON_BASE_URL: 'http://synthetic.example/v1', [missing]: '' },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'BLOCKED', blocker: 'operator_opt_in', probeAttempted: false });
    expect(result.stdout).not.toContain(environment.NVIDIA_API_KEY);
  }
});

test.each([
  ['LP_LIVE_TEST_OPT_IN', 'true'], ['LP_MODEL_LIVE_OPT_IN', '1'],
  ['NEMOTRON_BASE_URL', ''], ['NEMOTRON_BASE_URL', 'http://synthetic.example/v1'],
  ['NEMOTRON_BASE_URL', 'https://user:secret@synthetic.example/v1'],
  ['NEMOTRON_BASE_URL', 'https://synthetic.example/v1?key=secret'],
  ['NEMOTRON_BASE_URL', 'https://synthetic.example/v1#secret'],
  ['NEMOTRON_MODEL', ''], ['NEMOTRON_MODEL', '   '], ['NVIDIA_API_KEY', ''], ['NVIDIA_API_KEY', '   '],
  ...['LP_MODEL_CALL_BUDGET', 'LP_MODEL_TOKEN_BUDGET'].flatMap(name =>
    ['', '0', '-1', '1.5', 'Infinity', 'NaN', '9007199254740992'].map(value => [name, value])),
])('invalid %s=%s cannot submit an HTTP request', async (name, value) => {
  const { runModelGate } = await loadGate();
  let requests = 0;
  const result = await runModelGate({ ...environment, [name!]: value! }, async () => { requests++; return tool(); });
  expect(requests).toBe(0);
  expect(result.exitCode).toBe(2);
  expect(result.evidence).toMatchObject({ status: 'BLOCKED', probeAttempted: false });
  expect(JSON.stringify(result)).not.toContain(environment.NVIDIA_API_KEY);
});

test('the production probe authenticates, selects AUTO and interprets its nonce-bearing tool result before schema/authority validation', async () => {
  const { runModelGate } = await loadGate();
  const bodies: Body[] = [];
  const result = await runModelGate(environment, async (url, init) => {
    expect(url).toBe('https://synthetic-nemotron.example/v1/chat/completions');
    expect(new Headers(init!.headers).get('authorization')).toBe(`Bearer ${environment.NVIDIA_API_KEY}`);
    expect(init!.redirect).toBe('error');
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init!.body as string) as Body;
    bodies.push(body);
    expect(body).toMatchObject({ model: environment.NEMOTRON_MODEL, tool_choice: 'auto', max_tokens: 4096 });
    expect(body.response_format).toBeUndefined();
    if (!body.messages.some(message => message.role === 'tool')) return tool();
    const toolResult = body.messages.find(message => message.role === 'tool')!;
    expect(toolResult.tool_call_id).toBe('synthetic-auto');
    expect(body.messages.find(message => message.role === 'assistant')!.tool_calls).toEqual([expect.objectContaining({ id: 'synthetic-auto' })]);
    expect(JSON.parse(toolResult.content).project.goal).toMatch(/^Synthetic tool-result goal [a-f0-9-]{36}$/);
    return content(JSON.stringify(proposal(body)));
  });
  expect(bodies).toHaveLength(2);
  expect(result.exitCode).toBe(2);
  expect(result.evidence).toMatchObject({
    status: 'BLOCKED', blocker: 'synthetic_only', execution: 'synthetic', probeAttempted: true,
    probePassed: true, toolSelection: true, toolResultInterpreted: true,
    strictProposalSchema: true, proposalAuthorityValidated: true, fullAppVerified: false,
    modelCallLimit: 4, modelCalls: 2, tokenAllowance: 1000000, deadlineMs: 120000,
    endpointSha256: sha256('https://synthetic-nemotron.example/v1/chat/completions'),
    modelSha256: sha256(environment.NEMOTRON_MODEL),
  });
  expect(result.evidence.reservedTokens).toBeGreaterThan(8192);
  const receipt = JSON.stringify(result);
  for (const value of [environment.NVIDIA_API_KEY, environment.NEMOTRON_BASE_URL, environment.NEMOTRON_MODEL, 'Synthetic tool-result goal', 'requiredProposal']) expect(receipt).not.toContain(value);
});

test.each(['fenced', 'wrong_epoch', 'owner_authority', 'extra_field', 'ignores_result', 'missing_field'])('%s proposals never pass through client JSON repair or skipped schema/authority validation', async kind => {
  const { runModelGate } = await loadGate();
  let calls = 0;
  const result = await runModelGate(environment, async (_url, init) => {
    calls++;
    const body = JSON.parse(init!.body as string) as Body;
    if (calls === 1) return tool();
    const p = proposal(body);
    if (kind === 'wrong_epoch') p.projectEpoch = 1;
    if (kind === 'owner_authority') p.taskChanges = [{ type: 'create', task: { id: '11111111-1111-4111-8111-111111111111', title: 'Synthetic', status: 'todo', requirementOrigin: 'model_suggestion', evidenceLevel: 'user_reported', evidenceIds: [] } }];
    if (kind === 'ignores_result') p.reply.text = 'Read the project goal from the tool result.';
    const raw = JSON.stringify(kind === 'extra_field' ? { ...p, ownerOverride: true } : kind === 'missing_field' ? { schemaVersion: 1 } : p);
    return content(kind === 'fenced' ? '```json\n' + raw + '\n```' : raw);
  });
  expect(calls).toBe(3);
  expect(result.exitCode).toBe(2);
  expect(result.evidence).toMatchObject({ status: 'BLOCKED', blocker: 'probe_failed', probePassed: false, toolSelection: true, toolResultInterpreted: false, strictProposalSchema: false, proposalAuthorityValidated: false, modelCalls: 3 });
});

test('only one model correction may replace fenced JSON with a valid raw proposal', async () => {
  const { runModelGate } = await loadGate();
  let calls = 0;
  const result = await runModelGate(environment, async (_url, init) => {
    calls++;
    const body = JSON.parse(init!.body as string) as Body;
    if (calls === 1) return tool();
    const raw = JSON.stringify(proposal(body));
    return content(calls === 2 ? '```json\n' + raw + '\n```' : raw);
  });
  expect(calls).toBe(3);
  expect(result.evidence).toMatchObject({ status: 'BLOCKED', blocker: 'synthetic_only', probePassed: true, modelCalls: 3 });
});

test.each([
  { LP_MODEL_CALL_BUDGET: '1', LP_MODEL_TOKEN_BUDGET: '1000000', requests: 1 },
  { LP_MODEL_CALL_BUDGET: '2', LP_MODEL_TOKEN_BUDGET: '1000000', requests: 2 },
  { LP_MODEL_CALL_BUDGET: '4', LP_MODEL_TOKEN_BUDGET: '1', requests: 0 },
])('finite allowance $LP_MODEL_CALL_BUDGET/$LP_MODEL_TOKEN_BUDGET stops before overspending', async setting => {
  const { runModelGate } = await loadGate();
  let calls = 0;
  const { requests, ...allowance } = setting;
  const result = await runModelGate({ ...environment, ...allowance }, async () => {
    calls++; return calls === 1 ? tool() : content('```json\n{}\n```');
  });
  expect(calls).toBe(requests);
  expect(result.exitCode).toBe(2);
  expect(result.evidence).toMatchObject({ status: 'BLOCKED', probePassed: false, modelCalls: requests });
  expect(result.evidence.reservedTokens).toBeLessThanOrEqual(Number(setting.LP_MODEL_TOKEN_BUDGET));
});

test.each(['network', 'http', 'no_auto_tool'])('%s failure is blocked without raw HTTP, errors or keys', async kind => {
  const { runModelGate } = await loadGate();
  let calls = 0;
  const privateData = 'PRIVATE_PROVIDER_SOURCE_BODY';
  const result = await runModelGate(environment, async () => {
    calls++;
    if (kind === 'network') throw new Error(privateData + environment.NVIDIA_API_KEY);
    if (kind === 'http') return new Response(privateData, { status: 401 });
    return content('{}');
  });
  expect(calls).toBe(1);
  expect(result.exitCode).toBe(2);
  expect(result.evidence).toMatchObject({ status: 'BLOCKED', blocker: 'probe_failed', probePassed: false, toolSelection: false });
  expect(JSON.stringify(result)).not.toContain(privateData);
  expect(JSON.stringify(result)).not.toContain(environment.NVIDIA_API_KEY);
});
