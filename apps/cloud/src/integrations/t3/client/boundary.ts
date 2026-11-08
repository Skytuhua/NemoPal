import { z } from 'zod';
import { id } from '../model';
export type ConnectionPhase = 'configuration' | 'discovery' | 'registration' | 'authorization' | 'token' | 'initialize' | 'tools_list' | 'tool_call' | 'cleanup';
export type ConnectionCode = 'invalid_endpoint' | 'invalid_metadata' | 'invalid_registration' | 'invalid_callback' |
  'denied' | 'deadline' | 'cancelled' | 'response_too_large' | 'http_error' | 'oauth_error' | 'mcp_error' | 'missing_tools' | 'cleanup_failed';

const messages: Record<ConnectionCode, string> = {
  invalid_endpoint: 'Supply an explicit local HTTP MCP endpoint on 127.0.0.1.',
  invalid_metadata: 'T3 sign-in metadata did not match this local endpoint.',
  invalid_registration: 'T3 did not register the expected public read-only client.',
  invalid_callback: 'The sign-in callback did not match this connection attempt.',
  denied: 'T3 sign-in was declined.', deadline: 'The local connection check timed out.',
  cancelled: 'The local connection check was cancelled.', response_too_large: 'T3 returned more data than this check permits.',
  http_error: 'The local T3 request failed.', oauth_error: 'T3 sign-in could not be completed.',
  mcp_error: 'T3 MCP initialization or tool discovery failed.', missing_tools: 'T3 did not advertise the expected read tools.',
  cleanup_failed: 'The local MCP session could not be confirmed closed.',
};

/** Fixed messages only: SDK errors can contain credentials and raw response bodies. */
export class T3ConnectionError extends Error {
  constructor(readonly code: ConnectionCode, readonly phase: ConnectionPhase,
    readonly delivery: 'known_unsent' | 'uncertain' = 'known_unsent') {
    super(messages[code]); this.name = 'T3ConnectionError';
  }
}

export function localEndpoint(value: string): URL {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/mcp$/.test(value)) throw new T3ConnectionError('invalid_endpoint', 'configuration');
  try {
    const url = new URL(value);
    if (url.href !== value) throw new Error();
    return url;
  } catch { throw new T3ConnectionError('invalid_endpoint', 'configuration'); }
}

