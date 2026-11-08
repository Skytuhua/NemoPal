import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as connector from '../../apps/cloud/src/integrations/t3/client/index';
import { networkBoundary } from '../../apps/cloud/src/integrations/t3/client/boundary';
import { main } from '../../scripts/t3-connect';

const fixtures: { close(): Promise<void> }[] = [];
afterEach(async () => { await Promise.all(fixtures.splice(0).map(f => f.close())); });

type Mode = 'ok' | 'cross-origin' | 'bad-resource' | 'bad-issuer' | 'no-pkce' | 'oversize' |
  'redirect' | 'discovery-error' | 'token-error' | 'broad-token' | 'mcp-error' | 'missing-tool' | 'hang' |
  'session' | 'cleanup-error' | 'chunked-oversize' | 'mcp-oversize' | 'mcp-hang' | 'sse' | 'bad-token-endpoint' | 'bad-registration-endpoint' |
  'call-hang' | 'call-error' | 'call-oversize' | 'token-aged' | 'pkce-mismatch' | 'invalid-registration' | 'init-error' | 'delete405' | 'initialized-error' | 'initialized-cancel' | 'server-timeout-error' | 'mcp-empty' | 'slow-init-notification' | 'background-oversize' | 'background-hang';

async function fixture(mode: Mode = 'ok') {
  const requests: { path: string; method: string; body: string; authorization?: string; session?: string }[] = [];
  let onInitialized = () => {};
  let onCall = () => {};
  let onToken = () => {};
  let onToolsList = () => {};
  let authorization: URL | undefined;
  let callback: string | undefined;
  let callbackClosed = false;
  let origin = '';
  const send = (res: ServerResponse, body: unknown, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url!, method: req.method!, body, authorization: req.headers.authorization, session: req.headers['mcp-session-id'] as string | undefined });
    if (req.url === '/.well-known/oauth-protected-resource/mcp') {
      if (mode === 'hang') return;
      if (mode === 'oversize') return send(res, { pad: 'x'.repeat(300_000) });
      if (mode === 'chunked-oversize') {
        res.writeHead(200, { 'content-type': 'application/json' });
        for (let i = 0; i < 80; i++) res.write('x'.repeat(1024));
        return res.end();
      }
      if (mode === 'redirect') return res.writeHead(302, { location: `${origin}/unexpected` }).end();
      if (mode === 'discovery-error') return send(res, { error: 'private-body' }, 500);
      return send(res, { resource: mode === 'bad-resource' ? `${origin}/other` : `${origin}/mcp`,
        authorization_servers: [mode === 'cross-origin' ? 'http://127.0.0.1:1' : origin],
        scopes_supported: ['orchestration:read', 'orchestration:operate'] });
    }
    if (req.url === '/.well-known/oauth-authorization-server') return send(res, {
      issuer: mode === 'bad-issuer' ? `${origin}/wrong` : origin,
      authorization_endpoint: `${origin}/oauth/mcp/authorize`, token_endpoint: mode === 'bad-token-endpoint' ? 'http://127.0.0.1:1/token' : `${origin}/oauth/mcp/token`,
      registration_endpoint: mode === 'bad-registration-endpoint' ? `${origin}/other` : `${origin}/oauth/mcp/register`, response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'], token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: mode === 'no-pkce' ? ['plain'] : ['S256'],
      authorization_response_iss_parameter_supported: true, scopes_supported: ['orchestration:read'],
    });
    if (req.url === '/oauth/mcp/register') {
      const metadata = JSON.parse(body);
      expect(metadata.client_name).toBe('NemoPal local connection check');
      expect(metadata.scope).toBe('orchestration:read');
      expect(metadata.token_endpoint_auth_method).toBe('none');
      callback = metadata.redirect_uris[0];
      if (mode === 'invalid-registration') return send(res, { ...metadata, client_id: 'fixture-public-client', redirect_uris: [`${origin}/wrong`] }, 201);
      return send(res, { ...metadata, client_id: 'fixture-public-client' }, 201);
    }
    if (req.url === '/oauth/mcp/token') {
      const params = new URLSearchParams(body);
      expect(params.get('resource')).toBe(`${origin}/mcp`);
      expect(params.get('redirect_uri')).toBe(callback);
      expect(params.get('grant_type')).toBe('authorization_code');
      expect(params.get('client_id')).toBe('fixture-public-client');
      const challenge = createHash('sha256').update(params.get('code_verifier')!).digest('base64url');
      if (mode === 'pkce-mismatch') {
        expect(challenge).not.toBe(authorization?.searchParams.get('code_challenge'));
        return send(res, { error: 'invalid_grant' }, 400);
      }
      expect(challenge).toBe(authorization?.searchParams.get('code_challenge'));
      expect(params.get('code')).toBe('fixture-code');
      if (mode === 'token-error') return send(res, { error: 'invalid_grant', error_description: 'private-body' }, 400);
      if (mode === 'token-aged') { onToken(); return send(res, { access_token: 'fixture-secret-access-token', token_type: 'Bearer', expires_in: 1, scope: 'orchestration:read' }); }
      return send(res, { access_token: 'fixture-secret-access-token', token_type: 'Bearer', expires_in: 60,
        scope: mode === 'broad-token' ? 'orchestration:read orchestration:operate' : 'orchestration:read' });
    }
    if (req.url === '/mcp') {
      expect(req.headers.authorization).toBe('Bearer fixture-secret-access-token');
      if (req.method === 'GET') { if (mode === 'background-oversize') return res.writeHead(200, { 'content-type': 'text/event-stream' }).end('x'.repeat(300000)); if (mode === 'background-hang') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: ping\n\n'); return; } return res.writeHead(405).end(); }
      if (req.method === 'DELETE') return res.writeHead(mode === 'cleanup-error' ? 500 : mode === 'delete405' ? 405 : 204).end();
      const message = JSON.parse(body);
      if (message.method === 'initialize') {
        if (mode === 'init-error') return send(res, { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'private-body' } });
        if (mode === 'slow-init-notification') await new Promise(resolve => setTimeout(resolve, 250));
        if (['session', 'call-hang', 'call-error', 'call-oversize', 'cleanup-error', 'delete405', 'initialized-error', 'initialized-cancel', 'mcp-hang', 'server-timeout-error', 'mcp-empty', 'slow-init-notification', 'background-oversize'].includes(mode)) res.setHeader('mcp-session-id', 'fixture-session');
        return send(res, { jsonrpc: '2.0', id: message.id,
          result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'private-server-name', version: '0.1.7' } } });
      }
      if (message.method === 'notifications/initialized') { onInitialized(); if (mode === 'slow-init-notification') await new Promise(resolve => setTimeout(resolve, 250)); return res.writeHead(mode === 'initialized-error' ? 500 : 202).end(); }
      if (message.method === 'tools/call') {
        onCall();
        if (mode === 'call-hang') return;
        if (mode === 'call-error') return send(res, { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'fixture error' } });
        if (mode === 'call-oversize') return send(res, { pad: 'x'.repeat(300000) });
        if (message.params.name !== 't3_thread_read') return send(res, { jsonrpc: '2.0', id: message.id, result: { structuredContent: { requestIds: [] }, content: [] } });
        const args = message.params.arguments;
        expect(args.environmentId).toBe('env'); expect(args.threadId).toBe('thread');
        return send(res, { jsonrpc: '2.0', id: message.id, result: { content: [], structuredContent: {
          thread: { threadId: 'thread', projectId: 'source', activeRunId: 'run', latestRunId: 'run', status: 'running', updatedAt: '2026-11-08T04:00:00Z' },
          recentRuns: [{ runId: 'run', ordinal: 1, status: 'running' }],
          items: [{ itemId: 'item', position: 1, sourceThreadId: 'thread', visibility: 'local', runId: 'run', status: 'running', updatedAt: '2026-11-08T04:00:00Z', text: 'PRIVATE SOURCE' }],
          nextPosition: 1, hasMore: false,
        } } });
      }
      if (message.method === 'tools/list') {
        onToolsList();
        if (mode === 'mcp-empty') return res.writeHead(202).end();
        if (mode === 'server-timeout-error') return send(res, { jsonrpc: '2.0', id: message.id, error: { code: -32001, message: 'server error' } });
        if (mode === 'background-oversize') { await new Promise(resolve => setTimeout(resolve, 150)); return send(res, { jsonrpc: '2.0', id: message.id, error: { code: -32001, message: 'server error' } }); }
        if (mode === 'background-hang') { await new Promise(resolve => setTimeout(resolve, 120)); return send(res, { jsonrpc: '2.0', id: message.id, error: { code: -32001, message: 'server error' } }); }
        if (mode === 'mcp-hang') return;
        if (mode === 'mcp-oversize') return send(res, { pad: 'x'.repeat(300_000) });
        if (mode === 'mcp-error') return send(res, { jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'private-body' } });
        const response = { jsonrpc: '2.0', id: message.id, result: { tools: (mode === 'missing-tool' ? ['t3_thread_read'] :
          ['t3_thread_read', 't3_pending_request', 't3_thread_launch']).map(name => ({ name, inputSchema: { type: 'object' }, description: 'private description' })) } };
        if (mode === 'sse') return res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
        return send(res, response);
      }
      throw new Error(`Unexpected MCP method ${message.method}`);
    }
    send(res, {}, 404);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture address');
  origin = `http://127.0.0.1:${address.port}`;
  const result = {
    endpoint: `${origin}/mcp`, origin, requests,
    setOnInitialized(callback: () => void) { onInitialized = callback; },
    setOnCall(callback: () => void) { onCall = callback; },
    setOnToken(callback: () => void) { onToken = callback; },
    setOnToolsList(callback: () => void) { onToolsList = callback; },
    get callback() { return callback; },
    get callbackClosed() { return callbackClosed; },
    async authorize(url: string, alter?: (url: URL) => void) {
      authorization = new URL(url);
      expect(authorization.origin).toBe(origin);
      expect(authorization.pathname).toBe('/oauth/mcp/authorize');
      expect(authorization.searchParams.get('scope')).toBe('orchestration:read');
      expect(authorization.searchParams.get('resource')).toBe(`${origin}/mcp`);
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
      expect(authorization.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(authorization.searchParams.has('code_verifier')).toBe(false);
      // Fixture-only corrupted server-side authorization binding exercises a rejected PKCE exchange.
      if (mode === 'pkce-mismatch') authorization.searchParams.set('code_challenge', 'fixture-corrupted-challenge');
      const target = new URL(authorization.searchParams.get('redirect_uri')!);
      expect(target.hostname).toBe('127.0.0.1');
      expect(['45231', '55439']).not.toContain(target.port);
      target.searchParams.set('state', authorization.searchParams.get('state')!);
      target.searchParams.set('iss', origin);
      target.searchParams.set('code', 'fixture-code');
      alter?.(target);
      const response = await fetch(target, { redirect: 'error' });
      await response.text();
      return { response, target };
    },
    async checkCallbackClosed() {
      if (!callback) return;
      await expect(fetch(callback)).rejects.toThrow();
      callbackClosed = true;
    },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
  fixtures.push(result);
  return result;
}

describe('dedicated local T3 OAuth and MCP connection', () => {
  it('exports a real finite connector', () => { expect(connector.checkLocalT3Connection).toBeTypeOf('function'); });

  it('performs public S256 OAuth, initialize and one tools/list without tool calls or retained secrets', async () => {
    const f = await fixture();
    const receipt = await connector.checkLocalT3Connection({ endpoint: f.endpoint,
      onAuthorization: async url => { await f.authorize(url); } });
    expect(receipt).toMatchObject({ status: 'connected', permissions: ['orchestration:read'],
      expectedReadTools: ['t3_thread_read', 't3_pending_request'], toolCalls: 0, credentials: 'discarded' });
    const text = JSON.stringify(receipt);
    expect(text).not.toMatch(/secret|private|fixture-code|fixture-public-client/);
    expect(f.requests.filter(r => r.path === '/oauth/mcp/token')).toHaveLength(1);
    expect(f.requests.filter(r => r.path === '/mcp' && r.method === 'POST').map(r => JSON.parse(r.body).method))
      .toEqual(['initialize', 'notifications/initialized', 'tools/list']);
    expect(f.requests.filter(r => r.path !== '/mcp').every(r => !r.authorization)).toBe(true);
    await f.checkCallbackClosed();
  });

  it.each(['http://example.com/mcp', 'http://localhost:42123/mcp', 'http://127.0.0.2:42123/mcp',
    'http://127.0.0.1:42123/mcp?', 'http://127.0.0.1:42123/mcp#', 'http://user@127.0.0.1:42123/mcp',
    'http://127.0.0.1:42123/other', 'http://2130706433:42123/mcp'])('rejects invalid explicit endpoint %s before send', async endpoint => {
    await expect(connector.checkLocalT3Connection({ endpoint, onAuthorization: () => { throw new Error('must not authorize'); } }))
      .rejects.toMatchObject({ code: 'invalid_endpoint', delivery: 'known_unsent' });
  });

  it.each(['cross-origin', 'bad-resource', 'bad-issuer', 'no-pkce', 'oversize', 'chunked-oversize', 'redirect', 'discovery-error', 'bad-token-endpoint', 'bad-registration-endpoint'] as const)
    ('rejects %s discovery before registration', async mode => {
      const f = await fixture(mode);
      await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, onAuthorization: () => { throw new Error('must not authorize'); } }))
        .rejects.toMatchObject({ delivery: 'known_unsent' });
      expect(f.requests.some(r => r.method === 'POST')).toBe(false);
      expect(f.requests.some(r => r.path === '/unexpected')).toBe(false);
    });

  it.each(['state', 'iss', 'missing-issuer', 'duplicate', 'path', 'oversize-code', 'denied', 'error', 'open-redirect'] as const)('rejects %s callback and never exchanges a code', async kind => {
    const f = await fixture();
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, signInTimeoutMs: 300,
      onAuthorization: async url => { await f.authorize(url, target => {
        if (kind === 'state') target.searchParams.set('state', 'wrong');
        if (kind === 'iss') target.searchParams.set('iss', `${f.origin}/wrong`);
        if (kind === 'missing-issuer') target.searchParams.delete('iss');
        if (kind === 'duplicate') target.searchParams.append('state', 'duplicate');
        if (kind === 'path') target.pathname += '/wrong';
        if (kind === 'oversize-code') target.searchParams.set('code', 'x'.repeat(3000));
        if (kind === 'open-redirect') target.searchParams.set('redirect_uri', 'https://example.com');
        if (kind === 'denied' || kind === 'error') { target.searchParams.delete('code'); target.searchParams.set('error', kind === 'denied' ? 'access_denied' : 'invalid_request'); }
      }); } })).rejects.toMatchObject({ code: kind === 'denied' ? 'denied' : 'invalid_callback' });
    expect(f.requests.some(r => r.path === '/oauth/mcp/token')).toBe(false);
    await f.checkCallbackClosed();
  });

  it('uses a single-use callback', async () => {
    const f = await fixture();
    await connector.checkLocalT3Connection({ endpoint: f.endpoint, onAuthorization: async url => {
      const { target } = await f.authorize(url);
      try { const response = await fetch(target); expect(response.status).toBe(410); await response.text(); }
      catch (error) { expect(error).toBeInstanceOf(TypeError); }
    } });
    expect(f.requests.filter(r => r.path === '/oauth/mcp/token')).toHaveLength(1);
    await f.checkCallbackClosed();
  });

  it.each(['token-error', 'pkce-mismatch', 'broad-token', 'init-error', 'mcp-error', 'missing-tool'] as const)('fails closed on %s, with no replay and secret-safe errors', async mode => {
    const f = await fixture(mode);
    let error: unknown;
    try { await connector.checkLocalT3Connection({ endpoint: f.endpoint, onAuthorization: async url => { await f.authorize(url); } }); }
    catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(connector.T3ConnectionError);
    expect(String(error)).not.toMatch(/private|secret|fixture-code|fixture-public-client/);
    expect(f.requests.filter(r => r.path === '/oauth/mcp/token')).toHaveLength(1);
    expect(f.requests.some(r => r.body.includes('tools/call'))).toBe(false);
    await f.checkCallbackClosed();
  });

  it('bounds HTTP waits', async () => {
    const f = await fixture('hang');
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, requestTimeoutMs: 50, onAuthorization: () => {} }))
      .rejects.toMatchObject({ code: 'deadline', delivery: 'known_unsent' });
  });

  it('expires sign-in and closes its callback', async () => {
    const f = await fixture();
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, signInTimeoutMs: 50, onAuthorization: () => {} }))
      .rejects.toMatchObject({ code: 'deadline' });
    await f.checkCallbackClosed();
  });

  it('cancels sign-in and closes its callback', async () => {
    const f = await fixture(); const controller = new AbortController();
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, signal: controller.signal,
      onAuthorization: () => { controller.abort(); } })).rejects.toMatchObject({ code: 'cancelled' });
    expect(f.requests.some(r => r.path === '/oauth/mcp/token')).toBe(false);
    await f.checkCallbackClosed();
  });

  it('rejects altered public registration before printing a sign-in link', async () => {
    const f = await fixture('invalid-registration');
    const onAuthorization = vi.fn();
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, onAuthorization }))
      .rejects.toMatchObject({ code: 'invalid_registration', delivery: 'uncertain' });
    expect(onAuthorization).not.toHaveBeenCalled();
    expect(f.requests.some(r => r.path === '/oauth/mcp/token')).toBe(false);
    await f.checkCallbackClosed();
  });

  it('reports a stalled MCP request as a deadline', async () => {
    const f = await fixture('mcp-hang');
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, requestTimeoutMs: 50,
      onAuthorization: async url => { await f.authorize(url); } })).rejects.toMatchObject({ code: 'deadline', delivery: 'uncertain' });
  });

  it('does not send session cleanup after a request deadline', async () => {
    const f = await fixture('mcp-hang');
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, requestTimeoutMs: 100, signInTimeoutMs: 3000,
      onAuthorization: async url => { await f.authorize(url); } }))
      .rejects.toMatchObject({ code: 'deadline', phase: 'tools_list', delivery: 'uncertain' });
    expect(f.requests.filter(r => r.method === 'DELETE')).toHaveLength(0);
    await f.checkCallbackClosed();
  });

  it('cleans up after a server error that uses the SDK timeout code', async () => {
    const f = await fixture('server-timeout-error');
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, requestTimeoutMs: 2000, signInTimeoutMs: 3000,
      onAuthorization: async url => { await f.authorize(url); } }))
      .rejects.toMatchObject({ code: 'mcp_error', phase: 'tools_list', delivery: 'uncertain' });
    expect(f.requests.filter(r => r.method === 'DELETE')).toHaveLength(1);
    await f.checkCallbackClosed();
  });

  it('does not clean up after a local deadline while awaiting an SDK response', async () => {
    const f = await fixture('mcp-empty');
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, requestTimeoutMs: 100, signInTimeoutMs: 3000,
      onAuthorization: async url => { await f.authorize(url); } }))
      .rejects.toMatchObject({ code: 'deadline', phase: 'tools_list', delivery: 'uncertain' });
    expect(f.requests.filter(r => r.method === 'DELETE')).toHaveLength(0);
    await f.checkCallbackClosed();
  });

  it('fences later requests if initialization finishes after its deadline', async () => {
    const f = await fixture('slow-init-notification');
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, requestTimeoutMs: 400, signInTimeoutMs: 3000,
      onAuthorization: async url => { await f.authorize(url); } })).rejects.toMatchObject({ code: 'deadline', phase: 'initialize' });
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(f.requests.some(r => r.body.includes('tools/list'))).toBe(false);
    expect(f.requests.filter(r => r.method === 'DELETE')).toHaveLength(0);
    await f.checkCallbackClosed();
  });

  it('does not replace a foreground error with a background stream failure', async () => {
    const f = await fixture('background-oversize');
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, requestTimeoutMs: 2000, signInTimeoutMs: 3000,
      onAuthorization: async url => { await f.authorize(url); } })).rejects.toMatchObject({ code: 'mcp_error', phase: 'tools_list' });
    expect(f.requests.filter(r => r.method === 'DELETE')).toHaveLength(1);
    await f.checkCallbackClosed();
  });

  it('does not attribute a background stream timeout to the foreground request', async () => {
    const f = await fixture('background-hang');
    const boundary = networkBoundary(new URL(f.endpoint), new AbortController().signal, 200, () => 'tools_list', () => {});
    boundary.setBearer('fixture-secret-access-token');
    try {
      const background = await boundary.fetch(f.endpoint, { method: 'GET' });
      const reader = background.body!.getReader();
      await reader.read();
      const pendingRead = reader.read().catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 120));
      const foreground = await boundary.fetch(f.endpoint, { method: 'POST', body: JSON.stringify({ method: 'tools/list' }) });
      expect((await foreground.json()).error.code).toBe(-32001);
      expect(boundary.deadlineExpired).toBe(false);
      expect(boundary.failure).toBeUndefined();
      await pendingRead;
    } finally { boundary.dispose(); }
  });

  it('CLI requires an endpoint and never echoes invalid private arguments or raw errors', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main([])).toBe(2);
    expect(await main(['--endpoint', 'http://private-machine-name/mcp?private-token'])).toBe(1);
    expect(await main(['--help'])).toBe(0);
    expect(JSON.stringify([...log.mock.calls, ...error.mock.calls])).not.toMatch(/private-machine-name|private-token|stack/);
  });

  it('bounds an authorization-link handler that never settles', async () => {
    const f = await fixture();
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, signInTimeoutMs: 50,
      onAuthorization: () => new Promise<void>(() => {}) })).rejects.toMatchObject({ code: 'deadline' });
    await f.checkCallbackClosed();
  });

  it('sends a successful callback response before closing its receiver', async () => {
    const f = await fixture(); let response: Promise<{ response: Response; target: URL }> | undefined;
    await connector.checkLocalT3Connection({ endpoint: f.endpoint,
      onAuthorization: url => { response = f.authorize(url); } });
    expect((await response)!.response.status).toBe(200);
    await f.checkCallbackClosed();
  });

  it.each(['session', 'sse'] as const)('supports %s through the official transport', async mode => {
    const f = await fixture(mode);
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, onAuthorization: async url => { await f.authorize(url); } }))
      .resolves.toMatchObject({ status: 'connected', session: 'closed' });
    if (mode === 'session') expect(f.requests.filter(r => r.method === 'DELETE')).toHaveLength(1);
    await f.checkCallbackClosed();
  });

  it('reports a refused session termination as uncertain', async () => {
    const f = await fixture('delete405');
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, onAuthorization: async url => { await f.authorize(url); } }))
      .rejects.toMatchObject({ code: 'cleanup_failed', phase: 'cleanup', delivery: 'uncertain' });
    expect(f.requests.filter(r => r.method === 'DELETE')).toHaveLength(1);
    await f.checkCallbackClosed();
  });

  it('terminates an established session when the initialized notification fails', async () => {
    const f = await fixture('initialized-error');
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, onAuthorization: async url => { await f.authorize(url); } }))
      .rejects.toMatchObject({ code: 'mcp_error', phase: 'initialize', delivery: 'uncertain' });
    expect(f.requests.filter(r => r.method === 'DELETE')).toHaveLength(1);
    expect(f.requests.find(r => r.method === 'DELETE')).toMatchObject({ session: 'fixture-session', authorization: 'Bearer fixture-secret-access-token' });
    expect(f.requests.filter(r => r.path === '/oauth/mcp/token')).toHaveLength(1);
    await f.checkCallbackClosed();
  });

  it('does not send session cleanup after operator cancellation', async () => {
    const f = await fixture('initialized-cancel');
    const controller = new AbortController();
    f.setOnInitialized(() => controller.abort());
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, signal: controller.signal,
      onAuthorization: async url => { await f.authorize(url); } })).rejects.toMatchObject({ code: 'cancelled', delivery: 'uncertain' });
    expect(f.requests.filter(r => r.method === 'DELETE')).toHaveLength(0);
    await f.checkCallbackClosed();
  });

  it.each(['cleanup-error', 'mcp-oversize', 'mcp-hang'] as const)('reports %s as uncertain and never retries', async mode => {
    const f = await fixture(mode);
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, requestTimeoutMs: 100,
      onAuthorization: async url => { await f.authorize(url); } })).rejects.toMatchObject({ delivery: 'uncertain' });
    expect(f.requests.filter(r => r.path === '/mcp' && r.body.includes('tools/list'))).toHaveLength(1);
    await f.checkCallbackClosed();
  });
});

