import { TaskStatusSchema, type Task, type TaskStatus } from '@living-playbooks/contracts';

/** Renderer view only: workflow placement never implies canonical task status. */
export type BoardColumnView = { id: string; title: string; kind: 'workflow' | 'deferred'; taskIds: string[] };
export type BoardValue = Record<string, Task[]>;
export const statusLabels: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done', skipped: 'Skipped' };

export function legacyBoardColumns(tasks: Task[]): BoardColumnView[] {
  return TaskStatusSchema.options.filter(status => status !== 'skipped' || tasks.some(task => task.status === status))
    .map(status => ({ id: status, title: statusLabels[status], kind: 'workflow', taskIds: tasks.filter(task => task.status === status).map(task => task.id) }));
}

export function validateBoardColumns(columns: BoardColumnView[], tasks: Task[]): BoardColumnView[] {
  const reject = (reason: string): never => { throw new Error(`Invalid task board: ${reason}`); };
  if (tasks.length > 40) reject('at most 40 tasks are supported');
  const taskIds = new Set(tasks.map(task => task.id));
  if (taskIds.size !== tasks.length || tasks.some(task => typeof task.id !== 'string' || !task.id.trim())) reject('task identities must be unique and nonempty');
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > 12) reject('one to twelve columns are required');
  const identities = new Set<string>(), placements = new Set<string>();
  let deferred = 0;
  for (const column of columns) {
    if (!column || typeof column.id !== 'string' || !column.id.trim() || identities.has(column.id) || taskIds.has(column.id)) reject('column identities must be unique and distinct from tasks');
    identities.add(column.id);
    if (typeof column.title !== 'string' || !column.title.trim() || column.title.length > 120) reject('column titles must contain 1 to 120 characters');
    if (column.kind !== 'workflow' && column.kind !== 'deferred') reject('unknown column kind');
    if (column.kind === 'deferred' && ++deferred > 1) reject('only one Deferred column is supported');
    if (!Array.isArray(column.taskIds)) reject('column membership must be an array');
    for (const taskId of column.taskIds) {
      if (!taskIds.has(taskId) || placements.has(taskId)) reject('task membership must be known and unique');
      placements.add(taskId);
    }
  }
  if (placements.size !== tasks.length) reject('every task must belong to exactly one column');
  return columns;
}

export function boardValue(columns: BoardColumnView[], tasks: Task[]): BoardValue {
  const byId = new Map(tasks.map(task => [task.id, task]));
  return Object.fromEntries(columns.map(column => [column.id, column.taskIds.map(id => byId.get(id)!)]));
}

export function columnsFromValue(columns: BoardColumnView[], value: BoardValue): BoardColumnView[] {
  return columns.map(column => ({ ...column, taskIds: value[column.id]!.map(task => task.id) }));
}
