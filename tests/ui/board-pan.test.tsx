import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useBoardPan } from '../../apps/web/src/features/board/useBoardPan';

afterEach(cleanup);

function Canvas({ scope = 'project-a', blocked = false }: { scope?: string; blocked?: boolean }) {
  const pan = useBoardPan(scope, blocked);
  return <div {...pan} data-testid="canvas"><div data-task-column="column"><button>Column action</button><div data-board-task-id="card">Task text</div><div className="task-board-column-scroll" data-testid="list"><p>List text</p></div></div><div data-testid="background" /></div>;
}

function geometry() {
  const canvas = screen.getByTestId('canvas');
  Object.defineProperties(canvas, { scrollWidth: { configurable: true, value: 1400 }, clientWidth: { configurable: true, value: 600 }, scrollHeight: { configurable: true, value: 700 }, clientHeight: { configurable: true, value: 500 } });
  canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn(); canvas.hasPointerCapture = vi.fn(() => true);
  return canvas;
}

// jsdom lacks PointerEvent; keep browser coordinates explicit and synthetic.
function pointer(node: Element, type: string, values: Record<string, unknown> = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: 400, clientY: 200, ...values });
  Object.defineProperties(event, { pointerId: { value: values.pointerId ?? 4 }, pointerType: { value: values.pointerType ?? 'mouse' } });
  fireEvent(node, event);
  return event;
}

test('primary and middle mouse background drags pan only this canvas and release capture', () => {
  render(<Canvas />); const canvas = geometry(), background = screen.getByTestId('background');
  canvas.scrollLeft = 100;
  pointer(background, 'pointerdown');
  pointer(canvas, 'pointermove', { clientX: 320, clientY: 180 });
  expect(canvas.scrollLeft).toBe(180);
  expect(canvas.scrollTop).toBe(20);
  expect(canvas).toHaveAttribute('data-panning', 'true');
  pointer(canvas, 'pointerup', { buttons: 0 });
  expect(canvas.releasePointerCapture).toHaveBeenCalledWith(4);
  expect(canvas).not.toHaveAttribute('data-panning');
  expect(document.body.style.cursor).toBe('');
  pointer(background, 'pointerdown', { button: 1, buttons: 4 });
  pointer(canvas, 'pointermove', { buttons: 4, clientX: 350 });
  expect(canvas.scrollLeft).toBe(230);
});

test('card, text, controls, touch, and a blocked canvas never start panning', () => {
  const view = render(<Canvas />); const canvas = geometry();
  for (const target of [screen.getByText('Task text'), screen.getByRole('button'), screen.getByText('List text')]) pointer(target, 'pointerdown');
  pointer(screen.getByTestId('background'), 'pointerdown', { pointerType: 'touch' });
  expect(canvas.setPointerCapture).not.toHaveBeenCalled();
  view.rerender(<Canvas blocked />);
  pointer(screen.getByTestId('background'), 'pointerdown');
  expect(canvas.setPointerCapture).not.toHaveBeenCalled();
});

test('empty column list padding supports mouse panning', () => {
  render(<Canvas />); const canvas = geometry();
  pointer(screen.getByTestId('list'), 'pointerdown');
  pointer(canvas, 'pointermove', { clientX: 300 });
  expect(canvas.scrollLeft).toBe(100);
});

test.each(['pointercancel', 'lostpointercapture'])('%s stops further movement', type => {
  render(<Canvas />); const canvas = geometry();
  pointer(screen.getByTestId('background'), 'pointerdown');
  pointer(canvas, type);
  pointer(canvas, 'pointermove', { clientX: 50 });
  expect(canvas.scrollLeft).toBe(0);
  expect(canvas).not.toHaveAttribute('data-panning');
});

test('scope replacement and unmount release an in-flight capture without global styles', () => {
  const view = render(<Canvas />); const canvas = geometry();
  pointer(screen.getByTestId('background'), 'pointerdown');
  view.rerender(<Canvas scope="project-b" />);
  expect(canvas.releasePointerCapture).toHaveBeenCalledWith(4);
  pointer(canvas, 'pointermove', { clientX: 50 });
  expect(canvas.scrollLeft).toBe(0);
  pointer(screen.getByTestId('background'), 'pointerdown');
  view.unmount();
  expect(canvas.releasePointerCapture).toHaveBeenCalledTimes(2);
  expect(document.body.style.userSelect).toBe('');
});

test('wheel and Shift-wheel move the canvas while vertical list scrolling and zoom remain native', () => {
  render(<Canvas />); const canvas = geometry();
  expect(fireEvent.wheel(canvas, { deltaY: 60 })).toBe(false);
  expect(canvas.scrollLeft).toBe(60);
  fireEvent.wheel(canvas, { deltaY: 40, shiftKey: true });
  expect(canvas.scrollLeft).toBe(100);
  const list = screen.getByTestId('list');
  Object.defineProperties(list, { scrollHeight: { value: 900 }, clientHeight: { value: 200 } });
  expect(fireEvent.wheel(list, { deltaY: 50 })).toBe(true);
  expect(canvas.scrollLeft).toBe(100);
  expect(fireEvent.wheel(canvas, { deltaY: 50, ctrlKey: true })).toBe(true);
  expect(canvas.scrollLeft).toBe(100);
});
