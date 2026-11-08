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

test('narrow drawers keep the workspace visible, dismiss with Escape and restore opener focus', async () => {
  width = 800;
  render(<App client={createFixtureClient()} drafts={memoryDrafts()} fixture />);
  await screen.findByRole('heading', { name: 'Hackathon demo' });
  const opener = screen.getByRole('button', { name: 'Projects' });
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
  const editor = await screen.findByLabelText('Document: Demo notes');
  await waitFor(() => expect(editor).toBeEnabled());
  await userEvent.type(editor, ' Keep this draft');
  expect(editor).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'Project settings' }));
  expect(screen.getByRole('region', { name: 'Project settings' })).toBeVisible();
  expect(editor.isConnected).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Back to workspace' }));
  expect(screen.getByLabelText('Document: Demo notes')).toBe(editor);
  expect((editor as HTMLTextAreaElement).value).toContain('Keep this draft');
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
