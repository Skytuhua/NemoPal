import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AcceptedJob, PetChatBridge, PetChatState } from '@living-playbooks/contracts';
import { PetChat } from '../../apps/web/src/pet/PetChat';
import { memoryDrafts, snapshot, deferred } from './helpers';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function state(): PetChatState {
  const s = snapshot();
  return { type: 'pet_chat_state', version: 1, contextId: s.project.id, visible: true, expanded: false, reducedMotion: true, conversation: { draftScope: 'synthetic-owner-project', projectId: s.project.id, projectRevision: 0, eventSequence: 0, managerName: 'Nemo', messages: s.messages.map(({ observationIds: _refs, ...message }) => message), checkIn: { ...s.checkIns[0]!, state: 'presented', expiresAt: '2099-01-01T00:00:00Z' }, connected: true, inference: { available: true }, demoTiming: false } };
}
function harness(initial = state(), store = memoryDrafts()) {
  let listener!: (s: PetChatState) => void;
  const read = vi.fn(async () => initial);
  const invoke = vi.fn<PetChatBridge['invoke']>().mockResolvedValue(undefined);
  const bridge: PetChatBridge = { read, invoke, onEvent(fn) { listener = fn; return () => {}; } };
  const view = render(<PetChat bridge={bridge} store={store} />);
  return { ...view, invoke, read, bridge, store, initial, emit(s: PetChatState) { act(() => listener(s)); } };
}
const receipt = (operationId: string): AcceptedJob => ({ receipt: { operationId, requestHash: '0'.repeat(64), status: 'accepted', result: null, projectRevision: 1, eventSequence: 1 }, jobId: snapshot().project.manager.id, state: 'queued' });
test('real injected transcript, full question, response labels and editable composer coexist; expand preserves DOM and draft', async () => {
  const h = harness(); const composer = await screen.findByRole('textbox', { name: 'Message' });
  await waitFor(() => expect(composer).toBeEnabled());
  expect(screen.getByText(snapshot().messages[0]!.text)).toBeVisible();
  expect(screen.getByText('Have you recorded the demo?')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Mark task done' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Not yet' })).toBeVisible();
  expect(screen.queryByText(snapshot().project.title)).not.toBeInTheDocument();
  fireEvent.change(composer, { target: { value: 'Keep this local draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Expand conversation' }));
  expect(h.invoke).toHaveBeenCalledWith({ type: 'expand', contextId: h.initial.contextId, expanded: true });
  h.emit({ ...h.initial, version: 2, expanded: true });
  expect(screen.getByRole('textbox', { name: 'Message' })).toBe(composer);
  expect(composer).toHaveValue('Keep this local draft');
});
test('typing during accepted send survives; unknown send retains exact envelope across close/reopen, never auto resends', async () => {
  const h = harness(); const composer = await screen.findByRole('textbox', { name: 'Message' });
  await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: 'Original message' } });
  const pending = deferred<AcceptedJob>(); h.invoke.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(h.invoke).toHaveBeenCalledOnce());
  const sent = h.invoke.mock.calls[0]![0]; expect(sent.type).toBe('send');
  fireEvent.change(composer, { target: { value: 'Typed while sending' } });
  if (sent.type !== 'send') throw Error('Expected send');
  await act(async () => pending.resolve(receipt(sent.command.operationId)));
  expect(composer).toHaveValue('Typed while sending');
  h.invoke.mockRejectedValueOnce(Error('Synthetic unknown result'));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText(/not confirmed/i);
  const envelope = h.invoke.mock.calls[1]![0];
  h.emit({ ...h.initial, version: 3, visible: false });
  h.emit({ ...h.initial, version: 4, visible: true });
  expect(h.invoke).toHaveBeenCalledTimes(2);
  expect(composer).toHaveValue('Typed while sending');
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
  await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(3));
  expect(h.invoke.mock.calls[2]![0]).toEqual(envelope);
});
test('IME Enter/Escape do not send or close; offline keeps typing; no bridge is honestly unavailable', async () => {
  const h = harness(); const composer = await screen.findByRole('textbox', { name: 'Message' });
  await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: 'Composition' } });
  fireEvent.compositionStart(composer); fireEvent.keyDown(composer, { key: 'Enter', isComposing: true }); fireEvent.keyDown(composer, { key: 'Escape', isComposing: true });
  expect(h.invoke).not.toHaveBeenCalled(); fireEvent.compositionEnd(composer);
  h.emit({ ...h.initial, version: 2, conversation: { ...h.initial.conversation!, connected: false } });
  expect(composer).toBeEnabled(); expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  expect(screen.getByText(/Connection unavailable/)).toBeVisible();
  h.unmount(); render(<PetChat />);
  expect(screen.getByText(/Restricted desktop conversation bridge required/)).toBeVisible();
});
test('long question stays with responses and deliberate snooze date, without changing workspace behavior', async () => {
  const initial = state(); initial.conversation!.checkIn!.question = 'A full question about the project and its next milestone. '.repeat(6).trim();
  const h = harness(initial); await screen.findByRole('textbox', { name: 'Message' });
  expect(screen.getByText(initial.conversation!.checkIn!.question)).toBeVisible();
  expect(screen.queryByText('Read full question')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Snooze options' }));
  const date = screen.getByLabelText('Snooze until'); fireEvent.change(date, { target: { value: '2098-01-01T13:00' } });
  h.emit({ ...initial, version: 2, expanded: true });
  expect(date).toHaveValue('2098-01-01T13:00');
  expect(screen.getByText(initial.conversation!.checkIn!.question)).toBeVisible();
});
test('reloaded uncertain draft never auto-sends and canonical operation identity reconciles only the acknowledged generation', async () => {
  const store = memoryDrafts(), h = harness(state(), store);
  const composer = await screen.findByRole('textbox', { name: 'Message' }); await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: 'Uncertain original' } });
  h.invoke.mockRejectedValueOnce(Error('Synthetic disconnection'));
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await screen.findByText(/not confirmed/i);
  const command = h.invoke.mock.calls[0]![0]; if (command.type !== 'send') throw Error('Expected send');
  fireEvent.change(composer, { target: { value: 'Next local draft' } }); await store.flush();
  h.unmount(); const next = harness(state(), store);
  const nextComposer = await screen.findByRole('textbox', { name: 'Message' });
  await waitFor(() => expect(nextComposer).toHaveValue('Next local draft'));
  expect(next.invoke).not.toHaveBeenCalled();
  next.emit({ ...next.initial, version: 2, conversation: { ...next.initial.conversation!, messages: [...next.initial.conversation!.messages, { id: snapshot().project.ownerId, projectId: next.initial.conversation!.projectId, role: 'owner', text: 'Uncertain original', createdAt: '2026-11-07T14:00:00Z', operationId: command.command.operationId }] } });
  await screen.findByText(/Request accepted/);
  expect(nextComposer).toHaveValue('Next local draft'); expect(next.invoke).not.toHaveBeenCalled();
});
test('storage failure is visible and prevents dispatch; older events cannot restore sending', async () => {
  const store = memoryDrafts(), h = harness(state(), store);
  const composer = await screen.findByRole('textbox', { name: 'Message' }); await waitFor(() => expect(composer).toBeEnabled());
  store.write = async () => { throw Error('Synthetic storage failure'); };
  fireEvent.change(composer, { target: { value: 'Keep on screen' } });
  expect(await screen.findByRole('alert')).toHaveTextContent(/persisted/); expect(h.invoke).not.toHaveBeenCalled();
  h.emit({ ...h.initial, version: 3, conversation: { ...h.initial.conversation!, connected: false } });
  h.emit({ ...h.initial, version: 2 });
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled(); expect(composer).toHaveValue('Keep on screen');
});
test('late A acceptance cannot replace B or clear its composer', async () => {
  const h = harness(); const composer = await screen.findByRole('textbox', { name: 'Message' }); await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: 'A original' } });
  const slow = deferred<AcceptedJob>(); h.invoke.mockReturnValueOnce(slow.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await waitFor(() => expect(h.invoke).toHaveBeenCalledOnce());
  const command = h.invoke.mock.calls[0]![0]; if (command.type !== 'send') throw Error('Expected send');
  const b = snapshot(100);
  h.emit({ ...h.initial, version: 3, contextId: b.project.id, conversation: { ...h.initial.conversation!, draftScope: 'synthetic-owner-project-B', projectId: b.project.id, messages: [], checkIn: null } });
  const composerB = await screen.findByRole('textbox', { name: 'Message' }); await waitFor(() => expect(composerB).toBeEnabled());
  fireEvent.change(composerB, { target: { value: 'B draft' } });
  await act(async () => slow.resolve(receipt(command.command.operationId)));
  expect(composerB).toHaveValue('B draft'); expect(screen.queryByText(/Request accepted/)).not.toBeInTheDocument();
});
test('question retry preserves the original recorded payload and operation identity after ambiguity', async () => {
  const h = harness(); await screen.findByRole('textbox', { name: 'Message' });
  h.invoke.mockRejectedValueOnce(Error('Synthetic question receipt lost'));
  fireEvent.click(screen.getByRole('button', { name: 'Mark task done' })); await screen.findByRole('alert');
  const original = h.invoke.mock.calls[0]![0];
  expect(original.type).toBe('answer'); if (original.type !== 'answer') throw Error('Expected answer');
  expect(original.command.input).toEqual({ kind: 'recorded' });
  fireEvent.click(screen.getByRole('button', { name: 'Mark task done' }));
  await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(2));
  expect(h.invoke.mock.calls[1]![0]).toEqual(original);
});
test('reduced motion and timed close settle without animation events; reopen keeps the mounted draft', async () => {
  const h = harness(); const composer = await screen.findByRole('textbox', { name: 'Message' }); await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: 'Retain over close' } });
  fireEvent.keyDown(composer, { key: 'Escape' });
  const main = document.querySelector('main')!;
  expect(main).toHaveAttribute('data-phase', 'closed'); expect(main).toHaveAttribute('inert');
  h.emit({ ...h.initial, version: 2, contextId: snapshot().project.ownerId, reducedMotion: false });
  expect(screen.getByRole('textbox', { name: 'Message' })).toBe(composer); expect(composer).toHaveValue('Retain over close');
  await waitFor(() => expect(main).toHaveAttribute('data-phase', 'open'));
  fireEvent.keyDown(composer, { key: 'Escape' });
  expect(main).toHaveAttribute('data-phase', 'closing'); expect(main).toHaveAttribute('inert');
  await waitFor(() => expect(main).toHaveAttribute('data-phase', 'closed'));
});
test('quit flush reports only a bounded acknowledgement through the restricted bridge', async () => {
  const h = harness(); await screen.findByRole('textbox', { name: 'Message' });
  h.emit({ ...h.initial, version: 2, flushRequestId: snapshot().project.ownerId });
  await waitFor(() => expect(h.invoke).toHaveBeenCalledWith({ type: 'flushed', contextId: h.initial.contextId, flushId: snapshot().project.ownerId, succeeded: true }));
});

