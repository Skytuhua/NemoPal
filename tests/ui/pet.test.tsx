import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { PetBridge, SafePetEvent } from '@living-playbooks/contracts';
import { Pet } from '../../apps/web/src/pet/Pet';
import { snapshot } from './helpers';
afterEach(cleanup);
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-07T13:00:00Z')); });
function harness() {
  let listener!: (event: SafePetEvent) => void;
  const invoke = vi.fn<PetBridge['invoke']>().mockResolvedValue(undefined);
  const bridge: PetBridge = { invoke, onEvent(fn) { listener = fn; return () => {}; } };
  const seed = snapshot();
  const event: SafePetEvent = { type: 'pet_state', projectId: seed.project.id, chatContextId: seed.project.id, managerName: 'Nemo', petPackId: 'original-nemo-v1', state: 'waiting_for_you', checkIn: seed.checkIns[0]!, demoTiming: true, preference: { hidden: false, focus: false, reducedMotion: false, pinnedProjectId: null } };
  render(<Pet bridge={bridge} />);
  const emit = (next = event) => act(() => listener(next)); emit();
  return { invoke, event, emit };
}
test('duplicate canonical events show one passive question and no answer controls', () => {
  const h = harness(); h.emit(); h.emit();
  expect(screen.getAllByText('Have you recorded the demo?')).toHaveLength(1);
  expect(screen.getByText('Demo reminder timing')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Recorded' })).not.toBeInTheDocument();
  expect(h.invoke).not.toHaveBeenCalled();
});
test('pet identity fences foreign questions; Focus is quiet and manual chat remains reachable', () => {
  const h = harness(); h.emit({ ...h.event, projectId: snapshot(100).project.id, managerName: 'Second manager' });
  expect(screen.queryByText('Have you recorded the demo?')).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Second manager/ })).toBeVisible();
  h.emit({ ...h.event, preference: { ...h.event.preference, focus: true } });
  expect(screen.queryByRole('region', { name: 'Pet message' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open conversation' })).toBeEnabled();
});
test('all canonical sprite states keep accessible identity through reduced motion', () => {
  const h = harness();
  for (const state of ['idle', 'reviewing', 'waiting_for_you', 'milestone', 'snoozed', 'offline'] as const) for (const reducedMotion of [false, true]) {
    h.emit({ ...h.event, state, checkIn: state === 'waiting_for_you' ? h.event.checkIn : null, preference: { ...h.event.preference, reducedMotion } });
    const mouse = screen.getByRole('img', { name: `Nemo · ${state.replaceAll('_', ' ')}` });
    expect(mouse).toHaveClass('pet-mouse');
    expect(mouse.closest('main')).toHaveAttribute('data-reduced-motion', String(reducedMotion));
  }
});
test('without native bridge the pet reports unavailable and grants no controls', () => {
  cleanup(); render(<Pet />);
  expect(screen.getByText('Restricted desktop pet bridge required.')).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
