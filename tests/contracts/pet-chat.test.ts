import { expect, test } from 'vitest';
import { PetChatCommandSchema, PetCommandSchema } from '@living-playbooks/contracts';
import { fixtureIds as ids } from '../../fixtures/contracts/golden';
test('local chat admits only bounded revisioned commands, no workspace or native powers', () => {
  expect(PetCommandSchema.parse({ type: 'openChat', contextId: ids.project })).toEqual({ type: 'openChat', contextId: ids.project });
  const send = { type: 'send', contextId: ids.project, command: { operationId: ids.manager, expectedRevision: 0, input: { text: 'Synthetic owner message' } } };
  expect(PetChatCommandSchema.safeParse(send).success).toBe(true);
  for (const bad of [{ ...send, projectId: ids.owner }, { ...send, command: { ...send.command, input: { text: 'a'.repeat(16385) } } }, { type: 'invoke', contextId: ids.project, command: { type: 'listProjects' } }, { type: 'answer', contextId: ids.project, checkInId: ids.checkIn, command: send.command }]) expect(PetChatCommandSchema.safeParse(bad).success).toBe(false);
});