test('a failed pending write never dispatches until the same envelope is durable', async () => {
  const store = memoryDrafts(), write = store.write; let failing = true;
  store.write = async (key, value) => { if (failing && key.endsWith(':pending')) throw Error('disk full'); await write(key, value); };
  const h = harness(state(), store);
  const composer = await screen.findByRole('textbox', { name: 'Message' }); await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: 'Keep the same envelope' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByRole('alert');
  expect(h.invoke).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
  await screen.findByText(/not confirmed/i);
  expect(h.invoke).not.toHaveBeenCalled();
  failing = false;
  h.invoke.mockRejectedValueOnce(Error('synthetic uncertain result'));
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
  await waitFor(() => expect(h.invoke).toHaveBeenCalledOnce());
  const sent = h.invoke.mock.calls[0]![0];
  if (sent.type !== 'send') throw Error('Expected send');
  const saved = await store.read('pet-chat:synthetic-owner-project:draft:pending');
  expect(JSON.parse(saved!.text).command).toEqual(sent.command);
});

test('explicitly resolving an uncertain stale request preserves the draft and never resends it', async () => {
  const store = memoryDrafts(), h = harness(state(), store);
  const composer = await screen.findByRole('textbox', { name: 'Message' }); await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: 'Possibly sent' } });
  h.invoke.mockRejectedValueOnce(Error('Lost receipt'));
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await screen.findByText(/not confirmed/i);
  await store.flush(); h.unmount();
  const newer = state(); newer.conversation!.projectRevision = 1;
  const next = harness(newer, store); const draft = await screen.findByRole('textbox', { name: 'Message' });
  await waitFor(() => expect(draft).toHaveValue('Possibly sent'));
  expect(screen.getByRole('button', { name: 'Retry same request' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Resolve unconfirmed request' }));
  expect(await screen.findByText(/may already have been sent/i)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Keep draft and resolve' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
  expect(draft).toHaveValue('Possibly sent'); expect(next.invoke).not.toHaveBeenCalled();
  next.unmount(); const again = harness(newer, store);
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('Possibly sent'));
  expect(screen.queryByRole('button', { name: 'Retry same request' })).not.toBeInTheDocument(); expect(again.invoke).not.toHaveBeenCalled();
});


test('flush acknowledgement waits for an in-flight send and its local draft writes', async () => {
  const store = memoryDrafts(), h = harness(state(), store);
  const composer = await screen.findByRole('textbox', { name: 'Message' }); await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: 'Queued message' } });
  const result = deferred<AcceptedJob>(); h.invoke.mockReturnValueOnce(result.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); await waitFor(() => expect(h.invoke).toHaveBeenCalledOnce());
  const command = h.invoke.mock.calls[0]![0]; if (command.type !== 'send') throw Error('Expected send');
  h.emit({ ...h.initial, version: 2, flushRequestId: snapshot().project.ownerId });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(h.invoke).toHaveBeenCalledTimes(1);
  await act(async () => result.resolve(receipt(command.command.operationId)));
  await waitFor(() => expect(h.invoke).toHaveBeenCalledWith({ type: 'flushed', contextId: h.initial.contextId, flushId: snapshot().project.ownerId, succeeded: true }));
  expect(await store.read('pet-chat:synthetic-owner-project:draft:pending')).toBeUndefined();
});


