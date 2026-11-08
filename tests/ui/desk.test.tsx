import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { createFixtureClient } from '@living-playbooks/api-client';
import { App } from '../../apps/web/src/app/App';
import { memoryDrafts, snapshot } from './helpers';

afterEach(cleanup);

test('the desk shows recorded progress and connected task steps, with usable task actions', async () => {
  const seed = snapshot();
  seed.project.planState = 'accepted';
  seed.project.tasks.push({ ...seed.project.tasks[0]!, id: crypto.randomUUID(), title: 'Review the recording', status: 'done' });
  const steps = seed.project.workspace.panels.find(panel => panel.type === 'milestone_timeline');
  if (steps?.type === 'milestone_timeline') steps.taskIds = seed.project.tasks.map(task => task.id);
  render(<App client={createFixtureClient({ snapshots: [seed] })} drafts={memoryDrafts()} fixture />);
  const progress = await screen.findByRole('region', { name: 'Project progress' });
  expect(within(progress).getByText('50%')).toBeVisible();
  expect(within(progress).getByText('1 of 2 tasks marked done')).toBeVisible();
  expect(within(progress).getByRole('progressbar')).toHaveAttribute('value', '1');
  expect(screen.getByRole('list', { name: 'Project steps' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Open task' }));
  expect(screen.getByLabelText('Status: Record the demo')).toBeVisible();
});

test('Projects shows real summary counts and opens the existing project', async () => {
  render(<App client={createFixtureClient({ snapshots: [snapshot(), snapshot(100)] })} drafts={memoryDrafts()} fixture />);
  await screen.findByRole('heading', { name: 'Hackathon demo', level: 1 });
  await userEvent.click(screen.getByRole('button', { name: 'All projects' }));
  const overview = screen.getByRole('region', { name: 'Project overview' });
  expect(within(overview).getByText('2 projects')).toBeVisible();
  expect(within(overview).getByText('2 active')).toBeVisible();
  expect(within(overview).getByText('2 check-ins')).toBeVisible();
  await userEvent.click(within(overview).getAllByRole('button', { name: 'Continue' })[1]!);
  expect(await screen.findByRole('heading', { name: 'Second project', level: 1 })).toBeVisible();
});

test('unknown progress stays unknown, and the explicit demo badge explains its provenance on demand', async () => {
  render(<App client={createFixtureClient({ snapshots: [] })} drafts={memoryDrafts()} fixture />);
  await screen.findByText('No projects yet');
  expect(screen.getByText('Demo', { selector: 'summary' })).toBeVisible();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  await userEvent.click(screen.getByText('Demo', { selector: 'summary' }));
  expect(screen.getByText('Fixture mode · synthetic data · no live model')).toBeVisible();
});
