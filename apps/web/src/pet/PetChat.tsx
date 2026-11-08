import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, Textarea } from '@living-playbooks/project-ui';
import { AcceptedJobSchema, PetChatStateSchema, utf8Bytes, type CheckInAnswer, type PetChatBridge, type PetChatCommand, type PetChatState, type SnoozeInput } from '@living-playbooks/contracts';
import { createDraftStore, type DraftStore } from '../features/documents/drafts';
import { useDraft } from '../features/documents/useDraft';
import { Question } from '../features/checkins/Question';
import { PetChatSession, type PendingPetMessage } from './pet-chat-session';
import './pet-chat.css';

export function PetChat({ bridge, store: suppliedStore }: { bridge?: PetChatBridge; store?: DraftStore }) {
  const store = useMemo(() => suppliedStore ?? createDraftStore(), [suppliedStore]);
  const operations = useMemo(() => {
    const pending = new Set<Promise<unknown>>();
    return { track<T>(run: () => Promise<T>): Promise<T> { const task = run(); pending.add(task); void task.finally(() => pending.delete(task)).catch(() => {}); return task; }, async settle() { await Promise.allSettled([...pending]); } };
  }, []);
  const [state, setState] = useState<PetChatState>(), [error, setError] = useState('');
  const latest = useRef<PetChatState | undefined>(undefined);
  const retryDraft = useRef<(() => Promise<void>) | undefined>(undefined);
  useEffect(() => {
    latest.current = undefined; setState(undefined);
    if (!bridge) return;
    let active = true;
    const receive = (raw: PetChatState) => {
      if (!active) return;
      const parsed = PetChatStateSchema.safeParse(raw);
      if (!parsed.success) { setError('Conversation state unavailable. Close and reopen to refresh.'); return; }
      if (latest.current && parsed.data.version <= latest.current.version) return;
      latest.current = parsed.data; setState(parsed.data); setError('');
    };
    const unsubscribe = bridge.onEvent(receive);
    void bridge.read().then(receive).catch(() => { if (active) setError('Conversation unavailable. Close and reopen to refresh.'); });
    return () => { active = false; unsubscribe(); };
  }, [bridge]);
  useEffect(() => {
    if (!bridge || !state?.flushRequestId) return;
    const flushId = state.flushRequestId, contextId = state.contextId;
    let active = true;
    void (async () => {
      let succeeded = true;
      try {
        await operations.settle();
        try { await store.flush(); } catch { await retryDraft.current?.(); await store.retryFailed?.(); await store.flush(); }
      } catch { succeeded = false; }
      if (active && latest.current?.contextId === contextId) await bridge.invoke({ type: 'flushed', contextId, flushId, succeeded }).catch(() => {});
    })();
    return () => { active = false; };
  }, [bridge, state?.flushRequestId, state?.contextId, store, operations]);
  const refresh = async () => {
    if (!bridge) return;
    const next = PetChatStateSchema.parse(await bridge.read());
    if (!latest.current || next.version > latest.current.version) { latest.current = next; setState(next); }
  };
  if (!bridge) return <main className="pet-chat-unavailable" role="status">Restricted desktop conversation bridge required.</main>;
  if (!state) return <main className="pet-chat-unavailable" role="status">{error || 'Opening conversation…'}</main>;
  return <Conversation key={state.conversation?.draftScope ?? 'unavailable'} bridge={bridge} store={store} operations={operations} retryDraft={retryDraft} state={state} current={() => latest.current} refresh={refresh} bridgeError={error} />;
}

