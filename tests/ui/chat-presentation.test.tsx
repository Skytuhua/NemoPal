import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { createFixtureClient } from '@living-playbooks/api-client';
import { Chat } from '../../apps/web/src/features/chat/Chat';
import { Question } from '../../apps/web/src/features/checkins/Question';
import type { CheckIn } from '@living-playbooks/contracts';
import { memoryDrafts, snapshot } from './helpers';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const renderCheckIn = (record: CheckIn) => <Question question={record} answer={async () => {}} snooze={async () => {}} />;

test('a snoozed unanswered question renders its real state directly without implying an answer', () => {
  const current = snapshot();
  current.checkIns[0] = { ...current.checkIns[0]!, state: 'snoozed', answer: null };
  render(<Chat snapshot={current} client={createFixtureClient()} store={memoryDrafts()} disabled={false} refresh={async () => {}} renderCheckIn={renderCheckIn} />);
  expect(screen.getByText(current.checkIns[0]!.question)).toBeVisible();
  expect(screen.getByText('Question snoozed')).toBeVisible();
  expect(screen.queryByText(/Answer saved/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Recorded' })).not.toBeInTheDocument();
});

test('the most recent fallback is selected by due date, not opaque ID or array order', async () => {
  const current = snapshot(), original = current.checkIns[0]!;
  const newer = { ...original, id: '00000000-0000-4000-8000-000000000001', state: 'answered' as const, answer: { kind: 'not_yet' as const }, dueAt: '2026-02-01T12:00:00.000Z' };
  const older = { ...original, id: '00000000-0000-4000-8000-000000000999', state: 'answered' as const, answer: { kind: 'recorded' as const }, dueAt: '2026-01-01T12:00:00.000Z' };
  current.checkIns = [newer, older];
  render(<Chat snapshot={current} client={createFixtureClient()} store={memoryDrafts()} disabled={false} refresh={async () => {}} renderCheckIn={renderCheckIn} />);
  expect(within(screen.getByRole('region', { name: 'Manager question' })).getByText('Answer saved: Not yet')).toBeVisible();
  expect(screen.getByText('Answer saved: Recorded')).not.toBeVisible();
  await userEvent.click(screen.getByText('Earlier questions'));
  expect(screen.getByText('Answer saved: Recorded')).toBeVisible();
});

test('an available question due earlier takes priority over a later one', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-03-01T12:00:00.000Z'));
  const current = snapshot(), original = current.checkIns[0]!;
  const earlier = { ...original, id: '00000000-0000-4000-8000-000000000123', question: 'Earlier question', dueAt: '2026-01-01T12:00:00.000Z', expiresAt: '2099-01-01T12:00:00.000Z', state: 'available' as const, answer: null };
  const later = { ...earlier, question: 'Later question', id: '00000000-0000-4000-8000-000000000124', dueAt: '2026-02-01T12:00:00.000Z' };
  current.checkIns = [later, earlier];
  render(<Chat snapshot={current} client={createFixtureClient()} store={memoryDrafts()} disabled={false} refresh={async () => {}} renderCheckIn={renderCheckIn} />);
  expect(within(screen.getByRole('region', { name: 'Manager question' })).getByText(earlier.question)).toBeVisible();
  expect(screen.getByText(later.question)).not.toBeVisible();
  await userEvent.click(screen.getByText('Earlier questions'));
  expect(screen.getAllByText(earlier.question)).toHaveLength(1);
  expect(screen.getAllByText(later.question)).toHaveLength(1);
});

test('a future scheduled check-in is viewable without promising an answer or an answer action', () => {
  const current = snapshot();
  current.checkIns[0] = { ...current.checkIns[0]!, state: 'scheduled', dueAt: '2098-01-01T12:00:00.000Z', answer: null };
  render(<Chat snapshot={current} client={createFixtureClient()} store={memoryDrafts()} disabled={false} refresh={async () => {}} renderCheckIn={renderCheckIn} />);
  expect(screen.getByText(current.checkIns[0]!.question)).toBeVisible();
  expect(screen.getByText('Question scheduled')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Answer check-in' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'View answer' })).not.toBeInTheDocument();
});

test('the integrated composer preserves unavailable live drafts with an accessible truthful send reason', async () => {
  const current = snapshot(), client = createFixtureClient(), store = memoryDrafts();
  current.connection.mode = 'live';
  current.connection.inference = { available: false, reason: 'Model unavailable' };
  const send = vi.spyOn(client, 'sendMessage');
  render(<Chat snapshot={current} client={client} store={store} disabled={false} refresh={async () => {}} />);
  const editor = screen.getByLabelText('Message to Nemo');
  await waitFor(() => expect(editor).toBeEnabled());
  await userEvent.type(editor, 'Keep this question');
  const button = screen.getByRole('button', { name: 'Send message' });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('title', 'Replies are not connected');
  expect(button).toHaveAccessibleDescription('Replies are not connected. Your message has not been sent.');
  expect(editor.closest('.composer-input')).not.toBeNull();
  expect(within(editor.closest('.composer-input') as HTMLElement).getByRole('button', { name: 'Send message' })).toBe(button);
  await waitFor(async () => expect((await store.read(`${current.project.id}:chat`))?.text).toBe('Keep this question'));
  expect(send).not.toHaveBeenCalled();
  expect(screen.queryByText(/Build|model selection/i)).not.toBeInTheDocument();
});

test('the icon send control submits the existing revisioned message and clears only its acknowledged draft', async () => {
  const current = snapshot(), client = createFixtureClient(), store = memoryDrafts(), refresh = vi.fn(async () => {});
  current.connection.inference = { available: true };
  const send = vi.spyOn(client, 'sendMessage');
  render(<Chat snapshot={current} client={client} store={store} disabled={false} refresh={refresh} />);
  const editor = screen.getByLabelText('Message to Nemo');
  await waitFor(() => expect(editor).toBeEnabled());
  await userEvent.type(editor, 'What should I do next?');
  await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(send).toHaveBeenCalledExactlyOnceWith(current.project.id, { operationId: expect.any(String), expectedRevision: current.project.revision, input: { text: 'What should I do next?' } });
  expect(editor).toHaveValue('');
  expect(screen.getByRole('status')).toHaveTextContent('A reply is not available yet.');
});
