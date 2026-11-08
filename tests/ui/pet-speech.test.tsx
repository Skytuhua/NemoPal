import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { PetBridge, SafePetEvent } from '@living-playbooks/contracts';
import { Pet } from '../../apps/web/src/pet/Pet';
import { Question } from '../../apps/web/src/features/checkins/Question';
import { snapshot } from './helpers';

beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-07T13:00:00Z')); });
afterEach(cleanup);
function harness() {
  let listener!: (event: SafePetEvent) => void;
  const invoke = vi.fn<PetBridge['invoke']>().mockResolvedValue(undefined);
  const bridge: PetBridge = { invoke, onEvent(fn) { listener = fn; return () => {}; } };
  const seed = snapshot();
  const event: SafePetEvent = { type: 'pet_state', projectId: seed.project.id, chatContextId: seed.project.id, managerName: 'Nemo', petPackId: 'original-nemo-v1', state: 'waiting_for_you', demoTiming: false, checkIn: seed.checkIns[0]!, preference: { hidden: false, focus: false, reducedMotion: true, pinnedProjectId: null } };
  render(<Pet bridge={bridge} />);
  const emit = (next = event) => act(() => listener(next)); emit();
  return { invoke, event, emit };
}
test('passive speech keeps the full question, accessible mouse identity and only two utilities', () => {
  harness();
  expect(screen.getByText('Have you recorded the demo?')).toBeVisible();
  expect(screen.getByRole('img', { name: 'Nemo · waiting for you' })).toHaveClass('pet-mouse');
  expect(screen.queryByText('Nemo')).not.toBeInTheDocument();
  expect(screen.queryByText('Question available')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Expand|Recorded|Not yet|Read full question/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(3);
});
test('idle is quiet; keyboard activation opens native conversation without expanding speech', async () => {
  const h = harness(); h.emit({ ...h.event, state: 'idle', checkIn: null });
  const mouse = screen.getByRole('button', { name: 'Open conversation' });
  mouse.focus(); await userEvent.keyboard('[Enter]');
  expect(h.invoke).toHaveBeenCalledExactlyOnceWith({ type: 'openChat', contextId: h.event.chatContextId });
  expect(screen.queryByRole('region', { name: 'Pet message' })).not.toBeInTheDocument();
  await userEvent.tab(); expect(screen.getByRole('button', { name: 'Hide pet' })).toHaveFocus();
});
test('canonical reviewing alone draws thinking; focus, open chat, hidden and offline remain quiet', () => {
  const h = harness(), working = { ...h.event, state: 'reviewing' as const, checkIn: null };
  h.emit(working); expect(screen.getByText('thinking.....')).toBeVisible();
  expect(document.querySelector('.pet-bubble')).toHaveAttribute('data-kind', 'thought');
  for (const next of [{ ...working, state: 'idle' as const }, { ...working, state: 'offline' as const }, { ...working, chatOpen: true }, { ...working, preference: { ...working.preference, focus: true } }, { ...working, preference: { ...working.preference, hidden: true } }]) {
    h.emit(working); h.emit(next); expect(screen.queryByText('thinking.....')).not.toBeInTheDocument();
  }
});
test('canonical Hide has no invisible Show promise; preferences remain main-owned', async () => {
  const h = harness(); fireEvent.click(screen.getByRole('button', { name: 'Hide pet' }));
  expect(h.invoke).toHaveBeenCalledWith({ type: 'setPreference', preference: { ...h.event.preference, hidden: true } });
  expect(screen.getByRole('img')).toBeVisible();
  h.emit({ ...h.event, preference: { ...h.event.preference, hidden: true } });
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  h.emit(); fireEvent.click(screen.getByRole('button', { name: 'Focus mode' }));
  expect(h.invoke).toHaveBeenCalledWith({ type: 'setPreference', preference: { ...h.event.preference, focus: true } });
});
test('canonical answers and old revisions cannot revive a passive question', () => {
  const h = harness(); h.emit({ ...h.event, state: 'idle', checkIn: { ...h.event.checkIn!, state: 'answered', revision: 1 } }); h.emit();
  expect(screen.queryByText('Have you recorded the demo?')).not.toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAttribute('data-pet-state', 'idle');
  expect(h.invoke).not.toHaveBeenCalled();
});
test('default workspace Question keeps its caption and immediate snooze form', () => {
  const question = snapshot().checkIns[0]!;
  render(<Question question={question} answer={vi.fn()} snooze={vi.fn()} />);
  expect(screen.getByText('Question available')).toBeVisible();
  expect(screen.getByLabelText('Snooze until')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Recorded' })).toBeVisible();
});
