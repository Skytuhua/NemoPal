import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { createFixtureClient } from '@living-playbooks/api-client';
import { Question } from '../../apps/web/src/features/checkins/Question';
import { DocumentEditor } from '../../apps/web/src/features/documents/DocumentEditor';
import { deferred, memoryDrafts, snapshot } from './helpers';

afterEach(cleanup);

function questionProps() {
  return { question: { ...snapshot().checkIns[0]!, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, answer: vi.fn().mockResolvedValue(undefined), snooze: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined), openTask: vi.fn() };
}

test('default Question preserves the pet controls while compact Question keeps the main answers visible', async () => {
  const props = questionProps();
  const view = render(<Question {...props} />);
  expect(screen.getByLabelText('Snooze until')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Cancel question' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'More options' })).not.toBeInTheDocument();
  view.rerender(<div className="app-shell"><Question {...props} compact /></div>);
  expect(screen.getByRole('button', { name: 'Recorded' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Not yet' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Cancel question' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Not yet' }));
  expect(props.answer).toHaveBeenCalledExactlyOnceWith({ kind: 'not_yet' });
  const trigger = screen.getByRole('button', { name: 'More options' });
  await userEvent.click(trigger);
  const details = screen.getByRole('dialog', { name: 'Check-in options' });
  await userEvent.type(within(details).getByLabelText('Snooze until'), '2099-01-01T12:00');
  await userEvent.click(within(details).getByRole('button', { name: 'Snooze question' }));
  expect(props.snooze).toHaveBeenCalledWith(expect.objectContaining({ until: expect.stringContaining('2099'), timezone: expect.any(String) }));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test('compact Question keeps expired and pending answers disabled and reports a failed answer', async () => {
  const props = questionProps(), pending = deferred<void>();
  props.answer.mockImplementation(() => pending.promise);
  const view = render(<div className="app-shell"><Question {...props} compact /></div>);
  await userEvent.click(screen.getByRole('button', { name: 'Recorded' }));
  expect(screen.getByRole('button', { name: 'Not yet' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Recorded' })).toBeDisabled();
  await act(async () => pending.resolve());
  props.answer.mockRejectedValue(new Error('Not saved'));
  await userEvent.click(screen.getByRole('button', { name: 'Recorded' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Question update failed');
  view.rerender(<div className="app-shell"><Question {...props} question={{ ...props.question, expiresAt: '2020-01-01T00:00:00Z' }} compact /></div>);
  expect(screen.queryByRole('button', { name: 'Recorded' })).not.toBeInTheDocument();
  expect(screen.getByText(/expired/i)).toBeVisible();
});

test('compact notes open with keyboard, retain one editor and draft through close and navigation, and restore focus', async () => {
  const seed = snapshot(), client = createFixtureClient({ snapshots: [seed] }), store = memoryDrafts();
  const props = { document: seed.documents[0]!, heading: 'Demo notes', client, store, disabled: false, refresh: async () => {} };
  const view = render(<div className="app-shell"><DocumentEditor {...props} compact /></div>);
  const trigger = screen.getByRole('button', { name: 'Open notes' });
  const editor = screen.getByLabelText('Document: Demo notes');
  expect(editor).not.toBeVisible();
  trigger.focus();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('dialog', { name: 'Demo notes' })).toBeVisible();
  await waitFor(() => expect(editor).toBeEnabled());
  await userEvent.clear(editor);
  await userEvent.type(editor, 'Draft still on my desk');
  await userEvent.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
  expect(editor).not.toBeVisible();
  expect(editor.isConnected).toBe(true);
  expect(screen.getByText('Unsaved changes')).toBeVisible();
  view.rerender(<div className="app-shell" hidden><DocumentEditor {...props} document={{ ...props.document, revision: 2, text: 'New canonical notes' }} compact /></div>);
  view.rerender(<div className="app-shell"><DocumentEditor {...props} document={{ ...props.document, revision: 2, text: 'New canonical notes' }} compact /></div>);
  await userEvent.click(trigger);
  expect(screen.getByLabelText('Document: Demo notes')).toBe(editor);
  expect(editor).toHaveValue('Draft still on my desk');
  const close = screen.getByRole('button', { name: 'Close notes' });
  close.focus();
  await userEvent.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Save document' })).toHaveFocus();
  await userEvent.tab();
  expect(close).toHaveFocus();
  await userEvent.click(close);
  expect(trigger).toHaveFocus();
  expect((await store.read(`${seed.project.id}:document:${props.document.id}`))?.text).toBe('Draft still on my desk');
});

test.each(['saved', 'conflict'] as const)('closing compact notes during a late %s preserves newer text and its revision fence', async outcome => {
  const seed = snapshot(), client = createFixtureClient({ snapshots: [seed] }), store = memoryDrafts();
  const release = deferred<void>(), started = deferred<void>(), save = client.saveDocument;
  client.saveDocument = vi.fn(async (...args: Parameters<typeof save>) => {
    const receipt = await save(...args); started.resolve(); await release.promise;
    if (outcome === 'conflict') throw Object.assign(new Error('Conflict'), { code: 'revision_conflict' });
    return receipt;
  });
  render(<div className="app-shell"><DocumentEditor compact document={seed.documents[0]!} heading="Demo notes" client={client} store={store} disabled={false} refresh={async () => {}} /></div>);
  await userEvent.click(screen.getByRole('button', { name: 'Open notes' }));
  const editor = screen.getByLabelText('Document: Demo notes');
  await waitFor(() => expect(editor).toBeEnabled());
  await userEvent.clear(editor); await userEvent.type(editor, 'Submitted draft');
  await userEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await started.promise;
  await userEvent.click(screen.getByRole('button', { name: 'Close notes' }));
  await userEvent.click(screen.getByRole('button', { name: 'Open notes' }));
  await userEvent.clear(editor); await userEvent.type(editor, 'Newer local draft');
  await userEvent.keyboard('{Escape}');
  await act(async () => release.resolve());
  await waitFor(async () => expect((await store.read(`${seed.project.id}:document:${seed.documents[0]!.id}`))?.text).toBe('Newer local draft'));
  if (outcome === 'conflict') expect(screen.getByText('Review conflict')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Open notes' }));
  expect(screen.getByLabelText('Document: Demo notes')).toBe(editor);
  expect(editor).toHaveValue('Newer local draft');
  if (outcome === 'conflict') {
    expect(screen.getByText('Current server copy')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Keep my text with latest revision' }));
  }
  await userEvent.click(screen.getByRole('button', { name: 'Save document' }));
  await waitFor(() => expect(client.saveDocument).toHaveBeenCalledTimes(2));
  expect(vi.mocked(client.saveDocument).mock.calls[1]![2]).toMatchObject({ expectedRevision: 1, input: { text: 'Newer local draft' } });
});

test('default document editor remains directly editable without a notes trigger', async () => {
  const seed = snapshot();
  render(<DocumentEditor document={seed.documents[0]!} heading="Demo notes" client={createFixtureClient()} store={memoryDrafts()} disabled={false} refresh={async () => {}} />);
  await waitFor(() => expect(screen.getByLabelText('Document: Demo notes')).toBeEnabled());
  expect(screen.getByLabelText('Document: Demo notes')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Open notes' })).not.toBeInTheDocument();
});
