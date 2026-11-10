import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { AcceptedJob, PetChatBridge, PetChatState } from '@living-playbooks/contracts';
import { PetChat } from '../../apps/web/src/pet/PetChat';
import { memoryDrafts, snapshot } from './helpers';

afterEach(cleanup);

function state(): PetChatState {
  const s = snapshot();
  return { type: 'pet_chat_state', version: 1, contextId: s.project.id, visible: true, expanded: false, reducedMotion: true, conversation: { draftScope: 'synthetic-status-owner-project', projectId: s.project.id, projectRevision: 0, eventSequence: 0, managerName: 'Nemo', messages: [], checkIn: null, connected: true, inference: { available: true }, demoTiming: false } };
}
function harness(initial = state()) {
  let current = initial, listener!: (state: PetChatState) => void;
  const jobId = crypto.randomUUID();
  const invoke = vi.fn<PetChatBridge['invoke']>(async command => command.type === 'send' ? { receipt: { operationId: command.command.operationId, requestHash: '0'.repeat(64), status: 'accepted', result: null, projectRevision: 1, eventSequence: 1 }, jobId, state: 'queued' } satisfies AcceptedJob : undefined);
  const bridge: PetChatBridge = { read: async () => current, invoke, onEvent(fn) { listener = fn; return () => {}; } };
  const store = memoryDrafts();
  const view = render(<PetChat bridge={bridge} store={store} />);
  return { ...view, initial, invoke, jobId, emit(next: PetChatState) { current = next; act(() => listener(next)); } };
}

test.each([
  ['queued', 'Waiting for Nemo to reply'],
  ['running', 'Nemo is preparing a reply'],
  ['failed', 'Nemo could not reply. Your message is saved.'],
  ['cancelled', 'Reply cancelled. Your message is saved.'],
  ['superseded', 'Request replaced by a newer update. Your message is saved.'],
] as const)('popup renders the canonical %s reply state without resending', async (replyState, text) => {
  const initial = state(), projectId = initial.conversation!.projectId;
  initial.conversation!.messages = [
    { id: crypto.randomUUID(), projectId, role: 'owner', text: 'Saved popup question', createdAt: new Date().toISOString(), jobId: crypto.randomUUID(), replyState },
    { id: crypto.randomUUID(), projectId, role: 'manager', text: 'Unrelated older answer', createdAt: new Date().toISOString(), jobId: crypto.randomUUID() },
  ];
  const h = harness(initial);
  expect(await screen.findByText(text, { exact: false })).toHaveAttribute('role', 'status');
  expect(screen.getByText('Saved popup question')).toBeVisible();
  expect(h.invoke).not.toHaveBeenCalled();
});

test('popup does not invent pending state for a legacy message or an answered job', async () => {
  const initial = state(), projectId = initial.conversation!.projectId, jobId = crypto.randomUUID();
  initial.conversation!.messages = [
    { id: crypto.randomUUID(), projectId, role: 'owner', text: 'Legacy question', createdAt: new Date().toISOString() },
    { id: crypto.randomUUID(), projectId, role: 'owner', text: 'Answered question', createdAt: new Date().toISOString(), jobId, replyState: 'running' },
    { id: crypto.randomUUID(), projectId, role: 'manager', text: 'Saved answer', createdAt: new Date().toISOString(), jobId },
  ];
  harness(initial);
  await screen.findByText('Saved answer');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test.each(['failed', 'completed'] as const)('popup retires its accepted acknowledgment when the matching job is %s', async replyState => {
  const h = harness();
  const editor = await screen.findByRole('textbox', { name: 'Message' });
  await waitFor(() => expect(editor).toBeEnabled());
  fireEvent.change(editor, { target: { value: 'New popup question' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText(/Request accepted/);
  const sent = h.invoke.mock.calls[0]![0];
  if (sent.type !== 'send') throw Error('Expected send');
  fireEvent.change(editor, { target: { value: 'Keep my next draft' } });
  const next = structuredClone(h.initial), projectId = next.conversation!.projectId;
  next.version = 2;
  next.conversation!.messages = [{ id: crypto.randomUUID(), projectId, role: 'owner', text: 'New popup question', createdAt: new Date().toISOString(), operationId: sent.command.operationId, jobId: h.jobId, replyState }];
  if (replyState === 'completed') next.conversation!.messages.push({ id: crypto.randomUUID(), projectId, role: 'manager', text: 'Answer to popup question', createdAt: new Date().toISOString(), jobId: h.jobId });
  h.emit(next);
  expect(screen.queryByText(/A reply is not available yet/)).not.toBeInTheDocument();
  if (replyState === 'failed') expect(screen.getByRole('status')).toHaveTextContent('Nemo could not reply. Your message is saved.');
  else expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(editor).toHaveValue('Keep my next draft');
  expect(h.invoke).toHaveBeenCalledOnce();
  h.emit({ ...next, version: 3, conversation: { ...next.conversation!, messages: [] } });
  expect(screen.queryByText(/A reply is not available yet/)).not.toBeInTheDocument();
});

test('popup reconciles a lost acknowledgment without replacing a canonical failure with pending text', async () => {
  const h = harness();
  const editor = await screen.findByRole('textbox', { name: 'Message' });
  await waitFor(() => expect(editor).toBeEnabled());
  h.invoke.mockRejectedValueOnce(Error('Synthetic response lost'));
  fireEvent.change(editor, { target: { value: 'Unconfirmed popup question' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText(/not confirmed/);
  const sent = h.invoke.mock.calls[0]![0];
  if (sent.type !== 'send') throw Error('Expected send');
  fireEvent.change(editor, { target: { value: 'Preserve this newer draft' } });
  const next = structuredClone(h.initial);
  next.version = 2;
  next.conversation!.messages = [{ id: crypto.randomUUID(), projectId: next.conversation!.projectId, role: 'owner', text: 'Unconfirmed popup question', createdAt: new Date().toISOString(), operationId: sent.command.operationId, jobId: h.jobId, replyState: 'failed' }];
  h.emit(next);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry same request' })).not.toBeInTheDocument());
  expect(screen.queryByText(/A reply is not available yet/)).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Nemo could not reply. Your message is saved.');
  expect(editor).toHaveValue('Preserve this newer draft');
  expect(h.invoke).toHaveBeenCalledOnce();
});
