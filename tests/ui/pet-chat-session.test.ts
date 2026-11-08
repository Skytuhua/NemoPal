import { expect, test } from 'vitest';
import { PetChatSession } from '../../apps/web/src/pet/pet-chat-session';
import { memoryDrafts } from './helpers';
import { fixtureIds as ids } from '../../fixtures/contracts/golden';

test('uncertain operation is durably written before dispatch and restored verbatim, isolated from workspace draft', async () => {
  const store = memoryDrafts();
  await store.write(`${ids.project}:chat`, { text: 'Workspace composer', baseRevision: 0 });
  const session = new PetChatSession(store, 'synthetic-owner-project');
  await session.load();
  const pending = await session.prepare({ text: 'Popup composer', baseRevision: 3 }, 7);
  const reload = new PetChatSession(store, 'synthetic-owner-project');
  await reload.load();
  expect(reload.pending).toEqual(pending);
  expect(reload.pending?.command.expectedRevision).toBe(7);
  expect(reload.pending?.command.operationId).toBe(pending.command.operationId);
  expect(await store.read(`${ids.project}:chat`)).toEqual({ text: 'Workspace composer', baseRevision: 0 });
  const ownerB = new PetChatSession(store, 'another-synthetic-owner'); await ownerB.load();
  expect(ownerB.pending).toBeUndefined();
});
test('failed durable pending write prevents sending rather than silently losing operation identity', async () => {
  const store = memoryDrafts(), write = store.write; let failing = true;
  store.write = async (key, value) => { if (failing) throw Error('Synthetic disk unavailable'); await write(key, value); };
  const session = new PetChatSession(store, 'synthetic-owner-project'); await session.load();
  await expect(session.prepare({ text: 'Keep me', baseRevision: 1 }, 0)).rejects.toThrow();
  const original = session.pending;
  expect(original?.command.input.text).toBe('Keep me');
  failing = false;
  await session.persistPending();
  const reload = new PetChatSession(store, 'synthetic-owner-project'); await reload.load();
  expect(reload.pending).toEqual(original);
});