export function untilAborted<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(new T3ConnectionError(signal.reason === 'deadline' ? 'deadline' : 'cancelled', 'authorization'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

const scopeFields = { environmentId: id, threadId: id };
const readArgs = z.object({ ...scopeFields, view: z.literal('activity'), limit: z.number().int().min(1).max(25),
  maxCharsPerItem: z.literal(1), runLimit: z.number().int().min(1).max(10), afterPosition: z.number().int().nonnegative().optional(), itemId: id.optional() }).strict();
const pendingArgs = z.union([
  z.object({ ...scopeFields, action: z.literal('list') }).strict(),
  z.object({ ...scopeFields, action: z.literal('read'), requestId: id }).strict(),
]);
export function permittedCall(name: string, args: unknown, scope: { environmentId: string; threadId: string }): boolean {
  const parsed = (name === 't3_thread_read' ? readArgs : name === 't3_pending_request' ? pendingArgs : z.never()).safeParse(args);
  return parsed.success && parsed.data.environmentId === scope.environmentId && parsed.data.threadId === scope.threadId;
}

/** One request per permitted action; no auth retries, redirects, replay or arbitrary network fetch. */
export function networkBoundary(endpoint: URL, signal: AbortSignal, timeoutMs: number,
  phase: () => ConnectionPhase, attempted: () => void) {
  const used = new Set<string>();
  const active = new Map<AbortController, ReturnType<typeof setTimeout>>();
  let failure: T3ConnectionError | undefined;
  let bearer = '';
  let sessionId = '';
  let deadlineExpired = false;
  let scoped: { environmentId: string; threadId: string; expiresAt: number; onExpiry: () => void } | undefined;
  let sessionDeadline: { expiresAt: number; onExpiry: () => void; isExpired?: () => boolean } | undefined;
  const fail = (code: ConnectionCode): never => {
    failure = new T3ConnectionError(code, phase()); throw failure;
  };
  const guardedFetch: typeof fetch = async (input, init = {}) => {
    let url: URL;
    try { url = new URL(input instanceof Request ? input.url : String(input)); }
    catch { return fail('invalid_metadata'); }
    const method = (init.method ?? 'GET').toUpperCase();
    const background = url.href === endpoint.href && method === 'GET';
    let requestFailure: T3ConnectionError | undefined;
    const failRequest = (code: ConnectionCode): never => {
      requestFailure = new T3ConnectionError(code, phase());
      if (!background) failure = requestFailure;
      throw requestFailure;
    };
    if (url.origin !== endpoint.origin || url.username || url.password || url.search || url.hash) return fail('invalid_metadata');
    if (sessionDeadline && url.href === endpoint.href && (Date.now() >= sessionDeadline.expiresAt || sessionDeadline.isExpired?.())) { sessionDeadline.onExpiry(); return failRequest('deadline'); }
    let action = `${method} ${url.pathname}`;
    const publicActions = ['GET /.well-known/oauth-protected-resource/mcp', 'GET /.well-known/oauth-authorization-server',
      'POST /oauth/mcp/register', 'POST /oauth/mcp/token'];
    if (url.href === endpoint.href) {
      if (!['POST', 'GET', 'DELETE'].includes(method) || !bearer) return fail('mcp_error');
      if (method === 'POST') {
        let message: { method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
        try { message = JSON.parse(String(init.body)); } catch { return fail('mcp_error'); }
        if (message.method === 'tools/call' && scoped) {
          const args = message.params?.arguments;
          const name = message.params?.name;
          if (!name || !permittedCall(name, args, scoped)) return fail('mcp_error');
          action += ' tools/call';
        } else {
          if (!['initialize', 'notifications/initialized', 'tools/list'].includes(message.method ?? '')) return fail('mcp_error');
          action += ` ${message.method}`;
        }
      }
    } else if (!publicActions.includes(action)) return fail('invalid_metadata');
    if (action !== 'POST /mcp tools/call') {
      if (used.has(action)) return failRequest('http_error');
      used.add(action);
    }
    if (signal.aborted) return fail(signal.reason === 'deadline' ? 'deadline' : 'cancelled');
    if (deadlineExpired) return failRequest('deadline');
    if (method === 'POST' || method === 'DELETE') attempted();
    const controller = new AbortController();
    const timer = setTimeout(() => { if (!background) deadlineExpired = true; controller.abort('deadline'); }, timeoutMs);
    active.set(controller, timer);
    const combined = AbortSignal.any([signal, controller.signal, ...(init.signal ? [init.signal] : [])]);
    const finish = () => { clearTimeout(timer); active.delete(controller); };
    const abortCode = () => signal.aborted ? (signal.reason === 'deadline' ? 'deadline' : 'cancelled') :
      controller.signal.reason === 'deadline' ? 'deadline' : 'http_error';
    try {
      const headers = new Headers(init.headers);
      if (url.href === endpoint.href) headers.set('Authorization', `Bearer ${bearer}`);
      else headers.delete('Authorization');
      const prepared: RequestInit = { ...init, headers, signal: combined, redirect: 'manual', credentials: 'omit', cache: 'no-store' };
      if (sessionDeadline && url.href === endpoint.href && (Date.now() >= sessionDeadline.expiresAt || sessionDeadline.isExpired?.())) { sessionDeadline.onExpiry(); return failRequest('deadline'); }
      const response = await fetch(url, prepared);
      if (url.href === endpoint.href && method === 'POST') {
        const observed = response.headers.get('mcp-session-id');
        if (observed) sessionId = observed;
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel(); return failRequest('http_error');
      }
      const maxBytes = url.href === endpoint.href ? 256 * 1024 : 64 * 1024;
      const length = response.headers.get('content-length');
      if (length && (!/^[0-9]+$/.test(length) || Number(length) > maxBytes)) {
        await response.body?.cancel(); return failRequest('response_too_large');
      }
      if (!response.body) { finish(); return response; }
      const reader = response.body.getReader();
      let received = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(output) {
          try {
            const part = await reader.read();
            if (part.done) { finish(); output.close(); return; }
            received += part.value.byteLength;
            if (received > maxBytes) { await reader.cancel(); failRequest('response_too_large'); }
            output.enqueue(part.value);
          } catch (error) {
            finish();
            if (!(error instanceof T3ConnectionError)) {
              requestFailure = new T3ConnectionError(abortCode(), phase());
              if (!background) failure = requestFailure;
            }
            output.error(requestFailure ?? error);
          }
        },
        async cancel() { finish(); controller.abort(); await reader.cancel().catch(() => {}); },
      });
      return new Response(body, { status: response.status, headers: response.headers });
    } catch (error) {
      finish();
      if (error instanceof T3ConnectionError) throw error;
      return failRequest(abortCode());
    }
  };
  return {
    fetch: guardedFetch,
    setBearer(value: string) { bearer = value; },
    setSessionDeadline(value: { expiresAt: number; onExpiry: () => void; isExpired?: () => boolean }) { sessionDeadline = value; },
    enableScopedCalls(value: { environmentId: string; threadId: string; expiresAt: number; onExpiry: () => void; isExpired?: () => boolean }) { scoped = value; sessionDeadline = value; },
    clearFailure() { failure = undefined; },
    get sessionId() { return sessionId; },
    get deadlineExpired() { return deadlineExpired; },
    expireDeadline() { deadlineExpired = true; for (const request of active.keys()) request.abort('deadline'); },
    get failure() { return failure; },
    dispose() { bearer = ''; sessionId = ''; scoped = undefined; sessionDeadline = undefined; for (const [request, timer] of active) { clearTimeout(timer); request.abort(); } active.clear(); },
  };
}
