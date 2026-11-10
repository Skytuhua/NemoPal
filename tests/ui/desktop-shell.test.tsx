import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createFixtureClient } from '@living-playbooks/api-client';
import { App } from '../../apps/web/src/app/App';
import { memoryDrafts } from './helpers';

let width = 1240;
class Observer {
  static all: Observer[] = [];
  targets = new Set<Element>();
  constructor(private deliver: ResizeObserverCallback) { Observer.all.push(this); }
  observe(target: Element) { this.targets.add(target); }
  unobserve(target: Element) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
  resize() { this.deliver([...this.targets].map(target => ({ target, contentRect: { width, height: 820 } } as ResizeObserverEntry)), this as unknown as ResizeObserver); }
}
function resize(next: number) {
  width = next;
  act(() => { for (const observer of [...Observer.all]) observer.resize(); });
}
beforeEach(() => {
  width = 1240; Observer.all = []; localStorage.clear();
  vi.stubGlobal('ResizeObserver', Observer);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const handle = this.getAttribute('data-slot') === 'resizable-handle';
    const left = handle ? this.getAttribute('aria-label') === 'Resize Projects' ? 240 : width - 368 : 0;
    const measured = handle ? 8 : width;
    return { width: measured, height: 820, top: 0, left, right: left + measured, bottom: 820, x: left, y: 0, toJSON() { return {}; } };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('the working desktop shell provides two named keyboard-focusable separators', async () => {
  render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  await screen.findByRole('heading', { name: 'Hackathon demo' });
  const separators = screen.getAllByRole('separator');
  expect(separators).toHaveLength(2);
  expect(screen.getByRole('separator', { name: 'Resize Projects' })).toHaveAttribute('tabindex', '0');
  expect(screen.getByRole('separator', { name: 'Resize Chat' })).toHaveAttribute('tabindex', '0');
  expect(screen.getByRole('button', { name: 'Reset layout' })).toBeEnabled();
  const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('desktop chrome stays in the sidebar with an icon reset beside project settings', async () => {
  localStorage.setItem('lp:desktop-pane-layout:v1', JSON.stringify({ version: 1, projects: 300, manager: 400 }));
  render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  await screen.findByRole('heading', { name: 'Hackathon demo' });
  expect(screen.queryByText('Workspace', { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  const settings = screen.getByRole('button', { name: 'Project settings' });
  const reset = screen.getByRole('button', { name: 'Reset layout' });
  expect(settings.closest('footer')).toContainElement(reset);
  expect(reset).toHaveAttribute('title', 'Reset layout');
  expect(reset).not.toHaveTextContent('Reset layout');
  const demo = screen.getByLabelText('Demo · synthetic data · no live model');
  expect(within(screen.getByRole('complementary', { name: 'Projects' })).getByText('NemoPal').parentElement).toContainElement(demo);
  const editor = screen.getByLabelText('Document: Demo notes');
  const composer = screen.getByLabelText('Message to Nemo');
  await waitFor(() => expect(composer).toBeEnabled());
  await userEvent.type(composer, 'Retain this draft');
  expect(composer).toHaveValue('Retain this draft');
  await userEvent.click(reset);
  expect(JSON.parse(localStorage.getItem('lp:desktop-pane-layout:v1')!)).toEqual({ version: 1, projects: 240, manager: 360 });
  expect(screen.getByLabelText('Document: Demo notes')).toBe(editor);
  expect(screen.getByLabelText('Message to Nemo')).toBe(composer);
  expect(composer).toHaveValue('Retain this draft');
});

test('the plus beside project search opens the existing creation form and retains unsent text', async () => {
  render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  await screen.findByRole('heading', { name: 'Hackathon demo' });
  const create = screen.getByRole('button', { name: 'New project' });
  const search = screen.getByLabelText('Find a project');
  expect(search.closest('.project-search-row')).toContainElement(create);
  await userEvent.click(create);
  const title = screen.getByLabelText('Project title');
  const brief = screen.getByLabelText('Project brief');
  await waitFor(() => expect(title).toBeEnabled());
  await userEvent.type(title, 'A saved local draft');
  await userEvent.type(brief, 'Keep the original creation form working.');
  await userEvent.click(create);
  expect(title).not.toBeVisible();
  expect(title.isConnected).toBe(true);
  await userEvent.click(create);
  expect(screen.getByLabelText('Project title')).toBe(title);
  expect(title).toHaveValue('A saved local draft');
  expect(brief).toHaveValue('Keep the original creation form working.');
  expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled();
});

test('narrow drawers keep the workspace visible, dismiss with Escape and restore opener focus', async () => {
  width = 800;
  render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  await screen.findByRole('heading', { name: 'Hackathon demo' });
  const opener = screen.getByRole('button', { name: 'Projects' });
  expect(opener.closest('nav')).toHaveAttribute('aria-label', 'Workspace navigation');
  await userEvent.click(opener);
  const projects = screen.getByRole('dialog', { name: 'Projects' });
  expect(projects).toBeVisible();
  expect(document.getElementById('workspace')).not.toHaveAttribute('hidden');
  expect(document.getElementById('workspace')?.closest('[inert]')).not.toBeNull();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Projects' })).not.toBeInTheDocument());
  expect(opener).toHaveFocus();
  const chat = screen.getByRole('button', { name: 'Chat' });
  await userEvent.click(chat);
  expect(screen.getByRole('dialog', { name: 'Manager chat' })).toBeVisible();
  expect(screen.queryByRole('dialog', { name: 'Projects' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
  await waitFor(() => expect(chat).toHaveFocus());
});

test('editor and composer nodes, local text and composition survive narrow/wide transitions', async () => {
  render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  await userEvent.click(await screen.findByRole('button', { name: 'Project settings' }));
  const editor = await screen.findByLabelText('Document: Demo notes');
  await waitFor(() => expect(editor).toBeEnabled());
  const composer = screen.getByLabelText('Message to Nemo');
  await userEvent.type(editor, ' Unsaved notes');
  expect(editor).toHaveFocus();
  expect((editor as HTMLTextAreaElement).value).toContain('Unsaved notes');
  await userEvent.type(composer, 'Unsent message');
  editor.focus(); fireEvent.compositionStart(editor);
  resize(800);
  expect(screen.getByLabelText('Document: Demo notes')).toBe(editor);
  expect(editor).toHaveFocus();
  fireEvent.compositionEnd(editor);
  await userEvent.click(screen.getByRole('button', { name: 'Chat' }));
  expect(within(screen.getByRole('dialog', { name: 'Manager chat' })).getByLabelText('Message to Nemo')).toBe(composer);
  resize(1440);
  expect(screen.getByLabelText('Document: Demo notes')).toBe(editor);
  expect(screen.getByLabelText('Message to Nemo')).toBe(composer);
  expect((editor as HTMLTextAreaElement).value).toContain('Unsaved notes');
  expect(composer).toHaveValue('Unsent message');
});

test('project settings remain reachable without replacing the document editor', async () => {
  render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  await userEvent.click(await screen.findByRole('button', { name: 'Project settings' }));
  const editor = await screen.findByLabelText('Document: Demo notes');
  await waitFor(() => expect(editor).toBeEnabled());
  await userEvent.type(editor, ' Keep this draft');
  expect(editor).toHaveFocus();
  expect(screen.getByRole('region', { name: 'Project settings' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Notes' })).toBeVisible();
  expect(editor.isConnected).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Back to workspace' }));
  expect(screen.getByLabelText('Document: Demo notes')).toBe(editor);
  expect((editor as HTMLTextAreaElement).value).toContain('Keep this draft');
});

test('notes can apply a held workspace arrangement from settings without losing the editor draft', async () => {
  const client = createFixtureClient();
  const project = (await client.listProjects())[0]!;
  const initial = await client.getSnapshot(project.id), revised = structuredClone(initial);
  const documentPanel = revised.project.workspace.panels.find(panel => panel.type === 'document_editor');
  if (!documentPanel) throw new Error('Expected a fixture document panel');
  documentPanel.heading = 'Updated notes arrangement';
  revised.project.revision++; revised.eventSequence++;
  vi.spyOn(client, 'getSnapshot').mockResolvedValueOnce(initial).mockResolvedValue(revised);
  render(<App client={client} drafts={memoryDrafts()} fixture />);
  await userEvent.click(await screen.findByRole('button', { name: 'Project settings' }));
  const editor = screen.getByLabelText('Document: Demo notes');
  await waitFor(() => expect(editor).toBeEnabled());
  await userEvent.type(editor, ' Keep through arrangement');
  await userEvent.selectOptions(screen.getByLabelText('Phase'), 'building');
  const apply = await screen.findByRole('button', { name: 'Apply workspace arrangement' });
  expect(apply).toBeVisible();
  expect(screen.getByLabelText('Document: Demo notes')).toBe(editor);
  await userEvent.click(apply);
  expect(await screen.findByLabelText('Document: Updated notes arrangement')).toBe(editor);
  expect((editor as HTMLTextAreaElement).value).toContain('Keep through arrangement');
});

test('NemoPal keeps canonical progress compact and the real question directly in manager chat', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-08T11:00:00.000Z'));
  render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  await screen.findByRole('heading', { name: 'Hackathon demo' });
  expect(screen.getByText('NemoPal')).toBeVisible();
  expect(within(screen.getByRole('complementary', { name: 'Projects' })).getByRole('img', { name: 'Nemo mouse' })).toBeVisible();
  expect(within(screen.getByRole('complementary', { name: 'Manager chat' })).getByRole('img', { name: 'Nemo mouse' })).toBeVisible();
  expect(screen.getByRole('progressbar', { name: /Task progress: .* tasks marked done/ })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Project info' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Updates/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check-ins' })).not.toBeInTheDocument();
  const manager = screen.getByRole('complementary', { name: 'Manager chat' });
  expect(within(manager).getByRole('button', { name: 'Mark task done' })).toBeVisible();
  expect(screen.getAllByRole('button', { name: 'Mark task done' })).toHaveLength(1);
  const editor = screen.getByLabelText('Document: Demo notes');
  await userEvent.click(within(manager).getByRole('button', { name: 'Mark task done' }));
  await within(manager).findByText('You marked this task done.');
  expect(editor.isConnected).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Project settings' }));
  expect(screen.getByLabelText('Document: Demo notes')).toBe(editor);
  expect(editor).toBeVisible();
});

test('desktop edge Tab skips Radix guards and controls inside closed details', async () => {
  render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  const composer = await screen.findByLabelText('Message to Nemo');
  await waitFor(() => expect(composer).toBeEnabled());
  const closed = document.createElement('details');
  closed.innerHTML = '<button>Hidden detail action</button>';
  document.body.append(closed);
  try {
    await userEvent.click(composer);
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Skip to workspace' })).toHaveFocus();
    expect(document.activeElement).not.toHaveAttribute('data-radix-focus-guard');
    expect(closed.contains(document.activeElement)).toBe(false);
  } finally { closed.remove(); }
});


test('the sole board and notes stay mounted while settings open and close', async () => {
  render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  await screen.findByRole('heading', { name: 'Hackathon demo' });
  expect(screen.getByRole('region', { name: 'Project task board' })).toBeVisible();
  expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument();
  const board = screen.getByRole('region', { name: 'Project task board' });
  const settings = screen.getByRole('button', { name: 'Project settings' });
  await userEvent.click(settings);
  expect(board).not.toBeVisible();
  expect(board.isConnected).toBe(true);
  const editor = screen.getByLabelText('Document: Demo notes');
  await waitFor(() => expect(editor).toBeEnabled());
  await userEvent.type(editor, ' Draft retained with board');
  await userEvent.click(screen.getByRole('button', { name: 'Back to workspace' }));
  expect(screen.getByRole('region', { name: 'Project task board' })).toBe(board);
  expect(editor).not.toBeVisible();
  expect(editor.isConnected).toBe(true);
  await waitFor(() => expect(settings).toHaveFocus());
  await userEvent.click(settings);
  expect(screen.getByLabelText('Document: Demo notes')).toBe(editor);
  expect((editor as HTMLTextAreaElement).value).toContain('Draft retained with board');
});
