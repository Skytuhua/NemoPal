import { useEffect, useRef, useState } from 'react';
import { LocalThreadHistorySchema, LocalThreadReceiptSchema, LocalThreadSendInputSchema, type DesktopBridge, type LocalThreadHistory } from '@living-playbooks/contracts';

export function LocalThread({ bridge }: { bridge: NonNullable<DesktopBridge['localThread']> }) {
  const [history, setHistory] = useState<LocalThreadHistory>();
  const [draft, setDraft] = useState(''), [status, setStatus] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState<'read' | 'send'>(), [uncertain, setUncertain] = useState(false);
  const generation = useRef(0), pending = useRef(false), composing = useRef(false);
  useEffect(() => {
    generation.current++; pending.current = false;
    setHistory(undefined); setStatus(''); setError(''); setBusy(undefined); setUncertain(false);
    return () => { generation.current++; };
  }, [bridge]);

  async function read() {
    if (pending.current) return;
    const request = generation.current;
    pending.current = true; setBusy('read'); setStatus(''); setError('');
    try {
      const next = LocalThreadHistorySchema.parse(await bridge.read({ limit: 20 }));
      if (request !== generation.current) return;
      setHistory(next); setUncertain(false); setStatus('Read the latest messages from the configured local thread.');
    } catch {
      if (request === generation.current) setError('Local thread unavailable. Check that T3 is running and this desktop has a selected thread.');
    } finally {
      if (request === generation.current) { pending.current = false; setBusy(undefined); }
    }
  }
  async function send() {
    if (pending.current || composing.current || !history || uncertain) return;
    const input = LocalThreadSendInputSchema.safeParse({ message: draft });
    if (!input.success) { setError('Enter a message up to 16,000 UTF-8 bytes.'); return; }
    const request = generation.current, selected = history.thread.threadId;
    pending.current = true; setBusy('send'); setStatus(''); setError('');
    try {
      const result = LocalThreadReceiptSchema.parse(await bridge.send(input.data));
      if (request !== generation.current) return;
      if (result.threadId !== selected) throw Error('Thread changed');
      setDraft(''); setStatus(`Message accepted (${result.status}). Read thread to check delivery and replies.`);
    } catch {
      if (request === generation.current) {
        setUncertain(true);
        setError('Message delivery is unconfirmed and may already have been queued. Your draft is preserved. Read the thread before any manual retry.');
      }
    } finally {
      if (request === generation.current) { pending.current = false; setBusy(undefined); }
    }
  }
  return <main className="local-thread">
    <header className="surface-header"><h1>Local coding thread</h1><p>Read and message the T3 thread selected for this desktop. This connection uses local T3; the NemoPal cloud manager does not receive this transcript.</p></header>
    <div className="actions"><button disabled={!!busy} onClick={() => void read()}>{busy === 'read' ? 'Reading thread…' : 'Read thread'}</button></div>
    {history ? <section aria-label="Configured local thread">
      <h2>{history.thread.title}</h2><small>Thread status: {history.thread.status}. Latest {history.messages.length} visible messages.</small>
      <div className="messages" role="log" aria-label="Local coding thread messages">{history.messages.length ? history.messages.map((message, index) => <article key={`${message.runId ?? message.role}:${index}`}><strong>{message.role === 'user' ? 'You' : message.role}</strong><p>{message.text}</p></article>) : <p>No visible messages in the latest thread read.</p>}</div>
    </section> : <p>Read the configured thread before sending a message.</p>}
    <form className="composer" aria-label="Send to local coding thread" onSubmit={event => { event.preventDefault(); void send(); }}>
      <label htmlFor="local-thread-message">Message to local coding thread</label>
      <textarea id="local-thread-message" rows={4} maxLength={16000} value={draft} disabled={busy === 'send'} onChange={event => setDraft(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} />
      <small>Sending can start coding work with this thread's permissions. A busy thread queues the message for its next turn.</small>
      <button disabled={!history || !!busy || uncertain || !LocalThreadSendInputSchema.safeParse({ message: draft }).success}>{busy === 'send' ? 'Sending…' : 'Send to thread'}</button>
    </form>
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
  </main>;
}
