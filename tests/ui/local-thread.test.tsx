import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { DesktopBridge, DesktopCapabilities } from '@living-playbooks/contracts';
import { WorkspaceRoot } from '../../apps/web/src/app/WorkspaceRoot';
import { deferred } from './helpers';

const drafts = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../apps/web/src/features/documents/drafts', () => ({ createDraftStore: drafts.create }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const threadId = '11111111-1111-4111-8111-111111111111';
const history = { thread: { threadId, title: 'Synthetic local coding thread', status: 'running', link: 'https://example.test/thread' }, messages: [{ role: 'user', text: 'Synthetic request', runId: 'run-1' }] };
const receipt = { threadId, runId: 'run-2', status: 'queued' };
function harness() {
  const capabilities: DesktopCapabilities = { paired: false, cloudOrigin: null, nativePet: { available: false, reason: 'Synthetic' }, sourceObservation: { available: false, adapterId: 'test', adapterVersion: '1', installedVersion: null, capability: 'unavailable', reason: 'Synthetic', coverage: 'No observations' } };
  const read = vi.fn().mockResolvedValue(history), send = vi.fn().mockResolvedValue(receipt), invoke = vi.fn();
  const localThread = { read, send };
  const bridge = { capabilities: vi.fn().mockResolvedValue(capabilities), invoke, localThread } as unknown as DesktopBridge;
  return { bridge, read, send, invoke };
}
async function open(bridge: DesktopBridge) {
  const view = render(<WorkspaceRoot bridge={bridge} development={false} fixtureEnabled={false} />);
  await userEvent.click(screen.getByRole('button', { name: 'Local coding thread' }));
  return view;
}
async function readThread() { await userEvent.click(screen.getByRole('button', { name: 'Read thread' })); await screen.findByRole('heading', { name: history.thread.title }); }

test('local thread reads remain explicit and work outside cloud pairing', async () => {
  const h = harness();
  render(<WorkspaceRoot bridge={h.bridge} development={false} fixtureEnabled={false} />);
  expect(await screen.findByRole('heading', { name: 'Desktop connection unavailable' })).toBeVisible();
  expect(h.read).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Local coding thread' }));
  expect(h.read).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Send to thread' })).toBeDisabled();
  await readThread();
  expect(h.read).toHaveBeenCalledExactlyOnceWith({ limit: 20 });
  expect(screen.getByText('Synthetic request')).toBeVisible();
  expect(h.invoke).not.toHaveBeenCalled();
  expect(drafts.create).not.toHaveBeenCalled();
});

test('owner sends a literal message after reading the selected thread', async () => {
  const h = harness(); await open(h.bridge); await readThread();
  fireEvent.change(screen.getByLabelText('Message to local coding thread'), { target: { value: 'Owner test: "hello" & 你好' } });
  await userEvent.click(screen.getByRole('button', { name: 'Send to thread' }));
  await waitFor(() => expect(h.send).toHaveBeenCalledExactlyOnceWith({ message: 'Owner test: "hello" & 你好' }));
  expect(await screen.findByRole('status')).toHaveTextContent(/queued/i);
  expect(screen.getByLabelText('Message to local coding thread')).toHaveValue('');
  expect(h.read).toHaveBeenCalledTimes(1);
});

test('failed sending preserves the draft and requires a read before manual retry', async () => {
  const h = harness(); h.send.mockRejectedValue(Error('PRIVATE CLI ERROR'));
  await open(h.bridge); await readThread();
  fireEvent.change(screen.getByLabelText('Message to local coding thread'), { target: { value: 'Preserve this draft' } });
  await userEvent.click(screen.getByRole('button', { name: 'Send to thread' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/may already have been queued/i);
  expect(screen.getByLabelText('Message to local coding thread')).toHaveValue('Preserve this draft');
  expect(screen.getByRole('button', { name: 'Send to thread' })).toBeDisabled();
  expect(document.body.textContent).not.toContain('PRIVATE CLI ERROR');
  expect(h.send).toHaveBeenCalledTimes(1);
  await readThread();
  expect(screen.getByRole('button', { name: 'Send to thread' })).toBeEnabled();
  expect(h.send).toHaveBeenCalledTimes(1);
});

test('switching views keeps the unsent local draft', async () => {
  const h = harness(); await open(h.bridge); await readThread();
  fireEvent.change(screen.getByLabelText('Message to local coding thread'), { target: { value: 'Unsent draft' } });
  await userEvent.click(screen.getByRole('button', { name: 'Project workspace' }));
  await userEvent.click(screen.getByRole('button', { name: 'Local coding thread' }));
  expect(screen.getByLabelText('Message to local coding thread')).toHaveValue('Unsent draft');
  expect(h.read).toHaveBeenCalledTimes(1);
});

test('synchronous duplicate submits and IME composition never duplicate a send', async () => {
  const h = harness(), pending = deferred<typeof receipt>(); h.send.mockReturnValue(pending.promise);
  await open(h.bridge); await readThread();
  const field = screen.getByLabelText('Message to local coding thread');
  fireEvent.change(field, { target: { value: 'One message' } });
  fireEvent.compositionStart(field);
  fireEvent.submit(screen.getByRole('form', { name: 'Send to local coding thread' }));
  expect(h.send).not.toHaveBeenCalled();
  fireEvent.compositionEnd(field);
  fireEvent.submit(screen.getByRole('form', { name: 'Send to local coding thread' }));
  fireEvent.submit(screen.getByRole('form', { name: 'Send to local coding thread' }));
  expect(h.send).toHaveBeenCalledTimes(1);
  expect(field).toBeDisabled();
  await act(async () => { pending.resolve(receipt); });
});

test('replacing the desktop bridge ignores the old pending read', async () => {
  const a = harness(), b = harness(), pending = deferred<typeof history>(); a.read.mockReturnValue(pending.promise);
  const view = await open(a.bridge);
  await userEvent.click(screen.getByRole('button', { name: 'Read thread' }));
  view.rerender(<WorkspaceRoot bridge={b.bridge} development={false} fixtureEnabled={false} />);
  await act(async () => { pending.resolve(history); });
  expect(screen.queryByRole('heading', { name: history.thread.title })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Send to thread' })).toBeDisabled();
});
