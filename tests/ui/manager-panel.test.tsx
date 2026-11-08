import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { createFixtureClient } from '@living-playbooks/api-client';
import type { ProjectSnapshot, TaskStatus } from '@living-playbooks/contracts';
import { Chat } from '../../apps/web/src/features/chat/Chat';
import { deferred, memoryDrafts, snapshot } from './helpers';

afterEach(cleanup);

function tasks(statuses: TaskStatus[]): ProjectSnapshot {
  const seed = snapshot(), template = seed.project.tasks[0]!;
  seed.project.tasks = statuses.map((status, index) => ({ ...template, id: index ? crypto.randomUUID() : template.id, title: `Task ${index + 1}`, status }));
  seed.messages = [];
  return seed;
}

function setup(seed = snapshot(), options: Partial<Parameters<typeof Chat>[0]> = {}) {
  const client = createFixtureClient(), store = memoryDrafts(), refresh = vi.fn(async () => {});
  const props = { snapshot: seed, client, store, refresh, disabled: false, ...options };
  return { ...render(<div className="app-shell"><Chat {...props} /></div>), props, client: props.client, store: props.store, refresh: props.refresh };
}

test('manager derives all task counts and invokes the supplied next-task callbacks', async () => {
  const seed = tasks(['done', 'done', 'in_progress', 'todo', 'blocked', 'skipped']);
  const panel = seed.project.workspace.panels.find(item => item.type === 'next_action')!;
  if (panel.type === 'next_action') panel.taskId = seed.project.tasks[3]!.id;
  const openTask = vi.fn(), updateTask = vi.fn();
  const { client } = setup(seed, { openTask, updateTask });
  const send = vi.spyOn(client, 'sendMessage'), action = vi.spyOn(client, 'applyAction');
  expect(screen.getByRole('region', { name: 'Project task summary' })).toHaveTextContent('2 of 6 done');
  expect(screen.getByText('1 in progress')).toBeVisible();
  expect(screen.getByText('1 waiting')).toBeVisible();
  expect(screen.getByText('1 to do')).toBeVisible();
  expect(screen.getByText('1 skipped')).toBeVisible();
  expect(within(screen.getByRole('region', { name: 'Next task' })).getByText('Task 4')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Open next task' }));
  await userEvent.click(screen.getByRole('button', { name: 'Mark as done' }));
  expect(openTask).toHaveBeenCalledWith(seed.project.tasks[3]!.id);
  expect(updateTask).toHaveBeenCalledWith(seed.project.tasks[3]!.id, 'done');
  expect(action).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

test('completed next-action records fall back to current work instead of offering a completed task', () => {
  setup(tasks(['done', 'todo', 'in_progress']), { openTask: vi.fn() });
  expect(screen.getByRole('region', { name: 'Next task' })).toHaveTextContent('Task 3');
});

test('empty projects keep progress unknown and offer a real project action', async () => {
  const seed = snapshot(); seed.project.tasks = []; seed.project.workspace.panels = []; seed.messages = [];
  const openWorkspace = vi.fn();
  setup(seed, { openWorkspace });
  expect(screen.getByText('No tasks yet')).toBeVisible();
  expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark as done' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Open project' }));
  expect(openWorkspace).toHaveBeenCalledOnce();
});

test('done and skipped tasks do not generate another next task or a misleading all-done claim', () => {
  setup(tasks(['done', 'skipped']), { openTask: vi.fn(), updateTask: vi.fn() });
  expect(screen.getByText('No open tasks')).toBeVisible();
  expect(screen.getByText('1 of 2 done')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Open next task' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark as done' })).not.toBeInTheDocument();
});

test('optional callbacks never leave dead quick-action buttons', () => {
  setup(tasks(['todo']));
  expect(screen.queryByRole('button', { name: 'Open next task' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark as done' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Open project' })).not.toBeInTheDocument();
});

test('demo diagnostics are not presented as manager speech and real owner messages remain visible', () => {
  const seed = snapshot();
  seed.messages.push({ ...seed.messages[0]!, id: crypto.randomUUID(), role: 'owner', text: 'Keep my owner message.' });
  setup(seed, { fixture: true });
  expect(screen.getByLabelText('Manager chat status')).toHaveTextContent('Demo · draft only');
  const log = screen.getByRole('log', { name: 'Selected manager conversation' });
  expect(log).not.toHaveTextContent('This is a synthetic fixture. No live model has run.');
  expect(log).toHaveTextContent('Keep my owner message.');
  expect(screen.queryByText('Your manager can’t reply yet')).not.toBeInTheDocument();
});

test.each(['unavailable', 'offline', 'stale', 'updating'] as const)('%s chat keeps drafts editable and prevents send and disabled task writes', async state => {
  const seed = tasks(['todo']);
  if (state !== 'unavailable') { seed.connection.sync = state; seed.connection.inference = { available: true }; }
  const disabled = state !== 'unavailable', updateTask = vi.fn();
  const { store } = setup(seed, { disabled, updateTask, openTask: vi.fn() });
  const composer = screen.getByLabelText('Message to Nemo');
  await waitFor(() => expect(composer).toBeEnabled());
  await userEvent.type(composer, 'Keep this draft');
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  if (disabled) expect(screen.getByRole('button', { name: 'Mark as done' })).toBeDisabled();
  else expect(screen.getByRole('button', { name: 'Mark as done' })).toBeEnabled();
  expect(await store.read(`${seed.project.id}:chat`)).toEqual({ text: 'Keep this draft', baseRevision: 0 });
  expect(screen.getAllByLabelText('Manager chat status')).toHaveLength(1);
});

