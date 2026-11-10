import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as c from '@living-playbooks/contracts';
import { HttpNemotronAdapter } from '@living-playbooks/nemotron';
import { goldenSnapshot } from '../../fixtures/contracts/golden';
import type { JobQueue } from '../../apps/cloud/src/jobs/queue';
import { runJob } from '../../apps/cloud/src/jobs/worker';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const settings = { baseUrl: 'https://synthetic.invalid/v1', model: 'synthetic-nemotron', apiKey: 'synthetic', callBudget: 4, tokenBudget: 524288 };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each(['revoked', 'current'] as const)('rechecks job authority after a held continuation reservation: %s', async state => {
  const snapshot = c.ProjectSnapshotSchema.parse(goldenSnapshot);
  const grantVersions = snapshot.sourceBindings.map(binding => ({ bindingId: binding.id, grantRevision: binding.grantRevision }));
  const context = c.AuthorizedProjectContextSchema.parse({ snapshot, grantVersions });
  const job = c.ManagerJobSchema.parse({ id: randomUUID(), projectId: snapshot.project.id, kind: 'reflection', baseProjectRevision: snapshot.project.revision,
    projectEpoch: snapshot.project.epoch, grantVersions, state: 'running', leaseGeneration: 1, tries: 1,
    runAfter: new Date().toISOString(), leaseExpiresAt: new Date(Date.now() + 60000).toISOString(), inputMessageId: null, modelCalls: 0, toolCalls: 0, errorClass: null });
  let authorized = true, reservations = 0;
  const held = deferred(), release = deferred();
  const sent: { authorized: boolean; excerpt: boolean }[] = [];
  const commit = vi.fn(async () => { if (!authorized) throw Error('proposal_stale'); });
  const fail = vi.fn(async () => {});
  const queue = { context: vi.fn(async () => { if (!authorized) throw Error('proposal_stale'); return context; }), commit, fail,
    countCall: vi.fn(async () => {}), countTool: vi.fn(async () => {}), receipt: vi.fn(async () => {}), claimRepair: vi.fn(async () => false), renew: vi.fn(async () => {}) } as unknown as JobQueue;
  const adapter = new HttpNemotronAdapter(settings, async (_url, input) => {
    sent.push({ authorized, excerpt: String(input?.body).includes(snapshot.observations[0]!.excerpt!) });
    const message = sent.length === 1
      ? { role: 'assistant', tool_calls: [{ id: 'read', type: 'function', function: { name: 'read_evidence', arguments: JSON.stringify({ observationId: snapshot.observations[0]!.id }) } }] }
      : { role: 'assistant', content: JSON.stringify({ schemaVersion: 1, jobId: job.id, baseProjectRevision: job.baseProjectRevision,
        projectEpoch: job.projectEpoch, grantVersions, taskChanges: [], decisionSuggestions: [], workspace: snapshot.project.workspace, reply: { text: 'Synthetic.', observationIds: [] } }) };
    return Response.json({ model: settings.model, choices: [{ finish_reason: sent.length === 1 ? 'tool_calls' : 'stop', message }] });
  }, async () => { if (++reservations === 2) { held.resolve(); await release.promise; } });
  const running = runJob(queue, adapter, job, new AbortController().signal);
  await held.promise;
  authorized = state === 'current'; release.resolve(); await running;
  expect(reservations).toBe(2); // A denied send never refunds an existing reservation.
  if (state === 'revoked') { expect(sent).toEqual([{ authorized: true, excerpt: false }]); expect(commit).not.toHaveBeenCalled(); expect(fail).toHaveBeenCalledTimes(1); }
  else { expect(sent).toEqual([{ authorized: true, excerpt: false }, { authorized: true, excerpt: true }]); expect(commit).toHaveBeenCalledTimes(1); expect(fail).not.toHaveBeenCalled(); }
});

it('does not initiate transport when cancellation occurs during budget reservation', async () => {
  const held = deferred(), release = deferred(), controller = new AbortController();
  const send = vi.fn(async () => Response.json({ model: settings.model, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [
    { id: 'read', type: 'function', function: { name: 'read_project_state', arguments: '{}' } },
  ] } }] }));
  const adapter = new HttpNemotronAdapter(settings, send, async () => { held.resolve(); await release.promise; });
  const result = adapter.next({ projectId: goldenSnapshot.project.id, messages: [{ role: 'user', content: 'Synthetic.' }], remainingModelCalls: 4, remainingToolCalls: 6 }, controller.signal);
  const rejected = expect(result).rejects.toThrow();
  await held.promise; controller.abort(); release.resolve(); await rejected;
  expect(send).not.toHaveBeenCalled();
});

it('keeps job guards independent while sharing charged account allowance', async () => {
  const reserve = vi.fn(async () => {});
  const send = vi.fn(async () => Response.json({ model: settings.model, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [
    { id: 'read', type: 'function', function: { name: 'read_project_state', arguments: '{}' } },
  ] } }] }));
  const adapter = new HttpNemotronAdapter({ ...settings, callBudget: 2 }, send, reserve);
  const withdrawn = vi.fn(async () => { throw Error('proposal_stale'); }), current = vi.fn(async () => {});
  const first = adapter.withAuthority(withdrawn), second = adapter.withAuthority(current);
  const input: c.ModelTurnInput = { projectId: goldenSnapshot.project.id, messages: [{ role: 'user', content: 'Synthetic.' }], remainingModelCalls: 4, remainingToolCalls: 6 };
  await expect(first.next(input, new AbortController().signal)).rejects.toThrow('proposal_stale');
  await expect(second.next(input, new AbortController().signal)).resolves.toMatchObject({ type: 'tool_calls' });
  await expect(adapter.withAuthority(current).next(input, new AbortController().signal)).rejects.toThrow('account_budget');
  expect(reserve).toHaveBeenCalledTimes(2); expect(send).toHaveBeenCalledTimes(1);
  expect(withdrawn).toHaveBeenCalledTimes(1); expect(current).toHaveBeenCalledTimes(1);
});
