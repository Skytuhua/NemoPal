import { expect, test } from 'vitest';
import { NativeBoundary } from '../../apps/desktop/src/main/ipc';
import { fixtureIds as ids } from '../../fixtures/contracts/golden';
test('popup sender/frame/exact URL has only read and strict chat commands', async () => {
  const calls: unknown[] = [];
  const identity = { senderId: 12, frameId: 13, url: 'file:///app/index.html?surface=pet-chat' };
  const boundary = new NativeBoundary({ petChat: identity }, { projects: new Set([ids.project]), checkIns: new Map([[ids.checkIn, ids.project]]), documents: new Map(), jobs: new Map() }, async (operation, input) => { calls.push({ operation, input }); });
  const sender = { ...identity, role: 'petChat', topFrameId: 13 };
  await boundary.call(sender, 'petChatRead');
  await boundary.call(sender, 'petChatInvoke', { type: 'expand', contextId: ids.project, expanded: true });
  for (const wrong of [{ ...sender, senderId: 99 }, { ...sender, frameId: 99 }, { ...sender, topFrameId: 99 }, { ...sender, url: identity.url + '#foreign' }]) await expect(boundary.call(wrong, 'petChatRead')).rejects.toThrow();
  for (const operation of ['invoke', 'petInvoke', 'pair', 'confirmSource', 'selectSource']) await expect(boundary.call(sender, operation)).rejects.toThrow();
  await expect(boundary.call(sender, 'petChatInvoke', { type: 'expand', contextId: ids.project, expanded: true, url: 'file:///private' })).rejects.toThrow();
  expect(calls).toHaveLength(2);
});