it('opens a scoped read-only session usable by the observer and closes it', async () => {
  const f = await fixture('session');
  const now = Date.now();
  const context = {
    grant: { bindingId: 'binding', ownerId: 'owner', deviceId: 'device', environmentId: 'env', projectId: 'board', t3ProjectId: 'source', threadId: 'thread', revision: 1, expiresAt: now + 60000, revoked: false, startPosition: 0 },
    mapping: { ownerId: 'owner', projectId: 'board', taskId: 'task', taskRevision: 1, mappingRevision: 1, grantRevision: 1, runId: 'run', runOrdinal: 1 },
    completionPolicy: { enabled: false, revision: 1, criterionId: 'receipt' },
  };
  const session = await connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread',
    onAuthorization: async url => { await f.authorize(url); } });
  const { T3Adapter, T3Observer } = await import('../../apps/cloud/src/integrations/t3');
  const observer = new T3Observer(context, new T3Adapter(session, async () => context, Date.now), Date.now);
  const state = await observer.poll();
  expect(state.mode).toBe('current');
  expect(state.items).toHaveLength(1);
  expect(JSON.stringify(state)).not.toContain('PRIVATE SOURCE');
  await session.close();
  await expect(session.callTool('t3_thread_read', { environmentId: 'env', threadId: 'thread', view: 'activity', limit: 25, maxCharsPerItem: 1, runLimit: 10 }, new AbortController().signal)).rejects.toThrow();
  expect(f.requests.filter(r => r.method === 'DELETE')).toHaveLength(1);
});

