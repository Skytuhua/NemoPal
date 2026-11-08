import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { commandEnvelopeSchema, CreateProjectInputSchema, ProjectSummarySchema, SafeDesktopEventSchema, type CheckIn, type DesktopBridge, type DocumentDraft, type OwnerAction, type PlaybooksClient, type ProjectSnapshot, type ProjectSummary, type WorkspaceSpec } from '@living-playbooks/contracts';
import { Button, Input, Textarea, WorkspaceCatalog } from '@living-playbooks/project-ui';
import { DesktopWorkspaceShell, type DesktopShellHandle } from './DesktopWorkspaceShell';
import type { DraftStore } from '../features/documents/drafts';
import { DocumentEditor } from '../features/documents/DocumentEditor';
import { Chat } from '../features/chat/Chat';
import { Question } from '../features/checkins/Question';
import { SourceControls } from '../features/sources/SourceControls';
import { validateSnapshot } from './snapshots';
import { useDraft } from '../features/documents/useDraft';

export function App({ client, drafts, bridge, fixture = false }: { client: PlaybooksClient; drafts: DraftStore; bridge?: DesktopBridge; fixture?: boolean }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]), [selected, setSelected] = useState<string>();
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>(), [layout, setLayout] = useState<WorkspaceSpec>();
  const [loading, setLoading] = useState(true), [updating, setUpdating] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [rejected, setRejected] = useState(false), [connected, setConnected] = useState<boolean>();
  const [filter, setFilter] = useState(''), [settingsOpen, setSettingsOpen] = useState(false);
  const shell = useRef<DesktopShellHandle>(null);
  const [inspectedTask, setInspectedTask] = useState<string>(), [inspectorId] = useState(() => crypto.randomUUID());
  const titleDraft = useDraft(drafts, 'new-project:title', '', 0), briefDraft = useDraft(drafts, 'new-project:brief', '', 0);
  const pendingCreation = useDraft(drafts, 'new-project:pending', '', 0);
  const title = titleDraft.draft.text, brief = briefDraft.draft.text;
  const currentId = useRef<string | undefined>(undefined), ticket = useRef(0), activeSnapshot = useRef<ProjectSnapshot | undefined>(undefined), editing = useRef(false);
  const lastLayout = useRef<WorkspaceSpec | undefined>(undefined), live = useRef(true), projectListTicket = useRef(0);
  const heldDocuments = useRef<DocumentDraft[]>([]);
  const list = useCallback(async () => {
    const request = ++projectListTicket.current;
    const result = (await client.listProjects()).map(raw => ProjectSummarySchema.parse(raw));
    if (live.current && request === projectListTicket.current) setProjects(result);
    return result;
  }, [client]);
  const refresh = useCallback(async (id = currentId.current) => {
    if (!id || id !== currentId.current) return;
    const request = ++ticket.current;
    if (live.current) setUpdating(true);
    try {
      const raw = await client.getSnapshot(id);
      if (!live.current || currentId.current !== id || request !== ticket.current) return;
      if (raw.project.id !== id) throw new Error('Snapshot belongs to another project');
      const result = validateSnapshot(raw, lastLayout.current);
      if (activeSnapshot.current && result.snapshot.eventSequence < activeSnapshot.current.eventSequence) return;
      activeSnapshot.current = result.snapshot; setSnapshot(result.snapshot); setRejected(result.rejected);
      if (!lastLayout.current || !editing.current) { lastLayout.current = result.snapshot.project.workspace; heldDocuments.current = result.snapshot.documents; setLayout(lastLayout.current); }
      setError('');
    } catch { if (live.current && currentId.current === id && request === ticket.current) setError('Project unavailable. Your local drafts are preserved. Retry when connected.'); }
    finally { if (live.current && currentId.current === id && request === ticket.current) { setUpdating(false); setLoading(false); } }
  }, [client]);
  const select = useCallback(async (id: string) => {
    try { await drafts.flush(); } catch { setError('Draft storage failed. Copy your work before switching projects.'); return; }
    currentId.current = id; activeSnapshot.current = undefined; lastLayout.current = undefined; editing.current = false;
    heldDocuments.current = [];
    setSelected(id); setSnapshot(undefined); setLayout(undefined); setLoading(true); setBusy(false); setError(''); setSettingsOpen(false); shell.current?.showWorkspace(); setInspectedTask(undefined);
    await refresh(id);
  }, [drafts, refresh]);
  useEffect(() => {
    live.current = true;
    list().then(items => { if (!live.current) return; if (items[0]) void select(items[0].id); else setLoading(false); }).catch(() => { if (live.current) { setError('Projects unavailable. Retry when connected.'); setLoading(false); } });
    return () => { live.current = false; ticket.current++; };
  }, [list, select]);
  useEffect(() => {
    if (!snapshot) return;
    const controller = new AbortController(), id = snapshot.project.id;
    let sequence = snapshot.eventSequence;
    void client.subscribe(sequence, event => {
      if (event.seq <= sequence || controller.signal.aborted) return;
      sequence = event.seq;
      if (event.projectId === id) void refresh(id);
      void list().catch(() => {});
    }, controller.signal).catch(() => { if (!controller.signal.aborted && live.current && currentId.current === id) setConnected(false); });
    return () => controller.abort();
  }, [client, snapshot?.project.id, snapshot?.eventSequence, list, refresh]);
  useEffect(() => bridge?.onEvent(raw => {
    const result = SafeDesktopEventSchema.safeParse(raw);
    if (result.success && result.data.type === 'connection') setConnected(result.data.connected);
    if (result.success && result.data.type === 'source_state' && result.data.binding.projectId === currentId.current) void refresh();
    if (result.success && result.data.type === 'open_project') {
      const projectId = result.data.projectId;
      if (projects.some(project => project.id === projectId)) void select(projectId);
    }
  }), [bridge, refresh, select, projects]);
  async function action(input: OwnerAction) {
    const record = activeSnapshot.current;
    if (!record || busy) return;
    const id = record.project.id; setBusy(true);
    try { await client.applyAction(id, { operationId: crypto.randomUUID(), expectedRevision: record.project.revision, input }); await refresh(id); await list(); }
    catch { if (currentId.current === id) setError('Owner update not confirmed. Refresh before retrying; drafts are preserved.'); }
    finally { if (currentId.current === id) setBusy(false); }
  }
  async function createProject() {
    if (busy || !pendingCreation.ready) return;
    setBusy(true);
    const sentTitle = titleDraft.current.current, sentBrief = briefDraft.current.current, originatingProject = currentId.current;
    try {
      let pending = pendingCreation.current.current;
      const command = pending.text ? commandEnvelopeSchema(CreateProjectInputSchema).parse(JSON.parse(pending.text)) : {
        operationId: crypto.randomUUID(), input: CreateProjectInputSchema.parse({ title: sentTitle.text, brief: sentBrief.text, format: 'prompt' }),
      };
      if (!pending.text) { pending = { text: JSON.stringify(command), baseRevision: 0 }; pendingCreation.change(pending); }
      await drafts.flush();
      await client.createProject(command);
      const items = await list(), created = items.find(item => !projects.some(existing => existing.id === item.id));
      await titleDraft.saved(sentTitle, 0, ''); await briefDraft.saved(sentBrief, 0, '');
      await pendingCreation.saved(pending, 0, '');
      setError('');
      if (created && currentId.current === originatingProject) await select(created.id);
    } catch { setError('Project creation not confirmed. Retry the saved request to reconcile its outcome.'); }
    finally { setBusy(false); }
  }
  const offline = connected === false || snapshot?.connection.sync === 'offline';
  const fixtureMode = fixture || snapshot?.connection.mode === 'fixture';
  const disabled = busy || offline || !!error || !snapshot || snapshot.project.status === 'archived';
  const layoutChanged = layout && snapshot && JSON.stringify(layout.panels) !== JSON.stringify(snapshot.project.workspace.panels);
  const needsTaskInspector = inspectedTask && snapshot?.project.tasks.some(task => task.id === inspectedTask) && !layout?.panels.some(panel => panel.type === 'checklist' && panel.taskIds.includes(inspectedTask));
  const inboxQuestions = snapshot?.checkIns.filter(record => !layout?.panels.some(panel => panel.type === 'question_card' && panel.checkInId === record.id)) ?? [];
  async function applyLayout() {
    const record = activeSnapshot.current;
    if (!record) return;
    try { await drafts.flush(); }
    catch { setError('Draft storage failed. Copy your work before applying the workspace arrangement.'); return; }
    if (currentId.current !== record.project.id || JSON.stringify(activeSnapshot.current?.project.workspace) !== JSON.stringify(record.project.workspace)) return;
    lastLayout.current = record.project.workspace; heldDocuments.current = record.documents;
    setLayout(lastLayout.current); editing.current = false;
  }
  function openTask(id: string) {
    const record = activeSnapshot.current;
    if (!record?.project.tasks.some(task => task.id === id)) return;
    shell.current?.showWorkspace(); setSettingsOpen(false); setInspectedTask(id);
    requestAnimationFrame(() => { if (currentId.current === record.project.id) document.getElementById(`task-${id}`)?.focus(); });
  }
  function renderQuestion(record: CheckIn) {
    return <div key={record.id} id={`check-in-${record.id}`} tabIndex={-1}><Question question={record} disabled={disabled || snapshot?.project.status === 'paused'} answer={async input => { await client.answerCheckIn(record.id, { operationId: crypto.randomUUID(), expectedRevision: record.revision, input }); await refresh(record.projectId); }} snooze={async input => { await client.snoozeCheckIn(record.id, { operationId: crypto.randomUUID(), expectedRevision: record.revision, input }); await refresh(record.projectId); }} cancel={async () => { await client.cancelCheckIn(record.id, { operationId: crypto.randomUUID(), expectedRevision: record.revision, input: {} }); await refresh(record.projectId); }} openTask={() => openTask(record.taskId)} /></div>;
  }
  return <DesktopWorkspaceShell ref={shell} title={snapshot?.project.title ?? 'NemoPlaybook'} fixture={fixtureMode} offline={offline}
    refresh={() => { void list().catch(() => setError('Projects unavailable.')); void refresh(); }}
    projects={<div className="projects-surface">
      <div className="workspace-brand"><span className="workspace-mouse" role="img" aria-label="Nemo mouse" /><strong>NemoPlaybook</strong></div>
      <label className="project-filter"><span className="sr-only">Find a project</span><Input placeholder="Find a project…" value={filter} onChange={event => setFilter(event.target.value)} /></label>
      <p className="sidebar-caption">Your projects</p>
      {projects.length === 0 && !loading && <p>No projects yet</p>}
      <ul className="project-list">{projects.filter(project => project.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(project => <li key={project.id}><button aria-current={selected === project.id ? 'page' : undefined} onClick={() => void select(project.id)}><span className="project-dot" /><span><strong>{project.title}</strong><small>{project.status}{project.unreadCheckIns > 0 ? ` · ${project.unreadCheckIns} check-in${project.unreadCheckIns > 1 ? 's' : ''}` : ''}</small></span></button></li>)}</ul>
      <details className="new-project" open={projects.length === 0}><summary>New project</summary><form onSubmit={event => { event.preventDefault(); void createProject(); }}><label>Project title<Input value={title} disabled={!titleDraft.ready || !pendingCreation.ready || !!pendingCreation.draft.text} onChange={event => titleDraft.change({ text: event.target.value, baseRevision: 0 })} required maxLength={160} /></label><label>Project brief<Textarea value={brief} disabled={!briefDraft.ready || !pendingCreation.ready || !!pendingCreation.draft.text} onChange={event => briefDraft.change({ text: event.target.value, baseRevision: 0 })} rows={4} required /></label><Button disabled={busy || !pendingCreation.ready || !titleDraft.ready || !briefDraft.ready || !!titleDraft.error || !!briefDraft.error || !!pendingCreation.error || (!pendingCreation.draft.text && (!title.trim() || !brief.trim())) || offline}>{pendingCreation.draft.text ? 'Retry project creation' : 'Create project'}</Button>{pendingCreation.draft.text && <p role="status">An unresolved creation is saved. Retrying uses its original brief and operation ID.</p>}{(titleDraft.error || briefDraft.error || pendingCreation.error) && <p role="alert">{titleDraft.error || briefDraft.error || pendingCreation.error}</p>}</form></details>
      <footer className="sidebar-footer"><Button variant="ghost" disabled={!snapshot} onClick={() => { setSettingsOpen(true); shell.current?.showWorkspace(); }}>Project settings</Button></footer>
    </div>}
    workspace={<main className="workspace-surface" id="workspace" onInputCapture={() => { editing.current = true; }} onFocusCapture={event => { if ((event.target as HTMLElement).matches('textarea, input, select')) editing.current = true; }}>
      {error && <div className="global-error notice error" role="alert">{error}<Button variant="outline" onClick={() => { void list().catch(() => {}); void refresh(); }}>Retry</Button></div>}
      {snapshot && <section className="project-settings" aria-label="Project settings" hidden={!settingsOpen}>
        <header className="settings-heading"><h2>Project settings</h2><Button variant="outline" onClick={() => setSettingsOpen(false)}>Back to workspace</Button></header>
        <div className="project-controls"><label>Project status<select value={snapshot.project.status} disabled={disabled} onChange={event => void action({ type: 'set_project_status', status: event.target.value as 'active' | 'paused' | 'archived' })}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label><label>Phase<select value={snapshot.project.phase} disabled={disabled} onChange={event => void action({ type: 'set_project_phase', phase: event.target.value as 'planning' | 'building' | 'demo' | 'review' })}>{['planning', 'building', 'demo', 'review'].map(phase => <option key={phase}>{phase}</option>)}</select></label></div>
        <div className="connection-status"><p>Cloud {offline ? 'offline · writes unavailable' : snapshot.connection.sync === 'stale' ? 'stale · refresh recommended' : snapshot.connection.sync === 'updating' || updating ? 'updating…' : fixtureMode ? 'connection simulated' : 'snapshot current'}</p><p>Nemotron {snapshot.connection.inference.available ? 'available' : `unavailable · ${snapshot.connection.inference.reason}`}</p><p>Source freshness: {snapshot.sourceBindings.length ? snapshot.sourceBindings.map(source => `${source.state}${source.lastObservedAt && Date.now() - Date.parse(source.lastObservedAt) > 120000 ? ' · observation old' : ''}`).join(', ') : 'No source linked'}</p>{snapshot.connection.demoTiming && <p>Demo reminder timing</p>}</div>
        <SourceControls key={snapshot.project.id} bridge={bridge} snapshot={snapshot} refresh={() => refresh(snapshot.project.id)} />
      </section>}
      <div className="workspace-content" hidden={settingsOpen}>
        {loading && <div role="status" className="loading"><h1>Loading workspace…</h1></div>}
        {!selected && !loading && <div className="empty"><h1>Your next project</h1><p>Create a project to start a plan.</p><Button onClick={() => shell.current?.openProjects()}>Open projects</Button></div>}
        {snapshot && layout && <>
          <header className="project-heading"><h1>{snapshot.project.title}</h1><p>{snapshot.project.goal}</p><div className="actions"><strong>{snapshot.project.tasks.length ? `${snapshot.project.tasks.filter(task => task.status === 'done').length} of ${snapshot.project.tasks.length} tasks marked done` : 'Progress unknown'}</strong>{snapshot.project.tasks.length > 0 && <progress className="project-progress" aria-label="Task progress" max={snapshot.project.tasks.length} value={snapshot.project.tasks.filter(task => task.status === 'done').length} />}<span>{snapshot.project.planState === 'accepted' ? 'Plan accepted' : 'Draft plan · review needed'}</span>{snapshot.project.planState === 'proposed' && <Button size="sm" disabled={disabled || snapshot.project.tasks.length === 0} onClick={() => void action({ type: 'accept_plan' })}>Accept plan</Button>}</div></header>
          {snapshot.project.status === 'paused' && <p className="notice">Project paused · observation and check-ins require an active project.</p>}
          {rejected && <p className="notice" role="status">Layout rejected. Showing the last trusted layout or a plain task checklist.</p>}
          {layoutChanged && <div className="notice"><p>Workspace arrangement update available. Your editor stays in place.</p><p>{snapshot.project.workspace.panels.map(panel => panel.heading).join(' · ')}</p><Button variant="outline" onClick={() => void applyLayout()}>Apply workspace arrangement</Button></div>}
          {snapshot.project.tasks.length === 0 && <p className="empty">No tasks yet. Planning has not produced an accepted task list.</p>}
          <WorkspaceCatalog snapshot={snapshot} panels={layout.panels} disabled={disabled} correctTask={(taskId, status) => void action({ type: 'update_task', taskId, status })} openTask={openTask}
            document={(id, heading) => {
              const canonical = snapshot.documents.find(item => item.id === id), record = canonical ?? heldDocuments.current.find(item => item.id === id);
              return record ? <Fragment key={id}><DocumentEditor document={record} heading={heading} client={client} store={drafts} disabled={disabled || !canonical} refresh={() => refresh(snapshot.project.id)} />{!canonical && <p role="status">Document removed from the current workspace. Your local editor is retained until you apply the arrangement; saving is unavailable.</p>}</Fragment> : <p>Document unavailable. Your local copy is preserved.</p>;
            }} question={renderQuestion} />
          {needsTaskInspector && <WorkspaceCatalog snapshot={snapshot} panels={[{ id: inspectorId, type: 'checklist', heading: 'Selected task', taskIds: [inspectedTask!] }]} disabled={disabled} correctTask={(taskId, status) => void action({ type: 'update_task', taskId, status })} document={() => null} question={() => null} openTask={openTask} />}
          {inboxQuestions.length > 0 && <section aria-label="Project questions"><h2>Questions</h2>{inboxQuestions.map(renderQuestion)}</section>}
        </>}
      </div>
    </main>}
    manager={<div className="chat-surface">{snapshot ? <Chat key={snapshot.project.id} snapshot={snapshot} client={client} store={drafts} disabled={disabled} refresh={() => refresh(snapshot.project.id)} openCheckIn={id => { setSettingsOpen(false); shell.current?.showWorkspace(); requestAnimationFrame(() => document.getElementById(`check-in-${id}`)?.focus()); }} /> : <div className="empty"><h2>Manager chat</h2><p>{loading ? 'Loading…' : 'Choose a project to open its conversation.'}</p></div>}</div>}
  />;
}
