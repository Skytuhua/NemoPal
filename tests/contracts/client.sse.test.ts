import { expect, it, vi } from 'vitest';
import { createHttpClient, CursorExpiredError, MAX_EVENT_BYTES } from '../../packages/api-client/src/index';
import { fixtureIds } from '../../fixtures/contracts/golden';

const event = { seq: 1, projectId: fixtureIds.project, kind: 'project_updated', resourceId: fixtureIds.project, revision: 1 };
function streamResponse(...chunks: string[]) {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}

it('authenticates SSE, parses split CRLF frames, and emits only new strict invalidations', async () => {
  const data = JSON.stringify(event);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(streamResponse(': keepalive\r', `\ndata: ${data.slice(0, 20)}`, `${data.slice(20)}\r\n\r`, `\ndata: ${data}\n\n`));
  const client = createHttpClient({ origin: 'https://playbooks.example', getAuthorization: () => 'Bearer main-secret', fetch: fetcher });
  const onEvent = vi.fn();
  await client.subscribe(0, onEvent, new AbortController().signal);
  expect(onEvent.mock.calls).toEqual([[event]]);
  expect(String(fetcher.mock.calls[0]?.[0])).toBe('https://playbooks.example/v1/events?after=0');
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer main-secret');
});

it('rejects event payload authority fields, malformed JSON, and oversized frames', async () => {
  for (const frame of [`data: ${JSON.stringify({ ...event, token: 'secret' })}\n\n`, 'data: {bad json}\n\n', `data: ${'x'.repeat(MAX_EVENT_BYTES)}\n\n`]) {
    const client = createHttpClient({ origin: 'https://playbooks.example', fetch: vi.fn<typeof fetch>().mockResolvedValue(streamResponse(frame)) });
    const onEvent = vi.fn();
    await expect(client.subscribe(0, onEvent, new AbortController().signal)).rejects.toMatchObject({ code: frame.length > MAX_EVENT_BYTES ? 'event_limit' : 'invalid_response' });
    expect(onEvent).not.toHaveBeenCalled();
  }
});

it('requires snapshot recovery when the cursor expires in HTTP or the event stream', async () => {
  for (const response of [new Response(null, { status: 410 }), streamResponse('event: cursor_expired\ndata: {}\n\n')]) {
    const client = createHttpClient({ origin: 'https://playbooks.example', fetch: vi.fn<typeof fetch>().mockResolvedValue(response) });
    await expect(client.subscribe(0, () => {}, new AbortController().signal)).rejects.toBeInstanceOf(CursorExpiredError);
  }
});

it('aborts an idle stream and cancels its reader', async () => {
  const cancelled = vi.fn();
  let pulled!: () => void;
  const ready = new Promise<void>(resolve => { pulled = resolve; });
  const response = new Response(new ReadableStream<Uint8Array>({ pull: pulled, cancel: cancelled }), { headers: { 'content-type': 'text/event-stream' } });
  const client = createHttpClient({ origin: 'https://playbooks.example', fetch: vi.fn<typeof fetch>().mockResolvedValue(response) });
  const controller = new AbortController();
  const subscription = client.subscribe(0, () => {}, controller.signal);
  const rejected = expect(subscription).rejects.toMatchObject({ name: 'AbortError' });
  await ready;
  controller.abort();
  await rejected;
  expect(cancelled).toHaveBeenCalled();
});
