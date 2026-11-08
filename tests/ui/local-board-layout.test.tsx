import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { TaskBoard } from '../../apps/web/src/features/board/TaskBoard';
import { boardKey, initialLocalBoard, readLocalBoard, reconcileLocalBoard, saveLocalBoard } from '../../apps/web/src/app/local-board-layout';
import { snapshot } from './helpers';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function storage(): Storage {
  const entries = new Map<string, string>();
  return { get length() { return entries.size; }, clear: () => entries.clear(), getItem: key => entries.get(key) ?? null, key: index => [...entries.keys()][index] ?? null, removeItem: key => { entries.delete(key); }, setItem: (key, value) => { entries.set(key, value); } };
}
const owner = 'owner', project = 'project';
function geometry() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const fixed = this.style.position === 'fixed' ? this : this.parentElement?.style.position === 'fixed' ? this.parentElement : null;
    const column = this.closest('[data-task-column]');
    const index = Math.max(0, [...document.querySelectorAll('[data-task-column]')].indexOf(column!));
    const card = this.closest('[data-board-task-id]');
    const cardIndex = column ? [...column.querySelectorAll('[data-board-task-id]')].indexOf(card!) : -1;
    const left = fixed ? Number.parseFloat(fixed.style.left) || 0 : index * 300;
    const top = fixed ? Number.parseFloat(fixed.style.top) || 0 : cardIndex < 0 ? 0 : 100 + cardIndex * 100;
    const width = fixed ? Number.parseFloat(fixed.style.width) || 240 : cardIndex < 0 ? 280 : 240;
    const height = fixed ? Number.parseFloat(fixed.style.height) || 80 : cardIndex < 0 ? 600 : 80;
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() { return {}; } };
  });
}

test('full card mouse drop saves a local placement that survives reload without changing task status', async () => {
  geometry();
  const value = snapshot(), disk = storage(), original = value.project.tasks.map(task => task.status), changed = vi.fn();
  function Board() {
    const [board, setBoard] = useState(() => readLocalBoard(disk, owner, project, value.project.tasks));
    return <TaskBoard snapshot={value} columns={board.columns} disabled={false} onColumnsChange={next => { changed(next); setBoard(saveLocalBoard(disk, owner, project, next, value.project.tasks)); }} openTask={vi.fn()} closeTask={vi.fn()} correctTask={vi.fn()} />;
  }
  render(<Board />);
  const task = value.project.tasks[0]!;
  fireEvent.mouseDown(document.querySelector(`[data-board-task-id="${task.id}"]`)!, { button: 0, clientX: 120, clientY: 140 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 130, clientY: 140 });
  await waitFor(() => expect(document.querySelector('[data-board-drag-preview]')).toBeInTheDocument());
  fireEvent.mouseMove(document, { buttons: 1, clientX: 430, clientY: 140 });
  await waitFor(() => expect(document.querySelector('[data-task-column="local:next"]')).toContainElement(screen.getByRole('button', { name: `Open task: ${task.title}` })));
  fireEvent.mouseUp(document, { button: 0, clientX: 430, clientY: 140 });
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  const restored = readLocalBoard(disk, owner, project, value.project.tasks);
  expect(restored.status).toBe('saved');
  expect(restored.columns[1]!.taskIds).toContain(task.id);
  expect(value.project.tasks.map(item => item.status)).toEqual(original);
  expect(readLocalBoard(disk, owner, 'other', value.project.tasks).columns).toEqual(initialLocalBoard(value.project.tasks));
  expect(readLocalBoard(disk, 'other', project, value.project.tasks).columns).toEqual(initialLocalBoard(value.project.tasks));
});

test('reconciles added and removed tasks without carrying stale placements', () => {
  const value = snapshot(), disk = storage(), tasks = value.project.tasks;
  const board = initialLocalBoard(tasks);
  board[1]!.taskIds.push(board[0]!.taskIds.shift()!);
  const saved = saveLocalBoard(disk, owner, project, board, tasks);
  const added = { ...tasks[0]!, id: '00000000-0000-4000-8000-000000000999' };
  const next = [added, ...tasks.slice(1)];
  const reconciled = reconcileLocalBoard(saved, next);
  expect(reconciled.status).toBe('unsaved');
  expect(reconciled.columns[0]!.taskIds).toContain(added.id);
  expect(reconciled.columns.flatMap(column => column.taskIds)).not.toContain(tasks[0]!.id);
  expect(readLocalBoard(disk, owner, project, next)).toEqual(reconciled);
});

test.each(['{', 'x'.repeat(20000), JSON.stringify({ version: 1, columns: [{ id: '__proto__', title: 'bad', kind: 'workflow', taskIds: [] }] })])('rejects malformed or oversized saved layouts', raw => {
  const value = snapshot(), disk = storage(); disk.setItem(boardKey(owner, project), raw);
  expect(readLocalBoard(disk, owner, project, value.project.tasks)).toEqual({ columns: initialLocalBoard(value.project.tasks), status: 'unsaved' });
});

test('storage failure keeps the move in memory without claiming it was saved', () => {
  const tasks = snapshot().project.tasks, disk = storage();
  disk.setItem = () => { throw new Error('denied'); };
  const columns = initialLocalBoard(tasks);
  expect(saveLocalBoard(disk, owner, project, columns, tasks)).toEqual({ columns, status: 'unavailable' });
  disk.getItem = () => { throw new Error('denied'); };
  expect(readLocalBoard(disk, owner, project, tasks).status).toBe('unavailable');
});
