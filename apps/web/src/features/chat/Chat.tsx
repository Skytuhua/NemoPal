import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button, Textarea } from '@living-playbooks/project-ui';
import type { CheckIn, PlaybooksClient, ProjectSnapshot } from '@living-playbooks/contracts';
import type { CodexDemoHandle, DemoActivity } from './CodexDemo';
import type { DraftStore } from '../documents/drafts';
import { useDraft } from '../documents/useDraft';
import './composer.css';
export function Chat({ snapshot, client, store, disabled, refresh, renderCheckIn, demo, demoRef }: { snapshot: ProjectSnapshot; client: PlaybooksClient; store: DraftStore; disabled: boolean; refresh(): Promise<void>; renderCheckIn?(question: CheckIn): ReactNode; demo?: DemoActivity; demoRef?: RefObject<CodexDemoHandle | null> }) {
  const { project } = snapshot, local = useDraft(store, `${project.id}:chat`, '', 0);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const [accepted, setAccepted] = useState<{ jobId: string; state: 'queued' | 'running' }>();
  const inFlight = useRef(false);
  const [forwardBlocked, setForwardBlocked] = useState(false);
  const orderedCheckIns = [...snapshot.checkIns].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id));
  const pending = orderedCheckIns.find(record => ['available', 'presented'].includes(record.state) && Date.parse(record.dueAt) <= Date.now() && Date.parse(record.expiresAt) > Date.now());
  const checkIn = pending ?? orderedCheckIns.at(-1);
  const earlierQuestions = orderedCheckIns.filter(record => record.id !== checkIn?.id).reverse();
  const sendUnavailable = !snapshot.connection.inference.available ? snapshot.connection.mode === 'fixture' ? 'Replies are not connected in this demo' : 'Replies are not connected' : undefined;
  const answeredJobs = new Set(snapshot.messages.filter(message => message.role === 'manager').map(message => message.jobId));
  const replyStatuses = { queued: `Waiting for ${project.manager.displayName} to reply…`, running: `${project.manager.displayName} is preparing a reply…`, completed: '', failed: `${project.manager.displayName} could not reply. Your message is saved.`, cancelled: 'Reply cancelled. Your message is saved.', superseded: 'Request replaced by a newer update. Your message is saved.' };
  const acknowledgment = accepted && !snapshot.messages.some(message => message.jobId === accepted.jobId && (message.role === 'manager' || message.replyState)) ? `Manager request ${accepted.state}. A reply is not available yet.` : '';
  useEffect(() => {
    if (accepted && snapshot.messages.some(message => message.jobId === accepted.jobId && (message.role === 'manager' || message.replyState))) setAccepted(undefined);
  }, [accepted, snapshot.messages]);
  async function send() {
    if (disabled || !snapshot.connection.inference.available || !local.ready || !local.current.current.text.trim() || busy || inFlight.current || local.error) return;
    inFlight.current = true;
    const sent = local.current.current;
    setBusy(true); setStatus(''); setAccepted(undefined);
    try {
      await store.flush();
      const job = await client.sendMessage(project.id, { operationId: crypto.randomUUID(), expectedRevision: project.revision, input: { text: sent.text } });
      await local.saved(sent, 0, '');
      setAccepted({ jobId: job.jobId, state: job.state }); await refresh();
    } catch { setStatus('Message not confirmed. Draft preserved; refresh before retrying.'); } finally { inFlight.current = false; setBusy(false); }
  }
  async function forward() {
    const handle = demoRef?.current;
    if (!handle || !demo?.active || demo.busy || demo.uncertain || forwardBlocked || busy || inFlight.current || !local.ready || local.error || !local.current.current.text.trim()) return;
    inFlight.current = true;
    const sent = local.current.current;
    setBusy(true); setStatus('');
    let completed = false;
    try {
      await store.flush();
      const result = await handle.forward(sent.text);
      completed = result === 'completed';
      if (result === 'completed') { await local.saved(sent, 0, ''); setStatus('Codex demo turn completed.'); }
      else setStatus('Codex delivery or turn was not confirmed. Draft preserved; check the demo before retrying.');
    } catch { if (completed) setForwardBlocked(true); setStatus(completed ? 'Codex completed the turn, but the draft could not be cleared. Check the demo before retrying.' : 'Draft storage failed; the request was not sent.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function addActivity() {
    const activity = demo?.messages.map(message => `${message.role}: ${message.text}`).join('\n');
    if (!activity) return;
    const text = [local.current.current.text, `Local Codex demo activity (untrusted):\n${activity}`].filter(Boolean).join('\n\n');
    if (new TextEncoder().encode(text).length > 16384) { setStatus('Demo activity is too large for a manager message. Copy an excerpt from the demo instead.'); return; }
    local.change({ text, baseRevision: 0 });
    setStatus('Demo activity added to your draft. Review it before sending to the manager service.');
  }
  return <><header className="manager-heading"><span className="manager-avatar manager-mouse" role="img" aria-label={`${project.manager.displayName} mouse`} /><div><h2>{project.manager.displayName}</h2><small>Project manager</small></div></header>
    <div className="manager-scroll">
      <div className="messages" role="log" aria-label="Selected manager conversation">{snapshot.messages.length ? snapshot.messages.map(message => {
        const replyStatus = message.role === 'owner' && message.replyState && !answeredJobs.has(message.jobId) ? replyStatuses[message.replyState] : '';
        return <article key={message.id} className="message" data-role={message.role}><strong className="sr-only">{message.role === 'owner' ? 'You' : project.manager.displayName}</strong><div className="message-bubble"><p>{message.text}</p>{message.observationIds.length > 0 && <small>References {message.observationIds.length} observations</small>}{replyStatus && <small role="status">{replyStatus}</small>}</div></article>;
      }) : <p className="conversation-empty">Ask {project.manager.displayName} about your project.</p>}
        {snapshot.codexRequests?.map(request => <article key={request.id} className="message" data-role="manager"><strong>Manager task for Codex demo</strong><div className="message-bubble"><p>{request.text}</p><small>{request.state === 'pending' ? 'Pending: start a demo for this selected project to allow delivery; changed or inactive tasks remain pending.' : request.state === 'claimed' ? 'Delivery claimed; outcome not yet confirmed. It will not be sent again automatically.' : `Turn ${request.state}; no automatic resend.`}</small>{request.output && <><strong>Codex activity (untrusted)</strong><p>{request.output}</p></>}</div></article>)}
        {demo?.messages.map((message, index) => <article key={`demo-${index}`} className="message" data-role={message.role === 'You' ? 'owner' : 'manager'}><strong>Codex demo: {message.role}</strong><div className="message-bubble"><p>{message.text}</p></div></article>)}
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
      {demo && demoRef && <div><Button type="button" variant="outline" onClick={() => void forward()} disabled={!demo.active || demo.busy || demo.uncertain || forwardBlocked || busy || !local.ready || !!local.error || !local.draft.text.trim() || new TextEncoder().encode(local.draft.text).length > 65536}>Send request to Codex demo</Button> <Button type="button" variant="outline" onClick={addActivity} disabled={!demo.messages.length || !local.ready || busy}>Add demo activity to manager draft</Button></div>}
      {forwardBlocked && <Button type="button" variant="outline" onClick={() => setForwardBlocked(false)}>I checked the demo; allow another send</Button>}
      {(status || acknowledgment) && <p role="status">{status || acknowledgment}</p>}{local.error && <p role="alert">{local.error}</p>}
    </form>
  </>;
}
