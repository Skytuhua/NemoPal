import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { createFixtureClient } from '@living-playbooks/api-client';
import { App } from '../../apps/web/src/app/App';
import { deferred, memoryDrafts, snapshot } from './helpers';

afterEach(cleanup);

test.each(['saved', 'conflict'] as const)('a late document %s response preserves a newer draft after A to B to A', async outcome => {
  const a = snapshot(), b = snapshot(100), client = createFixtureClient({ snapshots: [a, b] });
  const store = memoryDrafts(), originalSave = client.saveDocument, release = deferred<void>(), started = deferred<void>();
  client.saveDocument = async (...args) => {
    const receipt = await originalSave(...args);
    started.resolve(); await release.promise;
    if (outcome === 'conflict') throw Object.assign(new Error('Conflict'), { code: 'revision_conflict' });
    return receipt;
  };
  const view = render(<App client={client} drafts={store} fixture />);
  if (!screen.queryByRole('button', { name: 'Close notes' })) await userEvent.click(await screen.findByRole('button', { name: 'Open notes' }));
  await waitFor(() => expect(screen.getByLabelText('Document: Demo notes')).toBeEnabled());
  await userEvent.clear(screen.getByLabelText('Document: Demo notes'));
  await userEvent.type(screen.getByLabelText('Document: Demo notes'), 'Submitted text');
  await userEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await started.promise;
  await userEvent.click(screen.getByRole('button', { name: /Second project/ }));
  await screen.findByRole('heading', { name: 'Second project', level: 1 });
  await userEvent.click(screen.getByRole('button', { name: /Hackathon demo/ }));
  if (!screen.queryByRole('button', { name: 'Close notes' })) await userEvent.click(await screen.findByRole('button', { name: 'Open notes' }));
  await waitFor(() => expect(screen.getByLabelText('Document: Demo notes')).toBeEnabled());
  await userEvent.clear(screen.getByLabelText('Document: Demo notes'));
  await userEvent.type(screen.getByLabelText('Document: Demo notes'), 'Newer text after return');
  await act(async () => release.resolve());
  await waitFor(async () => expect((await store.read(`${a.project.id}:document:${a.documents[0]!.id}`))?.text).toBe('Newer text after return'));
  view.unmount();
  render(<App client={client} drafts={store} fixture />);
  if (!screen.queryByRole('button', { name: 'Close notes' })) await userEvent.click(await screen.findByRole('button', { name: 'Open notes' }));
  await waitFor(() => expect(screen.getByLabelText('Document: Demo notes')).toHaveValue('Newer text after return'));
});

test('a late chat acknowledgment cannot remove the newer composer draft after returning to A', async () => {
  const a = snapshot(), b = snapshot(100);
  const client = createFixtureClient({ snapshots: [a, b] }), store = memoryDrafts();
  const read = client.getSnapshot;
  client.getSnapshot = async (...args) => { const current = await read(...args); current.connection.inference = { available: true }; return current; };
  const originalSend = client.sendMessage, started = deferred<void>(), release = deferred<void>();
  client.sendMessage = async (...args) => { const job = await originalSend(...args); started.resolve(); await release.promise; return job; };
  const view = render(<App client={client} drafts={store} fixture />);
  await waitFor(() => expect(screen.getByLabelText('Message to Nemo')).toBeEnabled());
  await userEvent.type(screen.getByLabelText('Message to Nemo'), 'First question');
  await userEvent.click(screen.getByRole('button', { name: 'Send message' })); await started.promise;
  await userEvent.click(screen.getByRole('button', { name: /Second project/ }));
  await screen.findByRole('heading', { name: 'Second project', level: 1 });
  await userEvent.click(screen.getByRole('button', { name: /Hackathon demo/ }));
  await waitFor(() => expect(screen.getByLabelText('Message to Nemo')).toBeEnabled());
  await userEvent.clear(screen.getByLabelText('Message to Nemo'));
  await userEvent.type(screen.getByLabelText('Message to Nemo'), 'New question after return');
  await act(async () => release.resolve());
  expect((await store.read(`${a.project.id}:chat`))?.text).toBe('New question after return');
  view.unmount(); render(<App client={client} drafts={store} fixture />);
  await waitFor(() => expect(screen.getByLabelText('Message to Nemo')).toHaveValue('New question after return'));
});

