import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { DesktopBridge, SafeDesktopEvent } from '@living-playbooks/contracts';
import { SourceControls } from '../../apps/web/src/features/sources/SourceControls';
import { snapshot } from './helpers';
afterEach(cleanup);
test('selected source cannot be confirmed until local scope, filtering, and named export consent are explicit', async () => {
  const seed = snapshot();
  const confirm = vi.fn().mockResolvedValue(seed.sourceBindings[0]);
  const bridge = {
    async capabilities() { return { nativePet: { available: true }, paired: true, cloudOrigin: 'https://receiving.example', sourceObservation: { available: true, adapterId: 'fixture', adapterVersion: '1', installedVersion: '1', capability: 'history_only', reason: 'Synthetic test', coverage: 'Synthetic messages only' } }; },
    async selectSource() { return { available: true, selectionId: crypto.randomUUID(), projectId: seed.project.id, displayName: 'Selected test thread', adapterId: 'fixture', adapterVersion: '1', capability: 'history_only', cloudOrigin: 'https://receiving.example', disclosure: 'Only this selected synthetic thread' }; },
    confirmSource: confirm,
    onEvent: () => () => {},
  } as unknown as DesktopBridge;
  render(<SourceControls bridge={bridge} snapshot={seed} refresh={async () => {}} />);
  await userEvent.click(screen.getByText('Sources & privacy'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Select source' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Select source' }));
  const button = await screen.findByRole('button', { name: 'Confirm source consent' });
  expect(button).toBeDisabled();
  await userEvent.click(screen.getByLabelText(/Allow local read/));
  await userEvent.click(screen.getByLabelText(/I understand filtering/));
  expect(screen.getByLabelText('Cloud export')).toHaveValue('off');
  await userEvent.selectOptions(screen.getByLabelText('Cloud export'), 'approved_excerpts');
  expect(button).toBeDisabled();
  await userEvent.click(screen.getByLabelText(/I consent to this export policy/));
  await userEvent.click(button);
  await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ projectId: seed.project.id, allowLocalRead: true, exportPolicy: 'approved_excerpts', acknowledgedBestEffortFiltering: true })));
});
test('a browser fixture cannot acquire native source authority', async () => {
  render(<SourceControls snapshot={snapshot()} refresh={async () => {}} />);
  await userEvent.click(screen.getByText('Sources & privacy'));
  expect(screen.getByText(/desktop bridge required/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Select source' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Pause source' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Revoke source' })).toBeDisabled();
});
test('local source revocation pending in cloud stays explicit and local pet preferences use only desktop bridge', async () => {
  const seed = snapshot(); let listener: (event: SafeDesktopEvent) => void = () => {};
  const setPreference = vi.fn().mockResolvedValue(undefined);
  const bridge = { async capabilities() { return { nativePet: { available: true }, paired: false, cloudOrigin: null, sourceObservation: { available: false, adapterId: 'fixture', adapterVersion: '1', installedVersion: null, capability: 'unavailable', reason: 'Unconfigured', coverage: 'None' } }; }, onEvent(callback: typeof listener) { listener = callback; return () => {}; }, setPetPreference: setPreference } as unknown as DesktopBridge;
  render(<SourceControls bridge={bridge} snapshot={seed} refresh={async () => {}} />);
  await userEvent.click(screen.getByText('Sources & privacy'));
  act(() => listener({ type: 'source_state', binding: { ...seed.sourceBindings[0]!, state: 'revoked', exportPolicy: 'off', grantRevision: 2 }, cloudRevocationPending: true }));
  expect(screen.getByText(/Local source revoked · cloud revocation pending/)).toBeVisible();
  await userEvent.click(await screen.findByLabelText('Hide desktop pet'));
  await userEvent.click(screen.getByLabelText('Focus mode for pet'));
  await userEvent.click(screen.getByRole('button', { name: 'Apply pet preferences' }));
  await waitFor(() => expect(setPreference).toHaveBeenCalledWith({ hidden: true, focus: true, reducedMotion: false, pinnedProjectId: null }));
});
