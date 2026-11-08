import '@testing-library/jest-dom/vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Sidebar, SidebarProvider, SidebarTrigger, useSidebar, Sheet, SheetContent, SheetDescription, SheetTitle, ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@living-playbooks/project-ui';

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

const { compile } = createRequire(resolve('apps/web/package.json'))('tailwindcss') as {
  compile(css: string): Promise<{ build(candidates: string[]): string }>;
};

test.each([14, 16].flatMap(root => ['horizontal', 'vertical'].map(orientation => ({ root, orientation }))))(
  'compiled $orientation handle dimensions retain the 16px budget at a $root-px root', async ({ root, orientation }) => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(<ResizablePanelGroup orientation={orientation as 'horizontal' | 'vertical'}>
      <ResizablePanel id="projects" /><ResizableHandle /><ResizablePanel id="workspace" /><ResizableHandle /><ResizablePanel id="manager" />
    </ResizablePanelGroup>);
    const handles = [...host.querySelectorAll('[data-slot="resizable-handle"]')];
    expect(handles).toHaveLength(2);
    const sizes: number[] = [];
    for (const handle of handles) {
      const horizontalGroup = orientation === 'horizontal';
      expect(handle.getAttribute('aria-orientation')).toBe(horizontalGroup ? 'vertical' : 'horizontal');
      const candidate = [...handle.classList].find(name => horizontalGroup ? name.startsWith('w-') : name.startsWith('aria-[orientation=horizontal]:h-'));
      expect(candidate).toBeDefined();
      // Compile the real rendered utility through the consuming package's pinned
      // Tailwind compiler, with its standard spacing unit. No browser geometry is claimed.
      const compiler = await compile('@theme { --spacing: 0.25rem; } @tailwind utilities;');
      const css = compiler.build([candidate!]);
      const property = horizontalGroup ? 'width' : 'height';
      const value = css.match(new RegExp(`\\b${property}:\\s*([^;]+);`))?.[1]?.trim();
      expect(value).toBeDefined();
      const literal = value!.match(/^(\d+(?:\.\d+)?)px$/);
      const spacing = value!.match(/^calc\(var\(--spacing\) \* (\d+(?:\.\d+)?)\)$/);
      if (!literal && !spacing) throw new Error(`Unsupported generated dimension: ${value}`);
      const pixels = literal ? Number(literal[1]) : root * 0.25 * Number(spacing![1]);
      sizes.push(pixels);
      expect(pixels).toBe(8);
    }
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(16);
  },
);
