import { expect, test, vi } from 'vitest';
import { PetChatController } from '../../apps/desktop/src/main/pet-chat';
import { ProjectSnapshotSchema, type PetChatState, type PlaybooksClient } from '@living-playbooks/contracts';
import { goldenSnapshot, fixtureIds as ids } from '../../fixtures/contracts/golden';
import { deferred } from './main-harness';

function harness() {
  const snapshot = ProjectSnapshotSchema.parse(goldenSnapshot);
  snapshot.connection.inference = { available: true };
  const read = vi.fn(async () => structuredClone(snapshot));
  const client = {
    getSnapshot: read,
    presentCheckIn: vi.fn(async () => ({ result: { ...snapshot.checkIns[0]!, state: 'presented' as const, revision: 1 } })),
    sendMessage: vi.fn(async (_id, command) => ({ receipt: { operationId: command.operationId, requestHash: '0'.repeat(64), status: 'accepted', result: null, projectRevision: 1, eventSequence: 1 }, jobId: ids.manager, state: 'queued' })),
    answerCheckIn: vi.fn(async () => ({ result: { ...snapshot.checkIns[0]!, revision: 2, state: 'answered', answer: { kind: 'recorded' } } })),
    snoozeCheckIn: vi.fn(),
  } as unknown as PlaybooksClient;
  let project: string | undefined = ids.project;
  let now = Date.parse('2026-11-07T13:00:00Z'), owner = 0;
  const events: PetChatState[] = [];
  const port = { show: vi.fn(async () => {}), hide: vi.fn(), resize: vi.fn(), destroy: vi.fn(), emit: (state: PetChatState) => events.push(state), visible: vi.fn() };
  const controller = new PetChatController({ client: () => client, project: () => project, authorized: id => id === project, owner: () => owner, preference: () => ({ hidden: false, focus: true, reducedMotion: true, pinnedProjectId: null }), recordPresentation: vi.fn(async () => true), port, now: () => now });
  return { controller, snapshot, client, read, port, events, expire() { now = Date.parse('2099-01-01T00:00:00Z'); }, replaceOwner() { owner++; controller.contextChanged(); }, setProject(id: string | undefined) { project = id; controller.contextChanged(); } };
}
test('manual Focus conversation reads a bounded real transcript and presents its question without selecting a project', async () => {
  const h = harness(); await h.controller.open();
  const state = h.controller.current();
  expect(state.conversation?.messages[0]?.text).toBe(goldenSnapshot.messages[0]!.text);
  expect(state.conversation?.checkIn?.state).toBe('presented');
  expect(h.client.presentCheckIn).toHaveBeenCalledOnce();
  expect(state.conversation).not.toHaveProperty('brief'); expect(state.conversation).not.toHaveProperty('sourceBindings');
  expect(state.conversation).not.toHaveProperty('ownerId');
  const contextId = state.contextId;
  await h.controller.command({ type: 'expand', contextId, expanded: true });
  expect(h.controller.current().contextId).toBe(contextId); expect(h.port.resize).toHaveBeenCalledWith(true);
  await h.controller.command({ type: 'close', contextId });
  await h.controller.open();
  expect(h.controller.current().expanded).toBe(false);
  await expect(h.controller.command({ type: 'expand', contextId, expanded: true })).rejects.toThrow();
});
test('expiry and subject revision fence question actions; owner replacement fences a late send', async () => {
  const h = harness(); await h.controller.open();
  const state = h.controller.current(); h.expire();
  await expect(h.controller.command({ type: 'answer', contextId: state.contextId, checkInId: ids.checkIn, presentationId: ids.presentation, command: { operationId: ids.manager, expectedRevision: 1, input: { kind: 'recorded' } } })).rejects.toThrow();
  expect(h.client.answerCheckIn).not.toHaveBeenCalled();
  const slow = deferred<Awaited<ReturnType<PlaybooksClient['sendMessage']>>>(); vi.mocked(h.client.sendMessage).mockReturnValueOnce(slow.promise);
  const sending = h.controller.command({ type: 'send', contextId: state.contextId, command: { operationId: ids.manager, expectedRevision: 0, input: { text: 'Original request' } } });
  const outcome = sending.catch(() => 'stale');
  h.replaceOwner(); expect(h.port.destroy).not.toHaveBeenCalled(); expect(h.controller.current().visible).toBe(false);
  const flush = h.controller.current();
  await h.controller.command({ type: 'flushed', contextId: flush.contextId, flushId: flush.flushRequestId!, succeeded: true });
  await vi.waitFor(() => expect(h.port.destroy).toHaveBeenCalledOnce());
  slow.resolve({ receipt: { operationId: ids.manager, requestHash: '0'.repeat(64), status: 'accepted', result: null, projectRevision: 1, eventSequence: 1 }, jobId: ids.owner, state: 'queued' });
  expect(await outcome).toBe('stale'); expect(h.controller.current().conversation).toBeNull();
});
test('quit flush waits for an exact context-bound renderer acknowledgement before teardown', async () => {
  const h = harness(); await h.controller.open();
  const flushing = h.controller.flush(); const state = h.controller.current();
  expect(state.flushRequestId).toBeTruthy();
  await expect(h.controller.command({ type: 'flushed', contextId: ids.owner, flushId: state.flushRequestId!, succeeded: true })).rejects.toThrow();
  expect(h.port.destroy).not.toHaveBeenCalled();
  await h.controller.command({ type: 'flushed', contextId: state.contextId, flushId: state.flushRequestId!, succeeded: true });
  await flushing; h.controller.stop(); expect(h.port.destroy).toHaveBeenCalledOnce();
});
test('an unavailable conversation can still close or expand without project authority', async () => {
  const h = harness(); h.setProject(undefined);
  await h.controller.open(); const state = h.controller.current();
  expect(state.conversation).toBeNull();
  expect(state.loading).toBe(false);
  await h.controller.command({ type: 'expand', contextId: state.contextId, expanded: true });
  await h.controller.command({ type: 'close', contextId: state.contextId });
  expect(h.controller.current().visible).toBe(false); expect(h.port.hide).toHaveBeenCalled();
});
test('presentation failure still exposes the canonical transcript and local draft scope with responses disabled', async () => {
  const h = harness(); vi.mocked(h.client.presentCheckIn).mockRejectedValueOnce(Error('Synthetic presentation unavailable'));
  await h.controller.open(); const state = h.controller.current();
  expect(state.conversation?.messages[0]?.text).toBe(goldenSnapshot.messages[0]!.text);
  expect(state.conversation?.draftScope).toBeTruthy(); expect(state.conversation?.connected).toBe(false);
  expect(state.conversation?.checkIn?.question).toBe(goldenSnapshot.checkIns[0]!.question);
  await expect(h.controller.command({ type: 'answer', contextId: state.contextId, checkInId: ids.checkIn, presentationId: ids.presentation, command: { operationId: ids.manager, expectedRevision: 0, input: { kind: 'recorded' } } })).rejects.toThrow();
});
test('late A reads and replies cannot replace B, reopen a hidden popup or clear a new context', async () => {
  const h = harness(); const slow = deferred<ReturnType<typeof ProjectSnapshotSchema.parse>>();
  h.read.mockReturnValueOnce(slow.promise);
  const opening = h.controller.open();
  const showsBeforeReplacement = h.port.show.mock.calls.length;
  h.setProject(ids.owner);
  slow.resolve(h.snapshot); await opening;
  expect(h.controller.current().conversation).toBeNull(); expect(h.port.show).toHaveBeenCalledTimes(showsBeforeReplacement);
  expect(h.port.destroy).toHaveBeenCalled();
});
test('manual activation shows once before a slow read; the later background result never focuses again', async () => {
  const h = harness(), slow = deferred<ReturnType<typeof ProjectSnapshotSchema.parse>>();
  h.read.mockReturnValueOnce(slow.promise);
  const opening = h.controller.open();
  expect(h.port.show).toHaveBeenCalledOnce();
  slow.resolve(h.snapshot); await opening;
  expect(h.port.show).toHaveBeenCalledOnce();
});
test('old context, stale project/question revision, foreign or expired presentation and oversized sends are rejected', async () => {
  const h = harness(); await h.controller.open(); const state = h.controller.current();
  const send = { type: 'send' as const, contextId: state.contextId, command: { operationId: ids.manager, expectedRevision: 0, input: { text: 'Synthetic message' } } };
  await expect(h.controller.command({ ...send, contextId: ids.owner })).rejects.toThrow();
  await expect(h.controller.command({ ...send, command: { ...send.command, expectedRevision: 99 } })).rejects.toThrow();
  const answer = { type: 'answer' as const, contextId: state.contextId, checkInId: ids.checkIn, presentationId: ids.presentation, command: { operationId: ids.manager, expectedRevision: 1, input: { kind: 'recorded' as const } } };
  await expect(h.controller.command({ ...answer, presentationId: ids.owner })).rejects.toThrow();
  await expect(h.controller.command({ ...answer, command: { ...answer.command, expectedRevision: 0 } })).rejects.toThrow();
  expect(h.client.sendMessage).not.toHaveBeenCalled(); expect(h.client.answerCheckIn).not.toHaveBeenCalled();
  await h.controller.command(send);
  expect(h.client.sendMessage).toHaveBeenCalledWith(ids.project, send.command);
  h.controller.close(false);
  await expect(h.controller.command(answer)).rejects.toThrow();
});

