import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createHttpClient } from '@living-playbooks/api-client';
import { hashCommand, ObservationBatchSchema } from '@living-playbooks/contracts';
import { JournalStore } from '../../apps/desktop/src/main/local-store';
import { SyncEngine } from '../../apps/desktop/src/main/sync';
import { localBinding } from '../../fixtures/codex/synthetic';
import { goldenObservationBatch } from '../../fixtures/contracts/golden';

it('real HTTP client reconnect retries one synthetic observation as one logical downstream update', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lp-http-'));
  const requests: string[] = []; const receipts = new Map<string, unknown>(); let logicalUpdates = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString(); requests.push(text);
    const envelope = JSON.parse(text) as { operationId: string; input: { observations: { id: string }[] } };
    if (!receipts.has(envelope.operationId)) {
      logicalUpdates++;
      receipts.set(envelope.operationId, { operationId: envelope.operationId, requestHash: await hashCommand(request.url!, envelope), status: 'completed', result: { acceptedIds: envelope.input.observations.map(item => item.id), duplicateIds: [] }, projectRevision: 0, eventSequence: 1 });
      request.socket.destroy(); return; // Server committed, client lost the response.
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(receipts.get(envelope.operationId)));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw Error('Expected loopback port');
    const client = createHttpClient({ origin: `http://127.0.0.1:${address.port}`, allowInsecureLoopback: true, getAuthorization: () => 'Bearer synthetic-test-only' });
    const path = join(directory, 'journal'); let store = await JournalStore.open(path); await store.putBinding(localBinding, true);
    await store.commitObservationBatch(localBinding.binding.id, null, ObservationBatchSchema.parse(goldenObservationBatch));
    expect((await new SyncEngine(store, client).run()).connected).toBe(false);
    store = await JournalStore.open(path);
    expect((await new SyncEngine(store, client).run()).connected).toBe(true);
    expect(requests).toHaveLength(2); expect(requests[1]).toBe(requests[0]); expect(logicalUpdates).toBe(1);
    expect(await store.pendingUploads(20)).toEqual([]); expect(store.cursor(localBinding.binding.id)?.offset).toBe(100);
    for (const localOnly of [localBinding.selectedSource, localBinding.sourceIdentity, 'nextCursor', 'localReadConsented']) expect(requests[0]).not.toContain(localOnly);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); }
});
