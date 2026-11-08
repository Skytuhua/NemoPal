import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { CodexDemo } from '../../apps/web/src/features/chat/CodexDemo';

afterEach(cleanup);

it('requires activation, displays replies, and preserves an uncertain message', async () => {
  const start = vi.fn(async () => 'started' as const);
  const send = vi.fn().mockResolvedValueOnce({ status: 'completed', replies: ['Synthetic reply'] }).mockResolvedValueOnce({ status: 'unknown', replies: [] });
  render(<CodexDemo projectId="project" start={start} send={send} stop={async () => {}} />);
  expect(send).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /start codex demo/i }));
  const input = screen.getByLabelText('Message to Codex');
  await userEvent.type(input, 'hello');
  await userEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));
  expect(await screen.findByText('Synthetic reply')).toBeVisible();
  await userEvent.type(input, 'approval');
  await userEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));
  expect(await screen.findByText(/delivery is unknown/i)).toBeVisible();
  expect(input).toHaveValue('approval');
  expect(screen.getByRole('button', { name: 'Send to Codex' })).toBeDisabled();
});

it('keeps the draft and warns when stopped during a pending send', async () => {
  let finish!: (value: { status: 'unknown'; replies: string[] }) => void;
  const send = vi.fn(() => new Promise<{ status: 'unknown'; replies: string[] }>(resolve => { finish = resolve; }));
  const guard = vi.fn();
  render(<CodexDemo projectId="project" start={async () => 'started'} send={send} stop={async () => {}} onGuardChange={guard} />);
  await userEvent.click(screen.getByRole('button', { name: /start codex demo/i }));
  await userEvent.type(screen.getByLabelText('Message to Codex'), 'keep this');
  await userEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));
  await userEvent.click(screen.getByRole('button', { name: 'Stop demo' }));
  expect(screen.getByRole('status')).toHaveTextContent('Delivery is unknown');
  expect(screen.getByLabelText('Message to Codex')).toHaveValue('keep this');
  expect(screen.getByRole('button', { name: 'Start Codex demo' })).toBeDisabled();
  await act(async () => { finish({ status: 'unknown', replies: [] }); });
  expect(screen.getByRole('status')).toHaveTextContent('Delivery is unknown');
  expect(guard).toHaveBeenLastCalledWith(true);
});
