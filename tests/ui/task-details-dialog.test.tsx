import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import type { Task } from '@living-playbooks/contracts';
import { createHttpClient } from '@living-playbooks/api-client';
import { TaskBoard, type TaskBoardProps } from '../../apps/web/src/features/board/TaskBoard';
import { deferred, memoryDrafts, snapshot } from './helpers';

afterEach(cleanup);
function setup() {
  const value = snapshot(), task = value.project.tasks[0]!;
  task.description = 'Prepare the owner review.';
  task.dueAt = '2026-11-09T15:00:00.000Z';
  task.checklist = [{ id: '00000000-0000-4000-8000-000000009001', text: 'Read source evidence', completed: false }];
  const store = memoryDrafts();
  const saveTaskDetails = vi.fn<NonNullable<TaskBoardProps['saveTaskDetails']>>(async command => ({ ...task, description: command.input.description, checklist: command.input.checklist, dueAt: command.input.dueAt ?? undefined, revision: command.input.expectedTaskRevision + 1 }));
  const props: TaskBoardProps = { snapshot: value, disabled: false, selectedTaskId: task.id, store, saveTaskDetails, openTask: vi.fn(), closeTask: vi.fn(), correctTask: vi.fn() };
  return { value, task, store, props, saveTaskDetails };
}
async function editor() {
  const edit = await screen.findByRole('button', { name: /^(Edit description|Add description)$/ });
  await waitFor(() => expect(edit).toBeEnabled());
  await userEvent.click(edit);
  const description = await screen.findByLabelText('Description');
  await waitFor(() => expect(description).toBeEnabled());
  return description;
}

