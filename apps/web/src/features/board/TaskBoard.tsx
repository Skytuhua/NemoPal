import { useLayoutEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { type ProjectSnapshot, type Task, type TaskStatus } from '@living-playbooks/contracts';
import { Kanban, KanbanBoard, KanbanColumn, KanbanColumnHandle, KanbanItem, KanbanItemHandle, KanbanOverlay, type KanbanProps } from '@living-playbooks/project-ui';
import { boardValue, columnsFromValue, legacyBoardColumns, statusLabels, validateBoardColumns, type BoardColumnView, type BoardValue } from './board-view';
import { useBoardPan } from './useBoardPan';
import type { DraftStore } from '../documents/drafts';
import { TaskDetailsDialog, type SaveTaskDetails, type ReviewTaskDetails } from './TaskDetailsDialog';
import { TaskStatusMenu } from './TaskStatusControl';
import './task-board.css';

export type TaskBoardProps = {
  snapshot: ProjectSnapshot;
  disabled: boolean;
  selectedTaskId?: string;
  columns?: BoardColumnView[];
  onColumnsChange?(next: BoardColumnView[]): void;
  openTask(id: string): void;
  closeTask(): void;
  correctTask(id: string, status: TaskStatus): void;
  store?: DraftStore;
  saveTaskDetails?: SaveTaskDetails;
  reviewTaskDetails?: ReviewTaskDetails;
};
const taskValue = (task: Task) => task.id;
type Draft = { pickup: symbol; snapshot: ProjectSnapshot; columns: BoardColumnView[]; persist: TaskBoardProps['onColumnsChange']; value: BoardValue };
type FocusedCard = { taskId: string; control: string; node: HTMLElement };
const stopSensor = (event: SyntheticEvent) => event.stopPropagation();

function GripIcon() {
  return <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="7" cy="5" r="1.2" /><circle cx="13" cy="5" r="1.2" /><circle cx="7" cy="10" r="1.2" /><circle cx="13" cy="10" r="1.2" /><circle cx="7" cy="15" r="1.2" /><circle cx="13" cy="15" r="1.2" /></svg>;
}
export function TaskBoard({ snapshot, disabled, selectedTaskId, columns: providedColumns, onColumnsChange, openTask, closeTask, correctTask, store, saveTaskDetails, reviewTaskDetails }: TaskBoardProps) {
  const { project } = snapshot;
  const columns = useMemo(() => validateBoardColumns(providedColumns === undefined ? legacyBoardColumns(project.tasks) : providedColumns, project.tasks), [providedColumns, snapshot]);
  const canonical = useMemo(() => boardValue(columns, project.tasks), [columns, snapshot]);
  const canDrag = !disabled && providedColumns !== undefined && onColumnsChange !== undefined;
  const [draft, setDraft] = useState<Draft | null>(null);
  // A replacement snapshot/view or revoked permission invalidates pickup immediately.
  const currentDraft = canDrag && draft?.snapshot === snapshot && draft.columns === columns && draft.persist === onColumnsChange ? draft : null;
  const value = currentDraft?.value ?? canonical;
  const scopeCounter = useRef(0);
  const interactionScope = useMemo(() => ++scopeCounter.current, [snapshot, columns, canDrag, onColumnsChange]);
  const pan = useBoardPan(interactionScope, !!currentDraft);
  // Sensor teardown may deliver an old closure after replacement/revocation.
  const liveDraft = useRef(currentDraft);
  liveDraft.current = currentDraft;
  const acceptedValue = useRef(value);
  useLayoutEffect(() => { acceptedValue.current = value; }, [value]);
  useLayoutEffect(() => { if (draft && !currentDraft) setDraft(null); }, [draft, currentDraft]);

  const selected = project.tasks.find(task => task.id === selectedTaskId);
  const returnToCard = useRef<string | undefined>(undefined);
  const cardFocus = useRef<FocusedCard | undefined>(undefined);
  useLayoutEffect(() => {
    const previous = cardFocus.current;
    if (!previous || previous.node.isConnected || document.activeElement !== document.body) return;
    const replacement = document.getElementById(`board-task-${previous.taskId}`)?.querySelector<HTMLElement>(`[data-card-control="${previous.control}"]`);
    if (replacement && !replacement.closest('[inert],[hidden]') && !replacement.hasAttribute('disabled')) replacement.focus();
  }, [value, disabled]);
  useLayoutEffect(() => {
    if (!selected && returnToCard.current) {
      if (document.activeElement === document.body) document.getElementById(`board-task-${returnToCard.current}`)?.querySelector<HTMLButtonElement>('[data-card-control="open"]')?.focus();
      returnToCard.current = undefined;
    }
  }, [selected?.id]);
  const close = () => { returnToCard.current = selected?.id; closeTask(); };
  const finishDrag = () => setDraft(current => currentDraft && current?.pickup === currentDraft.pickup ? null : current);
  const onMove: NonNullable<KanbanProps<Task>['onMove']> = event => {
    if (!currentDraft || liveDraft.current !== currentDraft || !canDrag || !onColumnsChange) return;
    const accepted = acceptedValue.current;
    let ordered = columns;
    if (Object.hasOwn(accepted, event.active.id)) {
      // Dice indices use record order, which may differ for integer-like column IDs.
      const keys = Object.keys(accepted), from = columns.findIndex(column => column.id === keys[event.activeIndex]), to = columns.findIndex(column => column.id === keys[event.overIndex]);
      if (from < 0 || to < 0 || from === to) return;
      ordered = [...columns];
      ordered.splice(to, 0, ordered.splice(from, 1)[0]!);
    }
    // Dice already accepted this preview. over.id may now identify the active item.
    const next = columnsFromValue(ordered, accepted);
    validateBoardColumns(next, project.tasks);
    onColumnsChange(next);
  };
  return <section className="task-board" aria-label="Project task board" data-board-mode={providedColumns ? 'workflow' : 'legacy-status'} onFocusCapture={event => {
    const node = event.target as HTMLElement, taskId = node.closest('[data-board-task-id]')?.getAttribute('data-board-task-id'), control = node.getAttribute('data-card-control');
    cardFocus.current = taskId && control ? { taskId, control, node } : undefined;
  }} onBlurCapture={event => {
    // Removal can blur to body; preserve that identity for the next canonical render.
    if (event.target === cardFocus.current?.node && event.relatedTarget) cardFocus.current = undefined;
  }}>
    <div className="task-board-layout" data-detail-open={!!selected}>
      <Kanban<Task> key={interactionScope} value={value} getItemValue={taskValue} onValueChange={next => {
        // Exact offered-record identity is Dice's controlled acknowledgment.
        setDraft(current => canDrag && currentDraft && liveDraft.current?.pickup === currentDraft.pickup && current?.pickup === currentDraft.pickup ? { ...current, value: next } : current);
      }} onDragStart={() => { if (canDrag) setDraft({ pickup: Symbol('board pickup'), snapshot, columns, persist: onColumnsChange, value }); }} onMove={onMove} onDragCancel={finishDrag} onDragEnd={finishDrag}>
        <KanbanBoard className="task-board-columns" aria-label="Project workflow" {...pan}>
          {columns.map(column => <KanbanColumn className="task-board-column" value={column.id} data-task-column={column.id} data-column-kind={column.kind} key={column.id} disabled={!canDrag} aria-labelledby={`board-column-${project.id}-${column.id}`}>
            <header className="task-board-column-heading">
              <h2 id={`board-column-${project.id}-${column.id}`}><span className="task-board-column-dot" aria-hidden="true" />{column.title}</h2>
              <span data-task-count aria-label={`${value[column.id]!.length} ${value[column.id]!.length === 1 ? 'task' : 'tasks'}`}>{value[column.id]!.length}</span>
              <KanbanColumnHandle className="task-board-drag-handle" aria-label={`Move column: ${column.title}`}><GripIcon /></KanbanColumnHandle>
            </header>
            <div className="task-board-column-scroll">
              {value[column.id]!.length ? value[column.id]!.map(task => <KanbanItem className="task-board-card" id={`board-task-${task.id}`} value={task.id} asHandle data-board-task-id={task.id} data-task-status={task.status} aria-label={`Task card: ${task.title}`} key={task.id} disabled={!canDrag}>
                <div className="task-board-card-heading">
                  <button className="task-board-open" data-card-control="open" aria-label={`Open task: ${task.title}`} aria-expanded={selected?.id === task.id} onClick={() => openTask(task.id)} onKeyDown={stopSensor}>{task.title}</button>
                  <KanbanItemHandle className="task-board-drag-handle" data-card-control="drag" aria-label={`Move task: ${task.title}`}><GripIcon /></KanbanItemHandle>
                </div>
                <div className="task-board-card-meta"><TaskStatusMenu task={task} disabled={disabled} correctTask={correctTask} />{task.dueAt && <time dateTime={task.dueAt} title={`Due ${new Date(task.dueAt).toLocaleString()}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></svg>{new Date(task.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>}{task.description?.trim() && <span className="task-board-description-icon" role="img" aria-label="Has description" title="Has description"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M5 6h14M5 10h14M5 14h14M5 18h9" /></svg></span>}{!!task.checklist?.length && <span className="task-board-checklist-count" aria-label={`${task.checklist.filter(item => item.completed).length} of ${task.checklist.length} checklist items complete`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m8 12 3 3 5-6" /></svg>{task.checklist.filter(item => item.completed).length}/{task.checklist.length}</span>}</div>
              </KanbanItem>) : <p className="task-board-empty">No tasks</p>}
            </div>
          </KanbanColumn>)}
        </KanbanBoard>
        <KanbanOverlay dropAnimation={null}>{({ value: id, variant }) => {
          const column = columns.find(item => item.id === id), task = project.tasks.find(item => item.id === id);
          return <div className="task-board-drag-preview" data-board-drag-preview>{variant === 'column' ? column?.title : task?.title}</div>;
        }}</KanbanOverlay>
      </Kanban>
      {selected && <TaskDetailsDialog key={`${project.id}:${selected.id}`} snapshot={snapshot} task={selected} disabled={disabled} store={store} saveTaskDetails={saveTaskDetails} reviewTaskDetails={reviewTaskDetails} close={close} correctTask={correctTask} />}
    </div>
  </section>;
}