test('owner replacement fences commands immediately and retains renderer until draft flush acknowledges', async () => {
  const h = harness(); await h.controller.open(); const old = h.controller.current();
  h.replaceOwner();
  expect(h.port.hide).toHaveBeenCalled();
  expect(h.port.destroy).not.toHaveBeenCalled();
  await expect(h.controller.command({ type: 'expand', contextId: old.contextId, expanded: true })).rejects.toThrow();
  const request = h.events.at(-1)!;
  expect(request.flushRequestId).toBeTruthy();
  const reopening = h.controller.open();
  expect(h.port.show).toHaveBeenCalledTimes(1);
  await h.controller.command({ type: 'flushed', contextId: request.contextId, flushId: request.flushRequestId!, succeeded: true });
  await reopening;
  expect(h.port.destroy).toHaveBeenCalledOnce();
  expect(h.port.show).toHaveBeenCalledTimes(2);
});

test('failed and timed out flushes release the composer and permit a new acknowledgement', async () => {
  vi.useFakeTimers();
  try {
    const h = harness(); await h.controller.open();
    const first = h.controller.flush(); const state = h.controller.current();
    const failed = expect(first).rejects.toThrow();
    await h.controller.command({ type: 'flushed', contextId: state.contextId, flushId: state.flushRequestId!, succeeded: false }); await failed;
    expect(h.events.at(-1)!.flushRequestId).toBeUndefined();
    const second = h.controller.flush(); const timedOut = expect(second).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(2000); await timedOut;
    expect(h.events.at(-1)!.flushRequestId).toBeUndefined();
    const third = h.controller.flush(); const retry = h.controller.current();
    await h.controller.command({ type: 'flushed', contextId: retry.contextId, flushId: retry.flushRequestId!, succeeded: true }); await third;
  } finally { vi.useRealTimers(); }
});

