import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { createFixtureClient } from '@living-playbooks/api-client';
import { App } from '../../apps/web/src/app/App';
import { deferred, memoryDrafts, snapshot } from './helpers';

afterEach(cleanup);

function withoutQuestionCard(offset = 0) {
  const seed = snapshot(offset);
  seed.project.workspace.panels = seed.project.workspace.panels.filter(panel => panel.type !== 'question_card');
  return seed;
}

test.each(['Not yet', 'Mark task done'] as const)('a canonical question without a canvas card or pet can be answered %s and survives reload', async label => {
  const seed = withoutQuestionCard(), client = createFixtureClient({ snapshots: [seed] }), drafts = memoryDrafts();
  const view = render(<App client={client} drafts={drafts} fixture />);
  await screen.findByRole('region', { name: 'Project questions' });
  expect(screen.getByText('Have you recorded the demo?', { selector: '.compact-question-copy p' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: label }));
  await screen.findByText(`Answer saved: ${label === 'Mark task done' ? 'Task marked done' : label}`);
  expect((await client.getSnapshot(seed.project.id)).checkIns[0]!.answer?.kind).toBe(label === 'Mark task done' ? 'recorded' : 'not_yet');
  view.unmount(); render(<App client={client} drafts={drafts} fixture />);
  expect(await screen.findByText(`Answer saved: ${label === 'Mark task done' ? 'Task marked done' : label}`)).toBeVisible();
});

test('a canonical question suggested by a canvas card appears once in the manager inbox', async () => {
  render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  await screen.findByText('Have you recorded the demo?', { selector: '.compact-question-copy p' });
  expect(screen.getAllByText('Have you recorded the demo?', { selector: '.compact-question-copy p' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Mark task done' })).toHaveLength(1);
  expect(screen.getAllByRole('region', { name: 'Project questions' })).toHaveLength(1);
});

test('a delayed inbox answer for A cannot replace B after project selection', async () => {
  const a = withoutQuestionCard(), b = withoutQuestionCard(100);
  b.checkIns[0]!.question = 'Have you recorded the second project?';
  const client = createFixtureClient({ snapshots: [a, b] }), original = client.answerCheckIn;
  const started = deferred<void>(), release = deferred<void>();
  client.answerCheckIn = async (...args) => { const receipt = await original(...args); started.resolve(); await release.promise; return receipt; };
  render(<App client={client} drafts={memoryDrafts()} fixture />);
  await userEvent.click(await screen.findByRole('button', { name: 'Not yet' }));
  await started.promise;
  await userEvent.click(screen.getByRole('button', { name: /Second project/ }));
  await screen.findByRole('heading', { name: 'Second project', level: 1 });
  await act(async () => release.resolve());
  await waitFor(() => expect(screen.getByText('Have you recorded the second project?', { selector: '.compact-question-copy p' })).toBeVisible());
  expect(screen.queryByText('Have you recorded the demo?')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Second project', level: 1 })).toBeVisible();
});
