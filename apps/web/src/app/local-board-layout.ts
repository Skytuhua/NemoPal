import type { Task } from '@living-playbooks/contracts';
import { validateBoardColumns, type BoardColumnView } from '../features/board/board-view';

export type LocalBoard = { columns: BoardColumnView[]; status: 'saved' | 'unsaved' | 'unavailable' };
const definitions = [
  { id: 'local:tasks', title: 'Tasks', kind: 'workflow' },
  { id: 'local:next', title: 'Next', kind: 'workflow' },
  { id: 'local:later', title: 'Later', kind: 'workflow' },
  { id: 'local:deferred', title: 'Deferred', kind: 'deferred' },
] as const;
const maxBytes = 16384;

export function boardStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
export function boardKey(ownerId: string, projectId: string): string {
  return `nemopal:board:v1:${ownerId}:${projectId}`;
}
export function initialLocalBoard(tasks: readonly Task[]): BoardColumnView[] {
  return definitions.map((column, index) => ({ ...column, taskIds: index === 0 ? tasks.map(task => task.id) : [] }));
}

// Stored data is untrusted. Permit only our four neutral columns and bounded UUID task IDs.
function validShape(value: unknown): value is BoardColumnView[] {
  if (!Array.isArray(value) || value.length !== definitions.length) return false;
  const ids = new Set<string>(), tasks = new Set<string>();
  for (const column of value) {
    if (!column || typeof column !== 'object' || Array.isArray(column) || Object.keys(column).sort().join(',') !== 'id,kind,taskIds,title') return false;
    const def = definitions.find(item => item.id === column.id);
    if (!def || ids.has(def.id) || column.title !== def.title || column.kind !== def.kind || !Array.isArray(column.taskIds) || column.taskIds.length > 40) return false;
    ids.add(def.id);
    for (const taskId of column.taskIds) {
      if (typeof taskId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId) || tasks.has(taskId) || tasks.size >= 40) return false;
      tasks.add(taskId);
    }
  }
  return true;
}

export function reconcileLocalBoard(board: LocalBoard, tasks: Task[]): LocalBoard {
  const current = new Set(tasks.map(task => task.id));
  const assigned = new Set(board.columns.flatMap(column => column.taskIds));
  const added = tasks.filter(task => !assigned.has(task.id)).map(task => task.id);
  if (!added.length && [...assigned].every(id => current.has(id))) return board;
  const columns = board.columns.map(column => ({ ...column, taskIds: [...column.taskIds.filter(id => current.has(id)), ...(column.id === 'local:tasks' ? added : [])] }));
  validateBoardColumns(columns, tasks);
  return { columns, status: board.status === 'unavailable' ? 'unavailable' : 'unsaved' };
}

export function readLocalBoard(storage: Storage | null, ownerId: string, projectId: string, tasks: Task[]): LocalBoard {
  const fallback = (status: LocalBoard['status']): LocalBoard => ({ columns: initialLocalBoard(tasks), status });
  if (!storage) return fallback('unavailable');
  let raw: string | null;
  try { raw = storage.getItem(boardKey(ownerId, projectId)); } catch { return fallback('unavailable'); }
  if (raw === null || raw.length > maxBytes) return fallback('unsaved');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).sort().join(',') !== 'columns,version') return fallback('unsaved');
    const record = parsed as { version: unknown; columns: unknown };
    if (record.version !== 1 || !validShape(record.columns)) return fallback('unsaved');
    return reconcileLocalBoard({ columns: record.columns, status: 'saved' }, tasks);
  } catch { return fallback('unsaved'); }
}

export function saveLocalBoard(storage: Storage | null, ownerId: string, projectId: string, columns: BoardColumnView[], tasks: Task[]): LocalBoard {
  if (!validShape(columns)) throw new Error('Invalid local board');
  validateBoardColumns(columns, tasks);
  try {
    if (!storage) throw new Error('Storage unavailable');
    const raw = JSON.stringify({ version: 1, columns });
    if (raw.length > maxBytes) throw new Error('Layout too large');
    storage.setItem(boardKey(ownerId, projectId), raw);
    return { columns, status: 'saved' };
  } catch { return { columns, status: 'unavailable' }; }
}
