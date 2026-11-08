import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { T3ConnectionError } from './boundary';

/** A nonce in the exact callback path complements the independent OAuth state. */
export async function callbackReceiver(issuer: string, signal: AbortSignal, bindAttempt = 0): Promise<{
  state: string; redirectUrl: string; code: Promise<string>; close(): Promise<void>;
}> {
  const state = randomBytes(32).toString('base64url');
  const path = `/oauth/callback/${randomBytes(24).toString('base64url')}`;
  let redirectUrl = '';
  let consumed = false;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // A callback can fail before the operator's authorization-link handler returns.
  void code.catch(() => {});
  const reject = (kind: 'invalid_callback' | 'denied' | 'deadline' | 'cancelled') => rejectCode(new T3ConnectionError(kind, 'authorization'));
  const abort = () => { consumed = true; reject(signal.reason === 'deadline' ? 'deadline' : 'cancelled'); };
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (consumed) { response.writeHead(410).end('This connection attempt is closed.'); return; }
    consumed = true;
    try {
      const raw = request.url ?? '';
      const target = new URL(raw, redirectUrl);
      if (request.method !== 'GET' || !raw.startsWith('/') || raw.startsWith('//') || raw.length > 4096 ||
        request.headers.host !== new URL(redirectUrl).host || target.origin !== new URL(redirectUrl).origin ||
        target.pathname !== path || raw.split('?')[0] !== path || target.hash || request.headers.origin ||
        [...target.searchParams.keys()].some(key => !['state', 'iss', 'code', 'error', 'error_description', 'error_uri'].includes(key)) ||
        [...target.searchParams.keys()].some(key => target.searchParams.getAll(key).length !== 1)) throw new Error();
      const receivedState = Buffer.from(target.searchParams.get('state') ?? '');
      const expectedState = Buffer.from(state);
      if (receivedState.length !== expectedState.length || !timingSafeEqual(receivedState, expectedState) ||
        target.searchParams.get('iss') !== issuer) throw new Error();
      const error = target.searchParams.get('error');
      if (error) {
        if (target.searchParams.has('code')) throw new Error();
        reject(error === 'access_denied' ? 'denied' : 'invalid_callback');
        response.writeHead(400).end('Sign-in was not completed. Return to the local terminal.'); return;
      }
      const authorizationCode = target.searchParams.get('code');
      if (!authorizationCode || authorizationCode.length > 2048 || /[\x00-\x20\x7f]/.test(authorizationCode)) throw new Error();
      resolveCode(authorizationCode);
      response.writeHead(200).end('Sign-in received. Return to the local terminal for the connection result.');
    } catch {
      reject('invalid_callback'); response.writeHead(400).end('This callback did not match the connection attempt.');
    }
  });
  server.maxConnections = 4;
  server.keepAliveTimeout = 1;
  await new Promise<void>((resolve, rejectListen) => {
    const onError = () => rejectListen(new T3ConnectionError('invalid_callback', 'authorization'));
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => { server.off('error', onError); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new T3ConnectionError('invalid_callback', 'authorization'); }
  // Avoid ports reserved by sibling connection checks if the OS happens to allocate one.
  if ([45231, 55439].includes(address.port)) {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (bindAttempt >= 2 || signal.aborted) throw new T3ConnectionError('invalid_callback', 'authorization');
    return callbackReceiver(issuer, signal, bindAttempt + 1);
  }
  redirectUrl = `http://127.0.0.1:${address.port}${path}`;
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  return {
    state, redirectUrl, code,
    async close() {
      consumed = true; signal.removeEventListener('abort', abort); reject('cancelled');
      // Stop accepting immediately, let a just-sent success page finish, then force-close stragglers.
      const forceClose = setTimeout(() => server.closeAllConnections(), 100);
      await new Promise<void>(resolve => server.close(() => resolve()));
      clearTimeout(forceClose);
    },
  };
}