test('description opens in reading mode and toggling editing retains the same unsaved textarea', async () => {
  const { props, saveTaskDetails } = setup(); render(<TaskBoard {...props} />);
  const description = await screen.findByLabelText('Description');
  expect(description).not.toBeVisible();
  expect(screen.getByText('Prepare the owner review.', { selector: 'p' })).toBeVisible();
  const edit = await screen.findByRole('button', { name: 'Edit description' });
  await waitFor(() => expect(edit).toBeEnabled());
  await userEvent.click(edit);
  expect(description).toBeVisible(); expect(description).toHaveFocus();
  fireEvent.change(description, { target: { value: 'Unsaved context stays here.' } });
  await userEvent.click(screen.getByRole('button', { name: 'Done editing description' }));
  expect(description).not.toBeVisible();
  expect(screen.getByText('Unsaved context stays here.', { selector: 'p' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Edit description' }));
  expect(screen.getByLabelText('Description')).toBe(description);
  expect(description).toHaveValue('Unsaved context stays here.');
  expect(saveTaskDetails).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Save details' })).toBeEnabled();
});

test('an empty description offers an explicit add action without an empty editor', async () => {
  const { props, task } = setup(); task.description = '';
  render(<TaskBoard {...props} />);
  expect(screen.getByLabelText('Description')).not.toBeVisible();
  const add = await screen.findByRole('button', { name: 'Add description' });
  await waitFor(() => expect(add).toBeEnabled());
  await userEvent.click(add);
  expect(screen.getByLabelText('Description')).toBeVisible();
  expect(screen.getByLabelText('Description')).toHaveFocus();
});

test('supporting facts remain available through a collapsed disclosure', async () => {
  const { props, task } = setup(); task.ownerOverride = true;
  render(<TaskBoard {...props} />);
  const summary = screen.getByText('Supporting updates', { selector: 'summary' });
  expect(summary.closest('details')).not.toHaveAttribute('open');
  expect(screen.getByText('Owner correction')).not.toBeVisible();
  await userEvent.click(summary);
  expect(screen.getByText('Owner correction')).toBeVisible();
  expect(screen.getByText('Project brief')).toBeVisible();
  expect(screen.getByText('No supporting updates are linked to this task.')).toBeVisible();
});

test.each(['http', 'native'] as const)('an ambiguous %s rejection can be reviewed and explicitly replaced without losing the draft', async transport => {
  const { props, task } = setup();
  const http = createHttpClient({ origin: 'https://synthetic.invalid', fetch: async () => Response.json({ code: 'revision_conflict', message: 'Synthetic conflict', retryable: false, currentRevision: 1 }, { status: 409 }) });
  const save = vi.fn<NonNullable<TaskBoardProps['saveTaskDetails']>>()
    .mockImplementationOnce(async command => {
      if (transport === 'http') await http.applyAction(props.snapshot.project.id, command);
      throw new Error('Native request rejected. Check source consent, current project and pairing state.');
    })
    .mockImplementation(async command => ({ ...task, description: command.input.description, revision: command.input.expectedTaskRevision + 1 }));
  const review = vi.fn(async () => ({ task: { ...task, description: 'Current saved task', revision: task.revision + 1 }, projectRevision: props.snapshot.project.revision + 1 }));
  render(<TaskBoard {...props} saveTaskDetails={save} reviewTaskDetails={review} />);
  fireEvent.change(await editor(), { target: { value: 'Keep my owner draft' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await screen.findByRole('button', { name: 'Retry original save' });
  const original = save.mock.calls[0]![0];
  await userEvent.click(screen.getByRole('button', { name: 'Review current task' }));
  expect(await screen.findByText('Current saved task')).toBeVisible();
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Description')).toHaveValue('Keep my owner draft');
  await userEvent.click(screen.getByRole('button', { name: 'Prepare replacement save' }));
  expect(save).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]![0]).toMatchObject({ expectedRevision: 1, input: { expectedTaskRevision: 1, description: 'Keep my owner draft' } });
  expect(save.mock.calls[1]![0].operationId).not.toBe(original.operationId);
});
test('real metadata is editable and the acknowledged callback keeps stable checklist identities without changing task status', async () => {
  const { props, task, saveTaskDetails } = setup(); render(<TaskBoard {...props} />);
  const description = await editor(); fireEvent.change(description, { target: { value: 'Owner review with linked evidence.' } });
  fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-11-10T10:30' } });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Read source evidence' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await screen.findByText('Task details saved.');
  expect(saveTaskDetails).toHaveBeenCalledOnce();
  expect(saveTaskDetails.mock.calls[0]![0]).toMatchObject({ expectedRevision: props.snapshot.project.revision, input: { type: 'update_task_details', taskId: task.id, expectedTaskRevision: task.revision, description: 'Owner review with linked evidence.', checklist: [{ ...task.checklist![0], completed: true }] } });
  expect(saveTaskDetails.mock.calls[0]![0].input.dueAt).toBe(new Date('2026-11-10T10:30').toISOString());
  expect(props.correctTask).not.toHaveBeenCalled();
});
test('compact cards show only actual due description and checklist metadata', () => {
  const { props, task } = setup(); render(<TaskBoard {...props} selectedTaskId={undefined} />);
  const card = screen.getByLabelText(`Task card: ${task.title}`);
  expect(within(card).getByLabelText('Has description')).toBeVisible();
  expect(within(card).getByLabelText('0 of 1 checklist items complete')).toHaveTextContent('0/1');
  expect(within(card).queryByText('Prepare the owner review.')).not.toBeInTheDocument();
  expect(within(card).queryByText('Agent reported')).not.toBeInTheDocument();
});
test('an unsaved draft survives close and remount and task B never displays task A edits', async () => {
  const { props, task, value } = setup(); const view = render(<TaskBoard {...props} />);
  fireEvent.change(await editor(), { target: { value: 'Retain task A locally.' } });
  view.rerender(<TaskBoard {...props} selectedTaskId={undefined} />);
  const second = { ...task, id: '00000000-0000-4000-8000-000000009002', title: 'Task B', description: 'Canonical B' };
  const other = { ...value, project: { ...value.project, tasks: [...value.project.tasks, second] } };
  view.rerender(<TaskBoard {...props} snapshot={other} selectedTaskId={second.id} />);
  expect(await editor()).toHaveValue('Canonical B');
  view.unmount(); render(<TaskBoard {...props} />);
  expect(await editor()).toHaveValue('Retain task A locally.');
});
test('the original envelope is persisted before dispatch and replayed exactly after a lost response and remount', async () => {
  const { props, task, store } = setup();
  const sent: unknown[] = [];
  const save = vi.fn(async (command: Parameters<NonNullable<TaskBoardProps['saveTaskDetails']>>[0]) => {
    const saved = await store.read(`${props.snapshot.project.id}:task:${task.id}`);
    expect(JSON.parse(saved!.text).pending).toEqual(command);
    sent.push(structuredClone(command));
    if (sent.length === 1) throw new Error('Response lost');
    return { ...task, description: command.input.description, revision: task.revision + 1 };
  });
  const view = render(<TaskBoard {...props} saveTaskDetails={save} />);
  fireEvent.change(await editor(), { target: { value: 'Original save' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await screen.findByText(/Save not confirmed/);
  view.unmount(); render(<TaskBoard {...props} saveTaskDetails={save} />);
  await editor(); await userEvent.click(screen.getByRole('button', { name: 'Retry original save' }));
  await screen.findByText('Task details saved.');
  expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
});
test('incoming task revisions require explicit conflict review and preserve the edit revision', async () => {
  const { props, value, task, saveTaskDetails } = setup(); const view = render(<TaskBoard {...props} />);
  fireEvent.change(await editor(), { target: { value: 'My local edit' } });
  const incoming = structuredClone(value); incoming.project.revision += 1; incoming.project.tasks[0] = { ...task, revision: task.revision + 1, description: 'Remote description' };
  view.rerender(<TaskBoard {...props} snapshot={incoming} />);
  expect(screen.getByRole('button', { name: 'Save details' })).toBeDisabled();
  expect(screen.getByText('Remote description')).toBeVisible();
  expect(screen.getByLabelText('Description')).toHaveValue('My local edit');
  expect(saveTaskDetails).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Keep my edits with current revision' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await waitFor(() => expect(saveTaskDetails).toHaveBeenCalledOnce());
  expect(saveTaskDetails.mock.calls[0]![0].input.expectedTaskRevision).toBe(task.revision + 1);
});
test('edits made after a lost reply survive retrying the earlier payload and cannot replace its pending envelope', async () => {
  const { props, task, value } = setup();
  const save = vi.fn<NonNullable<TaskBoardProps['saveTaskDetails']>>().mockRejectedValueOnce(new Error('Lost reply')).mockImplementation(async command => ({ ...task, description: command.input.description, revision: task.revision + 1 }));
  const view = render(<TaskBoard {...props} saveTaskDetails={save} />);
  fireEvent.change(await editor(), { target: { value: 'First request text' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save details' })); await screen.findByText(/Save not confirmed/);
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Newer local text' } });
  const incoming = structuredClone(value); incoming.project.tasks[0] = { ...task, revision: task.revision + 1, description: 'First request text' };
  view.rerender(<TaskBoard {...props} snapshot={incoming} saveTaskDetails={save} />);
  expect(screen.queryByRole('button', { name: 'Keep my edits with current revision' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry original save' })); await screen.findByText('Task details saved.');
  expect(save.mock.calls[1]![0]).toEqual(save.mock.calls[0]![0]);
  expect(screen.getByLabelText('Description')).toHaveValue('Newer local text');
  expect(screen.getByRole('button', { name: 'Save details' })).toBeEnabled();
});
test('new checklist identities persist through removal and clearing metadata sends explicit empty values', async () => {
  const { props, saveTaskDetails } = setup(); render(<TaskBoard {...props} />); await editor();
  await userEvent.click(screen.getByRole('button', { name: 'Add an item' }));
  fireEvent.change(screen.getByLabelText('Checklist item 2 text'), { target: { value: 'New stable item' } });
  const addedId = screen.getByLabelText('Checklist item 2 text').closest('[data-checklist-item]')!.getAttribute('data-checklist-item');
  await userEvent.click(screen.getByRole('button', { name: 'Remove checklist item 1' }));
  expect(screen.getByLabelText('Checklist item 1 text').closest('[data-checklist-item]')).toHaveAttribute('data-checklist-item', addedId);
  await userEvent.click(screen.getByRole('button', { name: 'Remove checklist item 1' }));
  await userEvent.click(screen.getByRole('button', { name: 'Remove due date' }));
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: '' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await waitFor(() => expect(saveTaskDetails).toHaveBeenCalledOnce());
  expect(saveTaskDetails.mock.calls[0]![0].input).toMatchObject({ description: '', dueAt: null, checklist: [] });
});
test('dialog status uses the shared keyboard radio menu inside the modal focus trap', async () => {
  const { props, task } = setup(); render(<TaskBoard {...props} />); await editor();
  const status = screen.getByRole('button', { name: `Status: ${task.title} — ${task.status === 'todo' ? 'To do' : 'In progress'}` });
  status.focus(); await userEvent.keyboard('[Enter][End]');
  expect(screen.getByRole('menuitemradio', { name: 'Skipped' })).toHaveFocus();
  expect(screen.getByRole('dialog')).toContainElement(screen.getByRole('menu'));
  await userEvent.keyboard('[Enter]');
  expect(props.correctTask).toHaveBeenCalledExactlyOnceWith(task.id, 'skipped');
  expect(status).toHaveFocus(); expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});
test.each([true, false])('only a verified typed revision rejection can explicitly retire the original request (%s)', async typed => {
  const { props, task, saveTaskDetails } = setup();
  saveTaskDetails.mockRejectedValueOnce(typed ? Object.assign(new Error('Revision changed'), { code: 'revision_conflict' }) : new Error('Native IPC failure'));
  render(<TaskBoard {...props} />); fireEvent.change(await editor(), { target: { value: 'Preserve these owner edits' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save details' })); await screen.findByText(/Save not confirmed/);
  const original = structuredClone(saveTaskDetails.mock.calls[0]![0]);
  if (!typed) {
    expect(screen.queryByRole('button', { name: 'Review current version' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry original save' }));
    await waitFor(() => expect(saveTaskDetails).toHaveBeenCalledTimes(2));
    expect(saveTaskDetails.mock.calls[1]![0]).toEqual(original);
  } else {
    await userEvent.click(screen.getByRole('button', { name: 'Review current version' }));
    expect(screen.getByLabelText('Description')).toHaveValue('Preserve these owner edits');
    expect(screen.getByRole('button', { name: 'Save details' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Keep my edits with current revision' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
    await waitFor(() => expect(saveTaskDetails).toHaveBeenCalledTimes(2));
    expect(saveTaskDetails.mock.calls[1]![0].operationId).not.toBe(original.operationId);
    expect(saveTaskDetails.mock.calls[1]![0].input).toMatchObject({ description: 'Preserve these owner edits', expectedTaskRevision: task.revision });
  }
});
test('edits made during a save survive acknowledgement and become a second explicit save', async () => {
  const { props, task } = setup(), release = deferred<Task>();
  const save = vi.fn<NonNullable<TaskBoardProps['saveTaskDetails']>>().mockImplementationOnce(() => release.promise).mockImplementation(async command => ({ ...task, description: command.input.description, revision: command.input.expectedTaskRevision + 1 }));
  render(<TaskBoard {...props} saveTaskDetails={save} />);
  fireEvent.change(await editor(), { target: { value: 'First edit' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Second edit' } });
  await act(async () => release.resolve({ ...task, description: 'First edit', revision: task.revision + 1 }));
  expect(screen.getByLabelText('Description')).toHaveValue('Second edit');
  await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]![0].input).toMatchObject({ description: 'Second edit', expectedTaskRevision: task.revision + 1 });
});
test('a closed editor acknowledgement cannot delete a newer draft for the same task', async () => {
  const { props, task, store } = setup(), release = deferred<Task>();
  const save = vi.fn(() => release.promise);
  const view = render(<TaskBoard {...props} saveTaskDetails={save} />);
  fireEvent.change(await editor(), { target: { value: 'First lifetime' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  view.rerender(<TaskBoard {...props} selectedTaskId={undefined} saveTaskDetails={save} />);
  view.rerender(<TaskBoard {...props} saveTaskDetails={save} />);
  fireEvent.change(await editor(), { target: { value: 'New lifetime draft' } });
  await act(async () => release.resolve({ ...task, description: 'First lifetime', revision: task.revision + 1 }));
  expect(screen.getByLabelText('Description')).toHaveValue('New lifetime draft');
  expect(JSON.parse((await store.read(`${props.snapshot.project.id}:task:${task.id}`))!.text).description).toBe('New lifetime draft');
});
test('modal traps focus, dismisses with Escape and backdrop, returns focus, and ignores composing Escape', async () => {
  const { props, task } = setup();
  const view = render(<TaskBoard {...props} selectedTaskId={undefined} />);
  const open = screen.getByRole('button', { name: `Open task: ${task.title}` }); open.focus();
  view.rerender(<TaskBoard {...props} />);
  const dialog = screen.getByRole('dialog', { name: task.title });
  await editor(); expect(dialog).toContainElement(document.activeElement as HTMLElement);
  await userEvent.keyboard('[Shift>][Tab][/Shift]'); expect(dialog).toContainElement(document.activeElement as HTMLElement);
  fireEvent.keyDown(screen.getByLabelText('Description'), { key: 'Escape', isComposing: true }); expect(props.closeTask).not.toHaveBeenCalled();
  await userEvent.keyboard('[Escape]'); expect(props.closeTask).toHaveBeenCalledOnce();
  view.rerender(<TaskBoard {...props} selectedTaskId={undefined} />); await waitFor(() => expect(open).toHaveFocus());
  view.rerender(<TaskBoard {...props} />);
  const overlay = document.querySelector('[data-slot="sheet-overlay"]')!;
  await userEvent.pointer({ target: overlay, keys: '[MouseLeft]' });
  await waitFor(() => expect(props.closeTask).toHaveBeenCalledTimes(2));
});
test('storage failure blocks dispatch and metadata remains visible', async () => {
  const { props, store, saveTaskDetails } = setup(); store.flush = async () => { throw new Error('disk full'); };
  render(<TaskBoard {...props} />); fireEvent.change(await editor(), { target: { value: 'Keep locally' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save details' }));
  await screen.findByText(/could not be persisted/); expect(saveTaskDetails).not.toHaveBeenCalled(); expect(screen.getByLabelText('Description')).toHaveValue('Keep locally');
});
