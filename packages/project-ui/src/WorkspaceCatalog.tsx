import type { ReactNode } from 'react';
import { TaskStatusSchema, type CheckIn, type EvidenceLevel, type ProjectSnapshot, type TaskStatus, type WorkspacePanel } from '@living-playbooks/contracts';

export const evidenceLabel = (level: EvidenceLevel) => ({ none: 'No evidence yet', agent_reported: 'Agent reported', user_reported: 'Owner reported', source_tool_observed: 'Source tool observed' })[level];
export const taskLabel = (status: TaskStatus) => ({ todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', skipped: 'Skipped' })[status];
export function WorkspaceCatalog({ snapshot, panels, disabled, correctTask, document, question, openTask }: { snapshot: ProjectSnapshot; panels: WorkspacePanel[]; disabled: boolean; correctTask(id: string, status: TaskStatus): void; document(id: string, heading: string): ReactNode; question(record: CheckIn): ReactNode; openTask(id: string): void }) {
  const tasks = snapshot.project.tasks;
  return <div className="catalog">{panels.map(panel => {
    let content: ReactNode;
    switch (panel.type) {
      case 'checklist': content = <ul className="task-list">{panel.taskIds.map(id => {
        const task = tasks.find(item => item.id === id);
        return task && <li key={id} id={`task-${id}`} tabIndex={-1}><div><strong>{task.title}</strong><small>{evidenceLabel(task.evidenceLevel)} · {task.ownerOverride ? 'Owner correction' : task.requirementOrigin.replaceAll('_', ' ')}</small></div><select aria-label={`Status: ${task.title}`} value={task.status} disabled={disabled} onChange={event => correctTask(id, TaskStatusSchema.parse(event.target.value))}>{TaskStatusSchema.options.map(status => <option key={status} value={status}>{taskLabel(status)}</option>)}</select></li>;
      })}</ul>; break;
      case 'milestone_timeline': content = <ol className="timeline">{panel.taskIds.map(id => { const task = tasks.find(item => item.id === id); return task && <li key={id}><button className="text-button" onClick={() => openTask(id)}>{task.title}</button><small>{taskLabel(task.status)} · {task.dueAt ? new Date(task.dueAt).toLocaleString() : 'No due date set'}</small></li>; })}</ol>; break;
      case 'evidence_card': content = <>{panel.observationIds.map(id => { const record = snapshot.observations.find(item => item.id === id); return record && <details key={id}><summary>{evidenceLabel(record.provenance.evidenceLevel)} · {record.provenance.mode === 'fixture' ? 'Synthetic fixture' : record.provenance.mode.replaceAll('_', ' ')}</summary><p>{record.excerpt ?? 'Metadata only; no source text exported.'}</p><small>Observed at {new Date(record.observedAt).toLocaleString()} · {record.kind.replaceAll('_', ' ')}</small><small>Observation {record.id} · {record.provenance.adapterId}</small></details>; })}</>; break;
      case 'question_card': { const record = snapshot.checkIns.find(item => item.id === panel.checkInId); content = record ? question(record) : <p>Question unavailable.</p>; break; }
      case 'document_editor': content = document(panel.documentId, panel.heading); break;
      case 'next_action': { const task = tasks.find(item => item.id === panel.taskId); content = task && <><p>{task.title}</p><button onClick={() => openTask(task.id)}>Open task</button><small>{task.status === 'done' || task.status === 'skipped' ? `This task is marked ${taskLabel(task.status).toLowerCase()}. Open it to review or change its status.` : 'See the task and update its status.'}</small></>; break; }
    }
    return <section className={`workspace-panel panel-${panel.type}`} data-panel-type={panel.type} key={panel.id} aria-labelledby={`panel-${panel.id}`}><h2 id={`panel-${panel.id}`}>{panel.heading}</h2>{content}</section>;
  })}</div>;
}
