import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { exchangeAuthorization, registerClient, startAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import { OAuthMetadataSchema, OAuthProtectedResourceMetadataSchema, type OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { T3_TOOLS, type T3McpClient, type T3ToolName } from '../protocol';
import { id } from '../model';
import { callbackReceiver } from './callback';
import { localEndpoint, networkBoundary, permittedCall, untilAborted, T3ConnectionError, type ConnectionPhase } from './boundary';

export { T3ConnectionError } from './boundary';

export interface ConnectionCheckOptions {
  endpoint: string;
  /** Prints a local authorization link only; must never approve it or open a browser automatically. */
  onAuthorization(url: string): void | Promise<void>;
  signal?: AbortSignal;
  /** Tests/operators may shorten, never extend these bounds. */
  signInTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface LocalT3Session extends T3McpClient { close(): Promise<void> }
export interface LocalT3SessionOptions extends ConnectionCheckOptions { environmentId: string; threadId: string; sessionTimeoutMs?: number }

/** Finite operator check. No tool calls, environment claims, credential store or application registration. */
export async function checkLocalT3Connection(options: ConnectionCheckOptions) {
  return connect(options);
}
export async function openLocalT3Session(options: LocalT3SessionOptions): Promise<LocalT3Session> {
  if (!id.safeParse(options.environmentId).success || !id.safeParse(options.threadId).success)
    throw new T3ConnectionError('invalid_endpoint', 'configuration');
  return connect(options, { ...options });
}
async function connect(options: ConnectionCheckOptions, scoped: LocalT3SessionOptions): Promise<LocalT3Session>;
async function connect(options: ConnectionCheckOptions): Promise<{ status: 'connected'; transport: 'loopback_http'; permissions: string[]; expectedReadTools: string[]; toolCalls: 0; credentials: 'discarded'; checkedAt: string; session: 'closed' }>;
async function connect(options: ConnectionCheckOptions, scoped?: LocalT3SessionOptions) {
  const endpoint = localEndpoint(options.endpoint);
  const duration = (value: number | undefined, maximum: number) => {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0 || value > maximum))
      throw new T3ConnectionError('invalid_endpoint', 'configuration');
    return value ?? maximum;
  };
  const signInMs = duration(options.signInTimeoutMs, 180_000);
  const requestMs = duration(options.requestTimeoutMs, 5000);
  const sessionMs = scoped ? duration(scoped.sessionTimeoutMs, 300_000) : 0;
  const deadline = new AbortController();
  let timer = setTimeout(() => deadline.abort('deadline'), signInMs);
  let sessionTimer: ReturnType<typeof setTimeout> | undefined;
  let tokenDeadline: number | undefined;
  const signal = AbortSignal.any([deadline.signal, ...(options.signal ? [options.signal] : [])]);
  let phase: ConnectionPhase = 'discovery';
  let attempted = false;
  const network = networkBoundary(endpoint, signal, requestMs, () => phase, () => { attempted = true; });
  let callback: Awaited<ReturnType<typeof callbackReceiver>> | undefined;
  let client: Client | undefined;
  let transport: StreamableHTTPClientTransport | undefined;
  let tokens: OAuthTokens | undefined;
  let codeVerifier = '';
  let authorizationCode = '';
  let cleanupFailed = false;
  let localRequestExpired = false;
  let retained = false;
  let session: LocalT3Session | undefined;
  const boundedMcp = async <T>(request: (requestSignal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    const requestTimer = setTimeout(() => { localRequestExpired = true; network.expireDeadline(); controller.abort('deadline'); }, requestMs);
    const requestSignal = AbortSignal.any([signal, controller.signal]);
    try { return await untilAborted(request(requestSignal), requestSignal); }
    finally { clearTimeout(requestTimer); }
  };
  let result: { status: 'connected'; transport: 'loopback_http'; permissions: string[]; expectedReadTools: string[];
    toolCalls: 0; credentials: 'discarded'; checkedAt: string; session: 'closed' } | undefined;
  let error: T3ConnectionError | undefined;
  try {
    signal.throwIfAborted();
    const resourceResponse = await network.fetch(`${endpoint.origin}/.well-known/oauth-protected-resource/mcp`);
    if (!resourceResponse.ok) { await resourceResponse.body?.cancel(); throw new T3ConnectionError('http_error', phase); }
    const resource = OAuthProtectedResourceMetadataSchema.parse(await resourceResponse.json());
    if (resource.resource !== endpoint.href || resource.authorization_servers?.length !== 1 ||
      resource.authorization_servers[0] !== endpoint.origin || !resource.scopes_supported?.includes('orchestration:read'))
      throw new T3ConnectionError('invalid_metadata', phase);
    const metadataResponse = await network.fetch(`${endpoint.origin}/.well-known/oauth-authorization-server`);
    if (!metadataResponse.ok) { await metadataResponse.body?.cancel(); throw new T3ConnectionError('http_error', phase); }
    const metadata = OAuthMetadataSchema.parse(await metadataResponse.json());
    if (metadata.issuer !== endpoint.origin || metadata.authorization_endpoint !== `${endpoint.origin}/oauth/mcp/authorize` ||
      metadata.token_endpoint !== `${endpoint.origin}/oauth/mcp/token` || metadata.registration_endpoint !== `${endpoint.origin}/oauth/mcp/register` ||
      !metadata.code_challenge_methods_supported?.includes('S256') || !metadata.response_types_supported.includes('code') ||
      !metadata.token_endpoint_auth_methods_supported?.includes('none')) throw new T3ConnectionError('invalid_metadata', phase);
    callback = await callbackReceiver(endpoint.origin, signal);
    phase = 'registration';
    const information = await registerClient(endpoint.origin, { metadata, fetchFn: network.fetch, scope: 'orchestration:read',
      clientMetadata: { client_name: 'NemoPal local connection check', redirect_uris: [callback.redirectUrl],
        token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code'], scope: 'orchestration:read' } });
    if (information.client_secret !== undefined || information.token_endpoint_auth_method !== 'none' ||
      information.redirect_uris.length !== 1 || information.redirect_uris[0] !== callback.redirectUrl ||
      (information.scope !== undefined && information.scope !== 'orchestration:read')) throw new T3ConnectionError('invalid_registration', phase);
    phase = 'authorization';
    const authorization = await startAuthorization(endpoint.origin, { metadata, clientInformation: information,
      redirectUrl: callback.redirectUrl, scope: 'orchestration:read', state: callback.state, resource: endpoint });
    codeVerifier = authorization.codeVerifier;
    signal.throwIfAborted();
    await untilAborted(Promise.resolve(options.onAuthorization(authorization.authorizationUrl.href)), signal);
    authorizationCode = await callback.code;
    await callback.close(); callback = undefined;
    phase = 'token';
    tokens = await exchangeAuthorization(endpoint.origin, { metadata, clientInformation: information, authorizationCode,
      codeVerifier, redirectUri: String(authorization.authorizationUrl.searchParams.get('redirect_uri')), resource: endpoint, fetchFn: network.fetch });
    codeVerifier = ''; authorization.codeVerifier = ''; authorizationCode = '';
    if (tokens.token_type.toLowerCase() !== 'bearer' || tokens.scope !== 'orchestration:read' ||
      !tokens.access_token || /[\x00-\x20\x7f]/.test(tokens.access_token) || (tokens.expires_in !== undefined && tokens.expires_in <= 0))
      throw new T3ConnectionError('oauth_error', phase);
    const currentTokenDeadline = Date.now() + (tokens.expires_in === undefined ? sessionMs : Math.min(sessionMs, tokens.expires_in * 1000));
    if (scoped) {
      tokenDeadline = currentTokenDeadline;
      network.setSessionDeadline({ expiresAt: currentTokenDeadline, onExpiry: () => deadline.abort('deadline') });
      sessionTimer = setTimeout(() => deadline.abort('deadline'), Math.max(0, currentTokenDeadline - Date.now()));
    }
    network.setBearer(tokens.access_token);
    // Supplying a static memory-only bearer to the guarded fetch disables SDK re-auth, scope escalation and replay.
    transport = new StreamableHTTPClientTransport(endpoint, { fetch: network.fetch,
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 0, maxReconnectionDelay: 0, reconnectionDelayGrowFactor: 1 } });
    client = new Client({ name: 'NemoPal local connection check', version: '0.1.0' }, { capabilities: {} });
    phase = 'initialize';
    await boundedMcp(requestSignal => client!.connect(transport!, { signal: requestSignal, timeout: requestMs + 1000, maxTotalTimeout: requestMs + 1000 }));
    phase = 'tools_list';
    const tools = await boundedMcp(requestSignal => client!.listTools({}, { signal: requestSignal, timeout: requestMs + 1000, maxTotalTimeout: requestMs + 1000 }));
    if (tools.nextCursor || !T3_TOOLS.every(expected => tools.tools.some(tool => tool.name === expected)))
      throw new T3ConnectionError('missing_tools', phase);
    signal.throwIfAborted();
    if (scoped) {
      clearTimeout(timer);
      const remainingMs = currentTokenDeadline - Date.now();
      if (remainingMs <= 0) throw new T3ConnectionError('deadline', 'initialize');
      network.enableScopedCalls({ environmentId: scoped.environmentId, threadId: scoped.threadId, expiresAt: currentTokenDeadline, onExpiry: () => deadline.abort('deadline') });
      let closed = false;
      let busy = false;
      let calls = 0;
      let closing: Promise<void> | undefined;
      const close = () => {
        if (closing) return closing;
        closed = true;
        signal.removeEventListener('abort', onAbort);
        if (Date.now() >= currentTokenDeadline && !signal.aborted) deadline.abort('deadline');
        if (busy && !signal.aborted) deadline.abort('cancelled');
        closing = (async () => {
          phase = 'cleanup';
          const sessionId = transport?.sessionId || network.sessionId;
          let failed = Boolean(sessionId && (signal.aborted || localRequestExpired || network.deadlineExpired));
          if (sessionId && !signal.aborted && !localRequestExpired && !network.deadlineExpired) {
            try {
              const headers = new Headers({ 'mcp-session-id': sessionId });
              if (transport?.protocolVersion) headers.set('mcp-protocol-version', transport.protocolVersion);
              const response = await network.fetch(endpoint, { method: 'DELETE', headers });
              failed = !response.ok; await response.body?.cancel();
            } catch { failed = true; }
          }
          network.dispose();
          try { await client?.close(); await transport?.close(); } catch { failed = true; }
          clearTimeout(timer); clearTimeout(sessionTimer); tokens = undefined;
          if (failed) throw new T3ConnectionError('cleanup_failed', 'cleanup', 'uncertain');
        })();
        return closing;
      };
      const onAbort = () => { void close().catch(() => {}); };
      signal.addEventListener('abort', onAbort, { once: true });
      session = {
        configuration: Object.freeze({ endpoint: endpoint.href, environmentId: scoped.environmentId }),
        toolNames: Object.freeze([...T3_TOOLS]), permissions: Object.freeze(['orchestration:read']),
        async callTool(name: T3ToolName, args: Record<string, unknown>, requestSignal: AbortSignal) {
          if (Date.now() >= currentTokenDeadline && !signal.aborted) deadline.abort('deadline');
          if (signal.aborted) throw new T3ConnectionError(signal.reason === 'deadline' ? 'deadline' : 'cancelled', 'tool_call');
          if (requestSignal.aborted) throw new T3ConnectionError('cancelled', 'tool_call');
          if (closed || busy || calls >= 300 || !permittedCall(name, args, scoped))
            throw new T3ConnectionError('mcp_error', 'tool_call');
          network.clearFailure();
          busy = true; calls++;
          const cancel = () => deadline.abort('cancelled');
          requestSignal.addEventListener('abort', cancel, { once: true });
          if (requestSignal.aborted) cancel();
          phase = 'tool_call';
          try {
            const result = await boundedMcp(inner => client!.callTool({ name, arguments: args }, undefined,
              { signal: inner, timeout: requestMs + 1000, maxTotalTimeout: requestMs + 1000 }));
            if (Date.now() >= currentTokenDeadline && !signal.aborted) deadline.abort('deadline');
            if (signal.aborted) throw new T3ConnectionError(signal.reason === 'deadline' ? 'deadline' : 'cancelled', 'tool_call');
            return result;
          } catch {
            if (Date.now() >= currentTokenDeadline && !signal.aborted) deadline.abort('deadline');
            const code = signal.aborted ? (signal.reason === 'deadline' ? 'deadline' : 'cancelled') :
              localRequestExpired || network.deadlineExpired ? 'deadline' :
              network.failure?.code === 'response_too_large' ? 'response_too_large' : 'mcp_error';
            if (code === 'deadline' && !signal.aborted) deadline.abort('deadline');
            if (!signal.aborted) { busy = false; await close().catch(() => {}); }
            throw new T3ConnectionError(code, 'tool_call', 'uncertain');
          } finally { busy = false; requestSignal.removeEventListener('abort', cancel); }
        }, close,
      };
      if (signal.aborted) { await close(); throw new T3ConnectionError('cancelled', 'cleanup'); }
      retained = true;
    }
    result = { status: 'connected', transport: 'loopback_http', permissions: ['orchestration:read'],
      expectedReadTools: [...T3_TOOLS], toolCalls: 0, credentials: 'discarded', session: 'closed', checkedAt: new Date().toISOString() };
  } catch (caught) {
    if (tokenDeadline !== undefined && Date.now() >= tokenDeadline && !signal.aborted) deadline.abort('deadline');
    const code = signal.aborted ? (signal.reason === 'deadline' ? 'deadline' : 'cancelled') :
      localRequestExpired || network.deadlineExpired ? 'deadline' :
      network.failure?.code === 'response_too_large' ? 'response_too_large' :
      caught instanceof McpError ? 'mcp_error' :
      network.failure?.code ?? (caught instanceof T3ConnectionError ? caught.code :
        phase === 'discovery' ? 'invalid_metadata' : phase === 'initialize' || phase === 'tools_list' ? 'mcp_error' : 'oauth_error');
    error = new T3ConnectionError(code, phase, attempted ? 'uncertain' : 'known_unsent');
  } finally {
    if (!retained) {
    phase = 'cleanup';
    if (callback) await callback.close();
    // On cancellation or any deadline no further HTTP is sent; remote closure remains unconfirmed.
    const sessionId = transport?.sessionId || network.sessionId;
    if (sessionId && !signal.aborted && error?.code !== 'deadline' && error?.code !== 'cancelled') {
      try {
        const headers = new Headers({ 'mcp-session-id': sessionId });
        if (transport?.protocolVersion) headers.set('mcp-protocol-version', transport.protocolVersion);
        const response = await network.fetch(endpoint, { method: 'DELETE', headers });
        cleanupFailed = !response.ok;
        await response.body?.cancel();
      } catch { cleanupFailed = true; }
    }
    try { await client?.close(); await transport?.close(); } catch { cleanupFailed = true; }
    network.dispose(); tokens = undefined; codeVerifier = ''; authorizationCode = '';
    clearTimeout(timer); clearTimeout(sessionTimer);
    }
  }
  if (error) throw error;
  if (signal.aborted) throw new T3ConnectionError(signal.reason === 'deadline' ? 'deadline' : 'cancelled', 'cleanup', 'uncertain');
  if (session) return session;
  if (cleanupFailed || !result) throw new T3ConnectionError('cleanup_failed', 'cleanup', 'uncertain');
  return result;
}
