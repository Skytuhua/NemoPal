import { expect, it, vi } from 'vitest';
import { createHttpClient, ClientError, MAX_RESPONSE_BYTES } from '../../packages/api-client/src/index';
import { fixtureIds, goldenCheckIn, goldenSnapshot } from '../../fixtures/contracts/golden';
import * as c from '../../packages/contracts/src/index';

const operationId = '10000000-0000-4000-8000-000000000001';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const receipt = (result: unknown, requestHash = 'a'.repeat(64)) => ({ operationId, requestHash, status: 'completed', result, projectRevision: 1, eventSequence: 1 });

it('reports a network failure without returning fixture projects or echoing transport secrets', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-token network detail'));
  const client = createHttpClient({ origin: 'https://playbooks.example', getAuthorization: () => 'Bearer secret-token', fetch: fetcher });

  await expect(client.listProjects()).rejects.toMatchObject({ code: 'network', message: 'Unable to reach the Playbooks API.' });
  await expect(client.listProjects()).rejects.toBeInstanceOf(ClientError);
});

it('validates commands before authorizing or sending and rejects malformed successes', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...goldenSnapshot, bearerToken: 'secret' }));
  const getAuthorization = vi.fn(() => 'Bearer secret');
  const client = createHttpClient({ origin: 'https://playbooks.example', getAuthorization, fetch: fetcher });
  await expect(client.createProject({ operationId, input: { title: '', brief: 'Brief' } })).rejects.toMatchObject({ code: 'invalid_command' });
  expect(getAuthorization).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  await expect(client.getSnapshot(fixtureIds.project)).rejects.toMatchObject({ code: 'invalid_response' });
});

it('refuses redirects and does not surface server error bodies', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://attacker.example' } })).mockResolvedValueOnce(json({ code: 'unavailable', message: 'secret response body', retryable: true }, 503));
  const client = createHttpClient({ origin: 'https://playbooks.example', getAuthorization: () => 'Bearer secret', fetch: fetcher });
  await expect(client.listProjects()).rejects.toMatchObject({ code: 'redirect' });
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', credentials: 'omit' });
  await expect(client.listProjects()).rejects.toMatchObject({ code: 'unavailable', status: 503, message: 'A required Playbooks dependency is unavailable.' });
});

it('preserves typed error metadata while suppressing remote messages and rejecting extra fields', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ code: 'conflict', message: 'secret server detail', retryable: false, currentRevision: 3, capability: 'history_only' }, 409)).mockResolvedValueOnce(json({ code: 'conflict', message: 'secret', retryable: false, token: 'secret' }, 409));
  const client = createHttpClient({ origin: 'https://playbooks.example', fetch: fetcher });
  await expect(client.listProjects()).rejects.toMatchObject({ code: 'conflict', retryable: false, currentRevision: 3, capability: 'history_only', message: 'The command conflicts with current state. Refresh before retrying.' });
  await expect(client.listProjects()).rejects.toMatchObject({ code: 'invalid_response' });
});

it('accepts a completed null cancellation receipt with an optional job revision', async () => {
  const command = { operationId, input: {} };
  const requestHash = await c.hashCommand(`/v1/jobs/${fixtureIds.task}/cancel`, command);
  const client = createHttpClient({ origin: 'https://playbooks.example', fetch: vi.fn<typeof fetch>().mockResolvedValue(json(receipt(null, requestHash))) });
  expect((await client.cancelJob(fixtureIds.task, command)).result).toBeNull();
});

it('requires HTTPS and explicit loopback development and prevents authorization callbacks in renderers', () => {
  expect(() => createHttpClient({ origin: 'http://playbooks.example' })).toThrow(ClientError);
  expect(() => createHttpClient({ origin: 'http://127.0.0.1:3000' })).toThrow(ClientError);
  expect(() => createHttpClient({ origin: 'http://127.0.0.1:3000', allowInsecureLoopback: true })).not.toThrow();
  expect(() => createHttpClient({ origin: 'https://user:password@playbooks.example' })).toThrow(ClientError);
  vi.stubGlobal('window', {});
  try { expect(() => createHttpClient({ origin: 'https://playbooks.example', getAuthorization: () => 'Bearer secret' })).toThrow(/main process/); }
  finally { vi.unstubAllGlobals(); }
});

it('accepts a presentation envelope without an invented revision requirement', async () => {
  const command = { operationId, input: { presentationId: fixtureIds.presentation } };
  const requestHash = await c.hashCommand(`/v1/checkins/${fixtureIds.checkIn}/presented`, command);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(receipt({ ...goldenCheckIn, state: 'presented' }, requestHash)));
  const client = createHttpClient({ origin: 'https://playbooks.example', fetch: fetcher });
  const result = await client.presentCheckIn(fixtureIds.checkIn, command);
  expect(result.result.state).toBe('presented');
  expect(String(fetcher.mock.calls[0]?.[0])).toBe(`https://playbooks.example/v1/checkins/${fixtureIds.checkIn}/presented`);
});

it('rejects mismatched request hashes and schema-valid foreign document receipts', async () => {
  const command = { operationId, expectedRevision: 0, input: { text: 'Owner text' } };
  const path = `/v1/projects/${fixtureIds.project}/documents/${fixtureIds.document}`;
  const requestHash = await c.hashCommand(path, command);
  const draft = { ...goldenSnapshot.documents[0]!, text: 'Owner text', revision: 1 };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(receipt(draft))).mockResolvedValueOnce(json(receipt({ ...draft, projectId: fixtureIds.owner }, requestHash))).mockResolvedValueOnce(json(receipt({ ...draft, id: fixtureIds.owner }, requestHash)));
  const client = createHttpClient({ origin: 'https://playbooks.example', fetch: fetcher });
  for (let attempt = 0; attempt < 3; attempt++) await expect(client.saveDocument(fixtureIds.project, fixtureIds.document, command)).rejects.toMatchObject({ code: 'invalid_response' });
});

it('rejects non-null cancellation results rather than silently converting them to null', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(receipt({})));
  const client = createHttpClient({ origin: 'https://playbooks.example', fetch: fetcher });
  await expect(client.cancelJob(fixtureIds.task, { operationId, expectedRevision: 0, input: {} })).rejects.toMatchObject({ code: 'invalid_response' });
});

it('bounds response bytes before parsing or exposing the response', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('[]', { headers: { 'content-type': 'application/json', 'content-length': String(MAX_RESPONSE_BYTES + 1) } }));
  const client = createHttpClient({ origin: 'https://playbooks.example', fetch: fetcher });
  await expect(client.listProjects()).rejects.toMatchObject({ code: 'response_limit' });
});
