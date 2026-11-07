import * as c from '@living-playbooks/contracts';
import { ClientError, CursorExpiredError } from './errors';

export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MAX_EVENT_BYTES = 16 * 1024;
type Parser<T> = { parse(value: unknown): T };

export interface HttpClientOptions {
  origin: string;
  /** Desktop credentials belong in main, never in a renderer or preload bridge. */
  getAuthorization?: () => string | undefined | Promise<string | undefined>;
  fetch?: typeof globalThis.fetch;
  /** Explicit local development only; accepts localhost, 127.0.0.1, and ::1. */
  allowInsecureLoopback?: boolean;
}

export function parseContract<T>(schema: Parser<T>, value: unknown, direction: 'input' | 'response' = 'input'): T {
  try { return schema.parse(value); }
  catch { throw new ClientError(direction === 'input' ? 'invalid_command' : 'invalid_response', direction === 'input' ? 'The command does not match the Playbooks contract.' : 'The API response does not match the Playbooks contract.'); }
}

function abortIfNeeded(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Request aborted.', 'AbortError');
}

export function createHttpClient(options: HttpClientOptions): c.PlaybooksClient {
  let base: URL;
  try { base = new URL(options.origin); }
  catch { throw new ClientError('configuration', 'Configure a valid Playbooks API origin.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback && options.allowInsecureLoopback === true)) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new ClientError('configuration', 'The API requires an HTTPS origin or explicitly enabled loopback development.');
  }
  if (options.getAuthorization && typeof window !== 'undefined') throw new ClientError('configuration', 'Authorization callbacks are restricted to the desktop main process.');
  const fetcher = options.fetch ?? globalThis.fetch;
  if (!fetcher) throw new ClientError('configuration', 'A Fetch implementation is required.');

  async function open(path: string, method: string, body?: unknown, signal?: AbortSignal, events = false): Promise<Response> {
    abortIfNeeded(signal);
    const headers = new Headers({ Accept: events ? 'text/event-stream' : 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.getAuthorization) {
      let authorization: string | undefined;
      try { authorization = await options.getAuthorization(); }
      catch { throw new ClientError('authorization', 'Unable to obtain Playbooks authorization.'); }
      if (authorization) {
        try { headers.set('Authorization', authorization); }
        catch { throw new ClientError('authorization', 'Unable to obtain Playbooks authorization.'); }
      }
    }
    abortIfNeeded(signal);
    let response: Response;
    try {
      response = await fetcher(new URL(path, base), { method, headers, redirect: 'error', credentials: 'omit', cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) });
    } catch {
      abortIfNeeded(signal);
      throw new ClientError('network', 'Unable to reach the Playbooks API.');
    }
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => {});
      throw new ClientError('redirect', 'The Playbooks API must not redirect requests.');
    }
    if (!response.ok) {
      if (events && [409, 410].includes(response.status)) {
        await response.body?.cancel().catch(() => {});
        throw new CursorExpiredError();
      }
      const apiError = parseContract(c.ApiErrorSchema, await readJson(response, signal), 'response');
      const failures: Record<number, [string, string]> = {
        401: ['unauthorized', 'Playbooks authorization is missing or expired.'],
        403: ['forbidden', 'This Playbooks operation is not permitted.'],
        404: ['not_found', 'The requested Playbooks record is unavailable.'],
        409: ['conflict', 'The command conflicts with current state. Refresh before retrying.'],
        422: ['invalid_command', 'The API rejected the command contract.'],
        429: ['rate_limited', 'Playbooks usage is temporarily limited.'],
        503: ['unavailable', 'A required Playbooks dependency is unavailable.'],
      };
      const [code, message] = failures[response.status] ?? ['http', 'The Playbooks API request failed.'];
      throw new ClientError(code, message, response.status, apiError);
    }
    const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (mediaType !== (events ? 'text/event-stream' : 'application/json')) {
      await response.body?.cancel().catch(() => {});
      throw new ClientError('invalid_response', 'The API returned an unsupported response format.');
    }
    return response;
  }

  async function readJson(response: Response, signal?: AbortSignal): Promise<unknown> {
    if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
      await response.body?.cancel().catch(() => {});
      throw new ClientError('invalid_response', 'The API returned an unsupported response format.');
    }
    const length = Number(response.headers.get('content-length'));
    if (length > MAX_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => {});
      throw new ClientError('response_limit', 'The API response exceeded the byte limit.');
    }
    if (!response.body) throw new ClientError('invalid_response', 'The API returned an empty response.');
    const reader = response.body.getReader();
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancel, { once: true });
    let size = 0;
    let text = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      while (true) {
        abortIfNeeded(signal);
        const chunk = await reader.read();
        abortIfNeeded(signal);
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new ClientError('response_limit', 'The API response exceeded the byte limit.');
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text) as unknown;
    } catch (error) {
      abortIfNeeded(signal);
      if (error instanceof ClientError) throw error;
      throw new ClientError('invalid_response', 'The API returned an unreadable response.');
    } finally {
      signal?.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  async function request<T>(path: string, method: string, schema: Parser<T>, body?: unknown, signal?: AbortSignal): Promise<T> {
    return parseContract(schema, await readJson(await open(path, method, body, signal), signal), 'response');
  }

  const id = (value: string) => parseContract(c.IdSchema, value);
  async function command<I, O>(path: string, method: string, input: unknown, inputSchema: Parser<I>, outputSchema: Parser<O>, matchesResource?: (result: O, body: I) => boolean): Promise<O> {
    const body = parseContract(inputSchema, input);
    const requestHash = await c.hashCommand(path, body);
    const result = await request(path, method, outputSchema, body);
    const receipt = result && typeof result === 'object' && 'receipt' in result ? result.receipt : result;
    if (!receipt || typeof receipt !== 'object' || !('operationId' in receipt) || !('requestHash' in receipt) || receipt.operationId !== (body as c.CommandEnvelope<unknown>).operationId || receipt.requestHash !== requestHash) throw new ClientError('invalid_response', 'The API returned a receipt for another command.');
    if (matchesResource && !matchesResource(result, body)) throw new ClientError('invalid_response', 'The API returned a receipt for another resource.');
    return result;
  }

  return {
    listProjects: signal => request('/v1/projects', 'GET', c.ProjectSummarySchema.array().max(1000), undefined, signal),
    createProject: input => command('/v1/projects', 'POST', input, c.commandEnvelopeSchema(c.CreateProjectInputSchema), c.AcceptedJobSchema),
    async getSnapshot(projectId, signal) {
      const result = await request(`/v1/projects/${id(projectId)}/snapshot`, 'GET', c.ProjectSnapshotSchema, undefined, signal);
      if (result.project.id !== projectId) throw new ClientError('invalid_response', 'The API returned another project snapshot.');
      return result;
    },
    sendMessage: (projectId, input) => command(`/v1/projects/${id(projectId)}/messages`, 'POST', input, c.revisionedCommandSchema(c.MessageInputSchema), c.AcceptedJobSchema),
    applyAction: (projectId, input) => command(`/v1/projects/${id(projectId)}/actions`, 'POST', input, c.revisionedCommandSchema(c.OwnerActionSchema), c.commandReceiptSchema(c.ProjectSchema), output => output.result.id === projectId),
    saveDocument: (projectId, documentId, input) => command(`/v1/projects/${id(projectId)}/documents/${id(documentId)}`, 'PUT', input, c.revisionedCommandSchema(c.DocumentInputSchema), c.commandReceiptSchema(c.DocumentDraftSchema), output => output.result.id === documentId && output.result.projectId === projectId),
    answerCheckIn: (checkInId, input) => command(`/v1/checkins/${id(checkInId)}/answer`, 'POST', input, c.revisionedCommandSchema(c.CheckInAnswerSchema), c.commandReceiptSchema(c.CheckInSchema), output => output.result.id === checkInId),
    snoozeCheckIn: (checkInId, input) => command(`/v1/checkins/${id(checkInId)}/snooze`, 'POST', input, c.revisionedCommandSchema(c.SnoozeInputSchema), c.commandReceiptSchema(c.CheckInSchema), output => output.result.id === checkInId),
    cancelCheckIn: (checkInId, input) => command(`/v1/checkins/${id(checkInId)}/cancel`, 'POST', input, c.revisionedCommandSchema(c.EmptyInputSchema), c.commandReceiptSchema(c.CheckInSchema), output => output.result.id === checkInId),
    presentCheckIn: (checkInId, input) => command(`/v1/checkins/${id(checkInId)}/presented`, 'POST', input, c.commandEnvelopeSchema(c.PresentationInputSchema), c.commandReceiptSchema(c.CheckInSchema), output => output.result.id === checkInId),
    enrollSource: (projectId, input) => command(`/v1/projects/${id(projectId)}/sources`, 'POST', input, c.revisionedCommandSchema(c.EnrollSourceInputSchema), c.commandReceiptSchema(c.SourceBindingSchema), output => output.result.projectId === projectId),
    setSourceState: (bindingId, input) => command(`/v1/sources/${id(bindingId)}/state`, 'POST', input, c.commandEnvelopeSchema(c.SourceStateInputSchema), c.commandReceiptSchema(c.SourceBindingSchema), output => output.result.id === bindingId),
    revokeSource: (bindingId, input) => command(`/v1/sources/${id(bindingId)}/revoke`, 'POST', input, c.commandEnvelopeSchema(c.RevokeSourceInputSchema), c.commandReceiptSchema(c.SourceBindingSchema), output => output.result.id === bindingId),
    ingestObservations: (bindingId, input) => command(`/v1/sources/${id(bindingId)}/observations`, 'POST', input, c.commandEnvelopeSchema(c.IngestObservationsInputSchema), c.commandReceiptSchema(c.IngestionResultSchema), (output, body) => {
      const submitted = new Set(body.input.observations.map(observation => observation.id));
      const acknowledged = [...output.result.acceptedIds, ...output.result.duplicateIds];
      return acknowledged.length === submitted.size && new Set(acknowledged).size === acknowledged.length && acknowledged.every(observationId => submitted.has(observationId));
    }),
    reportSourceHealth: (bindingId, input) => command(`/v1/sources/${id(bindingId)}/health`, 'POST', input, c.commandEnvelopeSchema(c.SourceHealthInputSchema), c.commandReceiptSchema(c.SourceBindingSchema), output => output.result.id === bindingId),
    deleteProject: (projectId, input) => command(`/v1/projects/${id(projectId)}`, 'DELETE', input, c.revisionedCommandSchema(c.EmptyInputSchema), c.commandReceiptSchema(c.AcceptedJobSchema.shape.receipt.shape.result)),
    cancelJob: (jobId, input) => command(`/v1/jobs/${id(jobId)}/cancel`, 'POST', input, c.commandEnvelopeSchema(c.EmptyInputSchema), c.commandReceiptSchema(c.AcceptedJobSchema.shape.receipt.shape.result)),
    async subscribe(after, onEvent, signal) {
      parseContract(c.RevisionSchema, after);
      const response = await open(`/v1/events?after=${after}`, 'GET', undefined, signal, true);
      if (!response.body) throw new ClientError('invalid_response', 'The event stream is unavailable.');
      const reader = response.body.getReader();
      const cancel = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', cancel, { once: true });
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let pending = '';
      let frameBytes = 0;
      let data: string[] = [];
      let eventType = '';
      let lastSequence = after;
      const line = (value: string) => {
        frameBytes += c.utf8Bytes(value) + 1;
        if (frameBytes > MAX_EVENT_BYTES) throw new ClientError('event_limit', 'An API event exceeded the byte limit.');
        if (value === '') {
          if (eventType === 'cursor_expired' || eventType === 'cursor-expired') throw new CursorExpiredError();
          if (data.length) {
            let raw: unknown;
            try { raw = JSON.parse(data.join('\n')); }
            catch { throw new ClientError('invalid_response', 'The API returned an unreadable event.'); }
            const event = parseContract(c.ProjectEventSchema, raw, 'response');
            if (event.seq > lastSequence) { lastSequence = event.seq; onEvent(event); }
          }
          frameBytes = 0; data = []; eventType = '';
          return;
        }
        const colon = value.indexOf(':');
        const field = colon < 0 ? value : value.slice(0, colon);
        const content = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /, '');
        if (field === 'data') data.push(content);
        if (field === 'event') eventType = content;
      };
      try {
        while (true) {
          abortIfNeeded(signal);
          const chunk = await reader.read();
          abortIfNeeded(signal);
          if (chunk.done) break;
          pending += decoder.decode(chunk.value, { stream: true });
          let newline: number;
          while ((newline = pending.search(/[\r\n]/)) >= 0) {
            if (pending[newline] === '\r' && newline === pending.length - 1) break;
            const width = pending[newline] === '\r' && pending[newline + 1] === '\n' ? 2 : 1;
            line(pending.slice(0, newline));
            pending = pending.slice(newline + width);
          }
          if (frameBytes + c.utf8Bytes(pending) > MAX_EVENT_BYTES) throw new ClientError('event_limit', 'An API event exceeded the byte limit.');
        }
        pending += decoder.decode();
        if (pending.endsWith('\r')) line(pending.slice(0, -1));
        // SSE requires a blank line to dispatch; an incomplete final frame is discarded.
      } catch (error) {
        abortIfNeeded(signal);
        if (error instanceof ClientError) throw error;
        throw new ClientError('invalid_response', 'The API event stream could not be read.');
      } finally {
        signal.removeEventListener('abort', cancel);
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    },
  };
}
