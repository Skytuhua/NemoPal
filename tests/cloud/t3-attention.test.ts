import { expect, it } from 'vitest';
import { bindingKey, T3Adapter, T3Attention, type AttentionRecord, type AttentionRepository, type NotificationInput, type T3Context, type QuestionRunBindingPort } from '../../apps/cloud/src/integrations/t3';

const time = Date.parse('2026-11-08T04:00:00Z');
function fixture() {
  let now = time, pending = true, offline = false, failSendblue = false, loseAck = false, runId = 'run';
  const context: T3Context = {
    grant: { bindingId: 'b', ownerId: 'owner', deviceId: 'device', environmentId: 'env', projectId: 'board', t3ProjectId: 'source', threadId: 'thread', revision: 1, expiresAt: time + 600000, revoked: false, startPosition: 0 },
    mapping: { ownerId: 'owner', projectId: 'board', taskId: 'task', taskRevision: 2, mappingRevision: 1, grantRevision: 1, runId: 'run', runOrdinal: 1 },
    completionPolicy: { enabled: false, revision: 1, criterionId: 'receipt' },
  };
  const current = structuredClone(context);
  const records = new Map<string, AttentionRecord>();
  const repository: AttentionRepository = {
    load: async key => structuredClone(records.get(key) ?? null),
    create: async record => { if (records.has(record.requestKey)) return false; records.set(record.requestKey, structuredClone(record)); return true; },
    compareAndSet: async (key, revision, next) => { if (records.get(key)?.revision !== revision) return false; records.set(key, structuredClone(next)); return true; },
  };
  const calls: { name: string; args: Record<string, unknown> }[] = [], pet: NotificationInput[] = [], sendblue: NotificationInput[] = [];
  const question = { requestId: 'request', questions: [{ id: 'choice', header: 'Secret title', question: 'PRIVATE QUESTION BODY', options: [{ label: 'One', description: 'PRIVATE OPTION', value: 'one' }, { label: 'Two', description: '', value: 'two' }], required: true, allowCustomAnswer: false }] };
  const adapter = new T3Adapter({ configuration: { endpoint: 'https://selected.invalid/mcp', environmentId: 'env' }, toolNames: ['t3_thread_read', 't3_pending_request', 'approve_everything'], permissions: ['orchestration:read', 'orchestration:operate'],
    callTool: async (name, args) => {
      calls.push({ name, args }); if (offline) throw Error('AUTH PRIVATE SECRET');
      if (name === 't3_thread_read') return { structuredContent: { thread: { threadId: 'thread', projectId: 'source', activeRunId: runId, latestRunId: runId, status: 'waiting', updatedAt: '2026-11-08T04:00:00Z' }, recentRuns: [{ runId, ordinal: 1, status: 'waiting' }], items: [], nextPosition: 0, hasMore: false } };
      if (args.action === 'list') return { structuredContent: { requestIds: pending ? ['request'] : [] } };
      if (args.action === 'read') return { content: [{ type: 'text', text: JSON.stringify(question) }] };
      pending = false; if (loseAck) throw Error('PRIVATE LOST ACK'); return { structuredContent: { sequence: 42 } };
    },
  }, async () => current, () => now);
  const sinks = {
    pet: { enqueue: async (input: NotificationInput) => { pet.push(input); return { state: 'accepted' as const }; } },
    sendblue: { enqueue: async (input: NotificationInput) => { if (failSendblue) throw Error('PROVIDER PRIVATE KEY'); sendblue.push(input); return { state: 'accepted' as const }; } },
  };
  const runBinding: QuestionRunBindingPort = { resolve: async (ctx, requestId, actionDigest) => ({ proofId: 'proof', kind: 'question', bindingKey: bindingKey(ctx), requestId, runId: ctx.mapping.runId, actionDigest, expiresAt: now + 300000 }) };
  const make = () => new T3Attention(context, adapter, repository, sinks, () => now, runBinding);
  return { context, current, records, repository, adapter, calls, pet, sendblue, question, make, sinks, runBinding, workflow: make(),
    expire: () => { now += 301000; }, revoke: () => { current.grant.revoked = true; }, offline: (flag: boolean) => { offline = flag; },
    sendblueFails: (flag: boolean) => { failSendblue = flag; }, lostAck: () => { loseAck = true; }, answered: () => { pending = false; }, replaceRun: () => { runId = 'run2'; } };
}
const principal = { ownerId: 'owner', deviceId: 'device', authenticated: true as const, channel: 'sendblue' as const };
function reply(record: AttentionRecord) { return { operationId: 'op', requestKey: record.requestKey, requestId: record.requestId, runId: record.runId,
  grantRevision: record.grantRevision, actionDigest: record.actionDigest, challenge: record.challenge, answers: { choice: 'two' } }; }

