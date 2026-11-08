import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createHttpClient } from '@living-playbooks/api-client';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { SyncEngine } from '../../apps/desktop/src/main/sync';
import { localBinding, syntheticReceiving } from '../../fixtures/codex/synthetic';
import { goldenObservationBatch } from '../../fixtures/contracts/golden';
import { hashCommand, ObservationBatchSchema, type PlaybooksClient } from '@living-playbooks/contracts';

it('lost responses retry the exact durable operation; reconnect sends revokes before other uploads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-reconnect-'));
  try {
    const path = join(dir, 'journal'); let store = await JournalStore.open(path); await store.putBinding(localBinding, true, syntheticReceiving);
    await store.commitObservationBatch(localBinding.binding.id, null, ObservationBatchSchema.parse(goldenObservationBatch));
    const commands: unknown[] = []; let fail = true;
    const client = { ingestObservations: async (_id: string, command: unknown) => { commands.push(command); if (fail) throw Error('lost response'); return { result: { acceptedIds: [goldenObservationBatch.observations[0]!.id], duplicateIds: [] } }; } } as unknown as PlaybooksClient;
    const sync = new SyncEngine(store, client, () => syntheticReceiving);
    expect((await sync.run()).connected).toBe(false);
    store = await JournalStore.open(path); fail = false;
    expect((await new SyncEngine(store, client, () => syntheticReceiving).run()).connected).toBe(true);
    expect(commands[1]).toEqual(commands[0]);
    expect(await store.pendingUploads(20)).toEqual([]);
    const other = { ...localBinding, binding: { ...localBinding.binding, id: '00000000-0000-4000-8000-000000000098' } };
    await store.revokeBinding(localBinding.binding.id, 1);
    await store.putBinding(other, true, syntheticReceiving); await store.commitObservationBatch(other.binding.id, null, { ...ObservationBatchSchema.parse(goldenObservationBatch), observations: goldenObservationBatch.observations.map(o => ({ ...ObservationBatchSchema.parse(goldenObservationBatch).observations[0]!, bindingId: other.binding.id })) });
    const order: string[] = [];
    const ordered = { revokeSource: async () => { order.push('revoke'); return { result: store.binding(localBinding.binding.id)!.binding }; }, ingestObservations: async () => { order.push('upload'); return { result: { acceptedIds: [goldenObservationBatch.observations[0]!.id], duplicateIds: [] } }; } } as unknown as PlaybooksClient;
    await new SyncEngine(store, ordered, () => syntheticReceiving).run(); expect(order).toEqual(['revoke', 'upload']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it.each([
  ['not_found', 404],
  ['source_revoked', 409],
] as const)('retires a durable revoke after cloud %s and drains the next source after restart', async (code, status) => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-terminal-withdrawal-'));
  try {
    const path = join(dir, 'journal');
    let store = await JournalStore.open(path);
    await store.putBinding(localBinding, true, syntheticReceiving);
    await store.revokeBinding(localBinding.binding.id, localBinding.binding.grantRevision);
    const next = { ...localBinding, binding: { ...localBinding.binding, id: '00000000-0000-4000-8000-000000000098', projectId: '11111111-0000-4000-8000-000000000001' } };
    await store.putBinding(next, true, syntheticReceiving);
    const batch = ObservationBatchSchema.parse(goldenObservationBatch);
    await store.commitObservationBatch(next.binding.id, null, { ...batch, observations: batch.observations.map(o => ({ ...o, bindingId: next.binding.id })) });
    store = await JournalStore.open(path);
    const calls: string[] = [];
    const client = createHttpClient({ origin: syntheticReceiving.cloudOrigin, allowInsecureLoopback: true, fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === `/v1/sources/${localBinding.binding.id}/revoke`) {
        calls.push('revoke'); return Response.json({ code, message: 'Source is unavailable.', retryable: false }, { status });
      }
      expect(path).toBe(`/v1/sources/${next.binding.id}/observations`);
      calls.push('upload');
      const envelope = JSON.parse(String(init?.body));
      return Response.json({ operationId: envelope.operationId, requestHash: await hashCommand(path, envelope), status: 'completed', result: { acceptedIds: batch.observations.map(o => o.id), duplicateIds: [] }, projectRevision: 0, eventSequence: 1 });
    } });
    expect((await new SyncEngine(store, client, () => syntheticReceiving).run()).connected).toBe(true);
    expect(calls).toEqual(['revoke', 'upload']);
    const restarted = await JournalStore.open(path);
    expect(restarted.pendingSourceCommands()).toEqual([]);
    expect(await restarted.pendingUploads(20)).toEqual([]);
    expect(restarted.binding(localBinding.binding.id)?.binding).toMatchObject({ state: 'revoked', exportPolicy: 'off' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it.each([
  ['unauthorized', 401],
  ['forbidden', 403],
  ['revision_conflict', 409],
  ['not_found', 500],
  ['source_revoked', 500],
  ['route_not_found', 404],
  ['router', 404],
] as const)('retains a withdrawal when cloud %s/%i does not prove the source is gone', async (code, status) => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-unconfirmed-withdrawal-'));
  try {
    const store = await JournalStore.open(join(dir, 'journal'));
    await store.putBinding(localBinding, true, syntheticReceiving);
    await store.revokeBinding(localBinding.binding.id, localBinding.binding.grantRevision);
    const pending = store.pendingSourceCommands();
    const client = createHttpClient({ origin: syntheticReceiving.cloudOrigin, allowInsecureLoopback: true, fetch: async () => Response.json(
      code === 'router' ? { message: 'Route not found', error: 'Not Found', statusCode: status } : { code, message: 'Synthetic cloud failure.', retryable: false },
      { status },
    ) });
    expect((await new SyncEngine(store, client, () => syntheticReceiving).run()).connected).toBe(false);
    expect(store.pendingSourceCommands()).toEqual(pending);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it.each([
  ['not_found', 404],
  ['source_revoked', 409],
] as const)('retires a pause after cloud %s without releasing retained uploads on restart', async (code, status) => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-terminal-pause-'));
  try {
    const path = join(dir, 'journal'); const store = await JournalStore.open(path);
    await store.putBinding(localBinding, true, syntheticReceiving);
    await store.commitObservationBatch(localBinding.binding.id, null, ObservationBatchSchema.parse(goldenObservationBatch));
    await store.pauseBinding(localBinding.binding.id);
    const requests: string[] = [];
    const client = createHttpClient({ origin: syntheticReceiving.cloudOrigin, allowInsecureLoopback: true, fetch: async url => {
      requests.push(new URL(String(url)).pathname);
      return Response.json({ code, message: 'Source is unavailable.', retryable: false }, { status });
    } });
    expect((await new SyncEngine(store, client, () => syntheticReceiving).run()).connected).toBe(true);
    const restarted = await JournalStore.open(path);
    expect(restarted.pendingSourceCommands()).toEqual([]);
    expect(await restarted.pendingUploads(20)).toHaveLength(1);
    expect(restarted.binding(localBinding.binding.id)?.binding.state).toBe('paused');
    expect((await new SyncEngine(restarted, client, () => syntheticReceiving).run()).connected).toBe(true);
    expect(requests).toEqual([`/v1/sources/${localBinding.binding.id}/state`]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it.each([
  ['not_found', 404],
  ['source_revoked', 409],
] as const)('retires a durable revoke after cloud %s and drains the next source after restart', async (code, status) => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-terminal-withdrawal-'));
  try {
    const path = join(dir, 'journal');
    let store = await JournalStore.open(path);
    await store.putBinding(localBinding, true);
    await store.revokeBinding(localBinding.binding.id, localBinding.binding.grantRevision);
    const next = { ...localBinding, binding: { ...localBinding.binding, id: '00000000-0000-4000-8000-000000000098', projectId: '11111111-0000-4000-8000-000000000001' } };
    await store.putBinding(next, true);
    const batch = ObservationBatchSchema.parse(goldenObservationBatch);
    await store.commitObservationBatch(next.binding.id, null, { ...batch, observations: batch.observations.map(o => ({ ...o, bindingId: next.binding.id })) });
    store = await JournalStore.open(path);
    const calls: string[] = [];
    const client = createHttpClient({ origin: 'http://127.0.0.1:4310', allowInsecureLoopback: true, fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === `/v1/sources/${localBinding.binding.id}/revoke`) {
        calls.push('revoke'); return Response.json({ code, message: 'Source is unavailable.', retryable: false }, { status });
      }
      expect(path).toBe(`/v1/sources/${next.binding.id}/observations`);
      calls.push('upload');
      const envelope = JSON.parse(String(init?.body));
      return Response.json({ operationId: envelope.operationId, requestHash: await hashCommand(path, envelope), status: 'completed', result: { acceptedIds: batch.observations.map(o => o.id), duplicateIds: [] }, projectRevision: 0, eventSequence: 1 });
    } });
    expect((await new SyncEngine(store, client).run()).connected).toBe(true);
    expect(calls).toEqual(['revoke', 'upload']);
    const restarted = await JournalStore.open(path);
    expect(restarted.pendingSourceCommands()).toEqual([]);
    expect(await restarted.pendingUploads(20)).toEqual([]);
    expect(restarted.binding(localBinding.binding.id)?.binding).toMatchObject({ state: 'revoked', exportPolicy: 'off' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it.each([
  ['unauthorized', 401],
  ['forbidden', 403],
  ['revision_conflict', 409],
  ['not_found', 500],
  ['source_revoked', 500],
  ['route_not_found', 404],
  ['router', 404],
] as const)('retains a withdrawal when cloud %s/%i does not prove the source is gone', async (code, status) => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-unconfirmed-withdrawal-'));
  try {
    const store = await JournalStore.open(join(dir, 'journal'));
    await store.putBinding(localBinding, true);
    await store.revokeBinding(localBinding.binding.id, localBinding.binding.grantRevision);
    const pending = store.pendingSourceCommands();
    const client = createHttpClient({ origin: 'http://127.0.0.1:4310', allowInsecureLoopback: true, fetch: async () => Response.json(
      code === 'router' ? { message: 'Route not found', error: 'Not Found', statusCode: status } : { code, message: 'Synthetic cloud failure.', retryable: false },
      { status },
    ) });
    expect((await new SyncEngine(store, client).run()).connected).toBe(false);
    expect(store.pendingSourceCommands()).toEqual(pending);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it.each([
  ['not_found', 404],
  ['source_revoked', 409],
] as const)('retires a pause after cloud %s without releasing retained uploads on restart', async (code, status) => {
  const dir = await mkdtemp(join(tmpdir(), 'lp-terminal-pause-'));
  try {
    const path = join(dir, 'journal'); const store = await JournalStore.open(path);
    await store.putBinding(localBinding, true);
    await store.commitObservationBatch(localBinding.binding.id, null, ObservationBatchSchema.parse(goldenObservationBatch));
    await store.pauseBinding(localBinding.binding.id);
    const requests: string[] = [];
    const client = createHttpClient({ origin: 'http://127.0.0.1:4310', allowInsecureLoopback: true, fetch: async url => {
      requests.push(new URL(String(url)).pathname);
      return Response.json({ code, message: 'Source is unavailable.', retryable: false }, { status });
    } });
    expect((await new SyncEngine(store, client).run()).connected).toBe(true);
    const restarted = await JournalStore.open(path);
    expect(restarted.pendingSourceCommands()).toEqual([]);
    expect(await restarted.pendingUploads(20)).toHaveLength(1);
    expect(restarted.binding(localBinding.binding.id)?.binding.state).toBe('paused');
    expect((await new SyncEngine(restarted, client).run()).connected).toBe(true);
    expect(requests).toEqual([`/v1/sources/${localBinding.binding.id}/state`]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
