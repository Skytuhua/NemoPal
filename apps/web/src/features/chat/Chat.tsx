import { useState, type ReactNode } from 'react';
import { Button, Textarea } from '@living-playbooks/project-ui';
import type { CheckIn, PlaybooksClient, ProjectSnapshot } from '@living-playbooks/contracts';
import type { DraftStore } from '../documents/drafts';
import { useDraft } from '../documents/useDraft';
import './composer.css';
export function Chat({ snapshot, client, store, disabled, refresh, renderCheckIn }: { snapshot: ProjectSnapshot; client: PlaybooksClient; store: DraftStore; disabled: boolean; refresh(): Promise<void>; renderCheckIn?(question: CheckIn): ReactNode }) {
  const { project } = snapshot, local = useDraft(store, `${project.id}:chat`, '', 0);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const orderedCheckIns = [...snapshot.checkIns].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id));
  const pending = orderedCheckIns.find(record => ['available', 'presented'].includes(record.state) && Date.parse(record.dueAt) <= Date.now() && Date.parse(record.expiresAt) > Date.now());
  const checkIn = pending ?? orderedCheckIns.at(-1);
  const earlierQuestions = orderedCheckIns.filter(record => record.id !== checkIn?.id).reverse();
  const sendUnavailable = !snapshot.connection.inference.available ? snapshot.connection.mode === 'fixture' ? 'Replies are not connected in this demo' : 'Replies are not connected' : undefined;
  async function send() {
    if (disabled || !snapshot.connection.inference.available || !local.ready || !local.current.current.text.trim() || busy || local.error) return;
    const sent = local.current.current;
    setBusy(true); setStatus('');
    try {
      await store.flush();
      const job = await client.sendMessage(project.id, { operationId: crypto.randomUUID(), expectedRevision: project.revision, input: { text: sent.text } });
      await local.saved(sent, 0, '');
      setStatus(`Manager request ${job.state}. A reply is not available yet.`); await refresh();
    } catch { setStatus('Message not confirmed. Draft preserved; refresh before retrying.'); } finally { setBusy(false); }
  }
  return <><header className="manager-heading"><span className="manager-avatar manager-mouse" role="img" aria-label={`${project.manager.displayName} mouse`} /><div><h2>{project.manager.displayName}</h2><small>Project manager</small></div></header>
    <div className="manager-scroll">
      <div className="messages" role="log" aria-label="Selected manager conversation">{snapshot.messages.length ? snapshot.messages.map(message => <article key={message.id} className="message" data-role={message.role}><strong className="sr-only">{message.role === 'owner' ? 'You' : project.manager.displayName}</strong><div className="message-bubble"><p>{message.text}</p>{message.observationIds.length > 0 && <small>References {message.observationIds.length} observations</small>}</div></article>) : <p className="conversation-empty">Ask {project.manager.displayName} about your project.</p>}
        {checkIn && renderCheckIn && <section key={checkIn.id} className="message manager-question" data-role="manager" aria-label="Manager question"><strong className="sr-only">{project.manager.displayName}</strong><div className="message-bubble">{renderCheckIn(checkIn)}</div></section>}
      </div>
      {earlierQuestions.length > 0 && renderCheckIn && <details className="question-history"><summary>Earlier questions <span>{earlierQuestions.length}</span></summary><div>{earlierQuestions.map(record => <section key={record.id} className="message manager-question" data-role="manager" aria-label="Earlier manager question"><div className="message-bubble">{renderCheckIn(record)}</div></section>)}</div></details>}
    </div>
    <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}>
      <div className="composer-input">
        <label className="sr-only" htmlFor="manager-message">Message to {project.manager.displayName}</label>
        <Textarea id="manager-message" rows={3} placeholder={`Message ${project.manager.displayName}…`} value={local.draft.text} disabled={!local.ready} onChange={event => local.change({ text: event.target.value, baseRevision: 0 })} />
        <div className="composer-actions">
          <span className="sr-only" id="manager-send-help">{sendUnavailable ? 'Replies are not connected. Your message has not been sent.' : ''}</span>
          <Button className="composer-send" size="icon" type="submit" aria-label={busy ? 'Sending message' : 'Send message'} aria-describedby="manager-send-help" title={sendUnavailable ?? (busy ? 'Sending message' : 'Send message')} disabled={disabled || !snapshot.connection.inference.available || !local.ready || !local.draft.text.trim() || busy || !!local.error}>
            <svg className={busy ? 'send-pending' : undefined} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{busy ? <circle cx="12" cy="12" r="8" strokeDasharray="36 14" /> : <path d="M12 19V5m-6 6 6-6 6 6" />}</svg>
          </Button>
        </div>
      </div>
      {status && <p role="status">{status}</p>}{local.error && <p role="alert">{local.error}</p>}
    </form>
  </>;
}