it('rejects other threads, write actions, and unbounded arguments before sending', async () => {
  const f = await fixture();
  const session = await connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', onAuthorization: async url => { await f.authorize(url); } });
  const signal = new AbortController().signal;
  const before = f.requests.length;
  await expect(session.callTool('t3_thread_read', { environmentId: 'env', threadId: 'other', view: 'activity', limit: 25, maxCharsPerItem: 1, runLimit: 10 }, signal)).rejects.toThrow();
  await expect(session.callTool('t3_pending_request', { environmentId: 'env', threadId: 'thread', action: 'respond' }, signal)).rejects.toThrow();
  await expect(session.callTool('t3_thread_read', { environmentId: 'env', threadId: 'thread', view: 'activity', limit: 100000, maxCharsPerItem: 1, runLimit: 10 }, signal)).rejects.toThrow();
  await expect(session.callTool('t3_thread_read', { environmentId: 'env', threadId: 'thread', view: 'activity', limit: 25, maxCharsPerItem: 1, runLimit: 10, privatePayload: 'do not send' }, signal)).rejects.toThrow();
  expect(f.requests.length).toBe(before);
  await session.close();
});

it('close aborts an in-flight read and prevents later requests', async () => {
  const f = await fixture('call-hang');
  const session = await connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', onAuthorization: async url => { await f.authorize(url); } });
  const pending = session.callTool('t3_thread_read', { environmentId: 'env', threadId: 'thread', view: 'activity', limit: 25, maxCharsPerItem: 1, runLimit: 10 }, new AbortController().signal);
  const rejected = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(f.requests.some(r => r.body.includes('tools/call'))).toBe(true));
  await expect(session.close()).rejects.toMatchObject({ code: 'cleanup_failed', delivery: 'uncertain' });
  await rejected;
  const count = f.requests.length;
  await expect(session.callTool('t3_thread_read', { environmentId: 'env', threadId: 'thread', view: 'activity', limit: 25, maxCharsPerItem: 1, runLimit: 10 }, new AbortController().signal)).rejects.toThrow();
  expect(f.requests.length).toBe(count);
  expect(f.requests.filter(r => r.method === 'DELETE')).toHaveLength(0);
});

