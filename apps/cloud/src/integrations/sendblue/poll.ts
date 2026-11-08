import type { Pool } from 'pg';
import { z } from 'zod';
import { capability, type SendblueConfig } from './config';
import { parseMessage } from './payload';

type Link = { id: string; account: string; receiving_line: string; sender: string; linked_at: Date; expires_at: Date };
type Item = { body: unknown; time: number; handle: string; stop: boolean };

async function readJson(response: Response) {
  if (!response.ok || !response.body) throw Error('sendblue_poll_uncertain');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1024 * 1024) throw Error('sendblue_poll_uncertain');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export class SendbluePoll {
  constructor(private pool: Pool, private config: SendblueConfig, private messaging: { accept(body: unknown, linkId: string): Promise<unknown> }, private fetcher: typeof fetch = fetch, private now: () => Date = () => new Date()) {}

  private async snapshot(link: Link, until: Date, signal: AbortSignal): Promise<Item[]> {
    const items: Item[] = [], handles = new Set<string>();
    let offset = 0, total: number | undefined;
    while (true) {
      signal.throwIfAborted();
      const url = new URL('https://api.sendblue.com/api/v2/messages');
      url.search = new URLSearchParams({ account_email: link.account, sendblue_number: link.receiving_line, from_number: link.sender,
        is_outbound: 'false', message_type: 'message', created_at_gte: new Date(link.linked_at).toISOString(), created_at_lte: until.toISOString(),
        order_by: 'createdAt', order_direction: 'asc', limit: '50', offset: String(offset) }).toString();
      const data = await readJson(await this.fetcher(url, { method: 'GET', redirect: 'error', signal,
        headers: { 'sb-api-key-id': this.config.keyId!, 'sb-api-secret-key': this.config.apiSecret! } }));
      const page = data?.pagination;
      if (data?.status !== 'OK' || !Array.isArray(data.data) || !page || page.offset !== offset || page.limit !== 50 ||
        !Number.isSafeInteger(page.total) || page.total < 0 || page.total > 1000 || typeof page.hasMore !== 'boolean' ||
        data.data.length > 50 || (total !== undefined && total !== page.total)) throw Error('sendblue_poll_uncertain');
      const pageTotal = page.total as number;
      total = pageTotal;
      for (const body of data.data) {
        const time = z.iso.datetime({ offset: true }).safeParse(body?.date_sent).success ? Date.parse(body.date_sent) : NaN;
        if (!Number.isFinite(time) || time > until.getTime()) throw Error('sendblue_poll_uncertain');
        const { message, sender } = parseMessage(body, this.config);
        if (message.is_outbound || sender !== link.sender || handles.has(message.message_handle)) throw Error('sendblue_poll_uncertain');
        handles.add(message.message_handle);
        if (time > new Date(link.linked_at).getTime())
          items.push({ body, time, handle: message.message_handle, stop: message.content.trim().toUpperCase() === 'STOP' || message.opted_out === true });
      }
      offset += data.data.length;
      if (offset > pageTotal || page.hasMore !== (offset < pageTotal) || page.hasMore && !data.data.length) throw Error('sendblue_poll_uncertain');
      if (!page.hasMore) return items;
    }
  }

  async tick(signal: AbortSignal) {
    if (!capability(this.config).available) return;
    const links = (await this.pool.query('SELECT id,account,receiving_line,sender,linked_at,expires_at FROM sendblue_links WHERE active AND linked_at IS NOT NULL AND expires_at>$1 AND account=$2 AND receiving_line=$3', [this.now(), this.config.account, this.config.line])).rows as Link[];
    for (const link of links) {
      signal.throwIfAborted();
      const until = this.now();
      const first = await this.snapshot(link, until, signal), second = await this.snapshot(link, until, signal);
      if (JSON.stringify(first) !== JSON.stringify(second)) throw Error('sendblue_poll_uncertain');
      const stop = first.find(item => item.stop);
      const pending = stop ? [stop] : first.sort((a, b) => a.time - b.time || a.handle.localeCompare(b.handle));
      for (const item of pending) { signal.throwIfAborted(); await this.messaging.accept(item.body, link.id); }
    }
  }
}
