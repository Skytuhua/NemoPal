import type { Task } from '@living-playbooks/contracts';
import type { BoardColumnView } from '../features/board/board-view';

// Explicit renderer sample, not a model response or persisted project schema.
export function createPreviewBoard(tasks: readonly Task[]): BoardColumnView[] {
  const columns: BoardColumnView[] = [
    { id: 'preview:prepare', title: 'Prepare', kind: 'workflow', taskIds: [] },
    { id: 'preview:make', title: 'Create', kind: 'workflow', taskIds: [] },
    { id: 'preview:review', title: 'Review', kind: 'workflow', taskIds: [] },
    { id: 'preview:handoff', title: 'Handoff', kind: 'workflow', taskIds: [] },
    { id: 'preview:deferred', title: 'Deferred', kind: 'deferred', taskIds: [] },
  ];
  tasks.forEach((task, index) => columns[index < 2 ? 0 : index === 2 ? 1 : index === 3 ? 2 : 3]!.taskIds.push(task.id));
  return columns;
}

export function reconcilePreviewBoard(columns: BoardColumnView[], tasks: readonly Task[]): BoardColumnView[] {
  const current = new Set(tasks.map(task => task.id));
  const assigned = new Set(columns.flatMap(column => column.taskIds));
  const added = tasks.filter(task => !assigned.has(task.id)).map(task => task.id);
  if (!added.length && [...assigned].every(id => current.has(id))) return columns;
  const destination = columns.find(column => column.kind !== 'deferred')?.id;
  return columns.map(column => ({ ...column, taskIds: [...column.taskIds.filter(id => current.has(id)), ...(column.id === destination ? added : [])] }));
}