it('persists exact question identity and sends generic pet/text notifications without source bodies', async () => {
  const h = fixture(); const record = await h.workflow.captureQuestion('request');
  expect(record).toMatchObject({ environmentId: 'env', projectId: 'board', t3ProjectId: 'source', threadId: 'thread', runId: 'run', requestId: 'request', kind: 'question', grantRevision: 1, responseCapability: 'question' });
  expect(record.question!.questions[0]!.options.map(x => x.value)).toEqual(['one', 'two']);
  expect(await h.workflow.notify(record.requestKey)).toMatchObject({ pet: 'accepted', sendblue: 'accepted' });
  await h.make().notify(record.requestKey);
  expect(h.pet).toHaveLength(1); expect(h.sendblue).toHaveLength(1);
  expect(h.pet[0]).toMatchObject({ ownerId: 'owner', projectId: 'board', kind: 't3_question', requestKey: record.requestKey, expiresAt: time + 300000 });
  expect(JSON.stringify([...h.pet, ...h.sendblue])).not.toMatch(/PRIVATE|Secret title/);
  expect((await h.workflow.captureQuestion('request')).challenge).toBe(record.challenge);
});

it('routes the authenticated human answer to exactly the pending request, once across restart and concurrency', async () => {
  const h = fixture(); const record = await h.workflow.captureQuestion('request'); const input = reply(record);
  const results = await Promise.allSettled([h.workflow.respond(principal, input), h.make().respond(principal, input)]);
  expect(results.some(result => result.status === 'fulfilled')).toBe(true);
  const saved = h.records.get(record.requestKey)!;
  expect(saved.response).toMatchObject({ operationId: 'op', state: 'accepted', sequence: 42 });
  const sent = h.calls.filter(x => x.args.action === 'respond'); expect(sent).toHaveLength(1);
  expect(sent[0]).toEqual({ name: 't3_pending_request', args: { action: 'respond', environmentId: 'env', threadId: 'thread', requestId: 'request', answers: { choice: 'two' } } });
  expect(await h.make().respond(principal, input)).toMatchObject({ state: 'accepted', sequence: 42 });
  await expect(h.workflow.respond(principal, { ...input, operationId: 'op2' })).rejects.toThrow('replay');
  await expect(h.workflow.respond(principal, { ...input, answers: { choice: 'one' } })).rejects.toThrow('replay');
  expect((await h.workflow.reconcile(record.requestKey)).requestState).toBe('not_pending');
});

it.each(['ownerId', 'deviceId', 'authenticated'] as const)('rejects unauthenticated or wrong owner %s without transport', async key => {
  const h = fixture(); const record = await h.workflow.captureQuestion('request'); h.calls.length = 0;
  await expect(h.workflow.respond({ ...principal, [key]: key === 'authenticated' ? false : 'wrong' }, reply(record))).rejects.toThrow('wrong_owner'); expect(h.calls).toEqual([]);
});

it.each(['requestKey', 'requestId', 'runId', 'grantRevision', 'actionDigest', 'challenge'] as const)('rejects miscorrelated %s', async key => {
  const h = fixture(); const record = await h.workflow.captureQuestion('request');
  await expect(h.workflow.respond(principal, { ...reply(record), [key]: key === 'grantRevision' ? 2 : 'wrong' })).rejects.toThrow();
  expect(h.calls.filter(x => x.args.action === 'respond')).toEqual([]);
});

it.each(['expiry', 'revoke', 'answered', 'runReplacement', 'changedQuestion', 'invalidAnswer'] as const)('fences %s questions before a response', async kind => {
  const h = fixture(); const record = await h.workflow.captureQuestion('request'); let input = reply(record);
  if (kind === 'expiry') h.expire(); if (kind === 'revoke') h.revoke(); if (kind === 'answered') h.answered(); if (kind === 'runReplacement') h.replaceRun();
  if (kind === 'changedQuestion') h.question.questions[0]!.question = 'changed'; if (kind === 'invalidAnswer') input = { ...input, answers: { choice: 'approve' } };
  await expect(h.workflow.respond(principal, input)).rejects.toThrow();
  expect(h.calls.filter(x => x.args.action === 'respond')).toHaveLength(0);
});

