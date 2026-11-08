import type { SendblueConfig } from './config';

export type SendblueFetch = typeof fetch;
// Called synchronously immediately after the final database authority guard.
export function beginSend(config: SendblueConfig, sender: string, text: string, fetcher: SendblueFetch, signal: AbortSignal) {
  signal.throwIfAborted();
  return fetcher('https://api.sendblue.com/api/send-message', { method: 'POST', redirect: 'error', signal,
    headers: { 'Content-Type': 'application/json', 'sb-api-key-id': config.keyId!, 'sb-api-secret-key': config.apiSecret! },
    body: JSON.stringify({ number: sender, from_number: config.line, content: text }) });
}
export async function readAcceptance(response: Response) {
  if (!response.ok || !response.body) throw Error('sendblue_uncertain');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16384) throw Error('sendblue_uncertain');
      chunks.push(chunk.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body.message_handle !== 'string' || !body.message_handle.length || body.message_handle.length > 256 ||
    !['REGISTERED','PENDING','QUEUED','ACCEPTED','SENT','DELIVERED'].includes(body.status) || body.error_code != null && body.error_code !== 0)
    throw Error('sendblue_uncertain');
  return { handle: body.message_handle as string, status: body.status as string };
}
