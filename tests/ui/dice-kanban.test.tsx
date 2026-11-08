import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as UI from '@living-playbooks/project-ui';

const { Kanban, KanbanBoard, KanbanColumn, KanbanColumnHandle, KanbanItem, KanbanItemHandle, KanbanOverlay } = UI;
type Item = { id: string; title: string };
type Board = Record<string, Item[]>;
const itemValue = (item: Item) => item.id;
const first = Object.freeze({ id: 'task:a', title: 'Shared title' });
const second = Object.freeze({ id: 'task:b', title: 'Shared title' });
const initial = () => Object.freeze({
  'research:custom': Object.freeze([first, second]),
  'owner:waiting': Object.freeze([]),
  'release:custom': Object.freeze([]),
}) as unknown as Board;

// Real dnd-kit sensors/collision detection, synthetic rectangles only: jsdom has no layout.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const fixed = this.style.position === 'fixed' ? this : this.parentElement?.style.position === 'fixed' ? this.parentElement : null;
    if (fixed) {
      const left = Number.parseFloat(fixed.style.left) || 0;
      const top = Number.parseFloat(fixed.style.top) || 0;
      const width = Number.parseFloat(fixed.style.width) || 240;
      const height = Number.parseFloat(fixed.style.height) || 60;
      return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() { return {}; } };
    }
    const column = this.closest<HTMLElement>('[data-column]');
    const columns = [...document.querySelectorAll('[data-column]')];
    const columnIndex = Math.max(0, columns.indexOf(column!));
    const card = this.closest<HTMLElement>('[data-card]');
    const cardIndex = column ? [...column.querySelectorAll('[data-card]')].indexOf(card!) : -1;
    const left = columnIndex * 300;
    const top = cardIndex < 0 ? 0 : 100 + cardIndex * 80;
    const width = cardIndex < 0 ? 280 : 240;
    const height = cardIndex < 0 ? 500 : 60;
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON() { return {}; } };
  });
});
afterEach(cleanup);

function Fixture({ changes = vi.fn(), move, disabled = false, replacement, click = vi.fn(), startValue, enabledHandleOverride, acceptPreview = true }: {
  changes?: (value: Board) => void;
  move?: UI.KanbanProps<Item>['onMove'];
  disabled?: boolean;
  replacement?: Board;
  click?: () => void;
  startValue?: Board;
  enabledHandleOverride?: boolean;
  acceptPreview?: boolean;
}) {
  const [value, setValue] = useState(startValue ?? initial);
  return <div className="workspace-ui" data-testid="workspace">
    <button onClick={() => replacement && setValue(replacement)}>Replace externally</button>
    <output data-testid="value">{JSON.stringify(value)}</output>
    <Kanban value={value} getItemValue={itemValue} onMove={move} onValueChange={next => { changes(next); if (acceptPreview) setValue(next); }}>
      <KanbanBoard aria-label="Project workflow">
        {Object.entries(value).map(([columnId, items]) => <KanbanColumn key={columnId} value={columnId} data-column={columnId} data-testid={columnId} disabled={disabled}>
          <KanbanColumnHandle aria-label={`Move column ${columnId}`} disabled={enabledHandleOverride ? false : undefined} />
          {items.map(item => <KanbanItem key={item.id} value={item.id} data-card={item.id} data-testid={item.id} disabled={disabled} onClick={click}>
            <span>{item.title}</span>
            <KanbanItemHandle aria-label={`Move ${item.id}`} disabled={enabledHandleOverride ? false : undefined} />
          </KanbanItem>)}
        </KanbanColumn>)}
      </KanbanBoard>
      <KanbanOverlay dropAnimation={null}>{({ value: activeId }) => <div data-testid="overlay-content">{activeId}</div>}</KanbanOverlay>
    </Kanban>
  </div>;
}

async function pickUp(taskId = 'task:a') {
  const user = userEvent.setup();
  screen.getByRole('button', { name: `Move ${taskId}` }).focus();
  await user.keyboard('[Space]');
  await waitFor(() => expect(screen.getByTestId('overlay-content')).toHaveTextContent(taskId));
  return user;
}

test('exports the composable controlled Kanban API', () => {
  for (const name of ['Kanban', 'KanbanBoard', 'KanbanColumn', 'KanbanColumnHandle', 'KanbanItem', 'KanbanItemHandle', 'KanbanOverlay'] as const) {
    expect(UI[name], name).toBeTypeOf('function');
  }
});