test('a replacement document keeps the focused old editor until its owner applies the layout', async () => {
  const a = snapshot(), client = createFixtureClient(), store = memoryDrafts();
  render(<App client={client} drafts={store} fixture />);
  if (!screen.queryByRole('button', { name: 'Close notes' })) await userEvent.click(await screen.findByRole('button', { name: 'Open notes' }));
  await waitFor(() => expect(screen.getByLabelText('Document: Demo notes')).toBeEnabled());
  const editor = screen.getByLabelText('Document: Demo notes');
  await userEvent.type(editor, ' Keep this local text');
  const changed = snapshot(), replacement = { ...changed.documents[0]!, id: crypto.randomUUID(), text: 'Replacement document' };
  changed.documents = [replacement]; changed.eventSequence = 1; changed.project.revision = 1;
  changed.project.workspace.revision = 1;
  for (const panel of changed.project.workspace.panels) if (panel.type === 'document_editor') panel.documentId = replacement.id;
  client.getSnapshot = async () => changed;
  await act(async () => { await client.applyAction(a.project.id, { operationId: crypto.randomUUID(), expectedRevision: 0, input: { type: 'accept_plan' } }); });
  await screen.findByRole('button', { name: 'Apply workspace arrangement' });
  expect(editor.isConnected).toBe(true);
  expect(document.activeElement).toBe(editor);
  expect((editor as HTMLTextAreaElement).value).toContain('Keep this local text');
  expect(screen.getByRole('button', { name: 'Save document' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Apply workspace arrangement' }));
  expect(editor.isConnected).toBe(false);
  if (!screen.queryByRole('button', { name: 'Close notes' })) await userEvent.click(await screen.findByRole('button', { name: 'Open notes' }));
  await waitFor(() => expect(screen.getByLabelText('Document: Demo notes')).toHaveValue('Replacement document'));
  expect((await store.read(`${a.project.id}:document:${a.documents[0]!.id}`))?.text).toContain('Keep this local text');
});

test('project creation replays the exact persisted command after a lost response and remount', async () => {
  const client = createFixtureClient({ snapshots: [] }), originalCreate = client.createProject, store = memoryDrafts(), operationIds: string[] = [];
  let lost = true;
  client.createProject = async command => {
    operationIds.push(command.operationId);
    const job = await originalCreate(command);
    if (lost) { lost = false; throw new Error('Response lost after commit'); }
    return job;
  };
  const view = render(<App client={client} drafts={store} fixture />);
  await screen.findByText('No projects yet');
  await userEvent.type(screen.getByLabelText('Project title'), 'Retry safe project');
  await userEvent.type(screen.getByLabelText('Project brief'), 'One project and one planning job');
  await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
  await screen.findByText(/Project creation not confirmed/);
  view.unmount(); render(<App client={client} drafts={store} fixture />);
  await screen.findByRole('heading', { name: 'Retry safe project', level: 1 });
  await userEvent.click(screen.getByText('New project', { selector: 'summary' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Create project|Retry project creation/ })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: /Create project|Retry project creation/ }));
  await waitFor(() => expect(operationIds).toHaveLength(2));
  expect(operationIds[1]).toBe(operationIds[0]);
  expect((await client.listProjects()).filter(project => project.title === 'Retry safe project')).toHaveLength(1);
});

test.each([
  ['question', 'missing'], ['question', 'omitted'],
  ['next_action', 'missing'], ['next_action', 'omitted'],
  ['milestone', 'missing'], ['milestone', 'omitted'],
] as const)('the %s task action reveals a task when its checklist is %s', async (source, checklist) => {
  const seed = snapshot();
  const type = { question: 'question_card', next_action: 'next_action', milestone: 'milestone_timeline' }[source];
  seed.project.workspace.panels = seed.project.workspace.panels.filter(panel => panel.type === type || (checklist === 'omitted' && panel.type === 'checklist'));
  for (const panel of seed.project.workspace.panels) if (panel.type === 'checklist') panel.taskIds = [];
  const client = createFixtureClient({ snapshots: [seed] });
  render(<App client={client} drafts={memoryDrafts()} fixture />);
  const opener = { question: 'Open linked task', next_action: 'Open task', milestone: 'Record the demo' }[source];
  await userEvent.click(await screen.findByRole('button', { name: opener }));
  const status = await screen.findByLabelText('Status: Record the demo');
  await waitFor(() => expect(document.activeElement).toBe(document.getElementById(`task-${seed.project.tasks[0]!.id}`)));
  await userEvent.selectOptions(status, 'done');
  await waitFor(() => expect(status).toHaveValue('done'));
  expect((await client.getSnapshot(seed.project.id)).project.tasks[0]!.ownerOverride).toBe(true);
});
