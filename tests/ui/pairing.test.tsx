import '@testing-library/jest-dom/vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { DesktopBridge, DesktopCapabilities, PairingResult } from '@living-playbooks/contracts';
import { deferred } from './helpers';

const drafts = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn(), write: vi.fn(), remove: vi.fn(), flush: vi.fn() }));
vi.mock('../../apps/web/src/features/documents/drafts', () => ({ createDraftStore: drafts.create }));
vi.mock('react-dom/client', async importOriginal => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return { ...actual, createRoot: vi.fn(actual.createRoot) };
});

let root: Root | undefined;
const origin = 'https://pairing.example';
function capabilities(paired = false): DesktopCapabilities {
  return { paired, cloudOrigin: origin, nativePet: { available: false, reason: 'Synthetic test' }, sourceObservation: {
    available: false, adapterId: 'test', adapterVersion: '1', installedVersion: null,
    capability: 'unavailable', reason: 'Synthetic test', coverage: 'No source reads',
  } };
}
function harness() {
  const capabilitiesCall = vi.fn<DesktopBridge['capabilities']>().mockResolvedValue(capabilities());
  const pair = vi.fn<DesktopBridge['pair']>().mockResolvedValue({ paired: false });
  const invoke = vi.fn().mockResolvedValue([]);
  const onEvent = vi.fn(() => () => {});
  const bridge = { capabilities: capabilitiesCall, pair, invoke, onEvent } as unknown as DesktopBridge;
  return { bridge, capabilities: capabilitiesCall, pair, invoke };
}
async function start(bridge?: DesktopBridge, options: { development?: boolean; fixture?: boolean; pet?: boolean } = {}) {
  vi.stubEnv('DEV', options.development ?? false);
  vi.stubEnv('VITE_DEV_FIXTURES', options.fixture ? 'true' : 'false');
  window.playbooks = bridge;
  window.history.replaceState(null, '', options.pet ? '/?surface=pet' : '/');
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => { await import('../../apps/web/src/main'); });
  root = vi.mocked(createRoot).mock.results.at(-1)!.value;
}
async function fill(code = 'operator-code', deviceName = 'Owner desktop') {
  await userEvent.type(await screen.findByLabelText('Pairing code'), code);
  await userEvent.type(screen.getByLabelText('Device name'), deviceName);
}
async function submit() { await userEvent.click(screen.getByRole('button', { name: 'Pair desktop' })); }
function expectClosed(h: ReturnType<typeof harness>) {
  expect(h.invoke).not.toHaveBeenCalled();
  expect(drafts.create).not.toHaveBeenCalled();
  expect(screen.queryByText(/Fixture mode/)).not.toBeInTheDocument();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  drafts.create.mockReturnValue(drafts);
  drafts.read.mockResolvedValue(undefined);
  drafts.write.mockResolvedValue(undefined);
  drafts.remove.mockResolvedValue(undefined);
  drafts.flush.mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => { root?.unmount(); }); root = undefined;
  delete window.playbooks; delete window.pet;
  document.body.innerHTML = ''; document.body.className = ''; document.documentElement.className = '';
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

test('workspace commands wait for capability loading and unpaired desktop stays closed', async () => {
  const h = harness(), pending = deferred<DesktopCapabilities>();
  h.capabilities.mockReturnValue(pending.promise);
  await start(h.bridge);
  expectClosed(h);
  expect(screen.getByRole('status')).toHaveTextContent('Checking desktop connection');
  await act(async () => { pending.resolve(capabilities()); });
  expect(await screen.findByRole('heading', { name: 'Pair this desktop' })).toBeVisible();
  expectClosed(h);
});

test('unpaired desktop shows configured destination and a private form, never fixture fallback', async () => {
  const h = harness(); await start(h.bridge, { development: true, fixture: true });
  const code = await screen.findByLabelText('Pairing code');
  expect(code).toHaveAttribute('type', 'password');
  expect(code).toHaveAttribute('autocomplete', 'off');
  expect(screen.getByText(origin)).toBeVisible();
  expect(screen.getByLabelText('Device name')).toBeVisible();
  expectClosed(h);
});

