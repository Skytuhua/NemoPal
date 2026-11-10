import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import * as c from '@living-playbooks/contracts';
import { BoundedRunner, HttpNemotronAdapter, InvalidProposalError } from '@living-playbooks/nemotron';
import { goldenSnapshot } from '../../fixtures/contracts/golden';

const settings = { baseUrl: 'https://synthetic.example/v1', model: 'synthetic-nemotron', apiKey: 'synthetic-only', callBudget: 4, tokenBudget: 1000000 };
const context = c.AuthorizedProjectContextSchema.parse({ snapshot: goldenSnapshot, grantVersions: [] });
const job = c.ManagerJobSchema.parse({ id: randomUUID(), projectId: context.snapshot.project.id, kind: 'initial_plan',
  baseProjectRevision: context.snapshot.project.revision, projectEpoch: context.snapshot.project.epoch, grantVersions: [],
  state: 'running', leaseGeneration: 1, tries: 1, runAfter: '2026-11-08T12:00:00.000Z', leaseExpiresAt: null,
  inputMessageId: null, modelCalls: 0, toolCalls: 0, errorClass: null });
const proposal: c.ManagerProposal = { schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision,
  projectEpoch: job.projectEpoch, grantVersions: [], taskChanges: [], decisionSuggestions: [],
  workspace: context.snapshot.project.workspace, reply: { text: 'A valid synthetic reply.', observationIds: [] } };
const input: c.ModelTurnInput = { projectId: job.projectId, messages: [{ role: 'user', content: 'Synthetic request.' }], remainingModelCalls: 4, remainingToolCalls: 6 };
const response = (value: unknown) => Response.json({ model: settings.model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(value) } }] });
const invalid = { ...proposal, taskChanges: [{ type: 'create', task: { id: 'private-provider-value', title: 'Task', status: 'todo', requirementOrigin: 'brief', evidenceLevel: 'none', evidenceIds: [] } }] };

test('invalid full proposals expose schema paths without rejected values or provider errors', async () => {
  const adapter = new HttpNemotronAdapter(settings, async () => response(invalid));
  const error = await adapter.next(input, new AbortController().signal).catch(value => value);
  expect(error).toBeInstanceOf(InvalidProposalError);
  expect(error.message).toBe('model_contract');
  expect(error.validationIssues).toContainEqual({ code: 'invalid_format', path: ['taskChanges', '*', 'task', 'id'] });
  expect(JSON.stringify(error)).not.toContain('private-provider-value');
});

test('schema diagnostics bound issue count and path depth and redact unknown path segments', () => {
  const error = new InvalidProposalError(Array.from({ length: 20 }, () => ({ code: 'custom', path: ['private-path-value', ...Array(20).fill('taskChanges')] })));
  expect(error.validationIssues).toHaveLength(8);
  expect(error.validationIssues.every(issue => issue.path.length <= 8)).toBe(true);
  expect(JSON.stringify(error)).not.toContain('private-path-value');
});

test('the existing single repair receives safe issue paths and returns the unchanged valid proposal', async () => {
  const bodies: { messages: { role: string; content: string }[] }[] = [];
  const adapter = new HttpNemotronAdapter(settings, async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return response(bodies.length === 1 ? invalid : proposal);
  });
  const result = await new BoundedRunner(adapter).run(job, context, new AbortController().signal);
  expect(result).toEqual(proposal);
  expect(bodies).toHaveLength(2);
  const repair = bodies[1]!.messages.at(-1)!.content;
  expect(repair).toContain('taskChanges');
  expect(repair).toContain('invalid_format');
  expect(repair).not.toContain('private-provider-value');

  let rejectedCalls = 0;
  const rejected = new HttpNemotronAdapter(settings, async () => { rejectedCalls++; return response(invalid); });
  await expect(new BoundedRunner(rejected).run(job, context, new AbortController().signal)).rejects.toThrow('model_contract');
  expect(rejectedCalls).toBe(2);
});

