import { lstat, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { expect, it } from 'vitest';
import { createHttpClient } from '../../packages/api-client/src/client';
import {
  commandEnvelopeSchema, commandReceiptSchema, IngestObservationsInputSchema,
  IngestionResultSchema, LocalBindingSchema, RevokeSourceInputSchema, SourceBindingSchema,
  hashCommand,
} from '@living-playbooks/contracts';
import { AppServerObserver } from '../../packages/codex-observer/src/adapter';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { SourceController } from '../../apps/desktop/src/main/source-controller';
import { SyncEngine } from '../../apps/desktop/src/main/sync';
import { command, finalMessage, hidden, localBinding, metadata, syntheticReceiving, turn } from '../../fixtures/codex/synthetic';

// Synthetic preparation only: no cloud transaction/job, source, native, J3 or J5 acceptance.
const binding = LocalBindingSchema.parse({ ...localBinding, binding: { ...localBinding.binding, exportPolicy: 'metadata_only' } });
const receiving = { ...syntheticReceiving, cloudOrigin: 'https://j3-prepared.example.test' };
const authorization = 'Bearer synthetic-j3-preparation-only';
const prefix = 'lp-j3-prepared-';
const oldReport = { ...finalMessage, id: 'old-report', text: 'OLD SYNTHETIC TRANSCRIPT' };

function recordedPost(url: Parameters<typeof fetch>[0], init: RequestInit | undefined, path: string): string {
  expect(String(url)).toBe(`${receiving.cloudOrigin}${path}`);
  expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store' });
  const headers = new Headers(init?.headers);
  expect(headers.get('authorization')).toBe(authorization);
  expect(headers.get('content-type')).toBe('application/json');
  expect(typeof init?.body).toBe('string');
  return init!.body as string;
}

async function cleanup(directory: string, controllers: SourceController[], syncs: SyncEngine[], stores: JournalStore[], operations: Promise<unknown>[] = []) {
  const stopped = await Promise.allSettled([
    ...controllers.map(controller => controller.stop()), ...syncs.map(sync => sync.stop()), ...operations,
  ]);
  const flushed = await Promise.allSettled(stores.map(store => store.flush()));
  const removed = await Promise.allSettled([(async () => {
    const parent = await realpath(tmpdir());
    const target = resolve(directory);
    const within = relative(parent, target);
    if (dirname(target) !== parent || !basename(target).startsWith(prefix) || !within || within === '..' || within.startsWith(`..${sep}`)) {
      throw Error('Refusing cleanup outside the test-owned temporary prefix');
    }
    async function verify(path: string): Promise<void> {
      const entry = await lstat(path);
      if (entry.isSymbolicLink()) throw Error('Refusing linked temporary path');
      if (entry.isDirectory()) {
        if (await realpath(path) !== resolve(path)) throw Error('Refusing redirected temporary directory');
        for (const name of await readdir(path)) await verify(join(path, name));
      } else if (!entry.isFile()) throw Error('Refusing unexpected temporary entry');
    }
    await verify(target);
    await rm(target, { recursive: true });
  })()]);
  const failures = [...stopped, ...flushed, ...removed].filter(result => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Synthetic journal cleanup failed');
}

it('synthetic preparation preserves a zero-backfill metadata batch through journal reopen and lost-response replay', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), prefix));
  const controllers: SourceController[] = [], syncs: SyncEngine[] = [], stores: JournalStore[] = [];
  const bodies: string[] = [];
  const path = `/v1/sources/${binding.binding.id}/observations`;
  const receiptSchema = commandReceiptSchema(IngestionResultSchema);
  let simulatedReceipt: ReturnType<typeof receiptSchema.parse> | undefined;
  let simulatedLogicalDeliveries = 0;
  const recordingFetch: typeof fetch = async (url, init) => {
    const body = recordedPost(url, init, path);
    bodies.push(body);
    const envelope = commandEnvelopeSchema(IngestObservationsInputSchema).parse(JSON.parse(body));
    if (!simulatedReceipt) {
      simulatedReceipt = receiptSchema.parse({
        operationId: envelope.operationId, requestHash: await hashCommand(path, envelope), status: 'completed',
        result: { acceptedIds: envelope.input.observations.map(item => item.id), duplicateIds: [] }, projectRevision: 0, eventSequence: 1,
      });
      simulatedLogicalDeliveries++;
      throw Error('Synthetic committed upload response lost');
    }
    return Response.json(simulatedReceipt);
  };
  try {
    const journal = join(directory, 'journal');
    let store = await JournalStore.open(journal); stores.push(store);
    await store.putBinding(binding, true, receiving);
    let client = createHttpClient({ origin: receiving.cloudOrigin, fetch: recordingFetch, getAuthorization: () => authorization });
    let sync = new SyncEngine(store, client, () => receiving, binding.binding.deviceId); syncs.push(sync);
    let items: unknown[] = [oldReport];
    const observer = new AppServerObserver({
      mode: 'fixture', version: async () => '0.167.0',
      request: async method => method === 'thread/read' ? structuredClone(metadata) : { data: [turn('synthetic-tail', items)], nextCursor: null },
    });
    const controller = new SourceController(store, observer); controllers.push(controller);
    await controller.poll(binding.binding.id);
    const baseline = store.cursor(binding.binding.id);
    expect(baseline).toMatchObject({ adapterId: 'codex-app-server', identity: binding.selectedSource, offset: 1 });
    expect(await store.pendingUploads(20, binding.binding.deviceId)).toEqual([]);
    expect((await sync.run()).connected).toBe(true);
    expect(bodies).toEqual([]);

    items = [oldReport, { ...finalMessage, unrelatedField: 'UNRELATED SYNTHETIC FIELD' }, command, hidden];
    await controller.poll(binding.binding.id);
    const queued = await store.pendingUploads(20, binding.binding.deviceId);
    expect(queued).toHaveLength(1);
    const upload = queued[0]!;
    expect(upload.input.observations).toHaveLength(2);
    expect(upload.input.observations.map(item => ({
      sourceItemId: item.sourceItemId, kind: item.kind, metadata: item.metadata, mode: item.provenance.mode, evidenceLevel: item.provenance.evidenceLevel,
    }))).toEqual([
      { sourceItemId: 'synthetic-tail/message-final', kind: 'assistant_report', metadata: { type: 'message', role: 'assistant' }, mode: 'fixture', evidenceLevel: 'agent_reported' },
      { sourceItemId: 'synthetic-tail/command', kind: 'tool_result_metadata', metadata: { type: 'tool', exitCode: 0 }, mode: 'fixture', evidenceLevel: 'source_tool_observed' },
    ]);
    expect(new Set(upload.input.observations.map(item => item.id)).size).toBe(2);
    expect(upload.input.observations.every(item => !Object.hasOwn(item, 'excerpt'))).toBe(true);
    const cursor = store.cursor(binding.binding.id);
    expect(cursor).toMatchObject({ offset: 4 });
    expect(cursor).not.toEqual(baseline);
    await controller.stop(); await sync.stop(); await store.flush();
    store = await JournalStore.open(journal); stores.push(store);
    expect(await store.pendingUploads(20, binding.binding.deviceId)).toEqual([upload]);
    expect(store.cursor(binding.binding.id)).toEqual(cursor);

    client = createHttpClient({ origin: receiving.cloudOrigin, fetch: recordingFetch, getAuthorization: () => authorization });
    sync = new SyncEngine(store, client, () => receiving, binding.binding.deviceId); syncs.push(sync);
    expect((await sync.run()).connected).toBe(false);
    expect(bodies).toHaveLength(1);
    expect(await store.pendingUploads(20, binding.binding.deviceId)).toEqual([upload]);
    expect(store.cursor(binding.binding.id)).toEqual(cursor);
    await sync.stop(); await store.flush();
    store = await JournalStore.open(journal); stores.push(store);
    expect(await store.pendingUploads(20, binding.binding.deviceId)).toEqual([upload]);
    client = createHttpClient({ origin: receiving.cloudOrigin, fetch: recordingFetch, getAuthorization: () => authorization });
    sync = new SyncEngine(store, client, () => receiving, binding.binding.deviceId); syncs.push(sync);
    expect((await sync.run()).connected).toBe(true); // One explicit retry; no timer or automatic reconnect.
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0]!)).toEqual({ operationId: upload.operationId, input: upload.input });
    expect(simulatedLogicalDeliveries).toBe(1); // Recording-port simulation, never a cloud job/transaction count.
    expect(simulatedReceipt).toMatchObject({ operationId: upload.operationId, requestHash: await hashCommand(path, JSON.parse(bodies[0]!)), status: 'completed' });
    expect(await store.pendingUploads(20, binding.binding.deviceId)).toEqual([]);
    expect(store.cursor(binding.binding.id)).toEqual(cursor);
    for (const excluded of [
      binding.selectedSource, binding.sourceIdentity, JSON.stringify(binding.sourceIdentity).slice(1, -1), receiving.disclosure,
      'selectedSource', 'sourceIdentity', 'localReadConsented', '"cwd":', '"workspace":', '"command":', '"output":',
      'receivingConsent', 'cursor', 'nextCursor', 'fingerprint', oldReport.text, finalMessage.text,
      'reasoning', 'PRIVATE REASONING', 'NEVER EXPORT', command.command, command.aggregatedOutput,
      'commandActions', 'aggregatedOutput', 'UNRELATED SYNTHETIC FIELD', 'unrelatedField',
    ]) expect(bodies[0]).not.toContain(excluded);
    await sync.stop(); await store.flush();
    store = await JournalStore.open(journal); stores.push(store);
    expect(await store.pendingUploads(20, binding.binding.deviceId)).toEqual([]);
    expect(store.cursor(binding.binding.id)).toEqual(cursor);
  } finally { await cleanup(directory, controllers, syncs, stores); }
}, 5000);

