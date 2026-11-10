import type { Project, TaskStatus } from '@living-playbooks/contracts';
import { actionableTask } from '@living-playbooks/project-ui';
import { ManagerIcon } from './ManagerIcon';

const statusLabels: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Waiting', done: 'Done', skipped: 'Skipped' };

export function ManagerOverview({ project, disabled, openTask, updateTask, openWorkspace }: {
  project: Project;
  disabled: boolean;
  openTask?: (id: string) => void;
  updateTask?: (id: string, status: TaskStatus) => void;
  openWorkspace?: () => void;
}) {
  const counts = { todo: 0, in_progress: 0, blocked: 0, done: 0, skipped: 0 };
  for (const task of project.tasks) counts[task.status]++;
  const next = actionableTask(project);
  const remaining = [
    { status: 'in_progress', count: counts.in_progress, text: 'in progress' },
    { status: 'blocked', count: counts.blocked, text: 'waiting' },
    { status: 'todo', count: counts.todo, text: 'to do' },
    { status: 'skipped', count: counts.skipped, text: 'skipped' },
  ];

  return <>
    <section className="manager-summary" aria-label="Project task summary">
      <h3 title={project.title}>{project.title}</h3>
      {project.tasks.length ? <>
        <p className="manager-task-total"><span className="manager-done-mark"><ManagerIcon name="check" /></span><strong>{counts.done} of {project.tasks.length} done</strong></p>
        {remaining.some(item => item.count > 0) && <ul className="manager-task-counts">{remaining.filter(item => item.count > 0).map(item => <li key={item.status} data-task-state={item.status}><span aria-hidden="true" />{item.count} {item.text}</li>)}</ul>}
      </> : <p className="manager-no-tasks">No tasks yet</p>}
    </section>

    {next ? <section className="manager-next" aria-label="Next task">
      <div className="manager-next-heading"><h3>Next task</h3><span>{statusLabels[next.status]}</span></div>
      <p className="manager-next-title" title={next.title}>{next.title}</p>
      {(openTask || openWorkspace || updateTask) && <div className="manager-quick-actions">
        {openTask ? <button type="button" className="manager-open-task" onClick={() => openTask(next.id)}>Open next task<ManagerIcon name="arrow" /></button>
          : openWorkspace && <button type="button" className="manager-open-task" onClick={openWorkspace}>Go to tasks &amp; notes<ManagerIcon name="arrow" /></button>}
        {updateTask && <button type="button" disabled={disabled} onClick={() => updateTask(next.id, 'done')}><ManagerIcon name="check" />Mark as done</button>}
      </div>}
    </section> : <div className="manager-no-next">
      {project.tasks.length ? <p>No open tasks</p> : <p>Open your project to review the brief.</p>}
      {openWorkspace && <button type="button" onClick={openWorkspace}>{project.tasks.length ? 'Go to tasks & notes' : 'Open project'}<ManagerIcon name="arrow" /></button>}
    </div>}
  </>;
}
