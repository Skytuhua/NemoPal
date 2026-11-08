import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
