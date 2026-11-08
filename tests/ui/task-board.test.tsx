import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { TaskStatusSchema, type ProjectSnapshot } from '@living-playbooks/contracts';
import { TaskBoard } from '../../apps/web/src/features/board/TaskBoard';
import type { BoardColumnView } from '../../apps/web/src/features/board/board-view';
import { snapshot } from './helpers';

afterEach(async () => {
  cleanup();
  // dnd-kit removes its document click suppressor 50ms after a mouse drag.
  // Let that listener retire before the next test sends a click.
  await new Promise(resolve => setTimeout(resolve, 80));
});
function project(count: number): ProjectSnapshot {
  const value = snapshot();
  value.project.tasks = Array.from({ length: count }, (_, index) => ({
    ...value.project.tasks[0]!, id: `00000000-0000-4000-8000-${String(500 + index).padStart(12, '0')}`,
    title: `Project task ${index + 1}`, status: TaskStatusSchema.options[index % 5]!,
    evidenceLevel: 'none', evidenceIds: [], ownerOverride: false,
  }));
  value.project.workspace.panels = [];
  value.checkIns = [];
  return value;
}
const callbacks = () => ({ openTask: vi.fn(), closeTask: vi.fn(), correctTask: vi.fn() });

test.each([0, 1, 6, 40])('validated status fallback renders %i canonical tasks exactly once with true counts', count => {
  const value = project(count);
  const { container } = render(<TaskBoard snapshot={value} disabled={false} {...callbacks()} />);
  expect(container.querySelectorAll('.task-board-card')).toHaveLength(count);
  for (const status of TaskStatusSchema.options) {
    const matching = value.project.tasks.filter(task => task.status === status);
    const column = container.querySelector(`[data-task-column="${status}"]`);
    if (status === 'skipped' && matching.length === 0) { expect(column).toBeNull(); continue; }
    expect(column).toBeInTheDocument();
    expect(column!.querySelector('[data-task-count]')).toHaveTextContent(String(matching.length));
    expect(column!.querySelectorAll('.task-board-card')).toHaveLength(matching.length);
  }
  for (const task of value.project.tasks) expect(screen.getByRole('button', { name: `Open task: ${task.title}` })).toBeVisible();
  const ids = [...container.querySelectorAll('[id]')].map(element => element.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('owner status changes call the guarded parent callback without manufacturing canonical completion', async () => {
  const value = project(1), calls = callbacks();
  const { rerender } = render(<TaskBoard snapshot={value} disabled={false} {...calls} />);
  const select = screen.getByRole('button', { name: 'Status: Project task 1 — To do' });
  await userEvent.click(select);
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Done' }));
  expect(calls.correctTask).toHaveBeenCalledExactlyOnceWith(value.project.tasks[0]!.id, 'done');
  expect(select).toHaveAttribute('aria-label', 'Status: Project task 1 — To do');
  expect(value.project.tasks[0]!.status).toBe('todo');
  rerender(<TaskBoard snapshot={value} disabled {...calls} />);
  expect(select).toBeDisabled();
});

test('cards open useful canonical details with provenance and only their actual evidence', async () => {
  const value = project(1), calls = callbacks(), task = value.project.tasks[0]!;
  task.dueAt = '2026-11-09T15:00:00.000Z';
  task.ownerOverride = true;
  task.requirementOrigin = 'owner';
  task.evidenceLevel = 'agent_reported';
  task.evidenceIds = [value.observations[0]!.id];
  value.observations[0]!.excerpt = 'The selected task was reported, not owner-confirmed.';
  const { rerender } = render(<TaskBoard snapshot={value} disabled={false} {...calls} />);
  await userEvent.click(screen.getByRole('button', { name: 'Open task: Project task 1' }));
  expect(calls.openTask).toHaveBeenCalledExactlyOnceWith(task.id);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  rerender(<TaskBoard snapshot={value} disabled={false} selectedTaskId={task.id} {...calls} />);
  const detail = screen.getByRole('dialog', { name: task.title });
  expect(within(detail).getByRole('heading', { name: task.title })).toBeVisible();
  expect(within(detail).getByRole('heading', { name: task.title })).toHaveFocus();
  await userEvent.click(within(detail).getByText('Supporting updates', { selector: 'summary' }));
  expect(within(detail).getAllByText('Agent reported')).toHaveLength(2);
  expect(within(detail).getByText('Owner correction')).toBeVisible();
  expect(within(detail).getByText(value.observations[0]!.excerpt!)).toBeVisible();
  await userEvent.click(within(detail).getByText('Source details', { selector: 'summary' }));
  expect(within(detail).getByText(value.observations[0]!.id, { exact: false })).toBeVisible();
  expect(within(detail).getByText('Due date')).toBeVisible();
  await userEvent.click(within(detail).getByRole('button', { name: 'Close task details' }));
  expect(calls.closeTask).toHaveBeenCalledOnce();
  rerender(<TaskBoard snapshot={value} disabled={false} {...calls} />);
  expect(screen.getByRole('button', { name: `Open task: ${task.title}` })).toHaveFocus();
});

test('unknown or removed task selections do not show stale fabricated details', () => {
  render(<TaskBoard snapshot={project(0)} disabled={false} selectedTaskId="removed-task" {...callbacks()} />);
  expect(screen.queryByRole('complementary', { name: 'Task details' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  expect(screen.getAllByText('No tasks')).toHaveLength(4);
});

test('a canonical column change restores the same task control without stealing unrelated focus', () => {
  const value = project(1), calls = callbacks();
  const view = render(<TaskBoard snapshot={value} disabled={false} {...calls} />);
  const previous = screen.getByRole('button', { name: 'Status: Project task 1 — To do' });
  previous.focus();
  const moved = structuredClone(value); moved.project.tasks[0]!.status = 'in_progress';
  view.rerender(<TaskBoard snapshot={moved} disabled={false} {...calls} />);
  expect(previous.isConnected).toBe(false);
  expect(screen.getByRole('button', { name: 'Status: Project task 1 — In progress' })).toHaveFocus();
  const outside = document.createElement('button'); document.body.append(outside);
  try {
    outside.focus();
    const next = structuredClone(moved); next.project.tasks[0]!.status = 'done';
    view.rerender(<TaskBoard snapshot={next} disabled={false} {...calls} />);
    expect(outside).toHaveFocus();
  } finally { outside.remove(); }
});

function columns(value: ProjectSnapshot): BoardColumnView[] {
  return [
    { id: 'research:custom', title: 'Shape the project', kind: 'workflow', taskIds: value.project.tasks.map(task => task.id) },
    { id: 'owner:later', title: 'When the owner is ready', kind: 'deferred', taskIds: [] },
    { id: 'release:custom', title: 'Ready to share', kind: 'workflow', taskIds: [] },
  ];
}

test.each([0, 1, 6, 40])('actual Dice primitives render %i tasks in arbitrary ordered columns independently of status', count => {
  const value = project(count), board = columns(value);
  if (count) { board[1]!.taskIds = [board[0]!.taskIds.shift()!]; }
  const { container } = render(<TaskBoard snapshot={value} columns={board} disabled={false} onColumnsChange={vi.fn()} {...callbacks()} />);
  expect(container.querySelector('[data-slot="kanban-board"]')).toBeInTheDocument();
  const rendered = [...container.querySelectorAll('[data-slot="kanban-column"]')];
  expect(rendered.map(node => node.getAttribute('data-task-column'))).toEqual(board.map(column => column.id));
  expect(container.querySelectorAll('[data-slot="kanban-item"]')).toHaveLength(count);
  for (const [index, column] of board.entries()) {
    expect(within(rendered[index]! as HTMLElement).getByRole('heading', { name: column.title })).toBeVisible();
    expect(rendered[index]!.querySelectorAll('[data-board-task-id]')).toHaveLength(column.taskIds.length);
  }
  if (count) expect(rendered[1]).toContainElement(screen.getByRole('button', { name: 'Open task: Project task 1' }));
  expect(value.project.tasks[0]?.status).toBe(count ? 'todo' : undefined);
  expect(container.querySelectorAll('[data-slot="kanban-column-handle"]')).toHaveLength(3);
  expect(container.querySelectorAll('[data-slot="kanban-item-handle"]')).toHaveLength(count);
});

test.each([
  ['unknown reference', (board: BoardColumnView[]) => { board[0]!.taskIds = ['missing']; }],
  ['missing membership', (board: BoardColumnView[]) => { board[0]!.taskIds = []; }],
  ['duplicate membership', (board: BoardColumnView[]) => { board[1]!.taskIds = [...board[0]!.taskIds]; }],
  ['duplicate column identity', (board: BoardColumnView[]) => { board[1]!.id = board[0]!.id; }],
  ['multiple deferred columns', (board: BoardColumnView[]) => { board[0]!.kind = 'deferred'; }],
  ['empty column list', (board: BoardColumnView[]) => { board.splice(0); }],
  ['too many columns', (board: BoardColumnView[]) => { board.push(...Array.from({ length: 10 }, (_, index) => ({ id: `extra-${index}`, title: 'Extra', kind: 'workflow' as const, taskIds: [] }))); }],
  ['blank title', (board: BoardColumnView[]) => { board[0]!.title = ' '; }],
] as const)('invalid explicit board rejects %s instead of using status fallback', (_name, breakBoard) => {
  const value = project(1), board = columns(value); breakBoard(board);
  expect(() => render(<TaskBoard snapshot={value} columns={board} disabled={false} {...callbacks()} />)).toThrow(/board/i);
});

// Real Dice/dnd-kit sensors with synthetic rectangles: jsdom provides no physical layout proof.
function syntheticBoardGeometry() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const fixed = this.style.position === 'fixed' ? this : this.parentElement?.style.position === 'fixed' ? this.parentElement : null;
    const column = this.closest('[data-task-column]');
    const columnIndex = Math.max(0, [...document.querySelectorAll('[data-task-column]')].indexOf(column!));
    const card = this.closest('[data-board-task-id]');
    const cardIndex = column ? [...column.querySelectorAll('[data-board-task-id]')].indexOf(card!) : -1;
    const left = fixed ? Number.parseFloat(fixed.style.left) || 0 : columnIndex * 300;
    const top = fixed ? Number.parseFloat(fixed.style.top) || 0 : cardIndex < 0 ? 0 : 100 + cardIndex * 100;
    const width = fixed ? Number.parseFloat(fixed.style.width) || 240 : cardIndex < 0 ? 280 : 240;
    const height = fixed ? Number.parseFloat(fixed.style.height) || 80 : cardIndex < 0 ? 600 : 80;
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() { return {}; } };
  });
}

function BoardFixture({ value, changed = vi.fn() }: { value: ProjectSnapshot; changed?: (next: BoardColumnView[]) => void }) {
  const [board, setBoard] = useState(() => columns(value));
  return <TaskBoard snapshot={value} columns={board} disabled={false} onColumnsChange={next => { changed(next); setBoard(next); }} {...callbacks()} />;
}

test('keyboard drop commits accepted cross-column membership exactly once without changing status', async () => {
  syntheticBoardGeometry();
  const value = project(2), changed = vi.fn();
  render(<BoardFixture value={value} changed={changed} />);
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'Move task: Project task 1' }).focus();
  await user.keyboard('[Space][ArrowRight]');
  const destination = document.querySelector('[data-task-column="owner:later"]')!;
  await waitFor(() => expect(destination).toContainElement(screen.getByRole('button', { name: 'Open task: Project task 1' })));
  expect(changed).not.toHaveBeenCalled();
  await user.keyboard('[Space]');
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(changed.mock.calls[0]![0]).toEqual([
    { ...columns(value)[0]!, taskIds: [value.project.tasks[1]!.id] },
    { ...columns(value)[1]!, taskIds: [value.project.tasks[0]!.id] },
    columns(value)[2],
  ]);
  expect(value.project.tasks.map(task => task.status)).toEqual(['todo', 'in_progress']);
});