it('expires a session locally and sends no tool call afterward', async () => {
  const f = await fixture();
  const session = await connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', sessionTimeoutMs: 30, onAuthorization: async url => { await f.authorize(url); } });
  await vi.waitFor(async () => {
    await expect(session.callTool('t3_thread_read', { environmentId: 'env', threadId: 'thread', view: 'activity', limit: 25, maxCharsPerItem: 1, runLimit: 10 }, new AbortController().signal)).rejects.toThrow();
  });
  const count = f.requests.filter(r => r.body.includes('tools/call')).length;
  await expect(session.callTool('t3_thread_read', { environmentId: 'env', threadId: 'thread', view: 'activity', limit: 25, maxCharsPerItem: 1, runLimit: 10 }, new AbortController().signal)).rejects.toThrow();
  expect(f.requests.filter(r => r.body.includes('tools/call'))).toHaveLength(count);
  await session.close();
});

it('revoked authority prevents the observer from sending a read', async () => {
  const f = await fixture();
  const now = Date.now();
  const context = {
    grant: { bindingId: 'binding', ownerId: 'owner', deviceId: 'device', environmentId: 'env', projectId: 'board', t3ProjectId: 'source', threadId: 'thread', revision: 1, expiresAt: now + 60000, revoked: false, startPosition: 0 },
    mapping: { ownerId: 'owner', projectId: 'board', taskId: 'task', taskRevision: 1, mappingRevision: 1, grantRevision: 1, runId: 'run', runOrdinal: 1 },
    completionPolicy: { enabled: false, revision: 1, criterionId: 'receipt' },
  };
  const session = await connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', onAuthorization: async url => { await f.authorize(url); } });
  const { T3Adapter, T3Observer } = await import('../../apps/cloud/src/integrations/t3');
  const observer = new T3Observer(context, new T3Adapter(session, async () => ({ ...context, grant: { ...context.grant, revoked: true } }), Date.now), Date.now);
  expect((await observer.poll()).mode).toBe('revoked');
  expect(f.requests.filter(r => r.body.includes('tools/call'))).toHaveLength(0);
  await session.close();
});


