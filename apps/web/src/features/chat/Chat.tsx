import { useState } from 'react';
import { Button, Textarea } from '@living-playbooks/project-ui';
import type { PlaybooksClient, ProjectSnapshot } from '@living-playbooks/contracts';
import type { DraftStore } from '../documents/drafts';
import { useDraft } from '../documents/useDraft';
export function Chat({ snapshot, client, store, disabled, refresh, openCheckIn }: { snapshot: ProjectSnapshot; client: PlaybooksClient; store: DraftStore; disabled: boolean; refresh(): Promise<void>; openCheckIn?(id: string): void }) {
  const { project } = snapshot, local = useDraft(store, `${project.id}:chat`, '', 0);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const pending = snapshot.checkIns.find(record => ['available', 'presented'].includes(record.state) && Date.parse(record.expiresAt) > Date.now());
  async function send() {
    const sent = local.current.current;
    setBusy(true); setStatus('');
    try {
      await store.flush();
      const job = await client.sendMessage(project.id, { operationId: crypto.randomUUID(), expectedRevision: project.revision, input: { text: sent.text } });
      await local.saved(sent, 0, '');
      setStatus(`Manager request ${job.state}. A reply is not available yet.`); await refresh();
    } catch { setStatus('Message not confirmed. Draft preserved; refresh before retrying.'); } finally { setBusy(false); }
  }
  return <><header className="manager-heading"><span className="manager-avatar" role="img" aria-label="Manager bot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="4" y="7" width="16" height="13" rx="4" /><path d="M12 3v4M2 12v4m20-4v4M8 15h.01M16 15h.01M9 18h6" strokeLinecap="round" /></svg></span><div><h2>{project.manager.displayName}</h2><small>Project manager</small></div></header>
    <div className="manager-scroll">
      {pending && openCheckIn && <section className="manager-checkin" aria-label="Current check-in"><span>Needs your answer</span><Button variant="outline" size="sm" onClick={() => openCheckIn(pending.id)}>Open check-in</Button></section>}
      <div className="messages" role="log" aria-label="Selected manager conversation">{snapshot.messages.length ? snapshot.messages.map(message => <article key={message.id}><strong>{message.role === 'owner' ? 'You' : project.manager.displayName}</strong><p>{message.text}</p>{message.observationIds.length > 0 && <small>References {message.observationIds.length} observations</small>}</article>) : <p>No messages yet.</p>}</div>
    </div>
    <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}><label htmlFor="manager-message">Message to {project.manager.displayName}</label><Textarea id="manager-message" rows={3} placeholder={`Write to ${project.manager.displayName}…`} value={local.draft.text} disabled={!local.ready} onChange={event => local.change({ text: event.target.value, baseRevision: 0 })} /><div className="composer-bottom"><small>{snapshot.connection.inference.available ? 'Your project conversation' : 'Replies unavailable · draft kept locally'}</small><Button disabled={disabled || !snapshot.connection.inference.available || !local.ready || !local.draft.text.trim() || busy || !!local.error}>{busy ? 'Sending…' : 'Send message'}</Button></div>{status && <p role="status">{status}</p>}{local.error && <p role="alert">{local.error}</p>}</form>
  </>;
}