test.each([undefined, null])('reply evidence array type error receives targeted repair without discarding valid evidence (%s)', async invalidValue => {
  const evidenceId = context.snapshot.observations[0]!.id;
  const correct = { ...proposal, reply: { text: 'The source reports progress.', observationIds: [evidenceId] } };
  const malformed = { ...correct, reply: { ...correct.reply, observationIds: invalidValue } };
  const bodies: { messages: { role: string; content: string }[] }[] = [];
  const adapter = new HttpNemotronAdapter(settings, async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return response(bodies.length === 1 ? malformed : correct);
  });
  const result = await new BoundedRunner(adapter).run(job, context, new AbortController().signal);
  expect(result.reply.observationIds).toEqual([evidenceId]);
  expect(bodies).toHaveLength(2);
  const initial = bodies[0]!.messages.find(message => message.content.includes('latestOwnerInput'))!.content;
  expect(initial).toMatch(/reply\.observationIds.{0,100}array/i);
  expect(initial).toMatch(/empty.{0,40}no evidence/i);
  expect(initial).toMatch(/never invent/i);
  const repair = bodies[1]!.messages.at(-1)!.content;
  expect(repair).toMatch(/reply\.observationIds.{0,100}array/i);
  expect(repair).toMatch(/empty.{0,40}no evidence/i);
  expect(repair).toMatch(/never invent/i);
  expect(repair).not.toContain(evidenceId);
});

test('malformed raw JSON stays rejected without copying its text into diagnostics', async () => {
  const adapter = new HttpNemotronAdapter(settings, async () => Response.json({ model: settings.model,
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '```json private-provider-value ```' } }] }));
  const error = await adapter.next(input, new AbortController().signal).catch(value => value);
  expect(error).toBeInstanceOf(InvalidProposalError);
  expect(error.validationIssues).toEqual([]);
  expect(JSON.stringify(error)).not.toContain('private-provider-value');
});

test('production prompts provide valid distinct task IDs and reuse them through repair', async () => {
  const inputs: c.ModelTurnInput[] = [];
  let expected: c.ManagerProposal | undefined;
  const adapter: c.NemotronAdapter = {
    probe: async () => { throw Error('No provider access'); },
    next: async input => {
      inputs.push(structuredClone(input));
      const payload = JSON.parse(input.messages[1]!.content);
      expect(payload.newTaskIds).toHaveLength(c.LIMITS.tasks - context.snapshot.project.tasks.length);
      expect(new Set(payload.newTaskIds).size).toBe(payload.newTaskIds.length);
      for (const id of payload.newTaskIds) {
        expect(c.IdSchema.safeParse(id).success).toBe(true);
        expect(context.snapshot.project.tasks.some(task => task.id === id)).toBe(false);
      }
      if (inputs.length === 1) throw new InvalidProposalError();
      expect(payload.newTaskIds).toEqual(JSON.parse(inputs[0]!.messages[1]!.content).newTaskIds);
      expected = { ...proposal, taskChanges: [{ type: 'create', task: { id: payload.newTaskIds[0], title: 'New task',
        status: 'todo', requirementOrigin: 'brief', evidenceLevel: 'none', evidenceIds: [] } }] };
      return { type: 'proposal', proposal: expected };
    },
  };
  const result = await new BoundedRunner(adapter).run(job, context, new AbortController().signal);
  expect(result).toEqual(expected);
  expect(inputs).toHaveLength(2);
  expect(inputs[0]!.messages[0]!.content).toContain('existing task IDs');
  expect(inputs[0]!.messages[0]!.content).toContain('newTaskIds');
  expect(inputs[0]!.messages[0]!.content).toMatch(/only.{0,30}fields.{0,30}schema/i);
  expect(inputs[0]!.messages[0]!.content).toMatch(/no extra.{0,30}top.level.{0,30}nested/i);
});

