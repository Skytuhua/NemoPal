import { useRef, type ReactNode } from 'react';
import type { ProjectSummary, Task } from '@living-playbooks/contracts';

export function AppIcon({ name }: { name: 'book' | 'projects' | 'plus' | 'arrow' | 'shield' | 'refresh' | 'check' | 'steps' | 'settings' | 'close' | 'task' }) {
  const paths = {
    book: 'M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1m0-15c3-2 7-2 9-1v15c-3-1-6-1-9 1V5Z',
    projects: 'M3 7V5h7l2 2h9v13H3V7Z',
    plus: 'M12 5v14M5 12h14',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-3 9 2 2 4-4',
    refresh: 'M20 10a8 8 0 1 0-1 8M20 4v6h-6',
    check: 'm5 12 4 4L19 6',
    steps: 'M4 6h4v4H4zM16 14h4v4h-4zM8 8h7v8h1',
    settings: 'M4 7h16M4 17h16M9 4v6M15 14v6',
    close: 'm6 6 12 12M6 18 18 6',
    task: 'M9 4h6v3H9zM9 5H5v16h14V5h-4M8 12l2 2 5-5M8 18h8',
  };
  return <svg className="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function ProjectProgress({ tasks, children }: { tasks: Task[]; children?: ReactNode }) {
  const done = tasks.filter(task => task.status === 'done').length;
  return <section className="project-summary" aria-label="Project progress">
    <div className="progress-main"><div className="progress-caption"><strong>{tasks.length ? `${Math.round(done / tasks.length * 100)}%` : 'Progress unknown'}</strong><span>{tasks.length ? `${done} of ${tasks.length} tasks marked done` : 'Add a plan to track your work'}</span></div>{tasks.length > 0 && <progress max={tasks.length} value={done} aria-label="Tasks marked done" />}</div>
    {tasks.length > 0 && <div className="status-counts"><span data-status="done"><i />{done}<small>Done</small></span><span data-status="in_progress"><i />{tasks.filter(task => task.status === 'in_progress').length}<small>In progress</small></span><span data-status="todo"><i />{tasks.filter(task => task.status === 'todo').length}<small>To do</small></span>{tasks.some(task => task.status === 'blocked') && <span data-status="blocked"><i />{tasks.filter(task => task.status === 'blocked').length}<small>Blocked</small></span>}</div>}
    {children}
  </section>;
}

export function DetailDisclosure({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  function close() { if (ref.current) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); } }
  return <details ref={ref} className={`desk-disclosure ${className}`} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}><summary>{title}</summary><div className="desk-detail"><div className="detail-heading"><h2>{title}</h2><button aria-label={`Close ${title.toLowerCase()}`} onClick={close}><AppIcon name="close" /></button></div>{children}</div></details>;
}

export function ManagerMouse() {
  return <span className="manager-mouse" aria-hidden="true" />;
}

export function ProjectOverview({ projects, open }: { projects: ProjectSummary[]; open(id: string): void }) {
  return <section className="project-overview" aria-label="Project overview">
    <header><div><h1>Your projects</h1><p>Choose a project to keep moving.</p></div><div className="overview-totals"><span><AppIcon name="projects" /><strong>{projects.length} projects</strong></span><span><i className="status-dot" /><strong>{projects.filter(project => project.status === 'active').length} active</strong></span><span><AppIcon name="task" /><strong>{projects.reduce((count, project) => count + project.unreadCheckIns, 0)} check-ins</strong></span></div></header>
    <ul className="overview-list">{projects.map(project => <li key={project.id}>
      <span className="project-monogram"><AppIcon name="projects" /></span><div><h2 id={`overview-project-${project.id}`}>{project.title}</h2><p>{project.goal}</p><div className="overview-project-meta"><span className="status-chip" data-status={project.status}>{project.status === 'active' ? 'Active' : project.status === 'paused' ? 'Paused' : 'Archived'}</span><small>{project.planState === 'accepted' ? 'Plan accepted' : 'Plan needs your review'}{project.unreadCheckIns > 0 ? ` · ${project.unreadCheckIns} unanswered question${project.unreadCheckIns === 1 ? '' : 's'}` : ''}</small></div></div>
      <button onClick={() => open(project.id)} aria-describedby={`overview-project-${project.id}`}>Continue<AppIcon name="arrow" /></button>
    </li>)}</ul>
  </section>;
}
