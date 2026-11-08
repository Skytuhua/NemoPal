import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as UI from '@living-playbooks/project-ui';

const { Kanban, KanbanBoard, KanbanColumn, KanbanColumnHandle, KanbanItem, KanbanItemHandle, KanbanOverlay } = UI;
type Item = { id: string | number; title: string };
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

function Fixture({ changes = vi.fn(), move, disabled = false, replacement, click = vi.fn(), startValue, enabledHandleOverride, acceptPreview = true, forwarded, replaceOnEnd = false, replaceOnOver = false, numericColumns = false }: {
  changes?: (value: Board) => void;
  move?: UI.KanbanProps<Item>['onMove'];
  disabled?: boolean;
  replacement?: Board;
  click?: () => void;
  startValue?: Board;
  enabledHandleOverride?: boolean;
  acceptPreview?: boolean | ((next: Board) => boolean);
  forwarded?: Partial<UI.KanbanProps<Item>>;
  replaceOnEnd?: boolean;
  replaceOnOver?: boolean;
  numericColumns?: boolean;
}) {
  const [value, setValue] = useState(startValue ?? initial);
  return <div className="workspace-ui" data-testid="workspace">
    <button onClick={() => replacement && setValue(replacement)}>Replace externally</button>
    <output data-testid="value">{JSON.stringify(value)}</output>
    <Kanban {...forwarded} onDragOver={event => { if (replaceOnOver && event.over?.id === 'owner:waiting' && replacement) setValue(replacement); forwarded?.onDragOver?.(event); }} onDragEnd={event => { if (replaceOnEnd && replacement) setValue(replacement); forwarded?.onDragEnd?.(event); }} value={value} getItemValue={itemValue} onMove={move} onValueChange={next => { changes(next); if (typeof acceptPreview === 'function' ? acceptPreview(next) : acceptPreview) setValue(next); }}>
      <KanbanBoard aria-label="Project workflow">
        {Object.entries(value).map(([columnId, items]) => <KanbanColumn key={columnId} value={numericColumns && columnId === '0' ? 0 : columnId} data-column={columnId} data-testid={columnId} disabled={disabled}>
          <KanbanColumnHandle aria-label={`Move column ${columnId}`} disabled={enabledHandleOverride ? false : undefined} />
          {items.map(item => <KanbanItem key={item.id} value={item.id} data-card={item.id} data-testid={item.id} disabled={disabled} onClick={click}>
            <span>{item.title}</span>
            <KanbanItemHandle aria-label={`Move ${item.id}`} disabled={enabledHandleOverride ? false : undefined} />
          </KanbanItem>)}
        </KanbanColumn>)}
      </KanbanBoard>
      <KanbanOverlay dropAnimation={null}>{({ value: activeId }) => <div data-testid="overlay-content" data-variant={Object.hasOwn(value, activeId) ? 'column' : 'item'}>{activeId}</div>}</KanbanOverlay>
    </Kanban>
  </div>;
}

async function pickUp(taskId: string | number = 'task:a') {
  const user = userEvent.setup();
  screen.getByRole('button', { name: `Move ${taskId}` }).focus();
  await user.keyboard('[Space]');
  await waitFor(() => expect(screen.getByTestId('overlay-content')).toHaveTextContent(String(taskId)));
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


test.each(['intercolumn', 'intracolumn'] as const)('a declined later %s preview retains accepted rollback and drop authority', async kind => {
  const third = { id: 'task:c', title: 'Third task' };
  const startValue: Board = { 'research:custom': [first, second, third], 'owner:waiting': [], 'release:custom': [] };
  const changes = vi.fn(), move = vi.fn(); let offers = 0;
  const rendered = render(<Fixture startValue={startValue} changes={changes} move={move} acceptPreview={next => next === startValue || ++offers === 1} />);
  const user = await pickUp();
  const direction = kind === 'intercolumn' ? '[ArrowRight]' : '[ArrowDown]';
  await user.keyboard(direction);
  await waitFor(() => expect(changes).toHaveBeenCalledTimes(1));
  const accepted = changes.mock.calls[0]![0] as Board;
  await user.keyboard(direction);
  await waitFor(() => expect(changes).toHaveBeenCalledTimes(2));
  await user.keyboard('[Escape]');
  expect(changes.mock.calls.at(-1)![0]).toBe(startValue);
  expect(screen.getByTestId('value').textContent).toBe(JSON.stringify(startValue));
  expect(move).not.toHaveBeenCalled();
  rendered.unmount();
  offers = 0; changes.mockClear();
  render(<Fixture startValue={startValue} changes={changes} move={move} acceptPreview={next => next === startValue || ++offers === 1} />);
  const nextUser = await pickUp();
  await nextUser.keyboard(direction); await nextUser.keyboard(direction);
  await waitFor(() => expect(changes).toHaveBeenCalledTimes(2));
  await nextUser.keyboard('[Space]');
  expect(move).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('value').textContent).toBe(JSON.stringify(accepted));
  expect(move.mock.calls[0]![0]).toMatchObject({ activeIndex: 0, overIndex: kind === 'intercolumn' ? 0 : 1 });
});

