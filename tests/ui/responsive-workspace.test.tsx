import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createFixtureClient } from '@living-playbooks/api-client';
import { App } from '../../apps/web/src/app/App';
import { memoryDrafts, snapshot } from './helpers';

let resize: (width: number) => void;
beforeEach(() => {
  resize = () => {};
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = width => callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    observe() {} disconnect() {} unobserve() {}
  });
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId: number; constructor(type: string, options: PointerEventInit = {}) { super(type, options); this.pointerId = options.pointerId ?? 1; } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function setup() {
  const seed = snapshot();
  const next = { ...seed.project.tasks[0]!, id: crypto.randomUUID(), title: 'Review the recording', status: 'in_progress' as const };
  seed.project.tasks[0]!.status = 'done'; seed.project.tasks.push(next);
  seed.project.workspace.panels.push({ id: crypto.randomUUID(), type: 'next_action', heading: 'Duplicate suggestion', taskId: next.id });
  const client = createFixtureClient({ snapshots: [seed] });
  const result = render(<App client={client} drafts={memoryDrafts()} fixture />);
  await screen.findByRole('heading', { name: seed.project.title, level: 1 });
  return { ...result, seed, next, client };
}

test('both separators resize independently with arrows, modified steps, Home/End, current bounds and reset', async () => {
  await setup(); act(() => resize(1440));
  const left = screen.getByRole('separator', { name: 'Resize projects' }), right = screen.getByRole('separator', { name: 'Resize conversation' });
  expect(left).toHaveAttribute('aria-orientation', 'vertical'); expect(left).toHaveAttribute('aria-controls', 'projects-panel');
  const before = Number(left.getAttribute('aria-valuenow')), other = right.getAttribute('aria-valuenow');
  fireEvent.keyDown(left, { key: 'ArrowRight' }); expect(Number(left.getAttribute('aria-valuenow'))).toBe(before + 10);
  fireEvent.keyDown(left, { key: 'ArrowLeft', shiftKey: true }); expect(Number(left.getAttribute('aria-valuenow'))).toBe(before - 50 + 10);
  expect(right).toHaveAttribute('aria-valuenow', other!);
  fireEvent.keyDown(right, { key: 'Home' }); expect(right.getAttribute('aria-valuenow')).toBe(right.getAttribute('aria-valuemin'));
  fireEvent.keyDown(left, { key: 'End' }); expect(left.getAttribute('aria-valuenow')).toBe(left.getAttribute('aria-valuemax'));
  act(() => resize(1080));
  expect(Number(left.getAttribute('aria-valuenow')) + Number(right.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(1080 - 420 - 12);
  act(() => resize(2000)); expect(left.getAttribute('aria-valuenow')).toBe(left.getAttribute('aria-valuemax'));
  await userEvent.click(screen.getByRole('button', { name: 'Reset pane widths' }));
  expect(left).toHaveAttribute('aria-valuenow', '240'); expect(right).toHaveAttribute('aria-valuenow', '340');
});

test('pointer capture isolates pointer ids and cleans drag state on cancel, lost capture, narrow and unmount', async () => {
  const { unmount, container } = await setup(); act(() => resize(1440));
  const handle = screen.getByRole('separator', { name: 'Resize projects' });
  const capture = vi.fn(), release = vi.fn(); handle.setPointerCapture = capture; handle.releasePointerCapture = release; handle.hasPointerCapture = () => true;
  fireEvent.pointerDown(handle, { pointerId: 7, clientX: 240, button: 0 }); expect(capture).toHaveBeenCalledWith(7);
  fireEvent.pointerMove(handle, { pointerId: 8, clientX: 300 }); expect(handle).toHaveAttribute('aria-valuenow', '240');
  fireEvent.pointerMove(handle, { pointerId: 7, clientX: 300 }); expect(handle).toHaveAttribute('aria-valuenow', '300');
  fireEvent.pointerCancel(handle, { pointerId: 7 }); expect(container.querySelector('[data-resizing=true]')).toBeNull(); expect(release).toHaveBeenCalledWith(7);
  fireEvent.pointerDown(handle, { pointerId: 9, clientX: 300, button: 0 }); fireEvent.lostPointerCapture(handle, { pointerId: 9 });
  expect(container.querySelector('[data-resizing=true]')).toBeNull();
  fireEvent.pointerDown(handle, { pointerId: 10, clientX: 300, button: 0 }); act(() => resize(500));
  expect(container.querySelector('[data-resizing=true]')).toBeNull();
  act(() => resize(1440)); fireEvent.pointerDown(handle, { pointerId: 11, clientX: 300, button: 0 }); unmount();
  expect(release).toHaveBeenCalledWith(11); expect(document.body.style.cursor).toBe(''); expect(document.body.style.userSelect).toBe('');
});

test('canvas and manager skip completed suggestions, deduplicate next actions and open actual details', async () => {
  const { next } = await setup();
  expect(screen.getAllByText('Review the recording')).toHaveLength(2);
  expect(screen.queryByRole('heading', { name: 'Duplicate suggestion' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Open task' }));
  const detail = screen.getByRole('dialog', { name: 'Task details' }); expect(within(detail).getByRole('heading', { name: next.title })).toBeVisible();
  expect(within(detail).getByText('No evidence yet')).toBeVisible();
});

test('visible task checkboxes update canonical status and recorded check-in clearly marks the linked task done', async () => {
  const { seed, client } = await setup();
  const action = vi.spyOn(client, 'applyAction'), answer = vi.spyOn(client, 'answerCheckIn');
  await userEvent.click(screen.getByRole('button', { name: 'Mark task done' }));
  expect(answer).toHaveBeenCalledWith(seed.checkIns[0]!.id, expect.objectContaining({ input: { kind: 'recorded' } }));
  expect(await screen.findByText('Answer saved: Task marked done')).toBeVisible();
  expect((await client.getSnapshot(seed.project.id)).project.tasks[0]!.status).toBe('done');
  await userEvent.click(screen.getByRole('checkbox', { name: `Mark ${seed.project.tasks[0]!.title} as to do` }));
  expect(action).toHaveBeenCalledWith(seed.project.id, expect.objectContaining({ input: { type: 'update_task', taskId: seed.project.tasks[0]!.id, status: 'todo' } }));
});

test('narrow drawers keep workspace mounted, trap focus, close with Escape and return focus without losing drafts', async () => {
  await setup(); act(() => resize(500));
  const trigger = screen.getByRole('button', { name: 'Chat' }); await userEvent.click(trigger);
  const panel = screen.getByRole('dialog', { name: 'Manager chat' });
  expect(screen.getByRole('main', { hidden: true })).toHaveAttribute('inert');
  const composer = within(panel).getByRole('textbox', { name: /Message to/ });
  await userEvent.type(composer, 'Keep this draft'); fireEvent.keyDown(panel, { key: 'Escape' });
  expect(trigger).toHaveFocus(); expect(screen.getByRole('main')).not.toHaveAttribute('inert');
  await userEvent.click(trigger); expect(screen.getByRole('textbox', { name: /Message to/ })).toHaveValue('Keep this draft');
  act(() => resize(1440)); expect(screen.queryByRole('dialog', { name: 'Manager chat' })).toBeNull();
});
