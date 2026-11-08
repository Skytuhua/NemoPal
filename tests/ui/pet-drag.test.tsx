import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { PetBridge, SafePetEvent } from '@living-playbooks/contracts';
import { Pet } from '../../apps/web/src/pet/Pet';
import { snapshot } from './helpers';

afterEach(cleanup);
function setup() {
  let emit!: (e: SafePetEvent) => void;
  const invoke = vi.fn().mockResolvedValue(undefined), drag = vi.fn().mockResolvedValue(undefined);
  const bridge = { invoke, drag, onEvent(fn: (e: SafePetEvent) => void) { emit = fn; return () => {}; } } as PetBridge;
  render(<Pet bridge={bridge} />);
  act(() => emit({ type: 'pet_state', projectId: snapshot().project.id, chatContextId: snapshot().project.id, managerName: 'Nemo', petPackId: 'original-nemo-v1', state: 'idle', checkIn: null, demoTiming: false, preference: { hidden: false, focus: false, reducedMotion: false, pinnedProjectId: null } }));
  return { invoke, drag, mouse: screen.getByRole('button', { name: 'Open conversation' }) };
}
function pointer(target: Element, type: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  const event = new MouseEvent(type, { bubbles: true, button: 0, screenX: x, screenY: y });
  Object.assign(event, { pointerId: 1, isPrimary: true, pointerType: 'mouse', ...extra });
  fireEvent(target, event);
}
test('mouse drag crosses threshold without opening chat; a later click and keyboard activation still work', () => {
  const h = setup();
  pointer(h.mouse, 'pointerdown', 100, 100); pointer(h.mouse, 'pointermove', 102, 101);
  expect(h.drag.mock.calls.map(c => c[0])).toEqual(['start']);
  pointer(h.mouse, 'pointermove', 110, 100); pointer(h.mouse, 'pointerup', 110, 100);
  fireEvent.click(h.mouse, { detail: 1 });
  expect(h.invoke).not.toHaveBeenCalled();
  expect(h.drag.mock.calls.map(c => c[0])).toEqual(['start', 'move', 'move', 'end']);
  pointer(h.mouse, 'pointerdown', 110, 100); pointer(h.mouse, 'pointerup', 111, 100); fireEvent.click(h.mouse, { detail: 1 });
  fireEvent.click(h.mouse, { detail: 0 });
  expect(h.invoke).toHaveBeenCalledTimes(2);
});
test('cancelled or lost gestures cannot move or open chat and utilities do not start a drag', () => {
  const h = setup();
  pointer(h.mouse, 'pointerdown', 100, 100); pointer(h.mouse, 'pointermove', 110, 100); pointer(h.mouse, 'pointercancel', 110, 100); fireEvent.click(h.mouse, { detail: 1 });
  pointer(h.mouse, 'pointermove', 130, 100); expect(h.invoke).not.toHaveBeenCalled();
  expect(h.drag.mock.calls.map(c => c[0])).toEqual(['start', 'move', 'end']);
  pointer(h.mouse, 'pointerdown', 100, 100); pointer(h.mouse, 'lostpointercapture', 100, 100); fireEvent.click(h.mouse, { detail: 1 });
  pointer(screen.getByRole('button', { name: 'Focus mode' }), 'pointerdown', 10, 10);
  expect(h.drag.mock.calls.map(c => c[0])).toEqual(['start', 'move', 'end', 'start', 'end']);
  expect(h.invoke).not.toHaveBeenCalled();
});
test('focus loss cancels a press, and the release itself can cross the drag threshold', () => {
  const h = setup(); h.mouse.focus();
  pointer(h.mouse, 'pointerdown', 100, 100); fireEvent.blur(h.mouse); fireEvent.click(h.mouse, { detail: 1 });
  expect(h.invoke).not.toHaveBeenCalled();
  pointer(h.mouse, 'pointerdown', 100, 100); pointer(h.mouse, 'pointerup', 110, 100); fireEvent.click(h.mouse, { detail: 1 });
  expect(h.invoke).not.toHaveBeenCalled();
  expect(h.drag.mock.calls.map(c => c[0])).toEqual(['start', 'end', 'start', 'move', 'end']);
});
