import { expect, test, vi } from 'vitest';
import type { DesktopBridge } from '@living-playbooks/contracts';
import { runtime } from '../../apps/web/src/app/runtime';
test('only explicit development fixture mode enables the shared fixture client', async () => {
  expect(runtime(undefined, true, false).client).toBeUndefined();
  expect(runtime(undefined, false, true).client).toBeUndefined();
  const result = runtime(undefined, true, true);
  expect(result.fixture).toBe(true);
  expect(await result.client?.listProjects()).toHaveLength(1);
});
test('desktop client forwards only validated allowed commands, never source grants or credentials', async () => {
  const invoke = vi.fn().mockResolvedValue([]);
  const bridge = { invoke, onEvent: () => () => {} } as unknown as DesktopBridge;
  const result = runtime(bridge, true, true);
  expect(result.fixture).toBe(false);
  expect(await result.client?.listProjects()).toEqual([]);
  expect(invoke).toHaveBeenCalledWith({ type: 'listProjects' });
  await expect(result.client?.getSnapshot('not-a-project-id')).rejects.toThrow();
  expect(invoke).toHaveBeenCalledTimes(1);
  await expect(result.client?.enrollSource(crypto.randomUUID(), { operationId: crypto.randomUUID(), expectedRevision: 0, input: { sourceKey: 'x', adapterId: 'x', adapterVersion: '1', capability: 'history_only', exportPolicy: 'off' } })).rejects.toThrow(/desktop consent/);
});

test('desktop phone enrollment passes the selected project and explicit grant through the validated bridge', async () => {
  const invoke = vi.fn().mockResolvedValue({ state: 'configured', link: null });
  const bridge = { invoke, onEvent: () => () => {} } as unknown as DesktopBridge;
  const client = runtime(bridge, false, false).client!;
  const projectId = crypto.randomUUID();
  await client.getPhoneStatus(projectId);
  const command = { operationId: crypto.randomUUID(), expectedRevision: 4, input: { sender: '+15550000002', expiresAt: '2026-11-09T12:00:00.000Z', notifications: true } };
  await client.linkPhone(projectId, command);
  expect(invoke).toHaveBeenCalledWith({ type: 'getPhoneStatus', projectId });
  expect(invoke).toHaveBeenCalledWith({ type: 'linkPhone', projectId, command });
  await expect(client.linkPhone(projectId, { ...command, input: { ...command.input, sender: 'invalid' } })).rejects.toThrow();
  expect(invoke).toHaveBeenCalledTimes(2);
});