test('Escape restores pickup membership with no persistence callback', async () => {
  syntheticBoardGeometry();
  const value = project(1), changed = vi.fn();
  render(<BoardFixture value={value} changed={changed} />);
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'Move task: Project task 1' }).focus();
  await user.keyboard('[Space][ArrowRight]');
  await waitFor(() => expect(document.querySelector('[data-task-column="owner:later"]')).toContainElement(screen.getByRole('button', { name: 'Open task: Project task 1' })));
  await user.keyboard('[Escape]');
  await waitFor(() => expect(document.querySelector('[data-task-column="research:custom"]')).toContainElement(screen.getByRole('button', { name: 'Open task: Project task 1' })));
  expect(changed).not.toHaveBeenCalled();
});

test('keyboard column sort reports fresh stable identities and unchanged memberships', async () => {
  syntheticBoardGeometry();
  const value = project(1), changed = vi.fn();
  render(<BoardFixture value={value} changed={changed} />);
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'Move column: Shape the project' }).focus();
  await user.keyboard('[Space][ArrowRight][Space]');
  await waitFor(() => expect(changed).toHaveBeenCalledExactlyOnceWith([columns(value)[1], columns(value)[0], columns(value)[2]]));
});

test('read-only fallback and missing callback expose disabled drag handles while task controls remain usable', async () => {
  const value = project(1), calls = callbacks();
  const view = render(<TaskBoard snapshot={value} disabled={false} {...calls} />);
  expect(screen.getByRole('button', { name: 'Move task: Project task 1' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Open task: Project task 1' }));
  expect(calls.openTask).toHaveBeenCalledOnce();
  view.rerender(<TaskBoard snapshot={value} columns={columns(value)} disabled={false} {...calls} />);
  expect(screen.getByRole('button', { name: 'Move task: Project task 1' })).toBeDisabled();
});

test('same-column keyboard sorting commits the accepted order once', async () => {
  syntheticBoardGeometry();
  const value = project(2), changed = vi.fn();
  render(<BoardFixture value={value} changed={changed} />);
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'Move task: Project task 1' }).focus();
  await user.keyboard('[Space][ArrowDown]');
  await waitFor(() => expect([...document.querySelectorAll('[data-board-task-id]')].map(node => node.getAttribute('data-board-task-id'))).toEqual([value.project.tasks[1]!.id, value.project.tasks[0]!.id]));
  await user.keyboard('[Space]');
  expect(changed).toHaveBeenCalledExactlyOnceWith([{ ...columns(value)[0]!, taskIds: [value.project.tasks[1]!.id, value.project.tasks[0]!.id] }, columns(value)[1], columns(value)[2]]);
});

test.each(['snapshot', 'columns', 'disabled', 'callback'] as const)('external %s replacement cancels accepted drag with no stale callback', async kind => {
  syntheticBoardGeometry();
  const value = project(1), board = columns(value), changed = vi.fn(), calls = callbacks();
  const view = render(<TaskBoard snapshot={value} columns={board} onColumnsChange={changed} disabled={false} {...calls} />);
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'Move task: Project task 1' }).focus();
  await user.keyboard('[Space][ArrowRight]');
  await waitFor(() => expect(document.querySelector('[data-task-column="owner:later"]')).toContainElement(screen.getByRole('button', { name: 'Open task: Project task 1' })));
  view.rerender(<TaskBoard snapshot={kind === 'snapshot' ? structuredClone(value) : value} columns={kind === 'columns' ? structuredClone(board) : board} onColumnsChange={kind === 'callback' ? undefined : changed} disabled={kind === 'disabled'} {...calls} />);
  await waitFor(() => expect(document.querySelector('[data-board-drag-preview]')).not.toBeInTheDocument());
  await user.keyboard('[Space][Escape]');
  expect(changed).not.toHaveBeenCalled();
  expect(document.querySelector('[data-task-column="research:custom"]')).toContainElement(screen.getByRole('button', { name: 'Open task: Project task 1' }));
});