it('synthetic preparation fences a withheld fixture read and durably replays only its offline revoke', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), prefix));
  const controllers: SourceController[] = [], syncs: SyncEngine[] = [], stores: JournalStore[] = [], operations: Promise<unknown>[] = [];
  let release!: (page: unknown) => void;
  const held = new Promise<unknown>(resolve => { release = resolve; });
  let readEntered!: (signal: AbortSignal) => void;
  const entered = new Promise<AbortSignal>(resolve => { readEntered = resolve; });
  const latePage = { data: [turn('synthetic-tail', [oldReport, finalMessage, command])], nextCursor: null };
  const bodies: string[] = [], methods: string[] = [];
  const path = `/v1/sources/${binding.binding.id}/revoke`;
  const receiptSchema = commandReceiptSchema(SourceBindingSchema);
  let simulatedReceipt: ReturnType<typeof receiptSchema.parse> | undefined;
  let simulatedLogicalRevokes = 0;
  try {
    const journal = join(directory, 'journal');
    let store = await JournalStore.open(journal); stores.push(store);
    await store.putBinding(binding, true, receiving);
    let items: unknown[] = [oldReport], withhold = false;
    const request = async (method: string, _params: unknown, signal?: AbortSignal): Promise<unknown> => {
      methods.push(method);
      if (method === 'thread/read') return structuredClone(metadata);
      if (withhold) {
        if (!signal) throw Error('Expected the real observer abort signal');
        readEntered(signal);
        return held; // Deliberately ignores abort until released, exercising late-result handling.
      }
      return { data: [turn('synthetic-tail', items)], nextCursor: null };
    };
    let controller = new SourceController(store, new AppServerObserver({ mode: 'fixture', version: async () => '0.167.0', request }));
    controllers.push(controller);
    await controller.poll(binding.binding.id);
    expect(store.cursor(binding.binding.id)).toMatchObject({ offset: 1 });
    expect(await store.pendingUploads(20, binding.binding.deviceId)).toEqual([]);
    items = [oldReport, finalMessage];
    await controller.poll(binding.binding.id);
    const queued = await store.pendingUploads(20, binding.binding.deviceId);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.input.observations).toHaveLength(1);
    const cursor = store.cursor(binding.binding.id);
    expect(cursor).toMatchObject({ offset: 2 });
    withhold = true;
    const polling = controller.poll(binding.binding.id); operations.push(polling);
    const readSignal = await Promise.race([entered, polling.then(() => { throw Error('Fixture read ended before the controlled hold'); })]);
    const withdrawal = controller.revoke(binding.binding.id); operations.push(withdrawal);
    expect(store.isFollowing(binding.binding.id)).toBe(false);
    expect(readSignal.aborted).toBe(true);
    expect(bodies).toEqual([]);
    await withdrawal;
    const pendingRevoke = store.pendingSourceCommands(binding.binding.deviceId);
    expect(pendingRevoke).toHaveLength(1);
    expect(pendingRevoke[0]).toMatchObject({ kind: 'revoke', bindingId: binding.binding.id, grantRevision: 1 });
    release(latePage); await polling;
    expect(store.cursor(binding.binding.id)).toEqual(cursor);
    expect(await store.pendingUploads(20, binding.binding.deviceId)).toEqual([]);
    await controller.stop(); await store.flush();
    store = await JournalStore.open(journal); stores.push(store);
    expect(store.binding(binding.binding.id)?.binding).toMatchObject({ state: 'revoked', grantRevision: 2, exportPolicy: 'off' });
    expect(store.isFollowing(binding.binding.id)).toBe(false);
    expect(store.cursor(binding.binding.id)).toEqual(cursor);
    expect(await store.pendingUploads(20, binding.binding.deviceId)).toEqual([]);
    expect(store.pendingSourceCommands(binding.binding.deviceId)).toEqual(pendingRevoke);
    controller = new SourceController(store, new AppServerObserver({ mode: 'fixture', version: async () => '0.167.0', request }));
    controllers.push(controller);
    const readsAfterRevoke = methods.length;
    await controller.poll(binding.binding.id);
    expect(methods).toHaveLength(readsAfterRevoke);

    const recordingFetch: typeof fetch = async (url, init) => {
      const body = recordedPost(url, init, path);
      bodies.push(body);
      const envelope = commandEnvelopeSchema(RevokeSourceInputSchema).parse(JSON.parse(body));
      if (!simulatedReceipt) {
        simulatedReceipt = receiptSchema.parse({
          operationId: envelope.operationId, requestHash: await hashCommand(path, envelope), status: 'completed',
          result: store.binding(binding.binding.id)!.binding, projectRevision: 0, eventSequence: 1,
        });
        simulatedLogicalRevokes++;
        throw Error('Synthetic committed revoke response lost');
      }
      return Response.json(simulatedReceipt);
    };
    let client = createHttpClient({ origin: receiving.cloudOrigin, fetch: recordingFetch, getAuthorization: () => authorization });
    let sync = new SyncEngine(store, client, () => receiving, binding.binding.deviceId); syncs.push(sync);
    expect((await sync.run()).connected).toBe(false);
    expect(bodies).toHaveLength(1);
    expect(store.pendingSourceCommands(binding.binding.deviceId)).toEqual(pendingRevoke);
    await controller.stop(); await sync.stop(); await store.flush();
    store = await JournalStore.open(journal); stores.push(store);
    expect(store.pendingSourceCommands(binding.binding.deviceId)).toEqual(pendingRevoke);
    const beforeAck = JSON.parse(await readFile(journal, 'utf8')) as { data: Record<string, unknown> };
    client = createHttpClient({ origin: receiving.cloudOrigin, fetch: recordingFetch, getAuthorization: () => authorization });
    sync = new SyncEngine(store, client, () => receiving, binding.binding.deviceId); syncs.push(sync);
    expect((await sync.run()).connected).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0]!)).toEqual({ operationId: pendingRevoke[0]!.operationId, input: { grantRevision: 1, removeExcerpts: true } });
    expect(simulatedLogicalRevokes).toBe(1); // Only an injected-port simulation of revoke replay.
    expect(simulatedReceipt).toMatchObject({ operationId: pendingRevoke[0]!.operationId, requestHash: await hashCommand(path, JSON.parse(bodies[0]!)) });
    expect(store.pendingSourceCommands(binding.binding.deviceId)).toEqual([]);
    expect(await store.pendingUploads(20, binding.binding.deviceId)).toEqual([]);
    expect(store.cursor(binding.binding.id)).toEqual(cursor);
    await store.flush();
    const afterAck = JSON.parse(await readFile(journal, 'utf8')) as { data: Record<string, unknown> };
    expect(afterAck.data).toEqual({ ...beforeAck.data, sourceCommands: [] });
    controller = new SourceController(store, new AppServerObserver({ mode: 'fixture', version: async () => '0.167.0', request }));
    controllers.push(controller);
    await controller.poll(binding.binding.id);
    expect((await sync.run()).connected).toBe(true);
    expect(methods).toHaveLength(readsAfterRevoke);
    expect(bodies).toHaveLength(2); // Neither an observation POST nor another revoke is sent.
  } finally {
    release(latePage);
    readEntered(new AbortController().signal);
    await cleanup(directory, controllers, syncs, stores, operations);
  }
}, 5000);