it('retries a failed notification port with the same operation while preserving the successful sink', async () => {
  const h = fixture(); const record = await h.workflow.captureQuestion('request'); h.sendblueFails(true);
  expect(await h.workflow.notify(record.requestKey)).toEqual({ pet: 'accepted', sendblue: 'retryable' });
  h.sendblueFails(false); expect(await h.make().notify(record.requestKey)).toEqual({ pet: 'accepted', sendblue: 'accepted' });
  expect(h.pet).toHaveLength(1); expect(h.sendblue).toHaveLength(1); expect(h.sendblue[0]!.operationId).not.toBe(h.pet[0]!.operationId);
});

it('keeps preflight retry safe, lost acknowledgements uncertain and never automatically resends', async () => {
  const h = fixture(); const record = await h.workflow.captureQuestion('request'); const input = reply(record);
  h.offline(true); await expect(h.workflow.respond(principal, input)).rejects.toThrow('unavailable');
  expect(h.calls.filter(x => x.args.action === 'respond')).toHaveLength(0);
  h.offline(false); h.lostAck(); expect(await h.make().respond(principal, input)).toMatchObject({ state: 'uncertain' });
  expect(await h.make().respond(principal, input)).toMatchObject({ state: 'uncertain' });
  expect(h.calls.filter(x => x.args.action === 'respond')).toHaveLength(1);
  const saved = await h.workflow.reconcile(record.requestKey); expect(saved.requestState).toBe('not_pending'); expect(saved.response!.state).toBe('uncertain');
  expect(JSON.stringify(saved.response)).not.toMatch(/PRIVATE|AUTH|LOST|answers|choice/);
});

it('keeps permissions informative and manual even when a mock advertises/accepts approve', async () => {
  const h = fixture();
  const record = await h.workflow.permissionNotice({ environmentId: 'env', projectId: 'board', threadId: 'thread', runId: 'run', requestId: 'permission', grantRevision: 1,
    actionDigest: 'a'.repeat(64), offeredDecisions: ['accept', 'decline'], expiresAt: time + 60000 });
  expect(record.responseCapability).toBe('manual'); expect(h.adapter.capabilities().permissionResponse).toBe(false);
  await h.workflow.notify(record.requestKey); expect(h.sendblue[0]!.kind).toBe('t3_permission_notice'); expect(h.sendblue[0]!.text).toContain('Open in T3');
  h.calls.length = 0;
  await expect(h.workflow.respond(principal, { ...reply(record), answers: { choice: 'accept' } })).rejects.toThrow('permission_unsupported');
  await expect(h.adapter.answerPermission()).rejects.toThrow('permission_unsupported'); expect(h.calls).toEqual([]);
});

it('rejects out-of-scope notices and grant revocation prevents both sinks', async () => {
  const h = fixture(); const input = { environmentId: 'wrong', projectId: 'board', threadId: 'thread', runId: 'run', requestId: 'permission', grantRevision: 1, actionDigest: 'a'.repeat(64), offeredDecisions: ['accept'], expiresAt: time + 60000 };
  await expect(h.workflow.permissionNotice(input)).rejects.toThrow('stale_request'); expect(h.records.size).toBe(0);
  const record = await h.workflow.captureQuestion('request'); h.revoke();
  await expect(h.workflow.notify(record.requestKey)).rejects.toThrow('revoked'); expect(h.pet).toEqual([]); expect(h.sendblue).toEqual([]);
});

it('unknown/read-only response capability uses a truthful manual question fallback', async () => {
  const h = fixture();
  const adapter = new T3Adapter({ configuration: { endpoint: 'https://selected.invalid/mcp', environmentId: 'env' }, toolNames: ['t3_thread_read', 't3_pending_request'], permissions: ['orchestration:read'],
    callTool: async () => { throw Error('must not send'); } }, async () => h.context, () => time);
  const workflow = new T3Attention(h.context, adapter, h.repository, { pet: { enqueue: async () => ({ state: 'accepted' }) }, sendblue: { enqueue: async input => { h.sendblue.push(input); return { state: 'accepted' }; } } }, () => time);
  const record = await h.workflow.captureQuestion('request'); h.records.get(record.requestKey)!.responseCapability = 'manual';
  await expect(workflow.respond(principal, reply(record))).rejects.toThrow('capability_unavailable');
});

