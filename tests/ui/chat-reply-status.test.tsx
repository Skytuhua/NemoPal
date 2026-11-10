import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { createFixtureClient } from '@living-playbooks/api-client';
import { Chat } from '../../apps/web/src/features/chat/Chat';
import { memoryDrafts, snapshot } from './helpers';

afterEach(cleanup);

test.each([
  ['queued', 'Waiting for Nemo to reply'],
  ['running', 'Nemo is preparing a reply'],
  ['failed', 'Nemo could not reply. Your message is saved.'],
  ['cancelled', 'Reply cancelled. Your message is saved.'],
  ['superseded', 'Request replaced by a newer update. Your message is saved.'],
] as const)('renders the canonical %s reply state beside its owner message after reopening', async (replyState, text) => {
  const current = snapshot();
  current.messages = [
    { id: crypto.randomUUID(), projectId: current.project.id, role: 'owner', text: 'Saved question', createdAt: new Date().toISOString(), observationIds: [], jobId: crypto.randomUUID(), ...{ replyState } },
    { id: crypto.randomUUID(), projectId: current.project.id, role: 'manager', text: 'Reply to a different question', createdAt: new Date().toISOString(), observationIds: [], jobId: crypto.randomUUID() },
  ];
  render(<Chat snapshot={current} client={createFixtureClient()} store={memoryDrafts()} disabled={false} refresh={async () => {}} />);
  expect(screen.getByRole('status')).toHaveTextContent(text);
  expect(screen.getByText('Saved question')).toBeVisible();
});

test('does not invent pending or failed state for legacy messages or an answered job', () => {
  const current = snapshot(), jobId = crypto.randomUUID();
  current.messages = [
    { id: crypto.randomUUID(), projectId: current.project.id, role: 'owner', text: 'Legacy question', createdAt: new Date().toISOString(), observationIds: [] },
    { id: crypto.randomUUID(), projectId: current.project.id, role: 'owner', text: 'Answered question', createdAt: new Date().toISOString(), observationIds: [], jobId, ...{ replyState: 'running' as const } },
    { id: crypto.randomUUID(), projectId: current.project.id, role: 'manager', text: 'Saved reply', createdAt: new Date().toISOString(), observationIds: [], jobId },
  ];
  render(<Chat snapshot={current} client={createFixtureClient()} store={memoryDrafts()} disabled={false} refresh={async () => {}} />);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText('Saved reply')).toBeVisible();
});

test.each(['failed', 'completed'] as const)('a sent question stops claiming to wait when its canonical job is %s', async replyState => {
  const current = snapshot(), client = createFixtureClient(), store = memoryDrafts();
  current.connection.inference = { available: true };
  let refreshed = false;
  const props = { client, store, disabled: false, refresh: async () => { refreshed = true; } };
  const view = render(<Chat snapshot={current} {...props} />);
  const editor = screen.getByLabelText('Message to Nemo');
  await waitFor(() => expect(editor).toBeEnabled());
  await userEvent.type(editor, 'New question');
  await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(refreshed).toBe(true));
  expect(screen.getByRole('status')).toHaveTextContent('A reply is not available yet.');
  await userEvent.type(editor, 'Keep my next question');
  const next = await client.getSnapshot(current.project.id);
  next.connection.inference = { available: true };
  const owner = next.messages.find(message => message.text === 'New question')!;
  Object.assign(owner, { replyState });
  if (replyState === 'completed') next.messages.push({ id: crypto.randomUUID(), projectId: current.project.id, role: 'manager', text: 'Answer to the new question', createdAt: new Date().toISOString(), observationIds: [], jobId: owner.jobId });
  view.rerender(<Chat snapshot={next} {...props} />);
  expect(screen.queryByText(/A reply is not available yet/)).not.toBeInTheDocument();
  if (replyState === 'failed') expect(screen.getByRole('status')).toHaveTextContent('Nemo could not reply. Your message is saved.');
  else { expect(screen.getByText('Answer to the new question')).toBeVisible(); expect(screen.queryByRole('status')).not.toBeInTheDocument(); }
  expect(editor).toHaveValue('Keep my next question');
  expect((await client.getSnapshot(current.project.id)).messages.filter(message => message.text === 'New question')).toHaveLength(1);
  view.rerender(<Chat snapshot={{ ...next, messages: [] }} {...props} />);
  expect(screen.queryByText(/A reply is not available yet/)).not.toBeInTheDocument();
});
