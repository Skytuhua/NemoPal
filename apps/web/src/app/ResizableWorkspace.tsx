import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

const defaults = { left: 240, right: 340 }, minima = { left: 200, right: 280 }, maxima = { left: 360, right: 480 };
const breakpoint = 1080, centerMinimum = 420, handles = 12;
type Side = 'left' | 'right';

function fit(width: number, preferred: typeof defaults) {
  const left = Math.max(minima.left, Math.min(maxima.left, preferred.left)), right = Math.max(minima.right, Math.min(maxima.right, preferred.right));
  const excess = Math.max(0, left + right + centerMinimum + handles - width);
  const room = left - minima.left + right - minima.right;
  return room > 0 ? { left: left - excess * (left - minima.left) / room, right: right - excess * (right - minima.right) / room } : { left, right };
}

export function useResizableWorkspace() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => typeof window === 'undefined' ? 1440 : window.innerWidth);
  const [preferred, setPreferred] = useState(defaults), [resizing, setResizing] = useState(false);
  const drag = useRef<{ side: Side; id: number; x: number; start: number; node: HTMLElement } | null>(null);
  const narrow = width < breakpoint, widths = fit(Math.max(width, breakpoint), preferred);
  const current = useRef({ width, widths }); current.current = { width, widths };

  function stop(id?: number) {
    const active = drag.current;
    if (!active || id !== undefined && active.id !== id) return;
    drag.current = null;
    if (active.node.hasPointerCapture?.(active.id)) active.node.releasePointerCapture(active.id);
    setResizing(false);
  }
  useLayoutEffect(() => {
    const node = ref.current!;
    function measure(value: number) { if (value > 0) { current.current.width = value; setWidth(value); if (value < breakpoint) stop(); } }
    measure(node.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return () => stop();
    const observer = new ResizeObserver(entries => { const size = entries[0]?.contentRect.width; if (size) measure(size); });
    observer.observe(node);
    return () => { observer.disconnect(); stop(); };
  }, []);

  function maximum(side: Side) {
    const other = side === 'left' ? 'right' : 'left';
    return Math.max(minima[side], Math.min(maxima[side], current.current.width - current.current.widths[other] - centerMinimum - handles));
  }
  function change(side: Side, value: number) {
    const bounded = Math.max(minima[side], Math.min(maximum(side), value));
    // Keep the other pane's actual width during a deliberate drag; resize alone retains preferences.
    setPreferred({ ...current.current.widths, [side]: bounded });
  }
  function keyDown(side: Side, event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const delta = (event.shiftKey ? 50 : 10) * (event.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? 1 : -1);
    change(side, event.key === 'Home' ? minima[side] : event.key === 'End' ? maximum(side) : current.current.widths[side] + delta);
  }
  function down(side: Side, event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault(); event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { side, id: event.pointerId, x: event.clientX, start: current.current.widths[side], node: event.currentTarget };
    setResizing(true);
  }
  function move(event: PointerEvent) {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    change(active.side, active.start + (event.clientX - active.x) * (active.side === 'left' ? 1 : -1));
  }
  function separator(side: Side) {
    return <div className={`pane-resizer resizer-${side}`} role="separator" tabIndex={0} aria-label={side === 'left' ? 'Resize projects' : 'Resize conversation'} aria-controls={side === 'left' ? 'projects-panel' : 'manager-panel'} aria-orientation="vertical" aria-valuemin={minima[side]} aria-valuemax={Math.round(maximum(side))} aria-valuenow={Math.round(widths[side])}
      onKeyDown={event => keyDown(side, event)} onPointerDown={event => down(side, event)} onPointerMove={move} onPointerUp={event => stop(event.pointerId)} onPointerCancel={event => stop(event.pointerId)} onLostPointerCapture={event => stop(event.pointerId)} />;
  }
  return { ref, narrow, resizing, separator, reset: () => setPreferred(defaults), style: { '--projects-width': `${widths.left}px`, '--conversation-width': `${widths.right}px` } as CSSProperties };
}
