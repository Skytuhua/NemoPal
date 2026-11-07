import { expect, it, vi } from 'vitest';
import * as c from '../../packages/contracts/src/index';
import { createFixtureClient, createHttpClient } from '../../packages/api-client/src/index';
import { fixtureIds, goldenObservation } from '../../fixtures/contracts/golden';

const operationId = '10000000-0000-4000-8000-000000000001';
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const create = { operationId, input: { title: 'Owner project', brief: 'Owner brief' } };
const optionalCreate = { ...create, expectedRevision: undefined, input: { ...create.input, format: undefined } };

it('hashes omitted and explicitly undefined optional object fields identically', async () => {
  expect(await c.hashCommand('/v1/projects', optionalCreate)).toBe(await c.hashCommand('/v1/projects', create));
});

it('accepts optional undefined fields over HTTP using the serialized request hash', async () => {
  const accepted = { receipt: { operationId, requestHash: await c.hashCommand('/v1/projects', create), status: 'accepted', result: null, projectRevision: 0, eventSequence: 0 }, jobId: fixtureIds.task, state: 'queued' };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(accepted));
  const client = createHttpClient({ origin: 'https://playbooks.example', fetch: fetcher });
  expect(await client.createProject(optionalCreate)).toEqual(accepted);
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual(create);
});

it('replays a fixture creation when optional undefined fields are later omitted', async () => {
  const client = createFixtureClient({ snapshots: [] });
  const first = await client.createProject(optionalCreate);
  expect(await client.createProject(create)).toEqual(first);
  expect(await client.listProjects()).toHaveLength(1);
});

it.each([
  { acceptedIds: [fixtureIds.owner], duplicateIds: [] },
  { acceptedIds: [], duplicateIds: [fixtureIds.owner] },
  { acceptedIds: [fixtureIds.observation, fixtureIds.observation], duplicateIds: [] },
  { acceptedIds: [fixtureIds.observation], duplicateIds: [fixtureIds.observation] },
  { acceptedIds: [], duplicateIds: [] },
])('rejects ingestion acknowledgments that do not partition the submitted IDs: %j', async result => {
  const command = { operationId, input: c.IngestObservationsInputSchema.parse({ observations: [goldenObservation] }) };
  const requestHash = await c.hashCommand(`/v1/sources/${fixtureIds.binding}/observations`, command);
  const client = createHttpClient({ origin: 'https://playbooks.example', fetch: vi.fn<typeof fetch>().mockResolvedValue(json({ operationId, requestHash, status: 'completed', result, projectRevision: 1, eventSequence: 1 })) });
  await expect(client.ingestObservations(fixtureIds.binding, command)).rejects.toMatchObject({ code: 'invalid_response' });
});

it.each(['acceptedIds', 'duplicateIds'] as const)('accepts an exact ingestion acknowledgment through %s', async field => {
  const command = { operationId, input: c.IngestObservationsInputSchema.parse({ observations: [goldenObservation] }) };
  const result = { acceptedIds: [] as string[], duplicateIds: [] as string[], [field]: [fixtureIds.observation] };
  const requestHash = await c.hashCommand(`/v1/sources/${fixtureIds.binding}/observations`, command);
  const client = createHttpClient({ origin: 'https://playbooks.example', fetch: vi.fn<typeof fetch>().mockResolvedValue(json({ operationId, requestHash, status: 'completed', result, projectRevision: 1, eventSequence: 1 })) });
  expect((await client.ingestObservations(fixtureIds.binding, command)).result).toEqual(result);
});

it.each(['+05:00', '-2359'])('rejects a fixed offset in place of an IANA timezone: %s', timezone => {
  expect(c.SnoozeInputSchema.safeParse({ until: '2026-11-07T13:00:00.000Z', timezone }).success).toBe(false);
});

it.each(['America/Chicago', 'UTC', 'Etc/GMT+5'])('retains a valid named timezone: %s', timezone => {
  expect(c.SnoozeInputSchema.safeParse({ until: '2026-11-07T13:00:00.000Z', timezone }).success).toBe(true);
});

it('rotates a snoozed fixture presentation once and preserves it on operation retries', async () => {
  const client = createFixtureClient();
  await client.presentCheckIn(fixtureIds.checkIn, { operationId: crypto.randomUUID(), input: { presentationId: fixtureIds.presentation } });
  const command = { operationId, expectedRevision: 1, input: { until: '2026-11-07T13:00:00.000Z', timezone: 'America/Chicago' } };
  const snoozed = await client.snoozeCheckIn(fixtureIds.checkIn, command);
  expect(snoozed.result.id).toBe(fixtureIds.checkIn);
  expect(snoozed.result.presentationId).not.toBe(fixtureIds.presentation);
  expect(await client.snoozeCheckIn(fixtureIds.checkIn, command)).toEqual(snoozed);
  await expect(client.presentCheckIn(fixtureIds.checkIn, { operationId: crypto.randomUUID(), input: { presentationId: fixtureIds.presentation } })).rejects.toMatchObject({ code: 'revision_conflict' });
  const presented = await client.presentCheckIn(fixtureIds.checkIn, { operationId: crypto.randomUUID(), input: { presentationId: snoozed.result.presentationId } });
  expect(presented.result).toMatchObject({ id: fixtureIds.checkIn, presentationId: snoozed.result.presentationId, state: 'presented' });
});
