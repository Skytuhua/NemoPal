import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export type PaneWidths = { projects: number; manager: number };
export type Drawer = 'projects' | 'chat' | null;

const storageKey = 'lp:desktop-pane-layout:v1';
const defaults: PaneWidths = { projects: 240, manager: 360 };
const desktopBreakpoint = 1100;
const centerMinimum = 480;
const handleBudget = 16;
const projectsMinimum = 200;
const managerMinimum = 300;

function isPaneWidths(value: unknown): value is PaneWidths {
  return typeof value === 'object' && value !== null
    && 'projects' in value && typeof value.projects === 'number' && Number.isFinite(value.projects)
    && 'manager' in value && typeof value.manager === 'number' && Number.isFinite(value.manager);
}

function clampWidths(widths: PaneWidths): PaneWidths {
  return {
    projects: Math.min(360, Math.max(projectsMinimum, widths.projects)),
    manager: Math.min(560, Math.max(managerMinimum, widths.manager)),
  };
}

function readPreferences(): PaneWidths {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null');
    if (isPaneWidths(stored) && 'version' in stored && stored.version === 1) return clampWidths(stored);
  } catch {
    // Preferences are optional; unavailable storage must not interrupt editing.
  }
  return defaults;
}

function persistPreferences(widths: PaneWidths) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ version: 1, ...widths }));
  } catch {
    // Keep the usable in-memory layout even when persistence is denied or full.
  }
}

function fitWidths(widths: PaneWidths, containerWidth: number): PaneWidths {
  // Drawer mode has no desktop sidebar budget; retain bounded widths for widening.
  if (containerWidth < desktopBreakpoint) return widths;
  const available = containerWidth - centerMinimum - handleBudget;
  if (widths.projects + widths.manager <= available) return widths;
  const extra = widths.projects - projectsMinimum + widths.manager - managerMinimum;
  const scale = Math.max(0, available - projectsMinimum - managerMinimum) / extra;
  const projects = projectsMinimum + (widths.projects - projectsMinimum) * scale;
  return {
    projects,
    manager: Math.min(managerMinimum + (widths.manager - managerMinimum) * scale, available - projects),
  };
}

export function useDesktopPaneLayout() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const measuredWidth = useRef(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [preferredWidths, setPreferredWidths] = useState(readPreferences);
  const [drawer, setDrawer] = useState<Drawer>(null);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let active = true;
    function measure(width: number) {
      if (!active || !Number.isFinite(width) || width < 0) return;
      measuredWidth.current = width;
      setContainerWidth(width);
      // Clear on every widen, including a widen/shrink delivered in the same batch.
      if (width >= desktopBreakpoint) setDrawer(null);
    }
    const measureContainer = () => measure(container.getBoundingClientRect().width);
    measureContainer();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
          if (entry.target === container) measure(entry.contentRect.width);
        }
      });
      observer.observe(container);
      return () => { active = false; observer.disconnect(); };
    }

    window.addEventListener('resize', measureContainer);
    return () => { active = false; window.removeEventListener('resize', measureContainer); };
  }, []);

  const openDrawer = useCallback((side: 'projects' | 'chat') => {
    setDrawer(measuredWidth.current < desktopBreakpoint ? side : null);
  }, []);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const commitUserWidths = useCallback((widths: PaneWidths) => {
    if (!mounted.current || !isPaneWidths(widths)) return;
    const next = fitWidths(clampWidths(widths), measuredWidth.current);
    setPreferredWidths(next);
    persistPreferences(next);
  }, []);
  const resetLayout = useCallback(() => {
    if (!mounted.current) return;
    setPreferredWidths(defaults);
    persistPreferences(defaults);
  }, []);

  return {
    containerRef,
    narrow: containerWidth < desktopBreakpoint,
    drawer,
    preferredWidths,
    effectiveWidths: fitWidths(preferredWidths, containerWidth),
    openDrawer,
    closeDrawer,
    commitUserWidths,
    resetLayout,
  };
}
