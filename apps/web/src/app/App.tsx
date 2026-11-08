import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { commandEnvelopeSchema, CreateProjectInputSchema, ProjectSchema, ProjectSummarySchema, SafeDesktopEventSchema, type CheckIn, type DesktopBridge, type DocumentDraft, type OwnerAction, type PlaybooksClient, type ProjectSnapshot, type ProjectSummary, type RevisionedCommandEnvelope, type Task, type WorkspaceSpec } from '@living-playbooks/contracts';
import { Button, Input, Textarea } from '@living-playbooks/project-ui';
import { DesktopWorkspaceShell, type DesktopShellHandle } from './DesktopWorkspaceShell';
import type { DraftStore } from '../features/documents/drafts';
import { DocumentEditor } from '../features/documents/DocumentEditor';
import { TaskBoard } from '../features/board/TaskBoard';
import type { BoardColumnView } from '../features/board/board-view';
import { createPreviewBoard, reconcilePreviewBoard } from './preview-board';
import { Chat } from '../features/chat/Chat';
import { CodexDemo, type CodexDemoHandle, type DemoActivity } from '../features/chat/CodexDemo';
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
  const [chatMode, setChatMode] = useState<'manager' | 'codex'>('manager');
  const codexGuard = useRef(false);
  const codexDemo = useRef<CodexDemoHandle>(null);
  const [demoActivity, setDemoActivity] = useState<{ projectId: string; activity: DemoActivity }>();
  const [codexSwitchNotice, setCodexSwitchNotice] = useState('');
  const setCodexGuard = useCallback((blocked: boolean) => { codexGuard.current = blocked; }, []);
  const reportDemoActivity = useCallback((projectId: string, activity: DemoActivity) => { if (currentId.current === projectId) setDemoActivity({ projectId, activity }); }, []);
  const shell = useRef<DesktopShellHandle>(null);
  const [inspectedTask, setInspectedTask] = useState<string>();
  const [previewBoards, setPreviewBoards] = useState<Record<string, BoardColumnView[]>>({});
  const settingsButton = useRef<HTMLButtonElement>(null);
  const titleDraft = useDraft(drafts, 'new-project:title', '', 0), briefDraft = useDraft(drafts, 'new-project:brief', '', 0);
  const pendingCreation = useDraft(drafts, 'new-project:pending', '', 0);
  const title = titleDraft.draft.text, brief = briefDraft.draft.text;
  const currentId = useRef<string | undefined>(undefined), ticket = useRef(0), activeSnapshot = useRef<ProjectSnapshot | undefined>(undefined), editing = useRef(false);
  const lastLayout = useRef<WorkspaceSpec | undefined>(undefined), live = useRef(true), projectListTicket = useRef(0);
  const reportDemoActivityForProject = useCallback((activity: DemoActivity) => { if (selected) reportDemoActivity(selected, activity); }, [selected, reportDemoActivity]);
  const heldDocuments = useRef<DocumentDraft[]>([]);
  const detailWrite = useRef<symbol | undefined>(undefined);
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
    if (id === currentId.current) { setSettingsOpen(false); shell.current?.showWorkspace(); return; }
    if (codexGuard.current) { setChatMode('codex'); setCodexSwitchNotice('Stop the Codex demo and clear or copy its draft before switching projects.'); return; }
    try { await drafts.flush(); } catch { setError('Draft storage failed. Copy your work before switching projects.'); return; }
    if (codexGuard.current) { setChatMode('codex'); setCodexSwitchNotice('Stop the Codex demo and clear or copy its draft before switching projects.'); return; }
    setCodexSwitchNotice('');
    currentId.current = id; activeSnapshot.current = undefined; lastLayout.current = undefined; editing.current = false; detailWrite.current = undefined;
    heldDocuments.current = [];
    setDemoActivity(undefined); setSelected(id); setSnapshot(undefined); setLayout(undefined); setLoading(true); setBusy(false); setError(''); setSettingsOpen(false); shell.current?.showWorkspace(); setInspectedTask(undefined);
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
  async function saveTaskDetails(command: RevisionedCommandEnvelope<Extract<OwnerAction, { type: 'update_task_details' }>>): Promise<Task> {
    const record = activeSnapshot.current;
    if (!record || record !== snapshot || busy || detailWrite.current || connected === false || record.connection.sync === 'offline' || record.project.status === 'archived' || error || !record.project.tasks.some(task => task.id === command.input.taskId)) throw new Error('Task is unavailable. Your draft is preserved.');
    const id = record.project.id, write = Symbol('task details');
    detailWrite.current = write; setBusy(true);
    try {
      // The dialog retains this exact envelope until its receipt is confirmed.
      const receipt = await client.applyAction(id, command);
      const result = ProjectSchema.parse(receipt.result), task = result.tasks.find(item => item.id === command.input.taskId);
      if (result.id !== id || !task) throw new Error('Task save returned a different project.');
      if (live.current && detailWrite.current === write && currentId.current === id) { await refresh(id); await list().catch(() => {}); }
      return task;
    } finally {
      if (detailWrite.current === write) { detailWrite.current = undefined; if (live.current) setBusy(false); }
    }
  }
  async function reviewTaskDetails(): Promise<{ task: Task; projectRevision: number }> {
    const previous = activeSnapshot.current, taskId = inspectedTask;
    if (!previous || previous !== snapshot || !taskId) throw new Error('Task is unavailable.');
    const id = previous.project.id;
    await refresh(id);
    const current = activeSnapshot.current;
    if (!live.current || currentId.current !== id || !current || current === previous || current.project.id !== id) throw new Error('Current task could not be loaded.');
    const task = current.project.tasks.find(item => item.id === taskId);
    if (!task) throw new Error('Task is unavailable.');
    return { task, projectRevision: current.project.revision };
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
  const taskIdentity = snapshot?.project.tasks.map(task => task.id).sort().join('|') ?? '';
  const previewColumns = useMemo(() => fixtureMode && snapshot ? reconcilePreviewBoard(previewBoards[snapshot.project.id] ?? createPreviewBoard(snapshot.project.tasks), snapshot.project.tasks) : undefined, [fixtureMode, snapshot?.project.id, taskIdentity, previewBoards]);
  const disabled = busy || offline || !!error || !snapshot || snapshot.project.status === 'archived';
  const layoutChanged = layout && snapshot && JSON.stringify(layout.panels) !== JSON.stringify(snapshot.project.workspace.panels);
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
    requestAnimationFrame(() => { if (currentId.current === record.project.id) document.getElementById(`board-detail-${id}`)?.focus(); });
  }
  function openSettings() {
    const projectId = currentId.current;
    setSettingsOpen(true); shell.current?.showWorkspace();
    requestAnimationFrame(() => { if (currentId.current === projectId) document.getElementById('project-settings-heading')?.focus(); });
  }
  function closeSettings() {
    setSettingsOpen(false);
    requestAnimationFrame(() => {
      const button = settingsButton.current;
      if (button?.closest('[hidden],[inert]')) document.getElementById('projects-drawer-toggle')?.focus();
      else button?.focus();
    });
  }
  function renderQuestion(record: CheckIn) {
    return <div key={record.id} id={`check-in-${record.id}`} tabIndex={-1}><Question question={record} presentation="chat" completionLabel="Mark task done" disabled={disabled || snapshot?.project.status === 'paused'} answer={async input => { await client.answerCheckIn(record.id, { operationId: crypto.randomUUID(), expectedRevision: record.revision, input }); await refresh(record.projectId); }} snooze={async input => { await client.snoozeCheckIn(record.id, { operationId: crypto.randomUUID(), expectedRevision: record.revision, input }); await refresh(record.projectId); }} cancel={async () => { await client.cancelCheckIn(record.id, { operationId: crypto.randomUUID(), expectedRevision: record.revision, input: {} }); await refresh(record.projectId); }} openTask={() => openTask(record.taskId)} /></div>;
  }
  const done = snapshot?.project.tasks.filter(task => task.status === 'done').length ?? 0, total = snapshot?.project.tasks.length ?? 0;
  const percent = total ? Math.round(done / total * 100) : null;
  return <DesktopWorkspaceShell ref={shell}
    projects={<div className="projects-surface">
      <div className="workspace-brand"><strong>NemoPal</strong>{fixtureMode && <span className="demo-indicator" aria-label="Demo · synthetic data · no live model" title="Sample data. Changes reset on page reload; no live model is connected.">Demo</span>}</div>
      <div className="project-search-row"><label className="project-filter"><span className="sr-only">Find a project</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg><Input placeholder="Find a project…" value={filter} onChange={event => setFilter(event.target.value)} /></label>
        <details className="new-project" open={projects.length === 0} onKeyDown={event => { if (event.key === 'Escape' && event.currentTarget.open) { event.preventDefault(); event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary role="button" aria-label="New project" title="New project"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg></summary><form onSubmit={event => { event.preventDefault(); void createProject(); }}><h3>New project</h3><label>Project title<Input value={title} disabled={!titleDraft.ready || !pendingCreation.ready || !!pendingCreation.draft.text} onChange={event => titleDraft.change({ text: event.target.value, baseRevision: 0 })} required maxLength={160} /></label><label>Project brief<Textarea value={brief} disabled={!briefDraft.ready || !pendingCreation.ready || !!pendingCreation.draft.text} onChange={event => briefDraft.change({ text: event.target.value, baseRevision: 0 })} rows={4} required /></label><Button disabled={busy || !pendingCreation.ready || !titleDraft.ready || !briefDraft.ready || !!titleDraft.error || !!briefDraft.error || !!pendingCreation.error || (!pendingCreation.draft.text && (!title.trim() || !brief.trim())) || offline}>{pendingCreation.draft.text ? 'Retry project creation' : 'Create project'}</Button>{pendingCreation.draft.text && <p role="status">An unresolved creation is saved. Retrying uses its original brief and operation ID.</p>}{(titleDraft.error || briefDraft.error || pendingCreation.error) && <p role="alert">{titleDraft.error || briefDraft.error || pendingCreation.error}</p>}</form></details>
      </div>
      <h2 className="sidebar-caption">Projects</h2>
      {projects.length === 0 && !loading && <p>No projects yet</p>}
      <ul className="project-list">{projects.filter(project => project.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(project => <li key={project.id}><button aria-current={selected === project.id ? 'page' : undefined} onClick={() => void select(project.id)}><span className="project-manager-art manager-mouse" role="img" aria-label={`${project.managerName} mouse`} /><span className="project-row-copy"><strong>{project.title}</strong><small>{project.managerName} <span aria-hidden="true">·</span> {project.status}</small></span>{project.unreadCheckIns > 0 && <span className="project-unread" aria-label={`${project.unreadCheckIns} unread question${project.unreadCheckIns > 1 ? 's' : ''}`}>{project.unreadCheckIns}</span>}</button></li>)}</ul>
      <footer className="sidebar-footer"><Button ref={settingsButton} className="settings-button" variant="ghost" size="icon" aria-label="Project settings" title="Project settings" disabled={!snapshot} onClick={openSettings}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9.5 3-.7 2.3-2 .9-2.2-.7-2 3.5 1.6 1.7v2.6L2.6 15l2 3.5 2.2-.7 2 .9.7 2.3h4.1l.7-2.3 2-.9 2.2.7 2-3.5-1.6-1.7v-2.6l1.6-1.7-2-3.5-2.2.7-2-.9-.7-2.3Z" /><circle cx="11.6" cy="12" r="3" /></svg></Button><Button className="layout-reset-button" variant="ghost" size="icon" aria-label="Reset layout" title="Reset layout" onClick={() => shell.current?.resetLayout()}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6" /></svg></Button></footer>
    </div>}
    workspace={<main className="workspace-surface" id="workspace" onInputCapture={() => { editing.current = true; }} onFocusCapture={event => { if ((event.target as HTMLElement).matches('textarea, input, select')) editing.current = true; }}>
      {error && <div className="global-error notice error" role="alert">{error}<Button variant="outline" onClick={() => { void list().catch(() => {}); void refresh(); }}>Retry</Button></div>}
      {snapshot && <section className="project-settings" aria-label="Project settings" hidden={!settingsOpen}>
        <header className="settings-heading"><h2 id="project-settings-heading" tabIndex={-1}>Project settings</h2><Button variant="outline" onClick={closeSettings}>Back to workspace</Button></header>
        <section className="settings-brief"><h3>Project brief</h3><p>{snapshot.project.goal}</p></section>
        <section className="settings-notes" aria-labelledby="project-notes-heading"><h3 id="project-notes-heading">Notes</h3>
          {layoutChanged && <div className="notice"><p>Workspace arrangement update available. Your editor stays in place.</p><p>{snapshot.project.workspace.panels.map(panel => panel.heading).join(' · ')}</p><Button variant="outline" onClick={() => void applyLayout()}>Apply workspace arrangement</Button></div>}
          {heldDocuments.current.map(held => snapshot.documents.find(record => record.id === held.id) ?? held).map(record => {
            const canonical = snapshot.documents.find(item => item.id === record.id);
            const panel = layout?.panels.find(item => item.type === 'document_editor' && item.documentId === record.id);
            return <section className="project-document" key={record.id}><h4>{panel?.heading ?? 'Notes'}</h4><DocumentEditor document={record} heading={panel?.heading ?? 'Notes'} client={client} store={drafts} disabled={disabled || !canonical} refresh={() => refresh(snapshot.project.id)} />{!canonical && <p role="status">Document removed from the current workspace. Your local editor is retained until you apply the arrangement; saving is unavailable.</p>}</section>;
          })}
          {snapshot.documents.length === 0 && heldDocuments.current.length === 0 && <p>No saved notes for this project.</p>}
        </section>
        <div className="project-controls"><label>Project status<select value={snapshot.project.status} disabled={disabled} onChange={event => void action({ type: 'set_project_status', status: event.target.value as 'active' | 'paused' | 'archived' })}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label><label>Phase<select value={snapshot.project.phase} disabled={disabled} onChange={event => void action({ type: 'set_project_phase', phase: event.target.value as 'planning' | 'building' | 'demo' | 'review' })}>{['planning', 'building', 'demo', 'review'].map(phase => <option key={phase}>{phase}</option>)}</select></label></div>
        <div className="connection-status"><p>Cloud {offline ? 'offline · writes unavailable' : snapshot.connection.sync === 'stale' ? 'stale · refresh recommended' : snapshot.connection.sync === 'updating' || updating ? 'updating…' : fixtureMode ? 'connection simulated' : 'snapshot current'}</p><p>Nemotron {snapshot.connection.inference.available ? 'available' : `unavailable · ${snapshot.connection.inference.reason}`}</p><p>Source freshness: {snapshot.sourceBindings.length ? snapshot.sourceBindings.map(source => `${source.state}${source.lastObservedAt && Date.now() - Date.parse(source.lastObservedAt) > 120000 ? ' · observation old' : ''}`).join(', ') : 'No source linked'}</p>{snapshot.connection.demoTiming && <p>Demo reminder timing</p>}</div>
        <SourceControls key={snapshot.project.id} bridge={bridge} snapshot={snapshot} refresh={() => refresh(snapshot.project.id)} />
      </section>}
      <div className="workspace-content" hidden={settingsOpen}>
        {loading && <div role="status" className="loading"><h1>Loading workspace…</h1></div>}
        {!selected && !loading && <div className="empty"><h1>Your next project</h1><p>Create a project to start a plan.</p><Button onClick={() => shell.current?.openProjects()}>Open projects</Button></div>}
        {snapshot && layout && <>
          <header className="project-heading"><div className="project-identity"><h1>{snapshot.project.title}</h1><span className="project-state" data-status={snapshot.project.status}>{snapshot.project.status}</span><span className="project-plan-state">{snapshot.project.planState === 'accepted' ? 'Plan accepted' : 'Draft plan'}</span></div><div className="project-heading-actions">{snapshot.project.planState === 'proposed' && <Button size="sm" disabled={disabled || snapshot.project.tasks.length === 0} onClick={() => void action({ type: 'accept_plan' })}>Accept plan</Button>}<div className="progress-summary">{percent !== null ? <><span className="progress-track" role="progressbar" aria-label={`Task progress: ${done} of ${total} tasks marked done`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={`${percent}% · ${done} of ${total} tasks marked done`}><span style={{ width: `${percent}%` }} /></span><span className="progress-copy"><strong>{percent}%</strong><span>{done} of {total} done</span></span></> : <span>Progress unknown</span>}</div></div></header>
          {snapshot.project.status === 'paused' && <p className="notice">Project paused · observation and check-ins require an active project.</p>}
          {rejected && <p className="notice" role="status">Layout rejected. Showing the last trusted layout or a plain task checklist.</p>}
          {layoutChanged && <div className="notice"><p>Workspace arrangement update available. Your editor stays in place.</p><p>{snapshot.project.workspace.panels.map(panel => panel.heading).join(' · ')}</p><Button variant="outline" onClick={() => void applyLayout()}>Apply workspace arrangement</Button></div>}
          {snapshot.project.tasks.length === 0 && <p className="empty">No tasks yet. Planning has not produced an accepted task list.</p>}
          <div className="board-host">
            <div className="board-content"><TaskBoard key={snapshot.project.id} snapshot={snapshot} store={drafts} saveTaskDetails={saveTaskDetails} reviewTaskDetails={reviewTaskDetails} columns={previewColumns} onColumnsChange={fixtureMode ? next => { if (!disabled && !settingsOpen && activeSnapshot.current === snapshot) setPreviewBoards(current => ({ ...current, [snapshot.project.id]: next })); } : undefined} disabled={disabled || settingsOpen} selectedTaskId={inspectedTask} openTask={openTask} closeTask={() => setInspectedTask(undefined)} correctTask={(taskId, status) => void action({ type: 'update_task', taskId, status })} /></div>
          </div>
        </>}
      </div>
    </main>}
    manager={<div className="chat-surface">{snapshot ? <>
      {codexSwitchNotice && <p role="status">{codexSwitchNotice}</p>}
      {bridge?.startCodexDemo && bridge.sendCodexDemo && bridge.stopCodexDemo && <nav className="chat-mode" aria-label="Conversation"><Button variant="ghost" aria-pressed={chatMode === 'manager'} onClick={() => setChatMode('manager')}>Manager</Button><Button variant="ghost" aria-pressed={chatMode === 'codex'} onClick={() => setChatMode('codex')}>Codex demo</Button></nav>}
      <div className="chat-mode-content" hidden={chatMode !== 'manager'}><Chat key={snapshot.project.id} snapshot={snapshot} client={client} store={drafts} disabled={disabled} refresh={() => refresh(snapshot.project.id)} renderCheckIn={renderQuestion} demo={demoActivity?.projectId === snapshot.project.id ? demoActivity.activity : undefined} demoRef={codexDemo} /></div>
      {bridge?.startCodexDemo && bridge.sendCodexDemo && bridge.stopCodexDemo && <div className="chat-mode-content" hidden={chatMode !== 'codex'}><CodexDemo ref={codexDemo} onActivity={reportDemoActivityForProject} key={snapshot.project.id} projectId={snapshot.project.id} start={bridge.startCodexDemo} send={bridge.sendCodexDemo} stop={bridge.stopCodexDemo} onGuardChange={setCodexGuard} /></div>}
    </> : <div className="empty"><h2>Manager chat</h2><p>{loading ? 'Loading…' : 'Choose a project to open its conversation.'}</p></div>}</div>}
  />;
}
