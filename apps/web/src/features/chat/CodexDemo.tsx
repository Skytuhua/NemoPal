import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Button, Textarea } from '@living-playbooks/project-ui';
import type { DesktopBridge } from '@living-playbooks/contracts';

export type DemoActivity = { active: boolean; busy: boolean; uncertain: boolean; messages: { role: string; text: string }[] };
export type CodexDemoHandle = { forward(text: string): Promise<'completed' | 'failed' | 'interrupted' | 'unknown'> };

export function CodexDemo({ projectId, start, send, stop, onGuardChange, onActivity, ref }: { projectId: string; start: NonNullable<DesktopBridge['startCodexDemo']>; send: NonNullable<DesktopBridge['sendCodexDemo']>; stop: NonNullable<DesktopBridge['stopCodexDemo']>; onGuardChange?: (blocked: boolean) => void; onActivity?: (activity: DemoActivity) => void; ref?: Ref<CodexDemoHandle> }) {
  const [active, setActive] = useState(false), [busy, setBusy] = useState(false), [draft, setDraft] = useState(''), [status, setStatus] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const generation = useRef(0);
  const sending = useRef(false);
  useEffect(() => { onGuardChange?.(active || busy || !!draft || uncertain); return () => onGuardChange?.(false); }, [active, busy, draft, uncertain, onGuardChange]);
  useEffect(() => { onActivity?.({ active, busy, uncertain, messages }); }, [active, busy, uncertain, messages, onActivity]);
  useEffect(() => () => { generation.current++; }, []);
  async function activate() {
    const current = ++generation.current; setBusy(true); setStatus('');
    try {
      const result = await start(projectId);
      if (current !== generation.current) return;
      if (result === 'started') { setMessages([]); setActive(true); setStatus('New local demo thread started.'); }
      else setStatus('Demo cancelled.');
    } catch { if (current === generation.current) setStatus('Demo could not start. Check the local Codex installation and try again.'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function forward(text: string, expectedGeneration = generation.current): Promise<'completed' | 'failed' | 'interrupted' | 'unknown'> {
    if (generation.current !== expectedGeneration || !active || busy || sending.current || uncertain || !text.trim() || new TextEncoder().encode(text).length > 65536) return 'failed';
    const current = generation.current; sending.current = true; setBusy(true); setStatus('Sending...');
    try {
      const result = await send({ projectId, text });
      if (current !== generation.current) return 'unknown';
      setMessages(existing => [...existing, { role: 'You', text }, ...result.replies.map(reply => ({ role: 'Codex', text: reply }))].slice(-80));
      if (result.status === 'completed') setStatus('Turn completed.');
      else if (result.status === 'unknown') { setActive(false); setUncertain(true); setStatus('Delivery is unknown; the session stopped. An approval request may have been left unanswered. Your draft is preserved; check before retrying.'); }
      else { setUncertain(true); setStatus(`Turn ${result.status}. Your draft is preserved; check the conversation before retrying.`); }
      return result.status;
    } catch { if (current === generation.current) { setActive(false); setUncertain(true); setStatus('Delivery is unknown. Your draft is preserved; check before retrying.'); } return 'unknown'; }
    finally { if (current === generation.current) { sending.current = false; setBusy(false); } }
  }
  const handleGeneration = generation.current;
  useImperativeHandle(ref, () => ({ forward: text => forward(text, handleGeneration) }));
  async function submit() {
    const text = draft;
    if (await forward(text) === 'completed') setDraft(current => current === text ? '' : current);
  }
  async function close() { const pending = sending.current; ++generation.current; sending.current = false; setActive(false); setBusy(false); setUncertain(uncertain || pending); setStatus(pending ? 'Delivery is unknown. Your draft is preserved; check before retrying.' : 'Demo stopped. This conversation is not resumed automatically.'); await stop(projectId).catch(() => {}); }
  return <>
    <div className="codex-demo-content">
      <h2>Codex local demo</h2>
      <p>A new demo-owned thread for a folder you choose. It cannot attach an existing conversation. The latest 80 messages are shown locally.</p>
      {!active ? <Button onClick={() => void activate()} disabled={busy || uncertain}>Start Codex demo</Button> : <Button variant="outline" onClick={() => void close()}>Stop demo</Button>}
      {uncertain && <Button variant="outline" onClick={() => { setUncertain(false); setStatus('Draft kept. Check the earlier conversation before sending again.'); }}>Keep draft and clear warning</Button>}
      <div role="log" aria-label="Codex demo conversation">{messages.map((message, index) => <article className="message" data-role={message.role === 'You' ? 'owner' : 'manager'} key={index}><strong>{message.role}</strong><div className="message-bubble"><p>{message.text}</p></div></article>)}</div>
    </div>
    <form className="composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor="codex-demo-message">Message to Codex</label>
      <div className="composer-input"><Textarea id="codex-demo-message" value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} rows={3} /></div>
      <Button type="submit" disabled={!active || busy || uncertain || !draft.trim() || new TextEncoder().encode(draft).length > 65536}>Send to Codex</Button>
      {status && <p role="status">{status}</p>}
    </form>
  </>;
}