test('permission revocation before any preview immediately removes the drag overlay', async () => {
  syntheticBoardGeometry();
  const value = project(1), board = columns(value), changed = vi.fn();
  const view = render(<TaskBoard snapshot={value} columns={board} onColumnsChange={changed} disabled={false} {...callbacks()} />);
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'Move task: Project task 1' }).focus();
  await user.keyboard('[Space]');
  await waitFor(() => expect(document.querySelector('[data-board-drag-preview]')).toBeInTheDocument());
  view.rerender(<TaskBoard snapshot={value} columns={board} onColumnsChange={changed} disabled {...callbacks()} />);
  await waitFor(() => expect(document.querySelector('[data-board-drag-preview]')).not.toBeInTheDocument());
  expect(changed).not.toHaveBeenCalled();
});

test('explicit null board data is rejected instead of projecting statuses', () => {
  expect(() => render(<TaskBoard snapshot={project(1)} columns={null as unknown as BoardColumnView[]} disabled={false} {...callbacks()} />)).toThrow(/board/i);
});

test('canonical explicit reparent preserves the focused control and long labels intact', () => {
  const value = project(1), board = columns(value), calls = callbacks();
  value.project.tasks[0]!.title = 'Read the complete project evidence and retain this very long task title without clipping or replacing its identity';
  board[0]!.title = 'A project-specific workflow column with a long descriptive title';
  const view = render(<TaskBoard snapshot={value} columns={board} disabled={false} {...calls} />);
  const control = screen.getByRole('button', { name: `Status: ${value.project.tasks[0]!.title} — To do` }); control.focus();
  const next = structuredClone(board); next[1]!.taskIds = next[0]!.taskIds; next[0]!.taskIds = [];
  view.rerender(<TaskBoard snapshot={value} columns={next} disabled={false} {...calls} />);
  expect(screen.getByRole('button', { name: `Status: ${value.project.tasks[0]!.title} — To do` })).toHaveFocus();
  expect(screen.getByRole('heading', { name: board[0]!.title })).toBeVisible();
});

