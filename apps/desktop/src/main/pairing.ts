import { RedeemResultSchema } from '@living-playbooks/contracts';

export async function readPairingResponse(response: Response) {
  if (!response.ok || response.redirected || response.headers.get('content-type')?.split(';')[0] !== 'application/json' || !response.body) { await response.body?.cancel().catch(() => {}); throw Error('Pairing unavailable'); }
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true }); let size = 0; let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 16384) throw Error('Pairing response exceeds limit'); text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode(); return RedeemResultSchema.parse(JSON.parse(text));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
