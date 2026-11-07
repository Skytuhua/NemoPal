import { expect, it } from 'vitest';
import { readPairingResponse } from '../../apps/desktop/src/main/pairing';

it('rejects oversized and malformed pairing responses before unbounded buffering or credential persistence', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16385)); }, cancel() { cancelled = true; } });
  await expect(readPairingResponse(new Response(body, { headers: { 'Content-Type': 'application/json' } }))).rejects.toThrow();
  expect(cancelled).toBe(true);
  await expect(readPairingResponse(new Response('{partial', { headers: { 'Content-Type': 'application/json' } }))).rejects.toThrow();
  await expect(readPairingResponse(new Response('{}', { headers: { 'Content-Type': 'text/html' } }))).rejects.toThrow();
});