test('failed retirement retains the hidden old renderer and blocks replacement until retry succeeds', async () => {
  const h = harness(); await h.controller.open(); h.replaceOwner();
  let request = h.controller.current();
  await h.controller.command({ type: 'flushed', contextId: request.contextId, flushId: request.flushRequestId!, succeeded: false });
  await vi.waitFor(() => expect(h.controller.current().flushRequestId).toBeUndefined());
  const opening = h.controller.open(); await vi.waitFor(() => expect(h.controller.current().flushRequestId).toBeTruthy());
  expect(h.port.destroy).not.toHaveBeenCalled(); expect(h.port.show).toHaveBeenCalledTimes(1);
  request = h.controller.current();
  await h.controller.command({ type: 'flushed', contextId: request.contextId, flushId: request.flushRequestId!, succeeded: true });
  await opening; expect(h.port.destroy).toHaveBeenCalledOnce(); expect(h.port.show).toHaveBeenCalledTimes(2);
});


test('a successful retry after failed popup loading participates in quit flush', async () => {
  const h = harness(); h.port.show.mockRejectedValueOnce(Error('Synthetic load failure'));
  await expect(h.controller.open()).rejects.toThrow();
  await h.controller.open();
  const flushing = h.controller.flush(); const request = h.controller.current();
  expect(request.flushRequestId).toBeTruthy();
  await h.controller.command({ type: 'flushed', contextId: request.contextId, flushId: request.flushRequestId!, succeeded: true }); await flushing;
});


test('successful quit acknowledgement keeps the renderer inert until shutdown succeeds or resumes', async () => {
  const h = harness(); await h.controller.open();
  const flushing = h.controller.flush(); const request = h.controller.current();
  await h.controller.command({ type: 'flushed', contextId: request.contextId, flushId: request.flushRequestId!, succeeded: true });
  await flushing;
  await h.controller.refresh();
  expect(h.events.at(-1)?.flushRequestId).toBe(request.flushRequestId);
  h.controller.resumeAfterFlush(); expect(h.events.at(-1)?.flushRequestId).toBeUndefined();
});
