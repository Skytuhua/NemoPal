import { useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type Ref, type CSSProperties } from 'react';
import { Button, ResizableHandle, ResizablePanel, ResizablePanelGroup, Sheet, SheetContent, SheetDescription, SheetTitle } from '@living-playbooks/project-ui';
import { useDesktopPaneLayout } from './useDesktopPaneLayout';
import './desktop-shell.css';

export type DesktopShellHandle = { openProjects(): void; showWorkspace(): void; resetLayout(): void };

function tabbable(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,summary,[tabindex]')].filter(element => {
    if (element.tabIndex < 0 || element.matches(':disabled,[data-radix-focus-guard]') || element.closest('[hidden],[inert]')) return false;
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      if (node.tagName === 'DETAILS' && !node.hasAttribute('open')) {
        const summary = [...node.children].find(child => child.tagName === 'SUMMARY');
        if (!summary?.contains(element)) return false;
      }
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  });
}

export function DesktopWorkspaceShell({ ref, projects, workspace, manager }: {
  ref?: Ref<DesktopShellHandle>;
  projects: ReactNode; workspace: ReactNode; manager: ReactNode;
}) {
  const pane = useDesktopPaneLayout();
  const projectsContent = useRef<HTMLDivElement>(null), managerContent = useRef<HTMLDivElement>(null);
  const projectsButton = useRef<HTMLButtonElement>(null), chatButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null), previous = useRef({ narrow: pane.narrow, drawer: pane.drawer });
  const applySizes = useRef<(layout: Record<string, number>) => void>(() => {});
  const appliedSizes = useRef('');
  const modal = pane.narrow && pane.drawer !== null;
  const open = (side: 'projects' | 'chat', element = document.activeElement) => {
    opener.current = element instanceof HTMLElement ? element : null;
    pane.openDrawer(side);
  };
  useImperativeHandle(ref, () => ({ openProjects: () => open('projects'), showWorkspace: () => pane.closeDrawer(), resetLayout: pane.resetLayout }));

  // The Group owns dragging/keyboard mechanics. Measurement only re-applies the
  // effective layout and never persists an automatic constraint adjustment.
  useLayoutEffect(() => {
    const width = pane.containerRef.current?.getBoundingClientRect().width ?? 0;
    if (!width) return;
    const signature = `${width}:${pane.narrow}:${pane.effectiveWidths.projects}:${pane.effectiveWidths.manager}`;
    if (appliedSizes.current === signature) return;
    appliedSizes.current = signature;
    const available = Math.max(1, width - (pane.narrow ? 0 : 16));
    const projects = pane.narrow ? 0 : pane.effectiveWidths.projects / available * 100;
    const manager = pane.narrow ? 0 : pane.effectiveWidths.manager / available * 100;
    applySizes.current({ projects, canvas: 100 - projects - manager, manager });
  });

  useLayoutEffect(() => {
    const active = pane.drawer === 'projects' ? projectsContent.current : managerContent.current;
    const before = previous.current;
    if (modal && active && before.drawer !== pane.drawer) {
      (tabbable(active)[0] ?? active).focus();
    } else if (pane.narrow && before.drawer && !pane.drawer) {
      const fallback = before.drawer === 'projects' ? projectsButton.current : chatButton.current;
      const target = opener.current?.isConnected && !opener.current.closest('[hidden],[inert]') ? opener.current : fallback;
      target?.focus();
    } else if (pane.narrow && !before.narrow && !pane.drawer) {
      const focused = document.activeElement;
      if (focused && projectsContent.current?.contains(focused)) projectsButton.current?.focus();
      if (focused && managerContent.current?.contains(focused)) chatButton.current?.focus();
    }
    previous.current = { narrow: pane.narrow, drawer: pane.drawer };
    if (!modal || !active) return;
    const trap = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const items = tabbable(active), first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); active.focus(); return; }
      if (!active.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); first.focus();
      } else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    };
    document.addEventListener('keydown', trap, true);
    return () => document.removeEventListener('keydown', trap, true);
  }, [pane.narrow, pane.drawer, modal]);

  function desktopTab(event: KeyboardEvent<HTMLDivElement>) {
    if (pane.narrow || event.key !== 'Tab' || event.defaultPrevented) return;
    // Force-mounted nonmodal Radix Content loops at its own boundary. On desktop
    // let Tab cross the pane boundary without changing the mounted Content type.
    const inside = tabbable(event.currentTarget), edge = event.shiftKey ? inside[0] : inside.at(-1);
    if (document.activeElement !== edge) return;
    const all = tabbable(document), index = all.indexOf(edge!);
    if (index < 0) return;
    const next = all[(index + (event.shiftKey ? -1 : 1) + all.length) % all.length];
    if (next) { event.preventDefault(); next.focus(); }
  }

  const sizes = { '--projects-width': `${pane.preferredWidths.projects}px`, '--manager-width': `${pane.preferredWidths.manager}px` } as CSSProperties;
  return <div className="workspace-ui desktop-shell" data-narrow={pane.narrow} style={sizes}>
    <a className="skip-link" href="#workspace">Skip to workspace</a>
    <div className="pane-container" ref={pane.containerRef} data-pane-measure>
      <ResizablePanelGroup orientation="horizontal" disabled={pane.narrow}
        groupRef={handle => { applySizes.current = handle ? layout => { handle.setLayout(layout); } : () => {}; }}
        onLayoutChanged={(layout, meta) => {
          if (!meta.isUserInteraction || pane.narrow) return;
          const available = (pane.containerRef.current?.getBoundingClientRect().width ?? 0) - 16;
          if (available > 0) pane.commitUserWidths({ projects: layout.projects! / 100 * available, manager: layout.manager! / 100 * available });
        }}>
        <ResizablePanel id="projects" defaultSize={240} minSize={pane.narrow ? 0 : 200} maxSize={pane.narrow ? 0 : 360} collapsible collapsedSize={0} inert={pane.narrow && pane.drawer !== 'projects'}>
          <Sheet open={!pane.narrow || pane.drawer === 'projects'} modal={false} onOpenChange={open => { if (!open && pane.narrow) pane.closeDrawer(); }}>
            <SheetContent ref={projectsContent} className="desktop-pane projects-pane" side="left" portal={false} showOverlay={false} showCloseButton={pane.narrow} forceMount
              hidden={pane.narrow && pane.drawer !== 'projects'} role={pane.narrow ? 'dialog' : 'complementary'} aria-modal={modal && pane.drawer === 'projects' ? true : undefined}
              onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}
              onEscapeKeyDown={event => { event.preventDefault(); if (pane.narrow) pane.closeDrawer(); }} onKeyDownCapture={desktopTab}>
              <SheetTitle className="sr-only">Projects</SheetTitle><SheetDescription className="sr-only">Choose or create a project.</SheetDescription>
              {projects}
            </SheetContent>
          </Sheet>
        </ResizablePanel>
        <ResizableHandle aria-label="Resize Projects" disabled={pane.narrow} hidden={pane.narrow} withHandle />
        <ResizablePanel id="canvas" minSize={pane.narrow ? 0 : 480} inert={modal}><div className="workspace-canvas">
          <nav className="narrow-workspace-actions" aria-label="Workspace navigation" hidden={!pane.narrow}>
            <Button id="projects-drawer-toggle" ref={projectsButton} variant="ghost" size="icon" aria-label="Projects" title="Projects" onClick={event => open('projects', event.currentTarget)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></svg></Button>
            <Button ref={chatButton} variant="ghost" size="icon" aria-label="Chat" title="Chat" onClick={event => open('chat', event.currentTarget)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1V11.5a9 9 0 0 1 18 0Z" /><path d="M8 11h8M8 15h5" /></svg></Button>
          </nav>{workspace}
        </div></ResizablePanel>
        <ResizableHandle aria-label="Resize Chat" disabled={pane.narrow} hidden={pane.narrow} withHandle />
        <ResizablePanel id="manager" defaultSize={360} minSize={pane.narrow ? 0 : 300} maxSize={pane.narrow ? 0 : 560} collapsible collapsedSize={0} inert={pane.narrow && pane.drawer !== 'chat'}>
          <Sheet open={!pane.narrow || pane.drawer === 'chat'} modal={false} onOpenChange={open => { if (!open && pane.narrow) pane.closeDrawer(); }}>
            <SheetContent ref={managerContent} className="desktop-pane manager-pane" portal={false} showOverlay={false} showCloseButton={pane.narrow} forceMount
              hidden={pane.narrow && pane.drawer !== 'chat'} role={pane.narrow ? 'dialog' : 'complementary'} aria-modal={modal && pane.drawer === 'chat' ? true : undefined}
              onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()} onInteractOutside={event => event.preventDefault()}
              onEscapeKeyDown={event => { event.preventDefault(); if (pane.narrow) pane.closeDrawer(); }} onKeyDownCapture={desktopTab}>
              <SheetTitle className="sr-only">Manager chat</SheetTitle><SheetDescription className="sr-only">Project conversation and manager questions.</SheetDescription>
              {manager}
            </SheetContent>
          </Sheet>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
    {modal && <button className="drawer-backdrop" aria-label="Close drawer" tabIndex={-1} onClick={pane.closeDrawer} />}
  </div>;
}