const reviewReadArgs = { environmentId: 'env', threadId: 'thread', view: 'activity', limit: 1, maxCharsPerItem: 1, runLimit: 1 };
it('fences session deadline even when the event loop delays its timer', async () => {
  const f = await fixture('session');
  const session = await connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', sessionTimeoutMs: 100, onAuthorization: async url => { await f.authorize(url); } });
  const until = Date.now() + 150;
  while (Date.now() < until) { /* simulate a stalled event loop */ }
  await expect(session.callTool('t3_thread_read', reviewReadArgs, new AbortController().signal)).rejects.toMatchObject({ code: 'deadline' });
  expect(f.requests.filter(r => r.body.includes('tools/call'))).toHaveLength(0);
  await expect(session.close()).rejects.toMatchObject({ code: 'cleanup_failed' });
});
it('preserves pre-aborted and in-flight cancellation', async () => {
  const f = await fixture('call-hang');
  const session = await connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', onAuthorization: async url => { await f.authorize(url); } });
  const pre = new AbortController(); pre.abort();
  await expect(session.callTool('t3_thread_read', reviewReadArgs, pre.signal)).rejects.toMatchObject({ code: 'cancelled' });
  expect(f.requests.filter(r => r.body.includes('tools/call'))).toHaveLength(0);
  const controller = new AbortController();
  const pending = session.callTool('t3_thread_read', reviewReadArgs, controller.signal);
  const result = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  await vi.waitFor(() => expect(f.requests.some(r => r.body.includes('tools/call'))).toBe(true));
  controller.abort(); await result;
  await expect(session.close()).rejects.toMatchObject({ code: 'cleanup_failed' });
});
it('preserves a lifetime timeout during a pending call', async () => {
  const f = await fixture('call-hang');
  const session = await connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', sessionTimeoutMs: 200, onAuthorization: async url => { await f.authorize(url); } });
  await expect(session.callTool('t3_thread_read', reviewReadArgs, new AbortController().signal)).rejects.toMatchObject({ code: 'deadline' });
  await expect(session.close()).rejects.toMatchObject({ code: 'cleanup_failed' });
});
it('preserves oversized tool response as a bounded error', async () => {
  const f = await fixture('call-oversize');
  const session = await connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', onAuthorization: async url => { await f.authorize(url); } });
  await expect(session.callTool('t3_thread_read', reviewReadArgs, new AbortController().signal)).rejects.toMatchObject({ code: 'response_too_large' });
  await session.close();
});
it('terminates the session after a definitive server error', async () => {
  const f = await fixture('call-error');
  const session = await connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', onAuthorization: async url => { await f.authorize(url); } });
  await expect(session.callTool('t3_thread_read', reviewReadArgs, new AbortController().signal)).rejects.toMatchObject({ code: 'mcp_error' });
  await session.close();
  expect(f.requests.filter(r => r.method === 'DELETE')).toHaveLength(1);
});