test('long task, project and conversation text stay present with keyboard-operable quick actions', async () => {
  const seed = tasks(['todo']);
  seed.project.title = 'A project with a detailed title that needs to wrap without losing its meaning';
  seed.project.tasks[0]!.title = 'Review the full accessibility and interaction notes before recording the demonstration'.repeat(3);
  seed.messages = [{ id: crypto.randomUUID(), projectId: seed.project.id, role: 'manager', text: 'A long real message.\n'.repeat(90), createdAt: seed.project.updatedAt, observationIds: [] }];
  const openTask = vi.fn();
  setup(seed, { openTask });
  expect(screen.getByText(seed.project.title)).toBeVisible();
  expect(screen.getByText(seed.project.tasks[0]!.title)).toBeVisible();
  expect(screen.getByRole('log')).toHaveTextContent('A long real message.');
  const open = screen.getByRole('button', { name: 'Open next task' });
  open.focus(); await userEvent.keyboard('{Enter}');
  expect(openTask).toHaveBeenCalledWith(seed.project.tasks[0]!.id);
  await userEvent.tab();
  expect(screen.getByRole('log')).toHaveFocus();
});

test('send preserves the revisioned request and newer edits made while its acknowledgment is pending', async () => {
  const seed = snapshot(); seed.connection.inference = { available: true };
  const client = createFixtureClient(), original = client.sendMessage, release = deferred<void>(), started = deferred<void>();
  const send = vi.spyOn(client, 'sendMessage').mockImplementation(async (...args) => { const job = await original(...args); started.resolve(); await release.promise; return job; });
  const { store, refresh } = setup(seed, { client });
  const composer = screen.getByLabelText('Message to Nemo');
  await waitFor(() => expect(composer).toBeEnabled());
  await userEvent.type(composer, 'First question');
  await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await started.promise;
  expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
  expect(composer).toBeEnabled();
  await userEvent.type(composer, ' and a newer thought');
  await act(async () => release.resolve());
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(send.mock.calls[0]).toEqual([seed.project.id, { operationId: expect.any(String), expectedRevision: seed.project.revision, input: { text: 'First question' } }]);
  expect(composer).toHaveValue('First question and a newer thought');
  expect((await store.read(`${seed.project.id}:chat`))?.text).toBe('First question and a newer thought');
});

test('an unconfirmed send retains the draft and presents the existing recovery instruction', async () => {
  const seed = snapshot(); seed.connection.inference = { available: true };
  const client = createFixtureClient(); vi.spyOn(client, 'sendMessage').mockRejectedValue(new Error('network interrupted'));
  const { store } = setup(seed, { client });
  const composer = screen.getByLabelText('Message to Nemo');
  await waitFor(() => expect(composer).toBeEnabled());
  await userEvent.type(composer, 'Please keep my question');
  await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Message not confirmed. Draft preserved; refresh before retrying.');
  expect(composer).toHaveValue('Please keep my question');
  expect((await store.read(`${seed.project.id}:chat`))?.text).toBe('Please keep my question');
});

test('draft storage failure blocks sending while keeping editable text and the recovery alert', async () => {
  const seed = snapshot(); seed.connection.inference = { available: true };
  const store = memoryDrafts(); store.write = async () => { throw new Error('disk full'); };
  setup(seed, { store });
  const composer = screen.getByLabelText('Message to Nemo');
  await waitFor(() => expect(composer).toBeEnabled());
  await userEvent.type(composer, 'Copy this text');
  expect(await screen.findByRole('alert')).toHaveTextContent('Draft could not be persisted. Copy your work before leaving.');
  expect(composer).toHaveValue('Copy this text');
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
});

test('project switching and a late send cannot clear the newer draft when returning to the project', async () => {
  const a = snapshot(), b = snapshot(100); a.connection.inference = { available: true };
  const client = createFixtureClient(), store = memoryDrafts(), refresh = vi.fn(async () => {});
  const original = client.sendMessage, release = deferred<void>(), started = deferred<void>();
  client.sendMessage = async (...args) => { const job = await original(...args); started.resolve(); await release.promise; return job; };
  const mount = (seed: ProjectSnapshot) => <Chat key={seed.project.id} snapshot={seed} client={client} store={store} refresh={refresh} disabled={false} />;
  const view = render(mount(a));
  await waitFor(() => expect(screen.getByLabelText('Message to Nemo')).toBeEnabled());
  await userEvent.type(screen.getByLabelText('Message to Nemo'), 'Sent question');
  await userEvent.click(screen.getByRole('button', { name: 'Send message' })); await started.promise;
  view.rerender(mount(b));
  await waitFor(() => expect(screen.getByLabelText('Message to Nemo')).toHaveValue(''));
  await userEvent.type(screen.getByLabelText('Message to Nemo'), 'Second project draft');
  view.rerender(mount(a));
  await waitFor(() => expect(screen.getByLabelText('Message to Nemo')).toHaveValue('Sent question'));
  await userEvent.clear(screen.getByLabelText('Message to Nemo'));
  await userEvent.type(screen.getByLabelText('Message to Nemo'), 'New draft after return');
  await act(async () => release.resolve());
  expect((await store.read(`${a.project.id}:chat`))?.text).toBe('New draft after return');
  view.rerender(mount(b));
  await waitFor(() => expect(screen.getByLabelText('Message to Nemo')).toHaveValue('Second project draft'));
});