test('retired popup retries the latest failed draft without exposing it to the next context', async () => {
  const values = new Map<string, { text: string; baseRevision: number }>();
  let failing = true, failedKey = '';
  const store = {
    async read(key: string) { return values.get(key); },
    async write(key: string, value: { text: string; baseRevision: number }) { if (failing) { failedKey = key; throw Error('disk full'); } values.set(key, structuredClone(value)); if (key === failedKey) failedKey = ''; },
    async remove(key: string) { values.delete(key); if (key === failedKey) failedKey = ''; },
    async flush() { if (failedKey) throw Error('sticky disk full'); },
  };
  const h = harness(state(), store);
  const composer = await screen.findByRole('textbox', { name: 'Message' }); await waitFor(() => expect(composer).toBeEnabled());
  fireEvent.change(composer, { target: { value: 'Latest old owner draft' } });
  await screen.findByRole('alert');
  h.emit({ ...h.initial, version: 2, visible: false, flushRequestId: snapshot().project.ownerId });
  await waitFor(() => expect(h.invoke).toHaveBeenCalledWith({ type: 'flushed', contextId: h.initial.contextId, flushId: snapshot().project.ownerId, succeeded: false }));
  failing = false;
  const retryId = snapshot(100).project.id;
  h.emit({ ...h.initial, version: 3, visible: false, flushRequestId: retryId });
  await waitFor(() => expect(h.invoke).toHaveBeenCalledWith({ type: 'flushed', contextId: h.initial.contextId, flushId: retryId, succeeded: true }));
  expect((await store.read('pet-chat:synthetic-owner-project:draft'))?.text).toBe('Latest old owner draft');
  const b = snapshot(100);
  h.emit({ ...h.initial, version: 4, contextId: b.project.id, visible: true, conversation: { ...h.initial.conversation!, draftScope: 'synthetic-owner-project-B', projectId: b.project.id, messages: [], checkIn: null } });
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(''));
});