it('does not start cleanup after expiry even when the timer is delayed', async () => {
  const f = await fixture('session');
  const session = await connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', sessionTimeoutMs: 100, onAuthorization: async url => { await f.authorize(url); } });
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    const until = Date.now() + 150;
    while (Date.now() < until) { /* prevent timer callbacks during expiry */ }
    await expect(session.close()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  } finally { fetchSpy.mockRestore(); }
});

it('classifies an error processed after session expiry as deadline and does not clean up remotely', async () => {
  const f = await fixture('call-error');
  const session = await connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', sessionTimeoutMs: 5000, onAuthorization: async url => { await f.authorize(url); } });
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  f.setOnCall(() => { clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10000); });
  try {
    await expect(session.callTool('t3_thread_read', reviewReadArgs, new AbortController().signal)).rejects.toMatchObject({ code: 'deadline' });
    await expect(session.close()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(f.requests.filter(r => r.method === 'DELETE')).toHaveLength(0);
  } finally { clock?.mockRestore(); }
});


it('network boundary fences an expired session before initiating cleanup', async () => {
  const f = await fixture('session');
  const controller = new AbortController();
  const onExpiry = vi.fn(() => controller.abort('deadline'));
  const boundary = networkBoundary(new URL(f.endpoint), controller.signal, 1000, () => 'cleanup', () => {});
  boundary.setBearer('fixture-secret-access-token');
  boundary.enableScopedCalls({ environmentId: 'env', threadId: 'thread', expiresAt: Date.now() - 1, onExpiry });
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    await expect(boundary.fetch(f.endpoint, { method: 'DELETE' })).rejects.toMatchObject({ code: 'deadline' });
    expect(onExpiry).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally { boundary.dispose(); fetchSpy.mockRestore(); }
});