test('a retired keyboard drag cannot interfere with a fresh pickup after permission returns', async () => {
  syntheticBoardGeometry();
  const value = project(1), board = columns(value), changed = vi.fn(), calls = callbacks();
  const view = render(<TaskBoard snapshot={value} columns={board} onColumnsChange={changed} disabled={false} {...calls} />);
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'Move task: Project task 1' }).focus();
  await user.keyboard('[Space][ArrowRight]');
  view.rerender(<TaskBoard snapshot={value} columns={board} onColumnsChange={changed} disabled {...calls} />);
  view.rerender(<TaskBoard snapshot={value} columns={board} onColumnsChange={changed} disabled={false} {...calls} />);
  screen.getByRole('button', { name: 'Move task: Project task 1' }).focus();
  await user.keyboard('[Space][ArrowRight][Escape]');
  expect(changed).not.toHaveBeenCalled();
  expect(document.querySelector('[data-task-column="research:custom"]')).toContainElement(screen.getByRole('button', { name: 'Open task: Project task 1' }));
});

test('the real mouse sensor moves a task from its card surface and preserves canonical status', async () => {
  syntheticBoardGeometry();
  const value = project(1), changed = vi.fn();
  render(<BoardFixture value={value} changed={changed} />);
  const card = document.querySelector<HTMLElement>('[data-board-task-id]')!;
  fireEvent.mouseDown(card, { button: 0, clientX: 120, clientY: 140 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 130, clientY: 140 });
  await waitFor(() => expect(document.querySelector('[data-board-drag-preview]')).toBeInTheDocument());
  fireEvent.mouseMove(document, { buttons: 1, clientX: 430, clientY: 140 });
  await waitFor(() => expect(document.querySelector('[data-task-column="owner:later"]')).toContainElement(screen.getByRole('button', { name: 'Open task: Project task 1' })));
  fireEvent.mouseUp(document, { button: 0, clientX: 430, clientY: 140 });
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(changed.mock.calls[0]![0][1].taskIds).toEqual([value.project.tasks[0]!.id]);
  expect(value.project.tasks[0]!.status).toBe('todo');
});