it('does not renew an expired challenge by rediscovering the same request', async () => {
  const h = fixture(); const record = await h.workflow.captureQuestion('request'); h.expire();
  await expect(h.make().captureQuestion('request')).rejects.toThrow('expired');
  expect(h.records.get(record.requestKey)!.expiresAt).toBe(time + 300000);
});

it('sanitizes repository errors before exposing them to authenticated ingress', async () => {
  const h = fixture(); const record = await h.workflow.captureQuestion('request');
  h.repository.load = async () => { throw Error('postgres://PRIVATE:CREDENTIAL@host/db'); };
  await expect(h.workflow.respond(principal, reply(record))).rejects.toThrow(/^unavailable$/);
});

it('does not notify the second sink after revocation during the first enqueue', async () => {
  const h = fixture(); const record = await h.workflow.captureQuestion('request');
  const workflow = new T3Attention(h.context, h.adapter, h.repository, {
    pet: { enqueue: async () => { h.revoke(); return { state: 'accepted' }; } },
    sendblue: { enqueue: async input => { h.sendblue.push(input); return { state: 'accepted' }; } },
  }, () => time, h.runBinding);
  await expect(workflow.notify(record.requestKey)).rejects.toThrow('revoked'); expect(h.sendblue).toEqual([]);
});

it('defaults remote question return off without verified request-to-run evidence', async () => {
  const h = fixture(); const workflow = new T3Attention(h.context, h.adapter, h.repository, h.sinks, () => time);
  const record = await workflow.captureQuestion('request'); expect(record.responseCapability).toBe('manual');
  await workflow.notify(record.requestKey); expect(h.sendblue[0]!.text).toContain('Open in T3');
  await expect(workflow.respond(principal, reply(record))).rejects.toThrow('capability_unavailable');
  expect(h.calls.filter(c => c.args.action === 'respond')).toEqual([]);
});

it('rejects wrong or expired request-run proofs before creating actionable attention', async () => {
  const h = fixture();
  h.runBinding.resolve = async (ctx, requestId, actionDigest) => ({ proofId: 'bad', kind: 'question', bindingKey: bindingKey(ctx), requestId, runId: 'old-run', actionDigest, expiresAt: time + 60000 });
  await expect(h.workflow.captureQuestion('request')).rejects.toThrow('stale_request'); expect(h.records.size).toBe(0);
  h.runBinding.resolve = async (ctx, requestId, actionDigest) => ({ proofId: 'bad', kind: 'question', bindingKey: bindingKey(ctx), requestId, runId: 'run', actionDigest, expiresAt: time });
  await expect(h.workflow.captureQuestion('request')).rejects.toThrow('stale_request'); expect(h.records.size).toBe(0);
});

it('a permission-shaped request proof cannot enable the question response path', async () => {
  const h = fixture();
  h.runBinding.resolve = async (ctx, requestId, actionDigest) => ({ proofId: 'bad', kind: 'permission' as never, bindingKey: bindingKey(ctx), requestId, runId: 'run', actionDigest, expiresAt: time + 60000 });
  await expect(h.workflow.captureQuestion('request')).rejects.toThrow('invalid_contract');
  expect(h.records.size).toBe(0); expect(h.calls.filter(c => c.args.action === 'respond')).toEqual([]);
});

it('rechecks challenge expiry after the final awaited transport authority guard', async () => {
  const h = fixture(); const record = await h.workflow.captureQuestion('request');
  const guard = h.adapter.guard.bind(h.adapter); let sendingGuards = 0;
  h.adapter.guard = async (context, signal) => {
    const result = await guard(context, signal);
    if (h.records.get(record.requestKey)?.response?.state === 'sending' && ++sendingGuards === 2) h.expire();
    return result;
  };
  await expect(h.workflow.respond(principal, reply(record))).rejects.toThrow('expired');
  expect(h.calls.filter(c => c.args.action === 'respond')).toEqual([]);
});