function Conversation({ bridge, store, operations, retryDraft, state, current, refresh, bridgeError }: { bridge: PetChatBridge; store: DraftStore; operations: { track<T>(run: () => Promise<T>): Promise<T> }; retryDraft: React.RefObject<(() => Promise<void>) | undefined>; state: PetChatState; current(): PetChatState | undefined; refresh(): Promise<void>; bridgeError: string }) {
  const composerId = useId();
  const conversation = state.conversation;
  const session = useMemo(() => new PetChatSession(store, conversation?.draftScope ?? 'unavailable'), [store, conversation?.draftScope]);
  const failedDraftWrite = useRef(false);
  const draftStore = useMemo<DraftStore>(() => {
    let sequence = 0;
    return {
      ...store,
      async write(key, value) {
        const operation = ++sequence;
        try { await store.write(key, value); if (sequence === operation) failedDraftWrite.current = false; }
        catch (error) { if (sequence === operation) failedDraftWrite.current = true; throw error; }
      },
      async remove(key) { ++sequence; failedDraftWrite.current = false; await store.remove(key); },
    };
  }, [store]);
  const local = useDraft(draftStore, session.draftKey, '', 0);
  useEffect(() => {
    const retry = async () => {
      if (!failedDraftWrite.current || !local.ready) return;
      await local.retry();
    };
    retryDraft.current = retry;
    return () => { if (retryDraft.current === retry) retryDraft.current = undefined; };
  }, [draftStore, session, local.ready, retryDraft]);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState(''), [pending, setPending] = useState<PendingPetMessage>();
  const [resolving, setResolving] = useState(false);
  const [phase, setPhase] = useState('open'), [closing, setClosing] = useState(false);
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const composer = useRef<HTMLTextAreaElement>(null), closeButton = useRef<HTMLButtonElement>(null), composing = useRef(false), lifetime = useRef(true), sending = useRef(false);
  const focusContext = useRef('');
  const questionOperation = useRef<Extract<PetChatCommand, { type: 'answer' | 'snooze' }> | undefined>(undefined);
  const active = state.visible && !closing && !state.flushRequestId;
  const reducedMotion = state.reducedMotion || systemReducedMotion;
  useEffect(() => {
    lifetime.current = true; let active = true;
    void session.load().then(() => { if (active) { setPending(session.pending); setReady(true); if (session.pending) setStatus('Message not confirmed. Refresh status before retrying.'); } }).catch(() => { if (active) setError('Draft storage unavailable. Copy your work before leaving.'); });
    return () => { active = false; lifetime.current = false; void store.flush().catch(() => {}); };
  }, [session, store]);
  useEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const change = () => setSystemReducedMotion(media.matches); media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => { setClosing(false); }, [state.contextId]);
  useEffect(() => {
    setPhase(active ? (reducedMotion ? 'open' : 'opening') : (reducedMotion ? 'closed' : 'closing'));
    if (reducedMotion) return;
    const timer = setTimeout(() => setPhase(active ? 'open' : 'closed'), active ? 180 : 130);
    return () => clearTimeout(timer);
  }, [active, reducedMotion]);
  useEffect(() => {
    if (active && local.ready && ready && focusContext.current !== state.contextId) { focusContext.current = state.contextId; (conversation ? composer.current : closeButton.current)?.focus(); }
  }, [active, local.ready, ready, state.contextId, conversation]);

  async function acknowledge(operation: PendingPetMessage) {
    const draft = local.current.current;
    if (draft.text === operation.sent.text && draft.baseRevision === operation.sent.baseRevision) await local.saved(draft, draft.baseRevision, '');
    await session.complete(operation);
    if (lifetime.current) { setPending(session.pending); setStatus('Request accepted. A reply is not available yet.'); }
  }
  useEffect(() => {
    if (!ready || !local.ready || !pending || !active || sending.current) return;
    if (conversation?.messages.some(message => message.role === 'owner' && message.operationId === pending.command.operationId)) {
      sending.current = true;
      void operations.track(() => acknowledge(pending)).catch(() => setError('Draft could not be persisted. Copy your work before leaving.')).finally(() => { sending.current = false; });
    }
  }, [ready, local.ready, pending, active, conversation?.messages]);
  function send(retry = false) { return operations.track(() => performSend(retry)); }
  async function performSend(retry = false) {
    const context = current();
    if (sending.current || !active || !context?.conversation || !context.visible || context.contextId !== state.contextId || !context.conversation.connected || !context.conversation.inference.available) return;
    sending.current = true; setBusy(true); setError(''); setStatus('');
    let operation: PendingPetMessage | undefined;
    try {
      if (retry) { operation = session.pending; await session.persistPending(); }
      else operation = await session.prepare(local.current.current, context.conversation.projectRevision);
      if (!operation) throw Error('Pending message unavailable');
      setPending(operation);
      if (current()?.contextId !== context.contextId || !current()?.visible) return;
      const receipt = AcceptedJobSchema.parse(await bridge.invoke({ type: 'send', contextId: context.contextId, command: operation.command }));
      if (!lifetime.current || current()?.contextId !== context.contextId || !current()?.visible) return;
      if (receipt.receipt.operationId !== operation.command.operationId) throw Error('Message receipt changed');
      await acknowledge(operation);
      await refresh();
    } catch {
      if (lifetime.current) {
        if (operation) setStatus('Message not confirmed. Draft preserved; refresh status before retrying.');
        else setError('Draft could not be persisted. Copy your work before leaving.');
      }
    } finally { sending.current = false; if (lifetime.current) { setBusy(false); setPending(session.pending); } }
  }
  async function resolvePending() {
    if (!pending || sending.current || !active) return;
    sending.current = true; setBusy(true);
    try { await operations.track(() => session.complete(pending)); if (lifetime.current) { setPending(session.pending); setResolving(false); setStatus('Unconfirmed request resolved. Your draft is still here.'); } }
    catch { if (lifetime.current) setError('Draft could not be persisted. Copy your work before leaving.'); }
    finally { sending.current = false; if (lifetime.current) setBusy(false); }
  }
  const canSend = !!conversation?.connected && conversation.inference.available && ready && local.ready && !busy && !pending && !error && !local.error && !bridgeError && !!local.draft.text.trim() && utf8Bytes(local.draft.text) <= 16384;
  const question = conversation?.checkIn;
  async function updateQuestion(type: 'answer' | 'snooze', input: CheckInAnswer | SnoozeInput) {
    if (!question) return;
    const contextId = state.contextId, previous = questionOperation.current;
    const sameQuestion = previous?.checkInId === question.id && previous.presentationId === question.presentationId && previous.command.expectedRevision === question.revision;
    if (sameQuestion && (previous.type !== type || JSON.stringify(previous.command.input) !== JSON.stringify(input))) throw Error('Previous question response unconfirmed; refresh first');
    const command = sameQuestion ? { ...previous, contextId } : { type, contextId, checkInId: question.id, presentationId: question.presentationId, command: { operationId: crypto.randomUUID(), expectedRevision: question.revision, input } } as Extract<PetChatCommand, { type: 'answer' | 'snooze' }>;
    questionOperation.current = command;
    try { await bridge.invoke(command); }
    catch (error) { if (current()?.contextId === contextId && current()?.visible) throw error; return; }
    if (current()?.contextId !== contextId || !current()?.visible) return;
    questionOperation.current = undefined;
    await refresh();
  }
  async function close() {
    if (!active) return;
    setClosing(true);
    try { await bridge.invoke({ type: 'close', contextId: state.contextId }); }
    catch { if (lifetime.current) { setClosing(false); setError('Conversation could not close. Try again.'); } }
  }
  return <main className="pet-chat" role="dialog" aria-label="Conversation" data-phase={phase} data-reduced-motion={reducedMotion} inert={!active} aria-hidden={!active} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => {
    if (event.key === 'Escape' && !composing.current && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void close(); }
  }}>
    <header className="pet-chat-header"><span>Conversation</span><Button ref={closeButton} variant="ghost" className="pet-chat-icon" aria-label="Close conversation" title="Close conversation" onClick={() => void close()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg></Button><Button variant="ghost" className="pet-chat-icon" aria-label={state.expanded ? 'Compact conversation' : 'Expand conversation'} title={state.expanded ? 'Compact conversation' : 'Expand conversation'} onClick={() => void bridge.invoke({ type: 'expand', contextId: state.contextId, expanded: !state.expanded }).catch(() => setError('Conversation could not resize. Try again.'))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={state.expanded ? 'M20 10h-6V4M14 10l6-6M4 14h6v6M10 14l-6 6' : 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7'} /></svg></Button></header>
    <div className="pet-chat-thread" tabIndex={0} aria-label="Conversation transcript">
      {!conversation ? <p role="status">{state.loading ? 'Opening conversation…' : 'Conversation unavailable. Pair this device and select a project in the workspace.'}</p> : <>
        {conversation.demoTiming && <p className="pet-chat-caption">Demo reminder timing</p>}
        <div role="log" aria-label="Project conversation">{conversation.messages.length ? conversation.messages.map(message => <article className="pet-chat-message" key={message.id}><span className="pet-chat-byline">{message.role === 'owner' ? 'You' : conversation.managerName}</span><p>{message.text}</p></article>) : <p>No messages yet.</p>}</div>
        {question && <section className="pet-chat-checkin" aria-label="Current question"><Question conversation key={`${question.id}:${question.presentationId}`} question={question} disabled={!active || !conversation.connected || !!bridgeError} answer={input => updateQuestion('answer', input)} snooze={input => updateQuestion('snooze', input)} /></section>}
      </>}
    </div>
    {conversation && <form className="pet-chat-composer" onSubmit={event => { event.preventDefault(); if (!composing.current && canSend) void send(); }}>
      <label htmlFor={composerId}>Message</label><div className="pet-chat-input-row"><Textarea ref={composer} id={composerId} rows={2} value={local.draft.text} disabled={!local.ready || !ready} onChange={event => local.change({ text: event.target.value, baseRevision: local.current.current.baseRevision + 1 })} placeholder="Write a message…" /><Button type="submit" disabled={!active || !canSend}>{busy ? 'Sending…' : 'Send'}</Button></div>
      {(!conversation.connected || !conversation.inference.available) && <p className="pet-chat-caption" role="status">{!conversation.connected ? 'Connection unavailable. Draft kept locally.' : 'Replies unavailable. Draft kept locally.'}</p>}
      {utf8Bytes(local.draft.text) > 16384 && <p role="alert">Message is too long to send. Shorten it; your draft is kept.</p>}
      {status && <p role="status">{status}</p>}
      {pending && <div className="pet-chat-recovery"><Button type="button" variant="outline" disabled={busy} onClick={() => void refresh().catch(() => setStatus('Status unavailable. The original request is still kept.'))}>Refresh status</Button><Button type="button" variant="outline" disabled={busy || !conversation.connected || !conversation.inference.available || pending.command.expectedRevision !== conversation.projectRevision} onClick={() => void send(true)}>Retry same request</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setResolving(true)}>Resolve unconfirmed request</Button></div>}
      {pending && resolving && <div><p role="status">This message may already have been sent. Check the transcript before sending it again. Resolving keeps your draft and does not resend it.</p><Button type="button" variant="outline" disabled={busy} onClick={() => void resolvePending()}>Keep draft and resolve</Button><Button type="button" variant="ghost" onClick={() => setResolving(false)}>Cancel</Button></div>}
    </form>}
    {(error || local.error || bridgeError) && <p className="pet-chat-error" role="alert">{error || local.error || bridgeError}</p>}
  </main>;
}