it('stops initialization sends when session expires before tools discovery', async () => {
  const f = await fixture('session');
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  const later = Date.now() + 60000;
  f.setOnInitialized(() => { clock = vi.spyOn(Date, 'now').mockReturnValue(later); });
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    await expect(connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread',
      sessionTimeoutMs: 5000, onAuthorization: async url => { await f.authorize(url); } })).rejects.toMatchObject({ code: 'deadline' });
    expect(f.requests.filter(r => r.body.includes('tools/list'))).toHaveLength(0);
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  } finally { clock?.mockRestore(); fetchSpy.mockRestore(); }
});

it('checks session deadline again immediately before fetch after preparing headers', async () => {
  const f = await fixture('session');
  const controller = new AbortController();
  const now = Date.now();
  const onExpiry = vi.fn(() => controller.abort('deadline'));
  const boundary = networkBoundary(new URL(f.endpoint), controller.signal, 1000, () => 'cleanup', () => {});
  boundary.setBearer('fixture-secret-access-token');
  boundary.enableScopedCalls({ environmentId: 'env', threadId: 'thread', expiresAt: now + 5000, onExpiry });
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  const headers = { get 'x-fixture'() { clock = vi.spyOn(Date, 'now').mockReturnValue(now + 6000); return 'value'; } };
  try {
    await expect(boundary.fetch(f.endpoint, { method: 'DELETE', headers })).rejects.toMatchObject({ code: 'deadline' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onExpiry).toHaveBeenCalledOnce();
  } finally { boundary.dispose(); clock?.mockRestore(); fetchSpy.mockRestore(); }
});


it('enforces session lifetime while initialization is still waiting', async () => {
  const f = await fixture('slow-init-notification');
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    await expect(connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread',
      sessionTimeoutMs: 50, onAuthorization: async url => { await f.authorize(url); } })).rejects.toMatchObject({ code: 'deadline' });
    expect(f.requests.filter(r => r.body.includes('tools/list'))).toHaveLength(0);
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  } finally { fetchSpy.mockRestore(); }
});


it('checks session deadline after all request options are prepared', async () => {
  const f = await fixture('session');
  const controller = new AbortController();
  const now = Date.now();
  const onExpiry = vi.fn(() => controller.abort('deadline'));
  const boundary = networkBoundary(new URL(f.endpoint), controller.signal, 1000, () => 'cleanup', () => {});
  boundary.setBearer('fixture-secret-access-token');
  boundary.enableScopedCalls({ environmentId: 'env', threadId: 'thread', expiresAt: now + 5000, onExpiry });
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  const init = { method: 'DELETE', get cache() { clock = vi.spyOn(Date, 'now').mockReturnValue(now + 6000); return 'no-store' as const; } };
  try {
    await expect(boundary.fetch(f.endpoint, init)).rejects.toMatchObject({ code: 'deadline' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onExpiry).toHaveBeenCalledOnce();
  } finally { boundary.dispose(); clock?.mockRestore(); fetchSpy.mockRestore(); }
});


it('does not use a token whose lifetime elapsed while its response was delayed', async () => {
  const f = await fixture('token-aged');
  const later = Date.now() + 2000;
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  f.setOnToken(() => { clock = vi.spyOn(Date, 'now').mockReturnValue(later); });
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    await expect(connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', sessionTimeoutMs: 5000,
      onAuthorization: async url => { await f.authorize(url); } })).rejects.toMatchObject({ code: 'deadline' });
    expect(f.requests.filter(r => r.path === '/mcp')).toHaveLength(0);
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  } finally { clock?.mockRestore(); fetchSpy.mockRestore(); }
});

