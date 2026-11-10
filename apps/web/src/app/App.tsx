import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { commandEnvelopeSchema, CreateProjectInputSchema, ProjectSummarySchema, SafeDesktopEventSchema, type CheckIn, type DesktopBridge, type DocumentDraft, type OwnerAction, type PlaybooksClient, type ProjectSnapshot, type ProjectSummary, type WorkspaceSpec } from '@living-playbooks/contracts';
import { evidenceLabel, taskLabel, WorkspaceCatalog } from '@living-playbooks/project-ui';
import type { DraftStore } from '../features/documents/drafts';
import { DocumentEditor } from '../features/documents/DocumentEditor';
import { Chat } from '../features/chat/Chat';
import { Question } from '../features/checkins/Question';
import { SourceControls } from '../features/sources/SourceControls';
import { validateSnapshot } from './snapshots';
import { useDraft } from '../features/documents/useDraft';
import { AppIcon, DetailDisclosure, ManagerMouse, ProjectOverview, ProjectProgress } from './Presentation';
import { useResizableWorkspace } from './ResizableWorkspace';
import { DetailSurface } from '../features/details/DetailSurface';
import { restoreFocus, trapFocus } from '../features/details/focus';

export function App({ client, drafts, bridge, fixture = false }: { client: PlaybooksClient; drafts: DraftStore; bridge?: DesktopBridge; fixture?: boolean }) {
  const shell = useResizableWorkspace();
  const [drawer, setDrawer] = useState<'Projects' | 'Chat' | null>(null), [search, setSearch] = useState('');
  const drawerOpener = useRef<Element | null>(null);
  useLayoutEffect(() => {
    if (!shell.narrow && drawer) setDrawer(null);
    if (shell.narrow && drawer) {
      drawerOpener.current = document.activeElement;
      document.getElementById(drawer === 'Projects' ? 'projects-panel' : 'manager-panel')?.querySelector<HTMLElement>('[data-drawer-close]')?.focus();
    } else if (drawerOpener.current) {
      if (!document.querySelector('dialog[open]')) restoreFocus(drawerOpener.current);
      drawerOpener.current = null;
    }
  }, [drawer, shell.narrow]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]), [selected, setSelected] = useState<string>();
  const [snapshot, setSnapshot] = useState<ProjectSnapshot>(), [layout, setLayout] = useState<WorkspaceSpec>();
  const [loading, setLoading] = useState(true), [updating, setUpdating] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [rejected, setRejected] = useState(false), [connected, setConnected] = useState<boolean>();
  const [surface, setSurface] = useState('Workspace');
  const [creating, setCreating] = useState(false);
  const [inspectedTask, setInspectedTask] = useState<string>();
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
    setSelected(id); setSnapshot(undefined); setLayout(undefined); setLoading(true); setBusy(false); setError(''); setSurface('Workspace'); setCreating(false); setInspectedTask(undefined);
    await refresh(id);
  }, [drafts, refresh]);
  useEffect(() => {
    live.current = true;
    list().then(items => { if (!live.current) return; if (items[0]) void select(items[0].id); else { setLoading(false); setSurface('Projects'); setCreating(true); } }).catch(() => { if (live.current) { setError('Projects unavailable. Your local drafts are preserved. Retry when connected.'); setLoading(false); } });
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
      setCreating(false);
    } catch { setError('Project creation not confirmed. Your brief is saved. Use Retry project creation to check the original request.'); }
    finally { setBusy(false); }
  }
  const offline = connected === false || snapshot?.connection.sync === 'offline';
  const fixtureMode = fixture || snapshot?.connection.mode === 'fixture';
  const disabled = busy || offline || !!error || !snapshot || snapshot.project.status === 'archived';
  const layoutChanged = layout && snapshot && JSON.stringify(layout.panels) !== JSON.stringify(snapshot.project.workspace.panels);
  const selectedTask = snapshot?.project.tasks.find(task => task.id === inspectedTask);
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
    setSurface('Workspace'); setInspectedTask(id);
    setDrawer(null);
  }
  function renderQuestion(record: CheckIn) {
    return <Question compact key={record.id} question={record} disabled={disabled || snapshot?.project.status === 'paused'} answer={async input => { await client.answerCheckIn(record.id, { operationId: crypto.randomUUID(), expectedRevision: record.revision, input }); await refresh(record.projectId); }} snooze={async input => { await client.snoozeCheckIn(record.id, { operationId: crypto.randomUUID(), expectedRevision: record.revision, input }); await refresh(record.projectId); }} cancel={async () => { await client.cancelCheckIn(record.id, { operationId: crypto.randomUUID(), expectedRevision: record.revision, input: {} }); await refresh(record.projectId); }} openTask={() => openTask(record.taskId)} />;
  }
  async function retry() {
    try {
      const items = await list();
      if (!currentId.current && items[0]) await select(items[0].id);
      else if (currentId.current) await refresh();
      else { setError(''); setSurface('Projects'); setCreating(true); }
    } catch { setError('Projects unavailable. Your local drafts are preserved. Retry when connected.'); }
  }
  function navigate(name: string) {
    setSurface(name); setCreating(false); setDrawer(null);
    requestAnimationFrame(() => document.getElementById(name === 'Chat' ? 'manager-panel' : 'workspace')?.focus());
  }
  function openPrivacy() {
    navigate('Workspace');
    requestAnimationFrame(() => {
      const details = document.getElementById('source-privacy') as HTMLDetailsElement | null;
      if (details) { details.open = true; details.querySelector('summary')?.focus(); details.scrollIntoView?.({ block: 'start' }); }
    });
  }
  const firstProject = !loading && !error && projects.length === 0;
  const orderedPanels = layout ? [...layout.panels].sort((a, b) => {
    const order = { next_action: 0, milestone_timeline: 1, checklist: 2, evidence_card: 3, document_editor: 4, question_card: 5 };
    return order[a.type] - order[b.type];
  }) : [];
  const paneProps = (name: 'Projects' | 'Chat') => ({ role: shell.narrow && drawer === name ? 'dialog' as const : undefined, 'aria-modal': shell.narrow && drawer === name ? true as const : undefined, inert: shell.narrow && drawer !== name ? true : undefined, 'data-drawer-open': shell.narrow && drawer === name, onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => { if (!shell.narrow || drawer !== name) return; if (event.key === 'Escape') { event.preventDefault(); setDrawer(null); } else trapFocus(event); } });
  return <div ref={shell.ref} style={shell.style} className="app-shell" data-narrow={shell.narrow} data-resizing={shell.resizing} data-surface={surface} data-creating={creating} data-first-project={firstProject}>
    <a className="skip-link" href="#workspace">Skip to workspace</a>
    <header className="app-header" inert={shell.narrow && !!drawer ? true : undefined}><span className="header-location">Workspace{snapshot && <> <AppIcon name="arrow" /> <b>{snapshot.project.title}</b></>}</span>{fixtureMode && <details className="fixture-label"><summary>Demo</summary><p>Fixture mode · synthetic data · no live model</p></details>}<div className="header-actions"><button onClick={() => void retry()}><AppIcon name="refresh" />Refresh</button></div>{error && <div className="global-error notice error" role="alert"><p>{error}</p><button onClick={() => void retry()}>Retry</button></div>}</header>
    <nav className="narrow-nav" aria-label="Main surfaces" inert={drawer ? true : undefined}>{(['Projects', 'Chat'] as const).map(name => <button data-drawer-trigger key={name} aria-controls={name === 'Projects' ? 'projects-panel' : 'manager-panel'} aria-expanded={drawer === name} disabled={name === 'Chat' && !selected} onClick={() => setDrawer(current => current === name ? null : name)}>{name}</button>)}</nav>
    {shell.narrow && drawer && <div className="drawer-backdrop" onClick={() => setDrawer(null)} aria-hidden="true" />}
    <aside className="projects-surface" id="projects-panel" tabIndex={-1} aria-label="Projects" {...paneProps('Projects')}>
      <div className="project-brand"><ManagerMouse /><strong>Living Playbooks</strong><button data-drawer-close className="drawer-close" aria-label="Close projects" onClick={() => setDrawer(null)}><AppIcon name="close" /></button></div>
      <label className="project-search">Search projects<input type="search" placeholder="Find a project…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <button className="overview-nav" aria-current={surface === 'Projects' ? 'page' : undefined} onClick={() => navigate('Projects')}><AppIcon name="projects" />All projects</button>
      <div className="sidebar-heading"><h2>Projects</h2><button aria-label="Start a project" onClick={() => { navigate('Projects'); setCreating(true); requestAnimationFrame(() => document.getElementById('project-title')?.focus()); }}><AppIcon name="plus" /><span>New project</span></button></div>
      <ul className="project-list">{projects.filter(project => project.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(project => <li key={project.id}><button aria-current={selected === project.id && surface !== 'Projects' ? 'page' : undefined} onClick={() => { setDrawer(null); if (selected === project.id) navigate('Workspace'); else void select(project.id); }}><AppIcon name="projects" /><span><strong>{project.title}</strong><small>{project.status}{project.unreadCheckIns > 0 ? ` · ${project.unreadCheckIns} unread question${project.unreadCheckIns > 1 ? 's' : ''}` : ''}</small></span></button></li>)}</ul>
      {search && !projects.some(project => project.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <p className="search-empty">No matching projects.</p>}
      <div className="sidebar-footer">{snapshot && <button onClick={openPrivacy}><AppIcon name="settings" />Settings</button>}<button onClick={shell.reset}>Reset pane widths</button><small>{projects.length} project{projects.length === 1 ? '' : 's'}</small></div>
    </aside>
    {shell.separator('left')}
    <main className="workspace-surface" id="workspace" tabIndex={-1} inert={shell.narrow && !!drawer ? true : undefined} onInputCapture={() => { editing.current = true; }} onFocusCapture={event => { if ((event.target as HTMLElement).matches('textarea, input, select')) editing.current = true; }}>
      {loading && <div role="status" className="loading"><h1>Loading workspace…</h1><div /><div /></div>}
      {firstProject && <header className="welcome"><ManagerMouse /><h1>Start your first project</h1><p>A name, a goal, and a place to make progress.</p><div className="welcome-features"><span><AppIcon name="steps" />Follow your steps</span><span><AppIcon name="task" />Keep tasks & notes</span></div><small>No projects yet</small></header>}
      <div hidden={surface !== 'Projects' || firstProject || loading}>{projects.length > 0 && <ProjectOverview projects={projects} open={id => { if (selected === id) navigate('Workspace'); else void select(id); }} />}</div>
      {!loading && <details className="new-project" open={creating} onToggle={event => setCreating(event.currentTarget.open)}><summary><AppIcon name="plus" />New project</summary><form aria-label="Create a project" onSubmit={event => { event.preventDefault(); void createProject(); }}><h2>{firstProject ? 'Start with a name and a goal' : 'What would you like to work on?'}</h2><label>Project title<input id="project-title" placeholder="e.g. Launch my website" aria-describedby="project-title-help" value={title} disabled={!titleDraft.ready || !pendingCreation.ready || !!pendingCreation.draft.text} onChange={event => titleDraft.change({ text: event.target.value, baseRevision: 0 })} required maxLength={160} /></label><small id="project-title-help">A short name you’ll recognize in your project list.</small><label>Project brief<textarea placeholder="What do you want to achieve? What would finished look like?" aria-describedby="project-brief-help" value={brief} disabled={!briefDraft.ready || !pendingCreation.ready || !!pendingCreation.draft.text} onChange={event => briefDraft.change({ text: event.target.value, baseRevision: 0 })} rows={4} required /></label><small id="project-brief-help">Describe the goal in your own words. You don’t need a detailed plan yet.</small><div className="actions"><button className="primary" disabled={busy || !pendingCreation.ready || !titleDraft.ready || !briefDraft.ready || !!titleDraft.error || !!briefDraft.error || !!pendingCreation.error || (!pendingCreation.draft.text && (!title.trim() || !brief.trim())) || offline}>{busy ? 'Creating…' : pendingCreation.draft.text ? 'Retry project creation' : 'Create project'}<AppIcon name="arrow" /></button>{!firstProject && <button type="button" onClick={() => setCreating(false)}>Cancel</button>}</div><small>Creating a project saves your brief. A plan appears when planning is available.</small>{pendingCreation.draft.text && <p role="status">Your original request is saved. Retrying checks the same request, so it won’t create a second project.</p>}{(titleDraft.error || briefDraft.error || pendingCreation.error) && <p role="alert">{titleDraft.error || briefDraft.error || pendingCreation.error}</p>}</form></details>}
      <div className="workspace-content" hidden={surface === 'Projects' || creating}>
      {snapshot && layout && <>
        <header className="project-heading"><div className="project-identity"><span className="project-monogram"><AppIcon name="projects" /></span><div><div className="project-title-row"><h1 title={snapshot.project.title}>{snapshot.project.title}</h1><span className="status-chip" data-status={snapshot.project.status}>{snapshot.project.status === 'active' ? 'Active project' : snapshot.project.status === 'paused' ? 'Project paused' : 'Project archived'}</span></div><p title={snapshot.project.goal}>{snapshot.project.goal}</p></div></div></header>
        <ProjectProgress tasks={snapshot.project.tasks}>{snapshot.project.planState === 'proposed' && snapshot.project.tasks.length > 0 ? <section className="plan-review"><h2>Review your plan</h2><button className="primary" disabled={disabled} onClick={() => void action({ type: 'accept_plan' })}>Accept plan</button></section> : <span className="plan-state">{snapshot.project.planState === 'accepted' ? 'Plan accepted' : 'Plan pending'}</span>}</ProjectProgress>
        <div className="desk-notices">
        {offline && <p className="notice" role="status">Cloud offline · writes unavailable. You can keep drafting notes and messages. Reconnect, then Refresh before saving.</p>}
        {rejected && <p className="notice" role="status">Layout rejected. Showing the last trusted layout or a plain task checklist.</p>}
        {layoutChanged && <div className="notice"><p>Workspace arrangement update available. Your editor stays in place.</p><p>{snapshot.project.workspace.panels.map(panel => panel.heading).join(' · ')}</p><button onClick={() => void applyLayout()}>Apply workspace arrangement</button></div>}
        {snapshot.project.tasks.length === 0 && <p className="empty">No tasks yet. Planning has not produced an accepted task list.</p>}
        </div>
        <WorkspaceCatalog snapshot={snapshot} panels={orderedPanels.filter(panel => panel.type !== 'question_card')} disabled={disabled} correctTask={(taskId, status) => void action({ type: 'update_task', taskId, status })} openTask={openTask}
          document={(id, heading) => {
            const canonical = snapshot.documents.find(item => item.id === id), record = canonical ?? heldDocuments.current.find(item => item.id === id);
            return record ? <Fragment key={id}><DocumentEditor compact document={record} heading={heading} client={client} store={drafts} disabled={disabled || !canonical} refresh={() => refresh(snapshot.project.id)} />{!canonical && <p role="status">Document removed from the current workspace. Your local editor is retained until you apply the arrangement; saving is unavailable.</p>}</Fragment> : <p>Document unavailable. Your local copy is preserved.</p>;
          }}
          question={renderQuestion}
        />
        <DetailSurface open={!!selectedTask} title="Task details" closeLabel="Close selected task" onClose={() => setInspectedTask(undefined)} className="task-detail">{selectedTask && <div className="task-detail-content"><h3>{selectedTask.title}</h3><p>{evidenceLabel(selectedTask.evidenceLevel)}{selectedTask.ownerOverride ? ' · Owner correction' : ''}</p><label>Selected task status<select disabled={disabled} value={selectedTask.status} onChange={event => void action({ type: 'update_task', taskId: selectedTask.id, status: event.target.value as typeof selectedTask.status })}>{['todo', 'in_progress', 'blocked', 'done', 'skipped'].map(status => <option key={status} value={status}>{taskLabel(status as typeof selectedTask.status)}</option>)}</select></label><h3>Linked evidence</h3>{selectedTask.evidenceIds.length ? selectedTask.evidenceIds.map(id => <p key={id}>{snapshot.observations.find(item => item.id === id)?.excerpt ?? 'Evidence metadata only.'}</p>) : <p>No evidence linked to this task.</p>}<h3>Check-ins</h3>{snapshot.checkIns.some(item => item.taskId === selectedTask.id) ? snapshot.checkIns.filter(item => item.taskId === selectedTask.id).map(item => <p key={item.id}>{item.question} · {item.answer?.kind === 'recorded' ? 'Task marked done' : item.answer?.kind === 'not_yet' ? 'Not yet' : item.state}</p>) : <p>No check-ins linked to this task.</p>}</div>}</DetailSurface>
        <footer className="workspace-details"><SourceControls key={snapshot.project.id} bridge={bridge} snapshot={snapshot} refresh={() => refresh(snapshot.project.id)} />
        <DetailDisclosure className="project-settings" title="Project settings"><div className="project-controls"><label>Project status<select value={snapshot.project.status} disabled={disabled} onChange={event => void action({ type: 'set_project_status', status: event.target.value as 'active' | 'paused' | 'archived' })}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label><label>Phase<select value={snapshot.project.phase} disabled={disabled} onChange={event => void action({ type: 'set_project_phase', phase: event.target.value as 'planning' | 'building' | 'demo' | 'review' })}>{['planning', 'building', 'demo', 'review'].map(phase => <option key={phase}>{phase}</option>)}</select></label></div></DetailDisclosure>
        <DetailDisclosure className="connection-status" title="Connection details"><p>Cloud {offline ? 'offline · writes unavailable' : snapshot.connection.sync === 'stale' ? 'stale · refresh recommended' : snapshot.connection.sync === 'updating' || updating ? 'updating…' : fixtureMode ? 'connection simulated' : 'snapshot current'}</p><p>Nemotron {snapshot.connection.inference.available ? 'available' : `unavailable · ${snapshot.connection.inference.reason}`}</p><p>Source freshness: {snapshot.sourceBindings.length ? snapshot.sourceBindings.map(source => `${source.state}${source.lastObservedAt && Date.now() - Date.parse(source.lastObservedAt) > 120000 ? ' · observation old' : ''}`).join(', ') : 'No source linked'}</p>{snapshot.project.status === 'paused' && <p>Project paused · reading connected sources and check-in scheduling require service eligibility.</p>}{snapshot.connection.demoTiming && <p>Demo reminder timing</p>}</DetailDisclosure></footer>
      </>}
      </div>
    </main>
    {shell.separator('right')}
    <aside className="chat-surface" id="manager-panel" tabIndex={-1} aria-label="Manager chat" {...paneProps('Chat')}><button data-drawer-close className="drawer-close" aria-label="Close conversation" onClick={() => setDrawer(null)}><AppIcon name="close" /></button>{snapshot ? <Chat fixture={fixtureMode} checkIns={snapshot.checkIns.map(renderQuestion)} openTask={openTask} updateTask={(taskId, status) => void action({ type: 'update_task', taskId, status })} key={snapshot.project.id} snapshot={snapshot} client={client} store={drafts} disabled={disabled} refresh={() => refresh(snapshot.project.id)} openWorkspace={() => { navigate('Workspace'); requestAnimationFrame(() => document.querySelector<HTMLElement>('.task-list li')?.focus()); }} /> : <div className="empty"><h2>Project manager</h2><p>{loading ? 'Loading selected manager…' : 'Your project’s conversation will appear here.'}</p></div>}</aside>
  </div>;
}
