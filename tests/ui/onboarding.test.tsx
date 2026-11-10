import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { createFixtureClient } from '@living-playbooks/api-client';
import { App } from '../../apps/web/src/app/App';
import { memoryDrafts, snapshot } from './helpers';

afterEach(cleanup);

test('first use explains the product and creates a real project from two labeled fields', async () => {
  const client = createFixtureClient({ snapshots: [] });
  render(<App client={client} drafts={memoryDrafts()} fixture />);
  expect(await screen.findByRole('heading', { name: 'Start your first project' })).toBeVisible();
  expect(screen.getByText(/A name, a goal/)).toBeVisible();
  await userEvent.type(screen.getByLabelText('Project title'), 'Garden plan');
  await userEvent.type(screen.getByLabelText('Project brief'), 'Plan a small herb garden');
  await userEvent.click(screen.getByRole('button', { name: 'Create project' }));
  expect(await screen.findByRole('heading', { name: 'Garden plan', level: 1 })).toBeVisible();
  expect((await client.listProjects())[0]?.goal).toBe('Plan a small herb garden');
  expect(screen.getByText('Progress unknown')).toBeVisible();
  expect(screen.getByText('No tasks yet. Planning has not produced an accepted task list.')).toBeVisible();
  expect(within(screen.getByRole('region', { name: 'Project progress' })).getByText('Plan pending')).toBeVisible();
  expect(screen.queryByText(/You can still update tasks/)).not.toBeInTheDocument();
});

test('Projects overview offers real projects without losing an unfinished notes draft', async () => {
  render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  if (!screen.queryByRole('button', { name: 'Close notes' })) await userEvent.click(await screen.findByRole('button', { name: 'Open notes' }));
  const editor = await screen.findByLabelText('Document: Demo notes');
  await waitFor(() => expect(editor).toBeEnabled());
  await userEvent.type(editor, ' A local note');
  await userEvent.click(screen.getByRole('button', { name: 'Close notes' }));
  await userEvent.click(screen.getByRole('button', { name: 'All projects' }));
  expect(screen.getByRole('heading', { name: 'Your projects' })).toBeVisible();
  const overview = screen.getByRole('region', { name: 'Project overview' });
  expect(within(overview).getByText('Hackathon demo')).toBeVisible();
  await userEvent.click(within(overview).getByRole('button', { name: 'Continue' }));
  await userEvent.click(screen.getByRole('button', { name: 'Open notes' }));
  expect(screen.getByLabelText('Document: Demo notes')).toBe(editor);
  expect((editor as HTMLTextAreaElement).value).toContain('A local note');
});

test('advanced settings stay closed and the privacy shortcut opens the source controls', async () => {
  render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  await screen.findByRole('heading', { name: 'Hackathon demo', level: 1 });
  expect(screen.getByText('Connection details', { selector: 'summary' }).closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText('Project settings', { selector: 'summary' }).closest('details')).not.toHaveAttribute('open');
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Revoke source' })).toBeVisible());
  expect(screen.getByRole('button', { name: 'Pause source' })).toBeVisible();
  expect(screen.getByText(/desktop bridge required/)).toBeVisible();
});

test('model unavailable offers a useful workspace action and keeps chat drafts editable', async () => {
  render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  expect(await screen.findByLabelText('Manager chat status')).toHaveTextContent(/draft only/i);
  expect(screen.getByRole('button', { name: 'Open notes' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Open next task' }));
  expect(screen.getByLabelText('Status: Record the demo')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  expect(screen.getByLabelText('Message to Nemo')).toBeEnabled();
});

test('a failed first project list can recover without reloading or fabricating a welcome state', async () => {
  const client = createFixtureClient(), list = client.listProjects;
  let failed = true;
  client.listProjects = async () => { if (failed) { failed = false; throw new Error('offline'); } return list(); };
  render(<App client={client} drafts={memoryDrafts()} fixture={false} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Projects unavailable');
  expect(screen.queryByRole('heading', { name: 'Start your first project' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('heading', { name: 'Hackathon demo', level: 1 })).toBeVisible();
});

test('task progress describes actual records and never turns unknown work into a percentage', async () => {
  const seed = snapshot(); seed.project.planState = 'accepted'; seed.project.tasks[0]!.status = 'done';
  render(<App client={createFixtureClient({ snapshots: [seed] })} drafts={memoryDrafts()} fixture />);
  expect(await screen.findByText('1 of 1 tasks marked done')).toBeVisible();
  expect(screen.getByText('100%')).toBeVisible();
  expect(screen.getByText('No open tasks.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Open task' })).not.toBeInTheDocument();
  await userEvent.click(await screen.findByText('Demo', { selector: 'summary' }));
  expect(screen.getByText('Fixture mode · synthetic data · no live model')).toBeVisible();
});

test('offline fallback does not offer task updates while server writes are disabled', async () => {
  const seed = snapshot(); seed.connection.sync = 'offline';
  render(<App client={createFixtureClient({ snapshots: [seed] })} drafts={memoryDrafts()} fixture />);
  expect(await screen.findByLabelText('Manager chat status')).toHaveTextContent('Offline');
  expect(screen.queryByText(/You can still update tasks/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Status: Record the demo')).toBeDisabled();
  await waitFor(() => expect(screen.getByLabelText('Message to Nemo')).toBeEnabled());
});
