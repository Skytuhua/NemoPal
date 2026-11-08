import type { ProjectSummary } from '@living-playbooks/contracts';

export function AppIcon({ name }: { name: 'book' | 'projects' | 'plus' | 'arrow' | 'shield' | 'refresh' }) {
  const paths = {
    book: 'M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1m0-15c3-2 7-2 9-1v15c-3-1-6-1-9 1V5Z',
    projects: 'M3 7V5h7l2 2h9v13H3V7Z',
    plus: 'M12 5v14M5 12h14',
    arrow: 'M5 12h14m-6-6 6 6-6 6',
    shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-3 9 2 2 4-4',
    refresh: 'M20 10a8 8 0 1 0-1 8M20 4v6h-6',
  };
  return <svg className="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function ManagerMouse() {
  return <span className="manager-mouse" aria-hidden="true" />;
}

export function ProjectOverview({ projects, open }: { projects: ProjectSummary[]; open(id: string): void }) {
  return <section className="project-overview" aria-label="Project overview">
    <header><h1>Your projects</h1><p>Pick up where you left off, or start something new.</p></header>
    <ul className="overview-list">{projects.map(project => <li key={project.id}>
      <AppIcon name="projects" /><div><h2 id={`overview-project-${project.id}`}>{project.title}</h2><p>{project.goal}</p><small>{project.status === 'active' ? 'Active' : project.status === 'paused' ? 'Paused' : 'Archived'} · {project.planState === 'accepted' ? 'Plan accepted' : 'Plan needs your review'}{project.unreadCheckIns > 0 ? ` · ${project.unreadCheckIns} unanswered question${project.unreadCheckIns === 1 ? '' : 's'}` : ''}</small></div>
      <button onClick={() => open(project.id)} aria-describedby={`overview-project-${project.id}`}>Continue<AppIcon name="arrow" /></button>
    </li>)}</ul>
  </section>;
}
