import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { PetBridge, SafePetEvent } from '@living-playbooks/contracts';
import { Pet } from '../../apps/web/src/pet/Pet';
import { snapshot, deferred } from './helpers';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T13:00:00Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function harness(reducedMotion = false) {
  let listener: (event: SafePetEvent) => void = () => {};
  const invoke = vi.fn<PetBridge['invoke']>().mockResolvedValue(undefined);
  const bridge: PetBridge = { invoke, onEvent(callback) { listener = callback; return () => {}; } };
  const seed = snapshot();
  const event: SafePetEvent = { type: 'pet_state', projectId: seed.project.id, managerName: 'Nemo', petPackId: 'original-nemo-v1', state: 'waiting_for_you', demoTiming: false, checkIn: seed.checkIns[0]!, preference: { hidden: false, focus: false, reducedMotion, pinnedProjectId: null } };
  render(<Pet bridge={bridge} />);
  const emit = (value = event) => act(() => listener(value));
  emit();
  return { event, invoke, emit };
}
const settle = () => act(() => vi.advanceTimersByTime(250));
test('speech has no visible manager heading and keeps the approved accessible mouse', () => {
  harness();
  expect(screen.queryByText('Nemo')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Nemo .* waiting for you/ })).toHaveClass('pet-mouse');
  expect(screen.getByRole('button', { name: 'Close controls' })).toHaveAttribute('aria-expanded', 'true');
});
test('Escape closes with an inert exit, returns focus, and reopening preserves the question draft', () => {
  const h = harness(); settle();
  const input = screen.getByLabelText('Snooze until');
  fireEvent.change(input, { target: { value: '2026-11-08T15:00' } }); input.focus();
  fireEvent.keyDown(input, { key: 'Escape' });
  const toggle = screen.getByRole('button', { name: 'Open controls' });
  expect(toggle).toHaveFocus();
  const bubble = document.getElementById(toggle.getAttribute('aria-controls')!)!;
  expect(bubble).toHaveAttribute('data-phase', 'closing');
  expect(bubble).toHaveAttribute('inert');
  expect(input.closest('fieldset')).toBeDisabled();
  expect(bubble).not.toHaveAttribute('hidden');
  settle(); expect(bubble).toHaveAttribute('hidden');
  fireEvent.click(toggle); expect(bubble).toHaveAttribute('data-phase', 'opening');
  expect(screen.getByLabelText('Snooze until')).toHaveValue('2026-11-08T15:00');
  settle(); expect(bubble).toHaveAttribute('data-phase', 'open');
  expect(h.invoke).not.toHaveBeenCalled();
});
test.each(['preference', 'system'] as const)('%s reduced motion settles without a spatial transition', kind => {
  if (kind === 'system') vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })));
  harness(kind === 'preference');
  const toggle = screen.getByRole('button', { name: 'Close controls' });
  fireEvent.click(toggle);
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toHaveAttribute('hidden');
});
test('rapid reopen cancels exit; closing a pending answer preserves revision and replay fences', async () => {
  const h = harness(); settle();
  const saving = deferred<void>(); h.invoke.mockReturnValueOnce(saving.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Recorded' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close controls' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open controls' }));
  settle();
  expect(screen.getByRole('button', { name: 'Recorded' })).toBeDisabled();
  await act(async () => saving.resolve());
  h.emit();
  expect(screen.queryByRole('button', { name: 'Recorded' })).not.toBeInTheDocument();
  expect(h.invoke).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'answer', command: expect.objectContaining({ expectedRevision: 0, input: { kind: 'recorded' } }) }));
});
test('canonical events still update while closed and stale revisions cannot revive answered questions', () => {
  const h = harness(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close controls' }));
  h.emit({ ...h.event, state: 'idle', checkIn: { ...h.event.checkIn!, state: 'answered', revision: 1 } });
  h.emit();
  fireEvent.click(screen.getByRole('button', { name: 'Open controls' }));
  expect(screen.queryByRole('button', { name: 'Recorded' })).not.toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAttribute('data-pet-state', 'idle');
});


test('keyboard activates the mouse and skips closed controls', async () => {
  vi.useRealTimers();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-07T13:00:00Z'));
  harness(true);
  const user = userEvent.setup();
  const mouse = screen.getByRole('button', { name: 'Close controls' });
  mouse.focus(); await user.keyboard('[Enter]');
  expect(mouse).toHaveAttribute('aria-expanded', 'false');
  await user.tab();
  expect(screen.getByRole('button', { name: 'Recorded', hidden: true })).not.toHaveFocus();
  mouse.focus(); await user.keyboard(' ');
  expect(mouse).toHaveAttribute('aria-expanded', 'true');
});
test('an old pending answer cannot dismiss a replacement presentation after closing', async () => {
  const h = harness(true), saving = deferred<void>();
  h.invoke.mockReturnValueOnce(saving.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Recorded' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close controls' }));
  const replacement = snapshot(100);
  h.emit({ ...h.event, projectId: replacement.project.id, checkIn: replacement.checkIns[0]! });
  await act(async () => saving.resolve());
  fireEvent.click(screen.getByRole('button', { name: 'Open controls' }));
  expect(screen.getByRole('button', { name: 'Recorded' })).toBeEnabled();
  expect(h.invoke).toHaveBeenCalledTimes(1);
});