test('status is a labelled icon menu with keyboard radio choices and no optimistic canonical change', async () => {
  const value = project(1), calls = callbacks();
  render(<TaskBoard snapshot={value} disabled={false} {...calls} />);
  const trigger = screen.getByRole('button', { name: 'Status: Project task 1 — To do' });
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  trigger.focus();
  await userEvent.keyboard('[Enter]');
  expect(screen.getByRole('menu')).toBeVisible();
  await userEvent.keyboard('[End]');
  expect(screen.getByRole('menuitemradio', { name: 'Skipped' })).toHaveFocus();
  await userEvent.keyboard('[Enter]');
  expect(calls.correctTask).toHaveBeenCalledExactlyOnceWith(value.project.tasks[0]!.id, 'skipped');
  expect(value.project.tasks[0]!.status).toBe('todo');
  expect(trigger).toHaveFocus();
});

test('mouse Escape rolls back an accepted preview and the next surface pickup remains usable', async () => {
  syntheticBoardGeometry();
  const value = project(1), changed = vi.fn();
  render(<BoardFixture value={value} changed={changed} />);
  fireEvent.mouseDown(document.querySelector('[data-board-task-id]')!, { button: 0, clientX: 120, clientY: 140 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 130, clientY: 140 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 430, clientY: 140 });
  await waitFor(() => expect(document.querySelector('[data-task-column="owner:later"]')).toContainElement(screen.getByRole('button', { name: 'Open task: Project task 1' })));
  fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
  await waitFor(() => expect(document.querySelector('[data-task-column="research:custom"]')).toContainElement(screen.getByRole('button', { name: 'Open task: Project task 1' })));
  expect(changed).not.toHaveBeenCalled();
  fireEvent.mouseDown(document.querySelector('[data-board-task-id]')!, { button: 0, clientX: 120, clientY: 140 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 130, clientY: 140 });
  await waitFor(() => expect(document.querySelector('[data-board-drag-preview]')).toBeInTheDocument());
  fireEvent.mouseUp(document, { button: 0, clientX: 130, clientY: 140 });
});

