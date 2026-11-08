import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import { resolve } from 'node:path';
import { createFixtureClient } from '@living-playbooks/api-client';
import { NativeBoundary } from '../../apps/desktop/src/main/ipc';
import { CodexDesktopSession } from '../../apps/desktop/src/main/codex-desktop-session';
import { Chat } from '../../apps/web/src/features/chat/Chat';
import { CodexDemo, type CodexDemoHandle, type DemoActivity } from '../../apps/web/src/features/chat/CodexDemo';
import { memoryDrafts, snapshot } from './helpers';

afterEach(cleanup);

it('forwards an explicit manager request to the same owned session and lets the user review activity before sharing with the manager', async () => {
  const current = snapshot();
  current.connection.inference = { available: true };
  const projectId = current.project.id;
  const demo = new CodexDesktopSession(() => ({ executable: process.execPath, args: [resolve('tests/desktop/fixtures/demo-app-server.cjs')] }));
  const sender = { role: 'workspace', senderId: 1, frameId: 2, topFrameId: 2, url: 'file:///app/index.html' };
  const boundary = new NativeBoundary({ workspace: { senderId: 1, frameId: 2, url: sender.url } }, { projects: new Set([projectId]), checkIns: new Map(), documents: new Map(), jobs: new Map() }, async (op, raw) => {
    if (op === 'startCodexDemo') { await demo.start(projectId, process.cwd()); return 'started'; }
    if (op === 'sendCodexDemo') { const input = raw as { projectId: string; text: string }; return demo.send(input.projectId, input.text); }
    if (op === 'stopCodexDemo') return demo.close();
    throw Error('denied');
  });
  const start = () => boundary.call(sender, 'startCodexDemo', projectId) as Promise<'started'>;
  const send = (input: { projectId: string; text: string }) => boundary.call(sender, 'sendCodexDemo', input) as Promise<{ status: 'completed' | 'failed' | 'interrupted' | 'unknown'; replies: string[] }>;
  const stop = async () => { await boundary.call(sender, 'stopCodexDemo', projectId); };
  const client = createFixtureClient();
  const managerSend = vi.spyOn(client, 'sendMessage');
  function Harness() {
    const ref = useRef<CodexDemoHandle>(null);
    const [activity, setActivity] = useState<DemoActivity>({ active: false, busy: false, uncertain: false, messages: [] });
    return <><Chat snapshot={current} client={client} store={memoryDraftsInstance} disabled={false} refresh={async () => {}} demo={activity} demoRef={ref} /><CodexDemo ref={ref} projectId={projectId} start={start} send={send} stop={stop} onActivity={setActivity} /></>;
  }
  const memoryDraftsInstance = memoryDrafts();
  try {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Start Codex demo' }));
    await screen.findByRole('button', { name: 'Stop demo' });
    await userEvent.type(screen.getByLabelText('Message to Codex'), 'first');
    await userEvent.click(screen.getByRole('button', { name: 'Send to Codex' }));
    await within(screen.getByRole('log', { name: 'Codex demo conversation' })).findByText('reply first');
    const manager = screen.getByLabelText('Message to Nemo');
    await waitFor(() => expect(manager).toBeEnabled());
    await userEvent.type(manager, 'second');
    await userEvent.click(screen.getByRole('button', { name: 'Send request to Codex demo' }));
    await waitFor(() => expect(within(screen.getByRole('log', { name: 'Selected manager conversation' })).getByText('reply second')).toBeVisible());
    expect(managerSend).not.toHaveBeenCalled();
    expect(manager).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Add demo activity to manager draft' }));
    expect((manager as HTMLTextAreaElement).value).toContain('reply first');
    expect((manager as HTMLTextAreaElement).value).toContain('reply second');
    expect(managerSend).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(managerSend).toHaveBeenCalledOnce());
  } finally { demo.close(); }
});


it('blocks another forward after an uncertain synthetic turn and preserves the manager draft', async () => {
  const current = snapshot(), store = memoryDrafts(), client = createFixtureClient();
  const send = vi.fn(async () => ({ status: 'unknown' as const, replies: [] }));
  function Harness() {
    const ref = useRef<CodexDemoHandle>(null);
    const [activity, setActivity] = useState<DemoActivity>({ active: false, busy: false, uncertain: false, messages: [] });
    return <><Chat snapshot={current} client={client} store={store} disabled={false} refresh={async () => {}} demo={activity} demoRef={ref} /><CodexDemo ref={ref} projectId={current.project.id} start={async () => 'started'} send={send} stop={async () => {}} onActivity={setActivity} /></>;
  }
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Start Codex demo' }));
  await screen.findByRole('button', { name: 'Stop demo' });
  const input = screen.getByLabelText('Message to Nemo');
  await waitFor(() => expect(input).toBeEnabled());
  await userEvent.type(input, 'approval');
  await userEvent.click(screen.getByRole('button', { name: 'Send request to Codex demo' }));
  await screen.findByText(/Delivery is unknown; the session stopped/);
  expect(input).toHaveValue('approval');
  expect(screen.getByRole('button', { name: 'Send request to Codex demo' })).toBeDisabled();
  expect(send).toHaveBeenCalledOnce();
});

it('cannot forward a captured request to a replacement demo session', async () => {
  const ref = { current: null as CodexDemoHandle | null };
  const send = vi.fn(async () => ({ status: 'completed' as const, replies: [] }));
  render(<CodexDemo ref={ref} projectId="project" start={async () => 'started'} send={send} stop={async () => {}} />);
  await userEvent.click(screen.getByRole('button', { name: 'Start Codex demo' }));
  await screen.findByRole('button', { name: 'Stop demo' });
  const original = ref.current!;
  await userEvent.click(screen.getByRole('button', { name: 'Stop demo' }));
  await userEvent.click(screen.getByRole('button', { name: 'Start Codex demo' }));
  await screen.findByRole('button', { name: 'Stop demo' });
  expect(await original.forward('stale')).toBe('failed');
  expect(send).not.toHaveBeenCalled();
});

it('blocks a repeat when the completed request draft cannot be cleared', async () => {
  const current = snapshot(), store = memoryDrafts(), client = createFixtureClient();
  store.remove = async () => { throw Error('synthetic storage failure'); };
  const send = vi.fn(async () => ({ status: 'completed' as const, replies: ['done'] }));
  function Harness() {
    const ref = useRef<CodexDemoHandle>(null);
    const [activity, setActivity] = useState<DemoActivity>({ active: false, busy: false, uncertain: false, messages: [] });
    return <><Chat snapshot={current} client={client} store={store} disabled={false} refresh={async () => {}} demo={activity} demoRef={ref} /><CodexDemo ref={ref} projectId={current.project.id} start={async () => 'started'} send={send} stop={async () => {}} onActivity={setActivity} /></>;
  }
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Start Codex demo' }));
  await screen.findByRole('button', { name: 'Stop demo' });
  const input = screen.getByLabelText('Message to Nemo');
  await waitFor(() => expect(input).toBeEnabled());
  await userEvent.type(input, 'once');
  await userEvent.click(screen.getByRole('button', { name: 'Send request to Codex demo' }));
  await screen.findByText(/Codex completed the turn, but the draft could not be cleared/);
  expect(input).toHaveValue('once');
  expect(screen.getByRole('button', { name: 'Send request to Codex demo' })).toBeDisabled();
  expect(send).toHaveBeenCalledOnce();
});
