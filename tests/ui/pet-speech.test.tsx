import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { PetBridge, SafePetEvent } from '@living-playbooks/contracts';
import { Question } from '../../apps/web/src/features/checkins/Question';
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
  expect(screen.getByRole('button', { name: 'Close message' })).toHaveAttribute('aria-expanded', 'true');
});
test('mouse closes with an inert exit, returns focus, and reopening preserves the question draft', () => {
  const h = harness(); settle();
  fireEvent.click(screen.getByRole('button', { name: 'Snooze options' }));
  const input = screen.getByLabelText('Snooze until');
  fireEvent.change(input, { target: { value: '2026-11-08T15:00' } }); input.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Close message' }));
  const toggle = screen.getByRole('button', { name: 'Open message' });
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
  const toggle = screen.getByRole('button', { name: 'Close message' });
  fireEvent.click(toggle);
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toHaveAttribute('hidden');
});
test('rapid reopen cancels exit; closing a pending answer preserves revision and replay fences', async () => {
  const h = harness(); settle();
  const saving = deferred<void>(); h.invoke.mockReturnValueOnce(saving.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Recorded' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close message' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open message' }));
  settle();
  expect(screen.getByRole('button', { name: 'Recorded' })).toBeDisabled();
  await act(async () => saving.resolve());
  h.emit();
  expect(screen.queryByRole('button', { name: 'Recorded' })).not.toBeInTheDocument();
  expect(h.invoke).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'answer', command: expect.objectContaining({ expectedRevision: 0, input: { kind: 'recorded' } }) }));
});
test('canonical events still update while closed and stale revisions cannot revive answered questions', () => {
  const h = harness(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close message' }));
  h.emit({ ...h.event, state: 'idle', checkIn: { ...h.event.checkIn!, state: 'answered', revision: 1 } });
  h.emit();
  expect(screen.getByRole('button', { name: 'Open message' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Recorded' })).not.toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAttribute('data-pet-state', 'idle');
});


test('keyboard activates the mouse and skips closed controls', async () => {
  vi.useRealTimers();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-07T13:00:00Z'));
  harness(true);
  const user = userEvent.setup();
  const mouse = screen.getByRole('button', { name: 'Close message' });
  mouse.focus(); await user.keyboard('[Enter]');
  expect(mouse).toHaveAttribute('aria-expanded', 'false');
  await user.tab();
  expect(screen.getByRole('button', { name: 'Hide pet' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Recorded', hidden: true })).not.toHaveFocus();
  mouse.focus(); await user.keyboard(' ');
  expect(mouse).toHaveAttribute('aria-expanded', 'true');
});
test('an old pending answer cannot dismiss a replacement presentation after closing', async () => {
  const h = harness(true), saving = deferred<void>();
  h.invoke.mockReturnValueOnce(saving.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Recorded' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close message' }));
  const replacement = snapshot(100);
  h.emit({ ...h.event, projectId: replacement.project.id, checkIn: replacement.checkIns[0]! });
  await act(async () => saving.resolve());
  expect(screen.getByRole('button', { name: 'Close message' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'Recorded' })).toBeEnabled();
  expect(h.invoke).toHaveBeenCalledTimes(1);
});

test('idle is quiet and persistent utilities live outside contextual speech', () => {
  const h = harness(true);
  h.emit({ ...h.event, state: 'idle', checkIn: null });
  const bubble = document.querySelector('.pet-bubble')!;
  expect(bubble).toHaveAttribute('hidden');
  for (const name of ['Hide pet', 'Focus mode']) {
    const action = screen.getByRole('button', { name });
    expect(action.closest('.pet-bubble')).toBeNull();
    expect(action).toHaveAttribute('title', name);
  }
  expect(screen.getByRole('button', { name: 'Hide pet' })).toHaveTextContent('-');
  expect(screen.getByRole('button', { name: 'Focus mode' })).not.toHaveTextContent('-');
  expect(h.invoke).not.toHaveBeenCalled();
});
test('compact hide and focus wait for canonical preferences and restore remains reachable', async () => {
  const h = harness(true);
  fireEvent.click(screen.getByRole('button', { name: 'Hide pet' }));
  await act(async () => {});
  expect(h.invoke).toHaveBeenLastCalledWith({ type: 'setPreference', preference: { ...h.event.preference, hidden: true } });
  expect(screen.getByRole('img')).toBeInTheDocument();
  h.emit({ ...h.event, preference: { ...h.event.preference, hidden: true } });
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show pet' }));
  await act(async () => {});
  expect(h.invoke).toHaveBeenLastCalledWith({ type: 'setPreference', preference: h.event.preference });
  h.emit();
  fireEvent.click(screen.getByRole('button', { name: 'Focus mode' }));
  await act(async () => {});
  expect(screen.getByRole('button', { name: 'Focus mode' })).toHaveAttribute('aria-pressed', 'false');
  h.emit({ ...h.event, preference: { ...h.event.preference, focus: true } });
  expect(screen.getByRole('button', { name: 'Focus mode' })).toHaveAttribute('aria-pressed', 'true');
});
test('new due questions reveal speech after a deliberate close without preference commands', () => {
  const h = harness(true);
  fireEvent.click(screen.getByRole('button', { name: 'Close message' }));
  h.emit({ ...h.event, checkIn: { ...h.event.checkIn!, presentationId: crypto.randomUUID(), revision: 1 } });
  expect(screen.getByRole('button', { name: 'Recorded' })).toBeVisible();
  expect(h.invoke).not.toHaveBeenCalled();
});

test('canonical reviewing enters a thought cloud and idle exits without inventing model state', () => {
  const h = harness(true);
  h.emit({ ...h.event, state: 'reviewing', checkIn: null });
  expect(screen.getByText('thinking.....')).toBeVisible();
  expect(document.querySelector('.pet-bubble')).toHaveAttribute('data-kind', 'thought');
  h.emit({ ...h.event, state: 'idle', checkIn: null });
  expect(screen.queryByText('thinking.....')).not.toBeInTheDocument();
  expect(document.querySelector('.pet-bubble')).toHaveAttribute('hidden');
  expect(h.invoke).not.toHaveBeenCalled();
});
test('question and canonical offline snooze focus or hidden states suppress the thought cloud', () => {
  const h = harness(true);
  const working = { ...h.event, state: 'reviewing' as const, checkIn: null };
  for (const override of [
    { checkIn: h.event.checkIn },
    { state: 'offline' as const },
    { state: 'snoozed' as const },
    { preference: { ...h.event.preference, focus: true } },
    { preference: { ...h.event.preference, hidden: true } },
  ]) {
    h.emit(working);
    expect(screen.getByText('thinking.....')).toBeVisible();
    h.emit({ ...working, ...override });
    expect(screen.queryByText('thinking.....')).not.toBeInTheDocument();
    expect(document.querySelector('.pet-bubble')).toHaveAttribute('data-kind', 'speech');
  }
  h.emit({ ...working, checkIn: h.event.checkIn });
  expect(screen.getByRole('button', { name: 'Recorded' })).toBeVisible();
  expect(document.querySelectorAll('.pet-bubble:not([hidden])')).toHaveLength(1);
});

test('compact pet removes the normal caption, overlays no chat glyph, and has only two mouse utilities', () => {
  harness(true);
  expect(screen.queryByText('Question available')).not.toBeInTheDocument();
  expect(document.querySelector('.pet-speech-mark')).toBeNull();
  expect(document.querySelectorAll('.pet-utilities button')).toHaveLength(2);
  const expand = screen.getByRole('button', { name: 'Expand to project chat' });
  expect(expand.closest('.pet-bubble')).not.toBeNull();
  expect(screen.getByRole('button', { name: 'Recorded' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Not yet' })).toBeVisible();
  expect(screen.queryByLabelText('Snooze until')).not.toBeInTheDocument();
});
test('idle mouse opens a compact popup and Expand uses the supported project command', async () => {
  const h = harness(true); h.emit({ ...h.event, state: 'idle', checkIn: null });
  const mouse = screen.getByRole('button', { name: 'Open message' });
  expect(mouse).toBeEnabled(); fireEvent.click(mouse);
  expect(screen.getByRole('region', { name: 'Pet message' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Pet message' })).toHaveAttribute('tabindex', '-1');
  expect(screen.queryByText('Nemo')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Expand to project chat' }));
  await act(async () => {});
  expect(h.invoke).toHaveBeenCalledExactlyOnceWith({ type: 'openProject', projectId: h.event.projectId });
});
test('compact snooze Back and Escape restore answers, focus and date draft without invoking commands', () => {
  const h = harness(true);
  fireEvent.click(screen.getByRole('button', { name: 'Snooze options' }));
  const input = screen.getByLabelText('Snooze until');
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: '2026-11-08T15:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Back to answers' }));
  expect(screen.getByRole('button', { name: 'Snooze options' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Snooze options' }));
  expect(screen.getByLabelText('Snooze until')).toHaveValue('2026-11-08T15:00');
  fireEvent.keyDown(screen.getByLabelText('Snooze until'), { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Recorded' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Close message' })).toHaveAttribute('aria-expanded', 'true');
  expect(h.invoke).not.toHaveBeenCalled();
});
test('default Question keeps its normal caption and immediate snooze form; compact expired feedback remains', () => {
  const question = snapshot().checkIns[0]!, answer = vi.fn(), snooze = vi.fn();
  const { rerender } = render(<Question question={question} answer={answer} snooze={snooze} />);
  expect(screen.getByText('Question available')).toBeVisible();
  expect(screen.getByLabelText('Snooze until')).toBeVisible();
  rerender(<Question compact question={{ ...question, expiresAt: '2026-11-06T00:00:00Z' }} answer={answer} snooze={snooze} />);
  expect(screen.getByText(/expired/)).toBeVisible();
});

test('offline has an accessible sleeping emoji and hidden leaves only canonical restore', () => {
  const h = harness(true); h.emit({ ...h.event, state: 'offline', checkIn: null });
  expect(screen.getByRole('img', { name: 'Cloud offline' })).toHaveTextContent(String.fromCodePoint(0x1f634));
  expect(screen.queryByText(/check-in timing unavailable/)).not.toBeInTheDocument();
  h.emit({ ...h.event, preference: { ...h.event.preference, hidden: true } });
  expect(screen.queryByText('Pet hidden')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Focus mode' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Show pet' })).toBeVisible();
});

test('text that overflows the compact preview becomes an explicit full-question disclosure', () => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(64);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(84);
  harness(true);
  const read = screen.getByRole('button', { name: 'Read full question' });
  expect(read).toHaveTextContent('Read full question');
  fireEvent.click(read);
  expect(screen.getByLabelText('Full question')).toHaveTextContent('Have you recorded the demo?');
  expect(screen.getByLabelText('Full question')).toHaveFocus();
  fireEvent.keyDown(screen.getByLabelText('Full question'), { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Read full question' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Recorded' })).toBeVisible();
});