test('composes arbitrary column IDs and stable task IDs despite duplicate titles', () => {
  render(<Fixture />);
  expect(screen.getByTestId('research:custom')).toContainElement(screen.getByTestId('task:a'));
  expect(screen.getByTestId('research:custom')).toContainElement(screen.getByTestId('task:b'));
  expect(screen.getByTestId('owner:waiting')).toBeInTheDocument();
  expect(screen.getAllByText('Shared title')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Move task:a' })).toHaveAttribute('aria-controls', screen.getByTestId('task:a').id);
});

test('column handles reorder arbitrary columns with the keyboard without changing membership', async () => {
  render(<Fixture />);
  const user = userEvent.setup();
  screen.getByRole('button', { name: 'Move column research:custom' }).focus();
  await user.keyboard('[Space][ArrowRight][Space]');
  await waitFor(() => expect([...screen.getByLabelText('Project workflow').querySelectorAll('[data-column]')].map(node => node.getAttribute('data-column'))).toEqual(['owner:waiting', 'research:custom', 'release:custom']));
  expect(screen.getByTestId('research:custom')).toContainElement(screen.getByTestId('task:a'));
  expect(screen.getByTestId('research:custom')).toContainElement(screen.getByTestId('task:b'));
});

test('keyboard reorder commits the preview once with original move indices and announces it', async () => {
  const move = vi.fn();
  render(<Fixture move={move} />);
  const user = await pickUp();
  expect(document.querySelector('[role="status"]')).toHaveTextContent(/(?:Picked up item at position 1 of 2|item is now at position 1 of 2)/);
  expect(within(screen.getByTestId('research:custom')).getAllByTestId(/^task:/).map(node => node.dataset.card)).toEqual(['task:a', 'task:b']);
  await user.keyboard('[ArrowDown]');
  await waitFor(() => expect(within(screen.getByTestId('research:custom')).getAllByTestId(/^task:/).map(node => node.dataset.card)).toEqual(['task:b', 'task:a']));
  await user.keyboard('[Space]');
  expect(move).toHaveBeenCalledTimes(1);
  expect(move.mock.calls[0]?.[0]).toMatchObject({ active: { id: 'task:a' }, activeIndex: 0, overIndex: 1 });
  expect(within(screen.getByTestId('research:custom')).getAllByTestId(/^task:/).map(node => node.dataset.card)).toEqual(['task:b', 'task:a']);
  expect(document.querySelector('[role="status"]')).toHaveTextContent('dropped');
});

test('keyboard drops into an empty arbitrary column and reports the external move', async () => {
  const move = vi.fn();
  const changes = vi.fn();
  render(<Fixture move={move} changes={changes} />);
  const user = await pickUp();
  await user.keyboard('[ArrowRight]');
  await waitFor(() => expect(screen.getByTestId('owner:waiting')).toContainElement(screen.getByTestId('task:a')));
  await user.keyboard('[Space]');
  expect(move).toHaveBeenCalledTimes(1);
  expect(move.mock.calls[0]?.[0]).toMatchObject({ active: { id: 'task:a' }, activeIndex: 0, overIndex: 0 });
  expect(changes.mock.calls.at(-1)?.[0]).toEqual({ 'research:custom': [second], 'owner:waiting': [first], 'release:custom': [] });
});

test('callback-only keyboard movement announces a valid insertion position in an empty column', async () => {
  const move = vi.fn();
  render(<Fixture move={move} acceptPreview={false} />);
  const before = screen.getByTestId('value').textContent;
  const user = await pickUp();
  await user.keyboard('[ArrowRight]');
  await waitFor(() => expect(document.querySelector('[role="status"]')).toHaveTextContent('in owner:waiting'));
  expect(document.querySelector('[role="status"]')).toHaveTextContent('position 1 of 1');
  await user.keyboard('[Space]');
  expect(move).toHaveBeenCalledTimes(1);
  expect(move.mock.calls[0]?.[0]).toMatchObject({ active: { id: 'task:a' }, over: { id: 'owner:waiting' }, activeIndex: 0, overIndex: 0 });
  expect(screen.getByTestId('value').textContent).toBe(before);
});

test('Escape restores the exact original controlled draft without mutating caller arrays', async () => {
  const changes = vi.fn();
  const move = vi.fn();
  render(<Fixture changes={changes} move={move} />);
  const before = screen.getByTestId('value').textContent;
  const user = await pickUp();
  await user.keyboard('[ArrowRight]');
  await waitFor(() => expect(screen.getByTestId('owner:waiting')).toContainElement(screen.getByTestId('task:a')));
  await user.keyboard('[Escape]');
  expect(screen.getByTestId('value').textContent).toBe(before);
  expect(changes.mock.calls.at(-1)?.[0]).toEqual(initial());
  expect(Object.isFrozen(changes.mock.calls.at(-1)?.[0]['research:custom'])).toBe(true);
  expect(first).toEqual({ id: 'task:a', title: 'Shared title' });
  expect(move).not.toHaveBeenCalled();
});

test.each(['[Escape]', '[Space]'])('external replacement removing the destination is never overwritten by stale %s', async key => {
  const replacement = { 'research:custom': [second], 'server:new': [] };
  const changes = vi.fn();
  const move = vi.fn();
  render(<Fixture changes={changes} move={move} replacement={replacement} />);
  const user = await pickUp();
  await user.keyboard('[ArrowRight]');
  await waitFor(() => expect(screen.getByTestId('owner:waiting')).toContainElement(screen.getByTestId('task:a')));
  fireEvent.click(screen.getByRole('button', { name: 'Replace externally' }));
  await user.keyboard(key);
  expect(screen.getByTestId('value')).toHaveTextContent(JSON.stringify(replacement));
  expect(screen.queryByTestId('task:a')).not.toBeInTheDocument();
  expect(move).not.toHaveBeenCalled();
});

test('removing only the destination cancels the preview without discarding the surviving task', async () => {
  const replacement = { 'research:custom': [first, second], 'server:new': [] };
  const changes = vi.fn();
  const move = vi.fn();
  render(<Fixture replacement={replacement} changes={changes} move={move} />);
  const user = await pickUp();
  await user.keyboard('[ArrowRight]');
  await waitFor(() => expect(screen.getByTestId('owner:waiting')).toContainElement(screen.getByTestId('task:a')));
  const count = changes.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Replace externally' }));
  await user.keyboard('[ArrowRight][Space]');
  expect(screen.getByTestId('value')).toHaveTextContent(JSON.stringify(replacement));
  expect(changes).toHaveBeenCalledTimes(count);
  expect(move).not.toHaveBeenCalled();
});

test.each([false, true])('disabled parents cannot be bypassed by handle disabled=false (%s)', async enabledHandleOverride => {
  const changes = vi.fn();
  render(<Fixture disabled changes={changes} enabledHandleOverride={enabledHandleOverride} />);
  for (const handle of screen.getAllByRole('button', { name: /^Move / })) expect(handle).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Move task:a' }), { key: ' ', code: 'Space' });
  expect(screen.queryByTestId('overlay-content')).not.toBeInTheDocument();
  expect(changes).not.toHaveBeenCalled();
});

test('stable task IDs matching Object.prototype names remain item identities', async () => {
  const item = { id: 'constructor', title: 'Prototype-named task' };
  const move = vi.fn();
  render(<Fixture startValue={{ 'research:custom': [item], 'owner:waiting': [] }} move={move} />);
  const user = await pickUp('constructor');
  await user.keyboard('[ArrowRight]');
  await waitFor(() => expect(screen.getByTestId('owner:waiting')).toContainElement(screen.getByTestId('constructor')));
  await user.keyboard('[Space]');
  expect(move).toHaveBeenCalledTimes(1);
  expect(move.mock.calls[0]?.[0]).toMatchObject({ active: { id: 'constructor' }, activeIndex: 0, overIndex: 0 });
});

test('a controlled same-column drop without onMove does not reverse its accepted preview', async () => {
  render(<Fixture />);
  const user = await pickUp();
  await user.keyboard('[ArrowDown]');
  await waitFor(() => expect(within(screen.getByTestId('research:custom')).getAllByTestId(/^task:/).map(node => node.dataset.card)).toEqual(['task:b', 'task:a']));
  await user.keyboard('[Space]');
  expect(within(screen.getByTestId('research:custom')).getAllByTestId(/^task:/).map(node => node.dataset.card)).toEqual(['task:b', 'task:a']);
});

test('a dragging card cannot accidentally invoke its click action and overlay retains workspace scope', async () => {
  const click = vi.fn();
  render(<Fixture click={click} />);
  const user = await pickUp();
  const overlay = screen.getByTestId('overlay-content');
  expect(screen.getByTestId('workspace')).not.toContainElement(overlay);
  expect(overlay.closest('.workspace-ui')).toHaveAttribute('data-slot', 'kanban-overlay-scope');
  expect(overlay.closest('[data-slot="kanban-overlay-scope"]')).toHaveAttribute('inert');
  fireEvent.click(screen.getByTestId('task:a'));
  expect(click).not.toHaveBeenCalled();
  await user.keyboard('[Escape]');
  fireEvent.click(screen.getByTestId('task:a'));
  expect(click).toHaveBeenCalledTimes(1);
});

test('the real mouse sensor suppresses the click generated when a drag ends', async () => {
  const click = vi.fn();
  render(<Fixture click={click} />);
  const handle = screen.getByRole('button', { name: 'Move task:a' });
  fireEvent.mouseDown(handle, { button: 0, buttons: 1, clientX: 10, clientY: 110 });
  fireEvent.mouseMove(document, { buttons: 1, clientX: 40, clientY: 110 });
  await waitFor(() => expect(screen.getByTestId('overlay-content')).toBeInTheDocument());
  fireEvent.click(screen.getByTestId('task:a'));
  fireEvent.mouseUp(document, { button: 0, clientX: 40, clientY: 110 });
  fireEvent.click(screen.getByTestId('task:a'));
  expect(click).not.toHaveBeenCalled();
});