test.each(['column', 'item'] as const)('consumer replacement in onDragEnd has final authority for %s drop', async kind => {
  const replacement = { 'server:replacement': [first, second] }, terminal = vi.fn(); let ended = false;
  render(<Fixture replacement={replacement} replaceOnEnd forwarded={{ onDragEnd: () => { ended = true; terminal(); } }} acceptPreview={kind === 'column' ? true : () => ended} />);
  const user = userEvent.setup();
  screen.getByRole('button', { name: kind === 'column' ? 'Move column research:custom' : 'Move task:a' }).focus();
  await user.keyboard('[Space][ArrowRight][Space]');
  expect(terminal).toHaveBeenCalledOnce();
  expect(screen.getByTestId('value').textContent).toBe(JSON.stringify(replacement));
});

function Handles({ subject, mode, keyboard, mouse, child, prevented = false, start }: {
  subject: 'item' | 'column'; mode: 'handle' | 'asChild' | 'asHandle';
  keyboard: () => void; mouse: () => void; child: () => void;
  prevented?: boolean; start: NonNullable<UI.KanbanProps<Item>['onDragStart']>;
}) {
  const value = subject === 'item' ? { source: [first], target: [] } : { source: [], target: [] };
  const handlers = { onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => { keyboard(); if (prevented) event.preventDefault(); }, onMouseDown: () => mouse() };
  const handle = subject === 'item' ? KanbanItemHandle : KanbanColumnHandle;
  const Handle = handle;
  const content = mode === 'asHandle' ? null : <Handle {...handlers} asChild={mode === 'asChild'} aria-label="Consumer handle">{mode === 'asChild' ? <button onKeyDown={() => child()}>Drag</button> : undefined}</Handle>;
  return <Kanban value={value} getItemValue={itemValue} onDragStart={start}><KanbanBoard>
    <KanbanColumn value="source" data-column="source" asHandle={subject === 'column' && mode === 'asHandle'} {...(subject === 'column' && mode === 'asHandle' ? { ...handlers, 'aria-label': 'Consumer handle' } : {})}>
      {subject === 'column' ? content : <KanbanItem value={first.id} data-card={first.id} asHandle={mode === 'asHandle'} {...(mode === 'asHandle' ? { ...handlers, 'aria-label': 'Consumer handle' } : {})}>{content}</KanbanItem>}
    </KanbanColumn><KanbanColumn value="target" data-column="target">{null}</KanbanColumn>
  </KanbanBoard><KanbanOverlay dropAnimation={null}>{() => <div data-testid="consumer-overlay">Dragging</div>}</KanbanOverlay></Kanban>;
}

test.each(['item', 'column'] as const)('consumer %s sensor handlers compose across separate, slotted and root handles', async subject => {
  for (const mode of ['handle', 'asChild', 'asHandle'] as const) {
    const key = vi.fn(), mouse = vi.fn(), child = vi.fn(), start = vi.fn();
    const view = render(<Handles subject={subject} mode={mode} keyboard={key} mouse={mouse} child={child} start={start} />);
    const handle = screen.getByRole('button', { name: 'Consumer handle' });
    fireEvent.keyDown(handle, { key: 'x', code: 'KeyX' }); fireEvent.mouseDown(handle, { button: 2 });
    expect(key).toHaveBeenCalledOnce(); expect(mouse).toHaveBeenCalledOnce();
    if (mode === 'asChild') expect(child).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    const user = userEvent.setup(); handle.focus(); await user.keyboard('[Space]');
    expect(start).toHaveBeenCalledOnce(); await user.keyboard('[Escape]');
    view.unmount();
    const blocked = render(<Handles subject={subject} mode={mode} keyboard={key} mouse={mouse} child={child} start={start} prevented />);
    screen.getByRole('button', { name: 'Consumer handle' }).focus(); await user.keyboard('[Space]');
    expect(start).toHaveBeenCalledTimes(1); expect(screen.queryByTestId('consumer-overlay')).not.toBeInTheDocument();
    blocked.unmount();
  }
});

