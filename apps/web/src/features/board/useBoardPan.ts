import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type Pan = { node: HTMLDivElement; pointerId: number; button: number; x: number; y: number; left: number; top: number };
const controls = '[data-board-task-id],button,a,input,textarea,select,[contenteditable=true],[role=button],[role=menu],[data-slot=resizable-handle],.task-board-column-heading';

/** Mouse-only navigation of empty canvas space; card and list interactions stay local. */
export function useBoardPan(scope: unknown, blocked = false) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef<Pan | null>(null);
  const [panning, setPanning] = useState(false);
  const release = () => {
    const previous = active.current;
    active.current = null;
    if (previous?.node.hasPointerCapture?.(previous.pointerId)) previous.node.releasePointerCapture(previous.pointerId);
  };
  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== active.current?.pointerId) return;
    release(); setPanning(false);
  };
  useLayoutEffect(() => {
    release(); setPanning(false);
    return release;
  }, [scope, blocked]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (blocked || active.current || event.ctrlKey || event.metaKey || event.defaultPrevented || node.scrollWidth <= node.clientWidth) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input,textarea,select,[contenteditable=true],[role=menu],[data-slot=resizable-handle]')) return;
      const list = target?.closest<HTMLElement>('.task-board-column-scroll');
      // Ordinary vertical wheel scroll belongs to a scrollable card list.
      if (!event.shiftKey && !event.deltaX && list && list.scrollHeight > list.clientHeight) return;
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientWidth : 1;
      const delta = (event.deltaX || event.deltaY) * factor;
      const next = Math.max(0, Math.min(node.scrollWidth - node.clientWidth, node.scrollLeft + delta));
      if (!delta || next === node.scrollLeft) return;
      node.scrollLeft = next;
      event.preventDefault();
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [blocked]);
  return {
    ref,
    'data-panning': panning ? 'true' : undefined,
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      const node = event.currentTarget, target = event.target;
      if (blocked || active.current || event.pointerType !== 'mouse' || (event.button !== 0 && event.button !== 1) || event.ctrlKey || event.metaKey || event.altKey || !(target instanceof HTMLElement) || target.closest(controls)) return;
      // Text remains selectable; the list padding and empty canvas are the pan surface.
      const background = target === node || target.classList.contains('task-board-column-scroll') || target.hasAttribute('data-task-column') || !target.textContent?.trim();
      if (!background || (node.ownerDocument.getSelection()?.toString() ?? '').length > 0) return;
      active.current = { node, pointerId: event.pointerId, button: event.button, x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop };
      node.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    },
    onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      const pan = active.current;
      if (!pan || event.pointerId !== pan.pointerId) return;
      if (!(event.buttons & (pan.button === 1 ? 4 : 1))) { finish(event); return; }
      const x = pan.x - event.clientX, y = pan.y - event.clientY;
      if (Math.abs(x) + Math.abs(y) < 3 && !panning) return;
      pan.node.scrollLeft = Math.max(0, Math.min(pan.node.scrollWidth - pan.node.clientWidth, pan.left + x));
      pan.node.scrollTop = Math.max(0, Math.min(pan.node.scrollHeight - pan.node.clientHeight, pan.top + y));
      setPanning(true);
      event.preventDefault();
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
  };
}
