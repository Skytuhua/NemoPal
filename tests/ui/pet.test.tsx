import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { PetBridge, SafePetEvent } from '@living-playbooks/contracts';
import { Pet } from '../../apps/web/src/pet/Pet';
import { snapshot } from './helpers';
import { memoryDrafts } from './helpers';
import { createFixtureClient } from '@living-playbooks/api-client';
import { App } from '../../apps/web/src/app/App';
afterEach(cleanup);
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-07T13:00:00.000Z')); });
function harness() {
  let listener: (event: SafePetEvent) => void = () => {};
  const invoke = vi.fn<PetBridge['invoke']>().mockResolvedValue(undefined);
  const bridge: PetBridge = { invoke, onEvent(callback) { listener = callback; return () => {}; } };
  const seed = snapshot();
  const event: SafePetEvent = { type: 'pet_state', projectId: seed.project.id, managerName: 'Nemo', petPackId: 'original-nemo-v1', state: 'waiting_for_you', checkIn: seed.checkIns[0]!, demoTiming: true, preference: { hidden: false, focus: false, reducedMotion: false, pinnedProjectId: null } };
  return { bridge, event, invoke, emit(value = event) { act(() => listener(value)); } };
}
test('duplicate pet events keep one question; answering uses only restricted revisioned bridge', async () => {
  const h = harness(); render(<Pet bridge={h.bridge} />); h.emit(); h.emit();
  expect(screen.getAllByText('Have you recorded the demo?')).toHaveLength(1);
  expect(screen.getByText('Demo reminder timing')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Recorded' }));
  expect(h.invoke).toHaveBeenCalledWith(expect.objectContaining({ type: 'answer', checkInId: h.event.checkIn!.id, command: expect.objectContaining({ expectedRevision: 0, input: { kind: 'recorded' } }) }));
  h.emit();
  expect(screen.queryByRole('button', { name: 'Recorded' })).not.toBeInTheDocument();
  expect(h.invoke).toHaveBeenCalledTimes(1);
});
test('pet identity and local visibility preferences fence foreign questions', async () => {
  const h = harness(); render(<Pet bridge={h.bridge} />); h.emit();
  h.emit({ ...h.event, projectId: snapshot(100).project.id, managerName: 'Second manager' });
  expect(screen.queryByText('Have you recorded the demo?')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Second manager/ })).toBeVisible();
  h.emit({ ...h.event, preference: { ...h.event.preference, focus: true } });
  expect(screen.queryByText('Have you recorded the demo?')).not.toBeInTheDocument();
  expect(screen.getByText('Focus mode · proactive question hidden')).toBeVisible();
  h.emit({ ...h.event, preference: { ...h.event.preference, hidden: true } });
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
test('six deterministic pet states render locally and cloud offline outranks a question', () => {
  const h = harness(); render(<Pet bridge={h.bridge} />);
  for (const state of ['idle', 'reviewing', 'waiting_for_you', 'milestone', 'snoozed', 'offline'] as const) {
    h.emit({ ...h.event, state, checkIn: state === 'waiting_for_you' || state === 'offline' ? h.event.checkIn : null });
    expect(screen.getByRole('img')).toHaveAttribute('data-pet-state', state);
  }
  expect(screen.queryByRole('button', { name: 'Recorded' })).not.toBeInTheDocument();
});
test('mouse keeps its accessible state identity when reduced motion changes', () => {
  const h = harness(); render(<Pet bridge={h.bridge} />);
  for (const state of ['idle', 'reviewing', 'waiting_for_you', 'milestone', 'snoozed', 'offline'] as const) {
    for (const reducedMotion of [false, true]) {
      h.emit({ ...h.event, state, checkIn: state === 'waiting_for_you' ? h.event.checkIn : null, preference: { ...h.event.preference, reducedMotion } });
      const mouse = screen.getByRole('img', { name: `Nemo · ${state.replaceAll('_', ' ')}` });
      expect(mouse).toHaveClass('pet-mouse');
      expect(mouse.closest('main')).toHaveAttribute('data-reduced-motion', String(reducedMotion));
    }
  }
});
test('pet preference actions wait for desktop state and preserve keyboard focus', async () => {
  const h = harness(); render(<Pet bridge={h.bridge} />); h.emit();
  const open = screen.getByRole('button', { name: 'Open project' });
  await userEvent.click(open);
  expect(h.invoke).toHaveBeenLastCalledWith({ type: 'openProject', projectId: h.event.projectId });
  expect(open).toHaveFocus();
  h.emit({ ...h.event, preference: { ...h.event.preference, reducedMotion: true } });
  expect(open).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'Hide pet' }));
  expect(h.invoke).toHaveBeenLastCalledWith({ type: 'setPreference', preference: { ...h.event.preference, hidden: true, reducedMotion: true } });
  expect(screen.getByRole('img')).toBeInTheDocument();
  h.emit({ ...h.event, preference: { ...h.event.preference, hidden: true, reducedMotion: true } });
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Recorded' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Show pet' }));
  expect(h.invoke).toHaveBeenLastCalledWith({ type: 'setPreference', preference: { ...h.event.preference, reducedMotion: true } });
  h.emit();
  await userEvent.click(screen.getByRole('button', { name: 'Focus mode' }));
  expect(h.invoke).toHaveBeenLastCalledWith({ type: 'setPreference', preference: { ...h.event.preference, focus: true } });
  expect(screen.getByRole('button', { name: 'Recorded' })).toBeInTheDocument();
  h.emit({ ...h.event, preference: { ...h.event.preference, focus: true } });
  expect(screen.getByRole('button', { name: 'Focus mode' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Focus mode' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('img')).toHaveAttribute('data-pet-state', 'snoozed');
  expect(screen.queryByRole('button', { name: 'Recorded' })).not.toBeInTheDocument();
});
test('snoozing keeps the revisioned command and waits for canonical desktop state', async () => {
  const h = harness(); render(<Pet bridge={h.bridge} />); h.emit();
  await userEvent.type(screen.getByLabelText('Snooze until'), '2026-11-08T15:00');
  await userEvent.click(screen.getByRole('button', { name: 'Snooze question' }));
  expect(h.invoke).toHaveBeenCalledOnce();
  expect(h.invoke).toHaveBeenCalledWith({ type: 'snooze', checkInId: h.event.checkIn!.id, command: { operationId: expect.any(String), expectedRevision: 0, input: { until: new Date('2026-11-08T15:00').toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } } });
  expect(screen.queryByRole('button', { name: 'Recorded' })).not.toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAttribute('data-pet-state', 'waiting_for_you');
  h.emit({ ...h.event, state: 'snoozed', checkIn: { ...h.event.checkIn!, state: 'snoozed', revision: 1 } });
  expect(screen.getByRole('img')).toHaveAttribute('data-pet-state', 'snoozed');
  expect(screen.queryByRole('button', { name: 'Recorded' })).not.toBeInTheDocument();
});
test('pet canonical answer event removes question without manufacturing a local completion', async () => {
  const h = harness(); render(<Pet bridge={h.bridge} />); h.emit();
  expect(screen.getByRole('button', { name: 'Recorded' })).toBeVisible();
  const answered = { ...h.event.checkIn!, state: 'answered' as const, revision: 1, answer: { kind: 'recorded' as const } };
  h.emit({ ...h.event, state: 'idle', checkIn: answered });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Recorded' })).not.toBeInTheDocument());
  expect(h.invoke).not.toHaveBeenCalled();
});
test('pet answer reaches the shared canonical project view through the client invalidation', async () => {
  const h = harness(), client = createFixtureClient();
  h.bridge.invoke = async command => {
    if (command.type === 'answer') {
      const receipt = await client.answerCheckIn(command.checkInId, command.command);
      h.emit({ ...h.event, state: 'idle', checkIn: receipt.result });
    }
  };
  render(<><App client={client} drafts={memoryDrafts()} fixture /><Pet bridge={h.bridge} /></>);
  await screen.findByLabelText('Status: Record the demo'); h.emit();
  const buttons = screen.getAllByRole('button', { name: 'Recorded' });
  await userEvent.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(screen.getByLabelText('Status: Record the demo')).toHaveValue('done'));
  expect(await screen.findByText('Answer saved: Recorded')).toBeVisible();
  expect(screen.queryByText('Submitted · waiting for canonical desktop state')).not.toBeInTheDocument();
});
