import { expect, test, vi } from 'vitest';
import type { Pool } from 'pg';
import { SendbluePoll } from '../../apps/cloud/src/integrations/sendblue/poll';
import { beginSend } from '../../apps/cloud/src/integrations/sendblue/transport';

const config = { enabled: true, account: 'synthetic@example.invalid', line: '+15550000001', keyId: 'synthetic-key', apiSecret: 'synthetic-secret', signingSecret: 'synthetic-hook' };
const link = { id: 'link-a', account: config.account, receiving_line: config.line, sender: '+15550000002', linked_at: new Date('2026-11-08T12:00:00Z'), expires_at: new Date('2026-11-08T13:00:00Z') };
const message = (handle: string, content = 'hello', date = '2026-11-08T12:01:00Z') => ({ accountEmail: config.account, message_handle: handle, from_number: link.sender, to_number: config.line, sendblue_number: config.line, number: link.sender, content, is_outbound: false, status: 'RECEIVED', message_type: 'message', date_sent: date });
const response = (data: unknown[], offset = 0, hasMore = false, total = data.length) => new Response(JSON.stringify({ status: 'OK', data, pagination: { offset, limit: 50, hasMore, total } }));
function setup(fetcher: typeof fetch, timeoutMs = 10000) {
  const accept = vi.fn(async (_body: unknown, _linkId: string) => ({ accepted: true, duplicate: false }));
  const pool = { query: async () => ({ rows: [link] }) } as unknown as Pool;
  const poll = new SendbluePoll(pool, config, { accept }, fetcher, () => new Date('2026-11-08T12:10:00Z'), timeoutMs);
  return { poll, accept };
}

test('polls only the linked conversation, rejects pre-consent messages, and replays through canonical acceptance', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    expect(u.origin + u.pathname).toBe('https://api.sendblue.co/api/v2/messages');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ sendblue_number: config.line, from_number: link.sender, is_outbound: 'false', created_at_gte: '2026-11-08T12:00:00.000Z' });
    expect(u.searchParams.has('account_email')).toBe(false);
    expect(u.searchParams.get('message_type')).toBe('message');
    expect(new Headers(init?.headers).get('sb-api-key-id')).toBe(config.keyId);
    expect(init?.redirect).toBe('error');
    return response([message('old', 'old', '2026-11-08T11:59:00Z'), message('new')]);
  }) as typeof fetch;
  const h = setup(fetcher);
  await h.poll.tick(new AbortController().signal);
  expect(h.accept).toHaveBeenCalledTimes(1);
  expect(h.accept).toHaveBeenCalledWith(expect.objectContaining({ message_handle: 'new' }), link.id);
});

test('sends only to the documented Sendblue API host without following redirects', async () => {
  const fetcher = vi.fn(async () => new Response('{}'));
  const signal = new AbortController().signal;
  await beginSend(config, link.sender, 'Synthetic local demo reply', fetcher, signal);
  expect(fetcher).toHaveBeenCalledWith('https://api.sendblue.co/api/send-message', expect.objectContaining({ method: 'POST', redirect: 'error', signal }));
});

test('unsupported attachment does not hide a later STOP', async () => {
  const h = setup(async () => response([{ ...message('attachment'), media_url: 'https://example.invalid/file' }, message('stop', 'STOP')]));
  await h.poll.tick(new AbortController().signal);
  expect(h.accept).toHaveBeenCalledTimes(1);
  expect(h.accept).toHaveBeenCalledWith(expect.objectContaining({ message_handle: 'stop' }), link.id);
});

test('accepts equivalent snapshots with different diagnostic fields and key order', async () => {
  let count = 0;
  const h = setup(async () => { const body = message('one'); return response([++count === 1 ? { ...body, diagnostic: 'one' } : { diagnostic: 'two', ...body }]); });
  await h.poll.tick(new AbortController().signal);
  expect(h.accept).toHaveBeenCalledTimes(1);
});

test('a hung provider response does not stall the polling loop', async () => {
  const h = setup(async () => new Promise<Response>(() => {}), 30);
  await expect(h.poll.tick(new AbortController().signal)).rejects.toThrow();
  expect(h.accept).not.toHaveBeenCalled();
});

test('a hung response body does not stall the polling loop', async () => {
  const h = setup(async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } })), 30);
  await expect(h.poll.tick(new AbortController().signal)).rejects.toThrow();
  expect(h.accept).not.toHaveBeenCalled();
});

test('does not accept a partial or changing pagination snapshot', async () => {
  let count = 0;
  const h = setup(async () => ++count === 1 ? response([message('a')], 0, true, 2) : response([message('b')], 1, false, 3));
  await expect(h.poll.tick(new AbortController().signal)).rejects.toThrow();
  expect(h.accept).not.toHaveBeenCalled();
});

test('processes STOP before any ordinary messages', async () => {
  const h = setup(async () => response([message('one'), message('stop', 'STOP')]));
  await h.poll.tick(new AbortController().signal);
  expect(h.accept).toHaveBeenCalledTimes(1);
  expect(h.accept).toHaveBeenCalledWith(expect.objectContaining({ message_handle: 'stop' }), link.id);
});

test('a stable multi-page scan replays every message without skipping the page boundary', async () => {
  const all = Array.from({ length: 51 }, (_, index) => message(`message-${index}`));
  const h = setup(async url => {
    const offset = Number(new URL(String(url)).searchParams.get('offset'));
    return response(all.slice(offset, offset + 50), offset, offset === 0, 51);
  });
  await h.poll.tick(new AbortController().signal);
  expect(h.accept).toHaveBeenCalledTimes(51);
  expect(h.accept).toHaveBeenCalledWith(expect.objectContaining({ message_handle: 'message-50' }), link.id);
});

test('changed snapshots do not admit messages and are retried on a later tick', async () => {
  let calls = 0;
  const h = setup(async () => response([message(++calls === 1 ? 'first' : 'second')]));
  await expect(h.poll.tick(new AbortController().signal)).rejects.toThrow();
  expect(h.accept).not.toHaveBeenCalled();
  await h.poll.tick(new AbortController().signal);
  expect(h.accept).toHaveBeenCalledWith(expect.objectContaining({ message_handle: 'second' }), link.id);
});

test('disabled polling performs no storage or provider work', async () => {
  const query = vi.fn(), fetcher = vi.fn();
  const poll = new SendbluePoll({ query } as unknown as Pool, { enabled: false }, { accept: vi.fn() }, fetcher);
  await poll.tick(new AbortController().signal);
  expect(query).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});

test('a future-dated message makes the snapshot uncertain instead of allowing later work', async () => {
  const h = setup(async () => response([message('future-stop', 'STOP', '2026-11-08T12:11:00Z'), message('normal')]));
  await expect(h.poll.tick(new AbortController().signal)).rejects.toThrow();
  expect(h.accept).not.toHaveBeenCalled();
});

test('a timestamp without an explicit zone is uncertain', async () => {
  const h = setup(async () => response([message('ambiguous', 'hello', '2026-11-08T01:01:00')]));
  await expect(h.poll.tick(new AbortController().signal)).rejects.toThrow();
  expect(h.accept).not.toHaveBeenCalled();
});
