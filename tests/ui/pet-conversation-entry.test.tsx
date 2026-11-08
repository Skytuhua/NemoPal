import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { PetBridge, SafePetEvent } from '@living-playbooks/contracts';
import { Pet } from '../../apps/web/src/pet/Pet';
import { snapshot } from './helpers';
afterEach(cleanup);
test('mouse opens real compact conversation; only Hide and Focus accompany it, with no passive Expand', async () => {
  let emit!: (event: SafePetEvent) => void;
  const invoke = vi.fn().mockResolvedValue(undefined);
  const bridge: PetBridge = { invoke, onEvent(fn) { emit = fn; return () => {}; } };
  render(<Pet bridge={bridge} />);
  act(() => emit({ type: 'pet_state', projectId: snapshot().project.id, chatContextId: snapshot().project.id, managerName: 'Nemo', petPackId: 'original-nemo-v1', state: 'idle', checkIn: null, demoTiming: false, preference: { hidden: false, focus: false, reducedMotion: true, pinnedProjectId: null } }));
  fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }));
  expect(invoke).toHaveBeenCalledWith({ type: 'openChat', contextId: snapshot().project.id });
  expect(screen.getAllByRole('button')).toHaveLength(3);
  expect(screen.queryByRole('button', { name: /Expand/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Pet message' })).not.toBeInTheDocument();
});