test('status control retains mouse focus and never activates the card sensor; clicking the title opens details', async () => {
  syntheticBoardGeometry();
  const value = project(1), calls = callbacks();
  render(<TaskBoard snapshot={value} columns={columns(value)} onColumnsChange={vi.fn()} disabled={false} {...calls} />);
  for (const control of [screen.getByRole('button', { name: 'Status: Project task 1 — To do' })]) {
    await userEvent.pointer([{ target: control, keys: '[MouseLeft>]', coords: { clientX: 120, clientY: 140 } }, { coords: { clientX: 430, clientY: 140 } }, { keys: '[/MouseLeft]' }]);
    expect(document.querySelector('[data-board-drag-preview]')).not.toBeInTheDocument();
  }
  await userEvent.click(screen.getByRole('button', { name: 'Open task: Project task 1' }));
  expect(calls.openTask).toHaveBeenCalled();
});

test('dragging from the title uses the card mouse sensor and suppresses opening details', async () => {
  syntheticBoardGeometry();
  const value = project(1), changed = vi.fn(), calls = callbacks();
  render(<TaskBoard snapshot={value} columns={columns(value)} onColumnsChange={changed} disabled={false} {...calls} />);
  const title = screen.getByRole('button', { name: 'Open task: Project task 1' });
  fireEvent.mouseDown(title, { button: 0, clientX: 120, clientY: 140 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 130, clientY: 140 });
  await waitFor(() => expect(document.querySelector('[data-board-drag-preview]')).toBeInTheDocument());
  fireEvent.mouseMove(document, { buttons: 1, clientX: 430, clientY: 140 });
  await waitFor(() => expect(document.querySelector('[data-task-column="owner:later"]')).toContainElement(screen.getByRole('button', { name: 'Open task: Project task 1' })));
  fireEvent.mouseUp(document, { button: 0, clientX: 430, clientY: 140 });
  const currentTitle = document.querySelector<HTMLButtonElement>('[data-board-task-id] [data-card-control="open"]');
  expect(currentTitle?.isConnected).toBe(true);
  fireEvent.click(currentTitle!);
  expect(calls.openTask).not.toHaveBeenCalled();
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  // A later ordinary click must still open the current card.
  await new Promise(resolve => setTimeout(resolve, 80));
  const settledTitle = document.querySelector<HTMLButtonElement>('[data-board-task-id] [data-card-control="open"]');
  expect(settledTitle?.isConnected).toBe(true);
  fireEvent.click(settledTitle!);
  expect(calls.openTask).toHaveBeenCalledExactlyOnceWith(value.project.tasks[0]!.id);
});

