import Fastify, { type FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';
import * as c from '@living-playbooks/contracts';
import { authenticate, redeem, type Principal } from '../auth/credentials';
import { Store } from '../domain/store';
import { DomainError, reject } from '../domain/errors';
import { readEvents } from './events';
import { CheckInCommands } from '../checkins/commands';
import { Messaging } from '../domain/messaging';
import { registerSendblue } from './sendblue';
import type { SendblueConfig } from '../integrations/sendblue/config';
import { claimCodexRequest, finishCodexRequest } from './codex-handoff';
export function buildServer(pool: Pool, options: {
    now?: () => Date;
    inference?: c.ProjectSnapshot['connection']['inference'];
    sendblue?: SendblueConfig;
} = {}) {
    const app = Fastify({ logger: false, bodyLimit: c.LIMITS.ingestionBytes + 8192, requestTimeout: 15000 });
    const store = new Store(pool, options.now, options.sendblue);
    const checkins = new CheckInCommands(store);
    if (options.inference)
        store.inference = options.inference;
    const principals = new WeakMap<FastifyRequest, Principal>();
    const principal = (r: FastifyRequest) => principals.get(r)!;
    registerSendblue(app, new Messaging(store), principal);
    const params = (r: FastifyRequest) => z.record(z.string(), c.IdSchema).parse(r.params);
    const id = (r: FastifyRequest) => params(r).id!;
    const path = (r: FastifyRequest) => r.url.split('?')[0]!;
    const attempts = new Map<string, {
        count: number;
        until: number;
    }>();
    const streams = new Set<() => void>();
    app.addHook('onClose', async () => { for (const close of streams)
        close(); });
    app.addHook('onRequest', async (r, reply) => {
        reply.header('Cache-Control', 'no-store');
        reply.header('X-Content-Type-Options', 'nosniff');
        if (r.headers.origin && r.headers.origin !== process.env.PUBLIC_ORIGIN)
            reject(403, 'origin_denied', 'Origin is not authorized.');
        if (r.url.startsWith('/v1/') && path(r) !== '/v1/auth/redeem')
            principals.set(r, await authenticate(pool, r.headers.authorization, store.now()));
    });
    app.setErrorHandler((error, _r, reply) => {
        if (error instanceof z.ZodError)
            return reply.code(422).send({ code: 'invalid_contract', message: 'Input does not match the shared contract.', retryable: false });
        if (error instanceof DomainError)
            return reply.code(error.status).send({ code: error.code, message: error.message, retryable: [429, 503].includes(error.status), ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }) });
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
            return reply.code(409).send({ code: 'identity_conflict', message: 'Record identity conflicts with existing state.', retryable: false });
        if (error && typeof error === 'object' && 'statusCode' in error && [400, 413, 415].includes(Number(error.statusCode)))
            return reply.code(422).send({ code: 'invalid_contract', message: 'Invalid JSON body or request size.', retryable: false });
        return reply.code(503).send({ code: 'unavailable', message: 'A required dependency is unavailable.', retryable: true });
    });
    app.get('/health/live', async () => ({ live: true }));
    app.get('/health/ready', async () => { await pool.query('SELECT 1'); return { ready: true }; });
    app.post('/v1/auth/redeem', async (r) => {
        const now = store.now().getTime();
        if (attempts.size > 1000)
            for (const [ip, value] of attempts)
                if (value.until <= now)
                    attempts.delete(ip);
        if (attempts.size >= 1000 && !attempts.has(r.ip))
            reject(429, 'rate_limit', 'Pairing rate limit reached.');
        let attempt = attempts.get(r.ip);
        if (!attempt || attempt.until <= now) {
            attempt = { count: 0, until: now + 60000 };
            attempts.set(r.ip, attempt);
        }
        if (++attempt.count > 5)
            reject(429, 'rate_limit', 'Pairing rate limit reached.');
        const input = c.PairingInputSchema.parse(r.body);
        return c.RedeemResultSchema.parse(await redeem(pool, input.code, store.now()));
    });
    app.get('/v1/projects', r => store.list(principal(r)));
    app.post('/v1/projects', r => store.createProject(principal(r), path(r), c.commandEnvelopeSchema(c.CreateProjectInputSchema).parse(r.body)));
    app.get('/v1/projects/:id/snapshot', r => store.snapshot(principal(r), id(r)));
    app.post('/v1/projects/:id/codex/claim', r => { c.EmptyInputSchema.parse(r.body); return claimCodexRequest(pool, principal(r), id(r), store.now()); });
    app.post('/v1/projects/:id/codex/:requestId/result', async r => { await finishCodexRequest(pool, principal(r), id(r), params(r).requestId!, c.CodexResultSchema.parse(r.body), store.now()); return { recorded: true }; });
    app.post('/v1/projects/:id/actions', r => store.action(principal(r), path(r), id(r), c.revisionedCommandSchema(c.OwnerActionSchema).parse(r.body)));
    app.post('/v1/projects/:id/messages', r => store.message(principal(r), path(r), id(r), c.revisionedCommandSchema(c.MessageInputSchema).parse(r.body)));
    app.put('/v1/projects/:id/documents/:documentId', r => store.document(principal(r), path(r), id(r), params(r).documentId!, c.revisionedCommandSchema(c.DocumentInputSchema).parse(r.body)));
    app.delete('/v1/projects/:id', r => store.delete(principal(r), path(r), id(r), c.revisionedCommandSchema(c.EmptyInputSchema).parse(r.body)));
    app.post('/v1/projects/:id/sources', r => store.enroll(principal(r), path(r), id(r), c.revisionedCommandSchema(c.EnrollSourceInputSchema).parse(r.body)));
    app.post('/v1/sources/:id/state', r => store.sourceCommand(principal(r), path(r), id(r), c.commandEnvelopeSchema(c.SourceStateInputSchema).parse(r.body), 'state'));
    app.post('/v1/sources/:id/revoke', r => store.sourceCommand(principal(r), path(r), id(r), c.commandEnvelopeSchema(c.RevokeSourceInputSchema).parse(r.body), 'revoke'));
    app.post('/v1/sources/:id/health', r => store.sourceCommand(principal(r), path(r), id(r), c.commandEnvelopeSchema(c.SourceHealthInputSchema).parse(r.body), 'health'));
    app.post('/v1/sources/:id/observations', r => store.sourceCommand(principal(r), path(r), id(r), c.commandEnvelopeSchema(c.IngestObservationsInputSchema).parse(r.body), 'observations'));
    app.post('/v1/jobs/:id/cancel', r => store.cancelJob(principal(r), path(r), id(r), c.commandEnvelopeSchema(c.EmptyInputSchema).parse(r.body)));
    app.post('/v1/checkins/:id/presented', r => checkins.apply(principal(r), path(r), id(r), c.commandEnvelopeSchema(c.PresentationInputSchema).parse(r.body), 'presented'));
    app.post('/v1/checkins/:id/answer', r => checkins.apply(principal(r), path(r), id(r), c.revisionedCommandSchema(c.CheckInAnswerSchema).parse(r.body), 'answer'));
    app.post('/v1/checkins/:id/snooze', r => checkins.apply(principal(r), path(r), id(r), c.revisionedCommandSchema(c.SnoozeInputSchema).parse(r.body), 'snooze'));
    app.post('/v1/checkins/:id/cancel', r => checkins.apply(principal(r), path(r), id(r), c.revisionedCommandSchema(c.EmptyInputSchema).parse(r.body), 'cancel'));
    app.get('/v1/events', async (r, reply) => {
        const after = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse((r.query as {
            after?: unknown;
        }).after ?? 0);
        let cursor = after;
        const initial = await readEvents(pool, principal(r), cursor, store.now());
        reply.hijack();
        reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        const write = (events: c.ProjectEvent[]) => { for (const event of events) {
            if (reply.raw.writableLength > 65536) {
                close();
                return;
            }
            reply.raw.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
            cursor = event.seq;
        } };
        let busy = false;
        const timer = setInterval(() => { if (busy)
            return; busy = true; void readEvents(pool, principal(r), cursor, store.now()).then(events => { write(events); if (!reply.raw.destroyed)
            reply.raw.write(': heartbeat\n\n'); }).catch(() => close()).finally(() => { busy = false; }); }, 1000);
        const close = () => { clearInterval(timer); streams.delete(close); reply.raw.end(); };
        streams.add(close);
        reply.raw.on('close', close);
        write(initial);
    });
    return app;
}
