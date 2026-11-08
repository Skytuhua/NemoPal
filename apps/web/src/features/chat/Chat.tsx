import { useState } from 'react';
import type { PlaybooksClient, ProjectSnapshot, TaskStatus } from '@living-playbooks/contracts';
import type { DraftStore } from '../documents/drafts';
import { useDraft } from '../documents/useDraft';
import { ManagerMouse } from '../../app/Presentation';
import { ManagerOverview } from './ManagerOverview';
import { ManagerIcon } from './ManagerIcon';
import './manager-panel.css';

export interface ChatProps {
  snapshot: ProjectSnapshot;
  client: PlaybooksClient;
  store: DraftStore;
  disabled: boolean;
  refresh(): Promise<void>;
  openWorkspace?(): void;
  fixture?: boolean;
  openTask?: (id: string) => void;
  updateTask?: (id: string, status: TaskStatus) => void;
}

export function Chat({ snapshot, client, store, disabled, refresh, openWorkspace, fixture = false, openTask, updateTask }: ChatProps) {
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

  const inference = snapshot.connection.inference;
  const demo = fixture || snapshot.connection.mode === 'fixture';
  const chatState = snapshot.connection.sync === 'offline' ? 'Offline'
    : snapshot.connection.sync === 'stale' ? 'Refresh needed'
      : snapshot.connection.sync === 'updating' ? 'Syncing'
        : disabled ? 'Read only'
          : !inference.available ? demo ? 'Demo · draft only' : 'Draft only'
            : demo ? 'Demo chat' : 'Chat enabled';
  const chatExplanation = disabled ? 'Sending is unavailable. You can keep a local draft.'
    : !inference.available ? 'Replies are unavailable. You can keep a local draft.'
      : demo ? 'Demo workspace. No live model is connected.' : 'Messaging is available for this project.';
  // The fixture's diagnostic record is provenance, not an AI conversation.
  // Never hide owner messages or apply this filter to a live conversation.
  const messages = demo ? snapshot.messages.filter(message => message.role !== 'manager' || message.text !== 'This is a synthetic fixture. No live model has run.') : snapshot.messages;

  return <div className="manager-desk">
    <header className="manager-heading">
      <h2>Project manager</h2>
      <span className="manager-chat-state" id="manager-chat-state" aria-label="Manager chat status" title={chatExplanation}><ManagerIcon name="message" />{chatState}</span>
    </header>

    <div className="manager-identity">
      <div className="manager-avatar"><ManagerMouse /></div>
      <div><h3>{project.manager.displayName}</h3><p>Your project manager</p></div>
    </div>

    <div className="manager-scroll">
      <ManagerOverview project={project} disabled={disabled || busy} openTask={openTask} updateTask={updateTask} openWorkspace={openWorkspace} />
      <section className="manager-conversation" aria-label="Conversation">
        <h3>Conversation</h3>
        <div className="manager-messages" role="log" aria-label="Selected manager conversation" tabIndex={0}>
          {messages.length ? messages.map(message => <article key={message.id} className={`manager-message manager-message-${message.role}`}>
            <strong>{message.role === 'owner' ? 'You' : project.manager.displayName}</strong>
            <p>{message.text}</p>
            {message.observationIds.length > 0 && <small>References {message.observationIds.length} observations</small>}
          </article>) : <p className="manager-conversation-empty">No messages yet.</p>}
        </div>
      </section>
    </div>

    <form className="manager-composer" aria-busy={busy} onSubmit={event => { event.preventDefault(); void send(); }}>
      <label htmlFor="manager-message">Message to {project.manager.displayName}</label>
      <div className="manager-composer-field">
        <textarea id="manager-message" placeholder="Ask about this project…" aria-describedby="manager-chat-state" rows={2} value={local.draft.text} disabled={!local.ready} onChange={event => local.change({ text: event.target.value, baseRevision: 0 })} />
        <div className="manager-composer-toolbar">
          <small>Local draft</small>
          <button type="submit" aria-label={busy ? 'Sending…' : 'Send message'} disabled={disabled || !snapshot.connection.inference.available || !local.ready || !local.draft.text.trim() || busy || !!local.error}>{busy ? 'Sending…' : 'Send'}<ManagerIcon name="send" /></button>
        </div>
      </div>
      {status && <p className="manager-send-status" role="status">{status}</p>}
      {local.error && <p className="manager-draft-error" role="alert">{local.error}</p>}
    </form>
  </div>;
}
