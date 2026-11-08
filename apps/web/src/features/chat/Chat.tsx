import { useState } from 'react';
import type { PlaybooksClient, ProjectSnapshot } from '@living-playbooks/contracts';
import type { DraftStore } from '../documents/drafts';
import { useDraft } from '../documents/useDraft';
import { ManagerMouse } from '../../app/Presentation';
export function Chat({ snapshot, client, store, disabled, refresh, openWorkspace }: { snapshot: ProjectSnapshot; client: PlaybooksClient; store: DraftStore; disabled: boolean; refresh(): Promise<void>; openWorkspace?(): void }) {
  const { project } = snapshot, local = useDraft(store, `${project.id}:chat`, '', 0);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('');
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
  return <><header className="surface-header"><ManagerMouse /><div><h2>{project.manager.displayName}</h2><small>Your project manager</small></div></header>
    <p className="manager-context">Here to help with <strong>{project.title}</strong>.</p>
    {!snapshot.connection.inference.available && <div className="manager-unavailable"><h3>Your manager can’t reply yet</h3><p>{disabled ? 'You can keep drafting messages. Refresh the project before saving changes.' : project.tasks.length || snapshot.documents.length ? 'You can still update tasks and write notes. Draft a message here to send when the model is available.' : 'Your project brief is saved. You can draft a message here to send when the model is available.'}</p>{openWorkspace && <button onClick={openWorkspace}>{project.tasks.length || snapshot.documents.length ? 'Go to tasks & notes' : 'Go to project'}</button>}</div>}
    <div className="messages" role="log" aria-label="Selected manager conversation">{snapshot.messages.length ? snapshot.messages.map(message => <article key={message.id}><strong>{message.role === 'owner' ? 'You' : project.manager.displayName}</strong><p>{message.text}</p>{message.observationIds.length > 0 && <small>References {message.observationIds.length} observations</small>}</article>) : <p>No messages yet. Your tasks and notes are available in Workspace.</p>}</div>
    <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}><label htmlFor="manager-message">Message to {project.manager.displayName}</label><textarea id="manager-message" placeholder="Ask a question about this project…" rows={4} value={local.draft.text} disabled={!local.ready} onChange={event => local.change({ text: event.target.value, baseRevision: 0 })} /><button disabled={disabled || !snapshot.connection.inference.available || !local.ready || !local.draft.text.trim() || busy || !!local.error}>{busy ? 'Sending…' : 'Send message'}</button>{!snapshot.connection.inference.available && <small>Sending is unavailable. Your draft stays on this device.</small>}{status && <p role="status">{status}</p>}{local.error && <p role="alert">{local.error}</p>}</form>
  </>;
}
