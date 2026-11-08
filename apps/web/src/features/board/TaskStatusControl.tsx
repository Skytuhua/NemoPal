import { useEffect, useId, useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { TaskStatusSchema, type Task, type TaskStatus } from '@living-playbooks/contracts';
import { statusLabels } from './board-view';
const stopSensor = (event: SyntheticEvent) => event.stopPropagation();
const controlBoundary = { onMouseDown: stopSensor, onTouchStart: stopSensor, onKeyDown: stopSensor };
function StatusIcon({ status }: { status: TaskStatus }) {
  return <svg className="task-board-status-icon" data-status={status} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">{status === 'in_progress' ? <><circle className="task-board-status-track" cx="12" cy="12" r="8.5" /><path className="task-board-status-ring" d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" /></> : <><circle cx="12" cy="12" r="8.5" />{status === 'done' ? <path d="m8 12 3 3 5-6" /> : status === 'blocked' ? <path d="M12 7.5v6m0 2.5v.5" strokeWidth="2" strokeLinecap="round" /> : status === 'skipped' ? <path d="M8 12h8" /> : null}</>}</svg>;
}

export function TaskStatusMenu({ task, disabled, correctTask }: { task: Task; disabled: boolean; correctTask: (id: string, status: TaskStatus) => void }) {
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null), id = useId();
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const close = (restore = true) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useLayoutEffect(() => {
    if (!open || disabled) { if (open) setOpen(false); return; }
    const rect = trigger.current!.getBoundingClientRect();
    const containingDialog = trigger.current!.closest('[role=dialog]')?.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 184)) - (containingDialog?.left ?? 0), top: Math.max(8, Math.min(rect.bottom + 5, window.innerHeight - 220)) - (containingDialog?.top ?? 0) });
    menu.current?.querySelector<HTMLElement>('[aria-checked=true]')?.focus();
  }, [open, disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) close(false); };
    const moved = () => close(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', moved);
    document.addEventListener('scroll', moved, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', moved); document.removeEventListener('scroll', moved, true); };
  }, [open]);
  return <span className="task-board-status" {...controlBoundary}>
    <button ref={trigger} type="button" className="task-board-status-trigger" data-card-control="status" disabled={disabled} aria-label={`Status: ${task.title} — ${statusLabels[task.status]}`} title={`Change status · ${statusLabels[task.status]}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(current => !current)} onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); setOpen(current => event.key === 'ArrowDown' || event.key === 'ArrowUp' ? true : !current); } }}><StatusIcon status={task.status} /></button>
    {open && !disabled && createPortal(<div className="workspace-ui task-board-status-menu" id={id} ref={menu} role="menu" aria-label={`Task status: ${task.title}`} style={position} onKeyDown={event => {
      const options = [...menu.current!.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')], index = options.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      else if (event.key === 'Tab') { close(); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
      }
    }}>{TaskStatusSchema.options.map(status => <button type="button" role="menuitemradio" tabIndex={-1} aria-checked={status === task.status} key={status} onClick={() => { close(); if (status !== task.status) correctTask(task.id, status); }}><StatusIcon status={status} /><span>{statusLabels[status]}</span></button>)}</div>, trigger.current?.closest('[role=dialog]') ?? document.body)}
  </span>;
}