test('already paired desktop mounts existing workspace without another pairing request', async () => {
  const h = harness(); h.capabilities.mockResolvedValue(capabilities(true));
  await start(h.bridge);
  expect(await screen.findByText('No projects yet')).toBeVisible();
  expect(h.invoke).toHaveBeenCalledWith({ type: 'listProjects' });
  expect(h.pair).not.toHaveBeenCalled();
});

test('successful pair waits for canonical capabilities before mounting, clears code and prevents duplicates', async () => {
  const h = harness(), attempt = deferred<PairingResult>(), confirmation = deferred<DesktopCapabilities>();
  h.pair.mockReturnValue(attempt.promise);
  h.capabilities.mockResolvedValueOnce(capabilities()).mockReturnValue(confirmation.promise);
  await start(h.bridge); await fill(' operator-code ', ' Owner desktop '); await submit();
  expect(h.pair).toHaveBeenCalledExactlyOnceWith({ code: 'operator-code', deviceName: 'Owner desktop' });
  expect(screen.getByLabelText('Pairing code')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Pairing desktop…' })).toBeDisabled();
  fireEvent.submit(screen.getByRole('form', { name: 'Pair this desktop' }));
  expect(h.pair).toHaveBeenCalledTimes(1);
  expectClosed(h);
  await act(async () => { attempt.resolve({ paired: true }); });
  expect(h.capabilities).toHaveBeenCalledTimes(2); expectClosed(h);
  await act(async () => { confirmation.resolve(capabilities(true)); });
  expect(await screen.findByText('No projects yet')).toBeVisible();
  expect(h.invoke).toHaveBeenCalledWith({ type: 'listProjects' });
});

test.each(['invalid', 'expired', 'unsafe provider detail'])('failed %s code stays closed until the connection is rechecked', async reason => {
  const h = harness(); h.pair.mockResolvedValueOnce({ paired: false, reason }).mockResolvedValueOnce({ paired: true });
  await start(h.bridge); await fill(); await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(/not confirmed.*retry.*connection/i);
  expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument();
  expect(screen.queryByText(reason, { exact: true })).not.toBeInTheDocument(); expectClosed(h);
  await userEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
  await fill('replacement-code');
  h.capabilities.mockResolvedValue(capabilities(true)); await submit();
  expect(await screen.findByText('No projects yet')).toBeVisible();
  expect(h.pair).toHaveBeenCalledTimes(2);
});

test('pair rejection hides raw errors and allows retry', async () => {
  const h = harness(); h.pair.mockRejectedValue(new Error('Bearer private-token operator-code https://internal/error'));
  await start(h.bridge); await fill(); await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(/not confirmed/i);
  expect(document.body.textContent).not.toMatch(/private-token|operator-code|internal\/error/);
  expect(screen.getByRole('button', { name: 'Retry connection' })).toBeEnabled(); expectClosed(h);
});

test.each([null, { paired: 'true' }, { paired: true, deviceId: 'wrong' }, { paired: true, token: 'private-token' }, { paired: true, expiresAt: '2000-01-01T00:00:00.000Z' }])('malformed or expired pair result fails closed: %j', async result => {
  const h = harness(); h.pair.mockResolvedValue(result as PairingResult);
  await start(h.bridge); await fill(); await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(/not confirmed/i);
  expect(h.capabilities).toHaveBeenCalledTimes(1); expectClosed(h);
});

test.each(['unpaired', 'malformed', 'rejected', 'changed destination'])('pair success with %s canonical confirmation fails closed', async scenario => {
  const h = harness(); h.pair.mockResolvedValue({ paired: true });
  if (scenario === 'rejected') h.capabilities.mockResolvedValueOnce(capabilities()).mockRejectedValue(new Error('private-network-detail'));
  else h.capabilities.mockResolvedValueOnce(capabilities()).mockResolvedValueOnce(
    scenario === 'malformed' ? { paired: true } as DesktopCapabilities : { ...capabilities(scenario !== 'unpaired'), cloudOrigin: scenario === 'changed destination' ? 'https://other.example' : origin });
  await start(h.bridge); await fill(); await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent(/not confirmed/i); expectClosed(h);
  expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry connection' })).toBeEnabled();
});

test('a changed destination must be reloaded and shown before another code can be sent', async () => {
  const h = harness(); h.pair.mockResolvedValue({ paired: true });
  h.capabilities.mockResolvedValueOnce(capabilities()).mockResolvedValueOnce({ ...capabilities(true), cloudOrigin: 'https://other.example' })
    .mockResolvedValueOnce({ ...capabilities(), cloudOrigin: 'https://other.example' });
  await start(h.bridge); await fill(); await submit();
  expect(await screen.findByRole('button', { name: 'Retry connection' })).toBeVisible();
  expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument();
  expect(h.pair).toHaveBeenCalledTimes(1); expectClosed(h);
  await userEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
  expect(await screen.findByText('https://other.example')).toBeVisible();
  expect(screen.getByLabelText('Pairing code')).toHaveValue('');
});

test.each(['false', 'rejected', 'malformed', 'expired'] as const)('a %s pair outcome requires a destination recheck before another code', async outcome => {
  const h = harness(); let destination = origin, paired = false;
  h.capabilities.mockImplementation(async () => ({ ...capabilities(paired), cloudOrigin: destination }));
  h.pair.mockImplementationOnce(async () => {
    destination = 'https://other.example';
    if (outcome === 'rejected') throw new Error('Uncertain pairing response');
    if (outcome === 'malformed') return { paired: 'true' } as unknown as PairingResult;
    if (outcome === 'expired') return { paired: true, expiresAt: '2000-01-01T00:00:00.000Z' };
    return { paired: false };
  }).mockImplementationOnce(async () => { paired = true; return { paired: true }; });
  await start(h.bridge); await fill(); await submit();
  await screen.findByRole('button', { name: 'Retry connection' });
  expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument();
  expect(h.pair).toHaveBeenCalledTimes(1); expect(h.capabilities).toHaveBeenCalledTimes(1); expectClosed(h);
  await userEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
  expect(await screen.findByText('https://other.example')).toBeVisible();
  expect(h.capabilities).toHaveBeenCalledTimes(2); expect(h.pair).toHaveBeenCalledTimes(1);
  await fill('fresh-code'); await submit();
  expect(await screen.findByText('No projects yet')).toBeVisible();
  expect(h.pair).toHaveBeenCalledTimes(2); expect(h.capabilities).toHaveBeenCalledTimes(3);
});

test('a lost pairing response reconciles canonical paired state without redeeming a second code', async () => {
  const h = harness();
  h.pair.mockRejectedValue(new Error('Response lost after successful redemption'));
  h.capabilities.mockResolvedValueOnce(capabilities()).mockResolvedValueOnce(capabilities(true));
  await start(h.bridge); await fill(); await submit();
  await userEvent.click(await screen.findByRole('button', { name: 'Retry connection' }));
  expect(await screen.findByText('No projects yet')).toBeVisible();
  expect(h.pair).toHaveBeenCalledTimes(1); expect(h.capabilities).toHaveBeenCalledTimes(2);
});

test.each([null, { ...capabilities(), paired: 'true' }, { ...capabilities(), token: 'private-token' }, { ...capabilities(), cloudOrigin: 'not-an-origin' }, { ...capabilities(), cloudOrigin: 'https://user:secret@pairing.example' }])('malformed capabilities offer retry and never unlock: %j', async value => {
  const h = harness(); h.capabilities.mockResolvedValueOnce(value as DesktopCapabilities).mockResolvedValueOnce(capabilities());
  await start(h.bridge, { development: true, fixture: true });
  expect(await screen.findByRole('alert')).toHaveTextContent(/connection.*unavailable/i); expectClosed(h);
  expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
  expect(await screen.findByLabelText('Pairing code')).toBeVisible();
});

test('capability rejection is unavailable and retry rechecks rather than falling back', async () => {
  const h = harness(); h.capabilities.mockRejectedValueOnce(new Error('internal-network-detail')).mockResolvedValueOnce(capabilities());
  await start(h.bridge, { development: true, fixture: true });
  expect(await screen.findByRole('alert')).toHaveTextContent(/connection.*unavailable/i);
  expect(document.body.textContent).not.toContain('internal-network-detail'); expectClosed(h);
  await userEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
  expect(await screen.findByLabelText('Pairing code')).toBeVisible();
});

test('unconfigured cloud destination cannot accept a pairing code', async () => {
  const h = harness(); h.capabilities.mockResolvedValue({ ...capabilities(), cloudOrigin: null });
  await start(h.bridge);
  expect(await screen.findByText(/destination.*not configured/i)).toBeVisible();
  expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument(); expectClosed(h);
});

test.each([{ code: '   ', deviceName: 'Owner' }, { code: 'code', deviceName: '   ' }, { code: '😀'.repeat(65), deviceName: 'Owner' }, { code: 'code', deviceName: '😀'.repeat(31) }])('input is validated against byte limits before bridge submission', async input => {
  const h = harness(); await start(h.bridge);
  fireEvent.change(await screen.findByLabelText('Pairing code'), { target: { value: input.code } });
  fireEvent.change(screen.getByLabelText('Device name'), { target: { value: input.deviceName } });
  fireEvent.submit(screen.getByRole('form', { name: 'Pair this desktop' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/enter.*code.*device name/i);
  expect(screen.getByLabelText('Pairing code')).toHaveValue('');
  expect(h.pair).not.toHaveBeenCalled(); expectClosed(h);
});

test('sensitive code never reaches draft/browser storage, URL or logs and clears on unmount', async () => {
  const h = harness(), storage = vi.spyOn(Storage.prototype, 'setItem'), idbOpen = vi.fn();
  vi.stubGlobal('indexedDB', { open: idbOpen });
  const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
  await start(h.bridge); await fill('sensitive-pairing-code');
  const code = screen.getByLabelText('Pairing code');
  await submit(); await screen.findByRole('alert');
  expect(code).toHaveValue('');
  await userEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
  const unsent = await screen.findByLabelText('Pairing code');
  await userEvent.type(unsent, 'sensitive-pairing-code');
  expect(storage).not.toHaveBeenCalled(); expect(idbOpen).not.toHaveBeenCalled(); expectClosed(h);
  expect(location.href).not.toContain('sensitive-pairing-code');
  await act(async () => { root!.unmount(); }); root = undefined;
  expect(code).toHaveValue('');
  expect(unsent).toHaveValue('');
  expect(JSON.stringify([log.mock.calls, warn.mock.calls, error.mock.calls])).not.toContain('sensitive-pairing-code');
});

test('unmount during pairing ignores late success and never opens workspace', async () => {
  const h = harness(), result = deferred<PairingResult>(); h.pair.mockReturnValue(result.promise);
  await start(h.bridge); await fill(); await submit();
  await act(async () => { root!.unmount(); }); root = undefined;
  await act(async () => { result.resolve({ paired: true }); });
  expect(h.capabilities).toHaveBeenCalledTimes(1); expectClosed(h);
});

test.each([{ development: false, fixture: true }, { development: true, fixture: false }])('missing bridge retains unavailable screen without implicit fixtures: %j', async options => {
  await start(undefined, options);
  expect(screen.getByRole('heading', { name: 'Open your project workspace' })).toBeVisible();
  expect(screen.getByText(/This browser window isn’t connected/)).toBeVisible();
  await userEvent.click(screen.getByText('Connection details'));
  expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument();
  if (options.development) expect(screen.getByText(/VITE_DEV_FIXTURES=true/)).toBeVisible();
});

test('intentional development fixtures remain visibly labeled', async () => {
  await start(undefined, { development: true, fixture: true });
  expect(await screen.findByText(/Fixture mode.*synthetic data.*no live model/)).toBeVisible();
  expect(screen.queryByLabelText('Pairing code')).not.toBeInTheDocument();
});

test('pet route keeps the existing restricted Pet path and skips workspace pairing', async () => {
  const h = harness(); window.pet = { invoke: vi.fn(), onEvent: vi.fn(() => () => {}) };
  await start(h.bridge, { pet: true, development: true, fixture: true });
  expect(screen.getByRole('status')).toHaveTextContent(/Waiting for desktop pet state/);
  expect(window.pet.onEvent).toHaveBeenCalledTimes(1);
  expect(h.capabilities).not.toHaveBeenCalled(); expectClosed(h);
  expect(document.body).toHaveClass('pet-window'); expect(document.documentElement).toHaveClass('pet-window');
});
