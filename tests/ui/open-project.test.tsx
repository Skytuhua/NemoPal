import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { createFixtureClient } from '@living-playbooks/api-client';
import type { DesktopBridge } from '@living-playbooks/contracts';
import { App } from '../../apps/web/src/app/App';
import { memoryDrafts, snapshot } from './helpers';

afterEach(cleanup);

function events() {
  const listeners = new Set<(event: unknown) => void>();
  const bridge = {
    capabilities: async () => { throw new Error('No native capability in this synthetic test'); },
    onEvent(listener: (event: unknown) => void) { listeners.add(listener); return () => listeners.delete(listener); },
  } as unknown as DesktopBridge;
  return { bridge, emit(event: unknown) { act(() => { for (const listener of listeners) listener(event); }); } };
}

test('pet open-project event selects the requested project and preserves the current draft', async () => {
  const a = snapshot(), b = snapshot(100), client = createFixtureClient({ snapshots: [a, b] });
  const drafts = memoryDrafts(), desktop = events();
  render(<App client={client} drafts={drafts} bridge={desktop.bridge} fixture />);
  await userEvent.click(await screen.findByRole('button', { name: 'Project settings' }));
  await waitFor(() => expect(screen.getByLabelText('Document: Demo notes')).toBeEnabled());
  await userEvent.type(screen.getByLabelText('Document: Demo notes'), ' Local unsaved text');
  desktop.emit({ type: 'open_project', projectId: b.project.id });
  await screen.findByRole('heading', { name: 'Second project' });
  expect((await drafts.read(`${a.project.id}:document:${a.documents[0]!.id}`))?.text).toContain('Local unsaved text');
});

test('pet open-project event cannot discard a draft when storage flush fails', async () => {
  const a = snapshot(), b = snapshot(100), client = createFixtureClient({ snapshots: [a, b] });
  const drafts = memoryDrafts(), desktop = events();
  render(<App client={client} drafts={drafts} bridge={desktop.bridge} fixture />);
  await userEvent.click(await screen.findByRole('button', { name: 'Project settings' }));
  await waitFor(() => expect(screen.getByLabelText('Document: Demo notes')).toBeEnabled());
  await userEvent.type(screen.getByLabelText('Document: Demo notes'), ' Keep this text');
  drafts.flush = async () => { throw new Error('Storage failed'); };
  desktop.emit({ type: 'open_project', projectId: b.project.id });
  await screen.findByText('Draft storage failed. Copy your work before switching projects.');
  expect(screen.getByRole('button', { name: /Hackathon demo/ })).toHaveAttribute('aria-current', 'page');
  expect((screen.getByLabelText('Document: Demo notes') as HTMLTextAreaElement).value).toContain('Keep this text');
});

test('malformed or unknown-project native events do not fetch or switch projects', async () => {
  const a = snapshot(), client = createFixtureClient(), desktop = events();
  const read = vi.spyOn(client, 'getSnapshot');
  render(<App client={client} drafts={memoryDrafts()} bridge={desktop.bridge} fixture />);
  await screen.findByRole('heading', { name: 'Hackathon demo' });
  const initialReads = read.mock.calls.length;
  desktop.emit({ type: 'open_project', projectId: crypto.randomUUID() });
  desktop.emit({ type: 'open_project', projectId: a.project.id, command: 'execute' });
  await act(async () => {});
  expect(read).toHaveBeenCalledTimes(initialReads);
  expect(screen.getByRole('heading', { name: 'Hackathon demo' })).toBeVisible();
});

test('keeps the Codex conversation on same-project selection and blocks switching with a draft', async () => {
  const a = snapshot(), b = snapshot(100), client = createFixtureClient({ snapshots: [a, b] }), desktop = events();
  desktop.bridge.startCodexDemo = async () => 'started';
  desktop.bridge.sendCodexDemo = async () => ({ status: 'unknown', replies: [] });
  desktop.bridge.stopCodexDemo = async () => {};
  render(<App client={client} drafts={memoryDrafts()} bridge={desktop.bridge} fixture />);
  await screen.findByRole('heading', { name: 'Hackathon demo' });
  await userEvent.click(screen.getByRole('button', { name: 'Codex demo' }));
  await userEvent.click(screen.getByRole('button', { name: 'Start Codex demo' }));
  const input = screen.getByLabelText('Message to Codex');
  await userEvent.type(input, 'keep draft');
  desktop.emit({ type: 'open_project', projectId: a.project.id });
  expect(screen.getByLabelText('Message to Codex')).toHaveValue('keep draft');
  desktop.emit({ type: 'open_project', projectId: b.project.id });
  expect(await screen.findByText(/clear or copy its draft before switching projects/i)).toBeVisible();
  expect(screen.getByLabelText('Message to Codex')).toHaveValue('keep draft');
  expect(screen.getByRole('heading', { name: 'Hackathon demo' })).toBeVisible();
});

test('manager forwards to the selected demo and shows its reply in the project', async () => {
  const a = snapshot(), client = createFixtureClient({ snapshots: [a] }), desktop = events();
  const send = vi.fn(async ({ text }: { projectId: string; text: string }) => ({ status: 'completed' as const, replies: [`Synthetic: ${text}`] }));
  desktop.bridge.startCodexDemo = async () => 'started';
  desktop.bridge.sendCodexDemo = send;
  desktop.bridge.stopCodexDemo = async () => {};
  render(<App client={client} drafts={memoryDrafts()} bridge={desktop.bridge} fixture />);
  await screen.findByRole('heading', { name: 'Hackathon demo' });
  await userEvent.click(screen.getByRole('button', { name: 'Codex demo' }));
  await userEvent.click(screen.getByRole('button', { name: 'Start Codex demo' }));
  await screen.findByRole('button', { name: 'Stop demo' });
  await userEvent.click(screen.getByRole('button', { name: 'Manager' }));
  const input = screen.getByLabelText('Message to Nemo');
  await waitFor(() => expect(input).toBeEnabled());
  await userEvent.type(input, 'Inspect this project');
  await userEvent.click(screen.getByRole('button', { name: 'Send request to Codex demo' }));
  expect(await within(screen.getByRole('log', { name: 'Selected manager conversation' })).findByText('Synthetic: Inspect this project')).toBeVisible();
  expect(send).toHaveBeenCalledExactlyOnceWith({ projectId: a.project.id, text: 'Inspect this project' });
});
