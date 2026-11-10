import { expect, it } from 'vitest';
import { NativeBoundary } from '../../apps/desktop/src/main/ipc';

it('accepts only a pet top frame and fixed drag phases without coordinates', async () => {
  const calls: unknown[] = [];
  const guard = new NativeBoundary({ pet: { senderId: 1, frameId: 2, url: 'file:///pet' }, workspace: { senderId: 3, frameId: 4, url: 'file:///workspace' } }, { projects: new Set(), checkIns: new Map(), documents: new Map(), jobs: new Map() }, async (op, input) => { calls.push([op, input]); });
  const pet = { role: 'pet', senderId: 1, frameId: 2, topFrameId: 2, url: 'file:///pet' };
  for (const phase of ['start', 'move', 'end']) await guard.call(pet, 'petDrag', phase);
  await expect(guard.call(pet, 'petDrag', { phase: 'move', x: 100, y: 100 })).rejects.toThrow();
  await expect(guard.call({ role: 'workspace', senderId: 3, frameId: 4, topFrameId: 4, url: 'file:///workspace' }, 'petDrag', 'move')).rejects.toThrow();
  await expect(guard.call({ ...pet, topFrameId: 99 }, 'petDrag', 'move')).rejects.toThrow();
  expect(calls).toEqual([['petDrag', 'start'], ['petDrag', 'move'], ['petDrag', 'end']]);
});