test('a full project receives no preallocated new task IDs', async () => {
  const full = structuredClone(context);
  full.snapshot.project.tasks = Array.from({ length: c.LIMITS.tasks }, (_, index) => ({ ...context.snapshot.project.tasks[0]!,
    id: index === 0 ? context.snapshot.project.tasks[0]!.id : randomUUID() }));
  const adapter: c.NemotronAdapter = {
    probe: async () => { throw Error('No provider access'); },
    next: async input => {
      expect(JSON.parse(input.messages[1]!.content).newTaskIds).toEqual([]);
      return { type: 'proposal', proposal };
    },
  };
  await expect(new BoundedRunner(adapter).run(job, full, new AbortController().signal)).resolves.toEqual(proposal);
});

test('an existing task ID in a create proposal receives targeted repair while validation stays strict', async () => {
  const existing = context.snapshot.project.tasks[0]!;
  const collision: c.ManagerProposal = { ...proposal, taskChanges: [{ type: 'create', task: {
    id: existing.id, title: 'Synthetic task', status: 'todo', requirementOrigin: 'brief', evidenceLevel: 'none', evidenceIds: [],
  } }] };
  const inputs: c.ModelTurnInput[] = [];
  const adapter: c.NemotronAdapter = { probe: async () => { throw Error('No provider access'); }, next: async input => {
    inputs.push(structuredClone(input));
    return { type: 'proposal', proposal: inputs.length === 1 ? collision : proposal };
  } };
  await expect(new BoundedRunner(adapter).run(job, context, new AbortController().signal)).resolves.toEqual(proposal);
  expect(inputs).toHaveLength(2);
  const instruction = inputs[1]!.messages.at(-1)!.content;
  expect(instruction).toMatch(/already exists/i);
  expect(instruction).toContain('newTaskIds');
  expect(instruction).not.toContain(existing.id);

  let calls = 0;
  const rejects: c.NemotronAdapter = { probe: adapter.probe, next: async () => { calls++; return { type: 'proposal', proposal: collision }; } };
  await expect(new BoundedRunner(rejects).run(job, context, new AbortController().signal)).rejects.toThrow('proposal_task_identity');
  expect(calls).toBe(2);
});

test('owner-message prompt distinguishes questions from requests to change tasks', async () => {
  const owner = c.ChatMessageSchema.parse({ id: randomUUID(), projectId: job.projectId, role: 'owner', text: 'Summarize the project.', createdAt: job.runAfter, observationIds: [] });
  const snapshot = { ...context.snapshot, messages: [...context.snapshot.messages, owner] };
  const ownerJob = { ...job, kind: 'owner_message' as const, inputMessageId: owner.id };
  let instruction = '';
  const adapter: c.NemotronAdapter = { probe: async () => { throw Error('No provider access'); }, next: async input => {
    instruction = input.messages[0]!.content;
    return { type: 'proposal', proposal };
  } };
  await new BoundedRunner(adapter).run(ownerJob, { ...context, snapshot }, new AbortController().signal);
  expect(instruction).toMatch(/information.{0,80}taskChanges/i);
  expect(instruction).toMatch(/asks.{0,80}change/i);
});

test('an explicit owner task request may still create a valid task', async () => {
  const owner = c.ChatMessageSchema.parse({ id: randomUUID(), projectId: job.projectId, role: 'owner', text: 'Add a task to review the demo.', createdAt: job.runAfter, observationIds: [] });
  const snapshot = { ...context.snapshot, messages: [...context.snapshot.messages, owner] };
  const ownerJob = { ...job, kind: 'owner_message' as const, inputMessageId: owner.id };
  const adapter: c.NemotronAdapter = { probe: async () => { throw Error('No provider access'); }, next: async input => {
    const newTaskId = JSON.parse(input.messages[1]!.content).newTaskIds[0];
    return { type: 'proposal', proposal: { ...proposal, taskChanges: [{ type: 'create', task: { id: newTaskId,
      title: 'Review the demo', status: 'todo', requirementOrigin: 'brief', evidenceLevel: 'none', evidenceIds: [] } }] } };
  } };
  const result = await new BoundedRunner(adapter).run(ownerJob, { ...context, snapshot }, new AbortController().signal);
  expect(result.taskChanges).toHaveLength(1);
  expect(result.taskChanges[0]).toMatchObject({ type: 'create', task: { title: 'Review the demo' } });
});
