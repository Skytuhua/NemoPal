import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Sidebar, SidebarProvider, SidebarTrigger, useSidebar, Sheet, SheetContent, SheetDescription, SheetTitle } from '@living-playbooks/project-ui';

const mediaListeners = new Set<() => void>();
const originalWidth = window.innerWidth;
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: (_name: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_name: string, listener: () => void) => mediaListeners.delete(listener),
  }));
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); mediaListeners.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
});

function State() {
  const { state } = useSidebar();
  return <output aria-label="Sidebar state">{state}</output>;
}

test('sidebar controls do not write cookies', async () => {
  const before = document.cookie;
  render(<SidebarProvider><SidebarTrigger /><State /></SidebarProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
  expect(screen.getByLabelText('Sidebar state')).toHaveTextContent('collapsed');
  expect(document.cookie).toBe(before);
});

test('sidebar does not capture the owner global shortcut', () => {
  render(<SidebarProvider defaultOpen={false}><State /></SidebarProvider>);
  fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
  expect(screen.getByLabelText('Sidebar state')).toHaveTextContent('collapsed');
  fireEvent.keyDown(window, { key: 'b', metaKey: true });
  expect(screen.getByLabelText('Sidebar state')).toHaveTextContent('collapsed');
});

function Draft() {
  const [value, setValue] = useState('');
  return <textarea aria-label="Draft" value={value} onChange={event => setValue(event.target.value)} />;
}

test('sidebar keeps one editor node and its draft when the viewport changes', async () => {
  render(<SidebarProvider><Sidebar><Draft /></Sidebar></SidebarProvider>);
  const editor = screen.getByLabelText('Draft');
  await userEvent.type(editor, 'Uncommitted draft');
  const previousWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640 });
  fireEvent(window, new Event('resize'));
  await act(async () => { for (const listener of mediaListeners) listener(); });
  expect(screen.getByLabelText('Draft')).toBe(editor);
  expect(editor).toHaveValue('Uncommitted draft');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
});

for (const portal of [false, true]) test(`a force-mounted sheet keeps its editor with invariant modal=false and portal=${portal}`, async () => {
  const view = (open: boolean) => <div data-testid="host" className="workspace-ui">
    <Sheet open={open} modal={false}>
      <SheetContent portal={portal} forceMount showCloseButton={false}>
        <SheetTitle>Chat</SheetTitle><SheetDescription>Project chat</SheetDescription><Draft />
      </SheetContent>
    </Sheet>
  </div>;
  const result = render(view(true));
  const editor = screen.getByLabelText('Draft');
  await userEvent.type(editor, 'Keep this draft');
  if (portal) {
    expect(screen.getByTestId('host')).not.toContainElement(editor);
    expect(editor.closest('.workspace-ui')).toHaveAttribute('data-slot', 'sheet-scope');
  } else expect(screen.getByTestId('host')).toContainElement(editor);
  result.rerender(view(false));
  expect(screen.getByLabelText('Draft')).toBe(editor);
  result.rerender(view(true));
  expect(screen.getByLabelText('Draft')).toBe(editor);
  expect(editor).toHaveValue('Keep this draft');
});
