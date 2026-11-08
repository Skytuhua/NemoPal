import { expect, test } from 'vitest';
import { snapshot } from './helpers';
import { createPreviewBoard, reconcilePreviewBoard } from '../../apps/web/src/app/preview-board';

test('sample columns reference only actual task identities without changing canonical status or evidence', () => {
  const value = snapshot(), before = structuredClone(value.project.tasks);
  const columns = createPreviewBoard(value.project.tasks);
  expect(columns.flatMap(column => column.taskIds)).toEqual(value.project.tasks.map(task => task.id));
  expect(columns.find(column => column.kind === 'deferred')?.taskIds).toEqual([]);
  expect(value.project.tasks).toEqual(before);
});

test('sample refresh preserves moved memberships and adds or removes only actual task IDs', () => {
  const tasks = snapshot().project.tasks, columns = createPreviewBoard(tasks);
  const id = tasks[0]!.id;
  columns.forEach(column => { column.taskIds = column.taskIds.filter(taskId => taskId !== id); });
  columns.find(column => column.kind === 'deferred')!.taskIds.push(id);
  expect(reconcilePreviewBoard(columns, [...tasks].reverse())).toBe(columns);
  const next = [...tasks.slice(0, 1), { ...tasks[0]!, id: '00000000-0000-4000-8000-000000009999' }];
  const result = reconcilePreviewBoard(columns, next);
  expect(result.find(column => column.kind === 'deferred')!.taskIds).toEqual([id]);
  expect(result.flatMap(column => column.taskIds).sort()).toEqual(next.map(task => task.id).sort());
  expect(result.flatMap(column => column.taskIds)).toHaveLength(next.length);
});