it('reports a deadline that expires during setup failure cleanup', async () => {
  const f = await fixture('server-timeout-error');
  const OriginalHeaders = globalThis.Headers;
  let serverErrorIssued = false;
  f.setOnToolsList(() => { serverErrorIssued = true; });
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  class CleanupHeaders extends OriginalHeaders {
    constructor(init?: HeadersInit) {
      super(init);
      if (serverErrorIssued && init && !(init instanceof OriginalHeaders) && !Array.isArray(init) && Object.keys(init).includes('mcp-session-id')) {
        const later = Date.now() + 60000;
        clock = vi.spyOn(Date, 'now').mockReturnValue(later);
      }
    }
  }
  vi.stubGlobal('Headers', CleanupHeaders);
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    await expect(connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', sessionTimeoutMs: 5000,
      onAuthorization: async url => { await f.authorize(url); } })).rejects.toMatchObject({ code: 'deadline' });
    expect(clock).toBeDefined();
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  } finally { clock?.mockRestore(); fetchSpy.mockRestore(); vi.unstubAllGlobals(); }
});


it('connection check rejects a token that expires during exchange', async () => {
  const f = await fixture('token-aged');
  const later = Date.now() + 2000;
  let wall: ReturnType<typeof vi.spyOn> | undefined;
  f.setOnToken(() => { wall = vi.spyOn(Date, 'now').mockReturnValue(later); });
  try {
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, onAuthorization: async url => { await f.authorize(url); } })).rejects.toMatchObject({ code: 'deadline' });
    expect(f.requests.filter(r => r.path === '/mcp')).toHaveLength(0);
  } finally { wall?.mockRestore(); }
});

it('connection check prevents sends after token expiry during initialization', async () => {
  const f = await fixture('token-aged');
  const later = Date.now() + 2000;
  let wall: ReturnType<typeof vi.spyOn> | undefined;
  f.setOnInitialized(() => { wall = vi.spyOn(Date, 'now').mockReturnValue(later); });
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    await expect(connector.checkLocalT3Connection({ endpoint: f.endpoint, onAuthorization: async url => { await f.authorize(url); } })).rejects.toMatchObject({ code: 'deadline' });
    expect(f.requests.filter(r => r.body.includes('tools/list'))).toHaveLength(0);
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  } finally { wall?.mockRestore(); fetchSpy.mockRestore(); }
});

it('does not extend a token when the wall clock moves backwards during exchange', async () => {
  const f = await fixture('token-aged');
  const earlierWall = Date.now() - 60000;
  const laterMonotonic = performance.now() + 2000;
  let wall: ReturnType<typeof vi.spyOn> | undefined;
  let monotonic: ReturnType<typeof vi.spyOn> | undefined;
  f.setOnToken(() => {
    wall = vi.spyOn(Date, 'now').mockReturnValue(earlierWall);
    monotonic = vi.spyOn(performance, 'now').mockReturnValue(laterMonotonic);
  });
  try {
    await expect(connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', sessionTimeoutMs: 5000,
      onAuthorization: async url => { await f.authorize(url); } })).rejects.toMatchObject({ code: 'deadline' });
    expect(f.requests.filter(r => r.path === '/mcp')).toHaveLength(0);
  } finally { wall?.mockRestore(); monotonic?.mockRestore(); }
});


it('fences boundary cleanup when monotonic time expires despite wall-clock rollback', async () => {
  const f = await fixture('session');
  const controller = new AbortController();
  const wallNow = Date.now();
  const monoNow = performance.now();
  const onExpiry = vi.fn(() => controller.abort('deadline'));
  const boundary = networkBoundary(new URL(f.endpoint), controller.signal, 1000, () => 'cleanup', () => {});
  boundary.setBearer('fixture-secret-access-token');
  boundary.enableScopedCalls({ environmentId: 'env', threadId: 'thread', expiresAt: wallNow + 5000,
    isExpired: () => performance.now() >= monoNow + 5000, onExpiry });
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
  let wall: ReturnType<typeof vi.spyOn> | undefined;
  let mono: ReturnType<typeof vi.spyOn> | undefined;
  const headers = { get 'x-fixture'() {
    wall = vi.spyOn(Date, 'now').mockReturnValue(wallNow - 60000);
    mono = vi.spyOn(performance, 'now').mockReturnValue(monoNow + 6000);
    return 'value';
  } };
  try {
    await expect(boundary.fetch(f.endpoint, { method: 'DELETE', headers })).rejects.toMatchObject({ code: 'deadline' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onExpiry).toHaveBeenCalledOnce();
  } finally { boundary.dispose(); wall?.mockRestore(); mono?.mockRestore(); fetchSpy.mockRestore(); }
});

it('classifies a late tool failure as deadline despite wall-clock rollback', async () => {
  const f = await fixture('call-error');
  const session = await connector.openLocalT3Session({ endpoint: f.endpoint, environmentId: 'env', threadId: 'thread', sessionTimeoutMs: 5000,
    onAuthorization: async url => { await f.authorize(url); } });
  const wallNow = Date.now();
  const monoNow = performance.now();
  let wall: ReturnType<typeof vi.spyOn> | undefined;
  let mono: ReturnType<typeof vi.spyOn> | undefined;
  f.setOnCall(() => {
    wall = vi.spyOn(Date, 'now').mockReturnValue(wallNow - 60000);
    mono = vi.spyOn(performance, 'now').mockReturnValue(monoNow + 6000);
  });
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  try {
    await expect(session.callTool('t3_thread_read', reviewReadArgs, new AbortController().signal)).rejects.toMatchObject({ code: 'deadline' });
    await expect(session.close()).rejects.toMatchObject({ code: 'cleanup_failed' });
    expect(fetchSpy.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  } finally { wall?.mockRestore(); mono?.mockRestore(); fetchSpy.mockRestore(); }
});
