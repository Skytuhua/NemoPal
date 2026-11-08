import { useRef, useState } from 'react';
import { Button, Textarea } from '@living-playbooks/project-ui';
import type { DesktopBridge } from '@living-playbooks/contracts';

export function CodexDemo({ projectId, start, send, stop }: { projectId: string; start: NonNullable<DesktopBridge['startCodexDemo']>; send: NonNullable<DesktopBridge['sendCodexDemo']>; stop: NonNullable<DesktopBridge['stopCodexDemo']> }) {
  const [active, setActive] = useState(false), [busy, setBusy] = useState(false), [draft, setDraft] = useState(''), [status, setStatus] = useState('');
  const [messages, setMessages] = useState<{ role: string; text: string }[]>([]);
  const generation = useRef(0);
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
  async function submit() {
    if (!active || busy || !draft.trim() || new TextEncoder().encode(draft).length > 65536) return;
    const current = generation.current, text = draft; setBusy(true); setStatus('Sending…');
    try {
      const result = await send({ projectId, text });
      if (current !== generation.current) return;
      setMessages(existing => [...existing, { role: 'You', text }, ...result.replies.map(reply => ({ role: 'Codex', text: reply }))]);
      if (result.status === 'completed') { setDraft(''); setStatus('Turn completed.'); }
      else if (result.status === 'unknown') { setActive(false); setStatus('Delivery is unknown; the session stopped. An approval request may have been left unanswered. Your draft is preserved; check before retrying.'); }
      else setStatus(`Turn ${result.status}. Your draft is preserved; check the conversation before retrying.`);
    } catch { if (current === generation.current) { setActive(false); setStatus('Delivery is unknown. Your draft is preserved; check before retrying.'); } }
    finally { if (current === generation.current) setBusy(false); }
  }
  async function close() { ++generation.current; setActive(false); setBusy(false); setStatus('Demo stopped. This conversation is not resumed automatically.'); await stop(projectId).catch(() => {}); }
  return <>
    <div className="codex-demo-content">
      <h2>Codex local demo</h2>
      <p>A new demo-owned thread for a folder you choose. It cannot attach an existing conversation.</p>
      {!active ? <Button onClick={() => void activate()} disabled={busy}>Start Codex demo</Button> : <Button variant="outline" onClick={() => void close()}>Stop demo</Button>}
      <div role="log" aria-label="Codex demo conversation">{messages.map((message, index) => <article className="message" data-role={message.role === 'You' ? 'owner' : 'manager'} key={index}><strong>{message.role}</strong><div className="message-bubble"><p>{message.text}</p></div></article>)}</div>
    </div>
    <form className="composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <label htmlFor="codex-demo-message">Message to Codex</label>
      <div className="composer-input"><Textarea id="codex-demo-message" value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} rows={3} /></div>
      <Button type="submit" disabled={!active || busy || !draft.trim() || new TextEncoder().encode(draft).length > 65536}>Send to Codex</Button>
      {status && <p role="status">{status}</p>}
    </form>
  </>;
}