test('the actual mouse column handle changes column order and keeps task membership', async () => {
  syntheticBoardGeometry();
  const value = project(1), changed = vi.fn();
  render(<BoardFixture value={value} changed={changed} />);
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Move column: Shape the project' }), { button: 0, clientX: 120, clientY: 30 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 130, clientY: 30 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 430, clientY: 30 });
  await waitFor(() => expect(document.querySelector('[data-board-drag-preview]')).toBeInTheDocument());
  fireEvent.mouseUp(document, { button: 0, clientX: 430, clientY: 30 });
  await waitFor(() => expect(changed).toHaveBeenCalledExactlyOnceWith([columns(value)[1], columns(value)[0], columns(value)[2]]));
});

test.each(['project', 'callback'] as const)('replacement %s retires a pickup before any preview and rejects late mouse events', async kind => {
  syntheticBoardGeometry();
  const value = project(1), board = columns(value), changed = vi.fn(), replacement = vi.fn();
  const view = render(<TaskBoard snapshot={value} columns={board} onColumnsChange={changed} disabled={false} {...callbacks()} />);
  fireEvent.mouseDown(document.querySelector('[data-board-task-id]')!, { button: 0, clientX: 120, clientY: 140 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 130, clientY: 140 });
  await waitFor(() => expect(document.querySelector('[data-board-drag-preview]')).toBeInTheDocument());
  const next = structuredClone(value); next.project.id = '00000000-0000-4000-8000-000000000099';
  view.rerender(<TaskBoard snapshot={kind === 'project' ? next : value} columns={board} onColumnsChange={kind === 'callback' ? replacement : changed} disabled={false} {...callbacks()} />);
  expect(document.querySelector('[data-board-drag-preview]')).not.toBeInTheDocument();
  fireEvent.mouseMove(document, { buttons: 1, clientX: 430, clientY: 140 });
  fireEvent.mouseUp(document, { button: 0, clientX: 430, clientY: 140 });
  expect(changed).not.toHaveBeenCalled();
  expect(replacement).not.toHaveBeenCalled();
  expect(document.querySelector('[data-task-column="research:custom"]')).toContainElement(screen.getByRole('button', { name: 'Open task: Project task 1' }));
});