test.each(['item', 'column'] as const)('numeric zero %s identity renders the correct overlay and cancels', async kind => {
  const changes = vi.fn(), move = vi.fn();
  const startValue: Board = kind === 'item' ? { source: [{ id: 0, title: 'Zero task' }], target: [] } : { 0: [], target: [] };
  render(<Fixture startValue={startValue} changes={changes} move={move} numericColumns={kind === 'column'} />);
  const user = kind === 'item' ? await pickUp(0) : userEvent.setup();
  if (kind === 'column') { screen.getByRole('button', { name: 'Move column 0' }).focus(); await user.keyboard('[Space]'); }
  const overlay = screen.getByTestId('overlay-content');
  expect(overlay).toHaveTextContent('0'); expect(overlay).toHaveAttribute('data-variant', kind);
  await user.keyboard('[ArrowRight][Escape]');
  expect(screen.getByTestId('value').textContent).toBe(JSON.stringify(startValue)); expect(move).not.toHaveBeenCalled();
});


test('consumer replacement from onDragOver supersedes that event preview', async () => {
  const replacement = { 'server:replacement': [first, second] }, move = vi.fn();
  render(<Fixture replacement={replacement} replaceOnOver move={move} />);
  const user = await pickUp(); await user.keyboard('[ArrowRight]');
  expect(screen.getByTestId('value').textContent).toBe(JSON.stringify(replacement));
  await user.keyboard('[Escape]');
  expect(screen.getByTestId('value').textContent).toBe(JSON.stringify(replacement));
  expect(move).not.toHaveBeenCalled();
});


test.each([0, 1])('primitive numeric item %i offers an immutable intercolumn preview and completes both terminal paths', async item => {
  const initialValue = Object.freeze({ source: Object.freeze([item]), target: Object.freeze([]) }) as unknown as Record<string, number[]>;
  for (const terminal of ['[Escape]', '[Space]']) {
    const changes = vi.fn(), moved = vi.fn(), hovered = vi.fn();
    function PrimitiveFixture() {
      const [value, setValue] = useState(initialValue);
      return <><output data-testid="primitive-value">{JSON.stringify(value)}</output><Kanban<number> value={value} onDragOver={hovered} onMove={moved} onValueChange={next => { changes(next); setValue(next); }}><KanbanBoard>{Object.entries(value).map(([id, items]) => <KanbanColumn key={id} value={id} data-column={id}>{items.map(number => <KanbanItem key={number} value={number} data-card={number} data-testid={`primitive-${number}`}><KanbanItemHandle aria-label={`Primitive ${number}`} /></KanbanItem>)}</KanbanColumn>)}</KanbanBoard><KanbanOverlay dropAnimation={null}>{({ value }) => <div data-testid="primitive-overlay">{value}</div>}</KanbanOverlay></Kanban></>;
    }
    const view = render(<PrimitiveFixture />), user = userEvent.setup();
    screen.getByRole('button', { name: `Primitive ${item}` }).focus(); await user.keyboard('[Space][ArrowRight]');
    expect(hovered.mock.calls.some(([event]) => event.active.id === item && event.over?.id === 'target')).toBe(true);
    expect(changes).toHaveBeenCalledOnce();
    expect(changes.mock.calls[0]![0]).toEqual({ source: [], target: [item] });
    expect(initialValue).toEqual({ source: [item], target: [] });
    await user.keyboard(terminal);
    if (terminal === '[Escape]') {
      expect(changes.mock.calls.at(-1)![0]).toBe(initialValue);
      expect(screen.getByTestId('primitive-value').textContent).toBe(JSON.stringify(initialValue));
      expect(moved).not.toHaveBeenCalled();
    } else {
      expect(moved).toHaveBeenCalledOnce();
      expect(moved.mock.calls[0]![0]).toMatchObject({ active: { id: item }, activeIndex: 0, overIndex: 0 });
      expect(screen.getByTestId('primitive-value').textContent).toBe(JSON.stringify({ source: [], target: [item] }));
    }
    view.unmount();
  }
});

test('adapted provenance describes repository-policy LF source bytes', () => {
  const file = 'packages/project-ui/src/ui/kanban.tsx';
  const source = Buffer.from(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'));
  const provenance = JSON.parse(readFileSync('packages/project-ui/src/ui/diceui-provenance.json', 'utf8'));
  expect(provenance.adapted.bytes).toBe(source.length);
  expect(provenance.adapted.sha256).toBe(createHash('sha256').update(source).digest('hex'));
});
