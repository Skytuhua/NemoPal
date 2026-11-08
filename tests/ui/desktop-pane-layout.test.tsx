import '@testing-library/jest-dom/vitest';
import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useDesktopPaneLayout, type PaneWidths } from '../../apps/web/src/app/useDesktopPaneLayout';

const key = 'lp:desktop-pane-layout:v1';
const defaults = { projects: 240, manager: 360 };
let containerWidth: number;
let layout: ReturnType<typeof useDesktopPaneLayout>;
let storage: Storage;
let writes: Array<[string, string]>;

class ContainerObserver {
  static instances: ContainerObserver[] = [];
  target: Element | null = null;
  disconnected = false;

  constructor(private callback: ResizeObserverCallback) {
    ContainerObserver.instances.push(this);
  }
  observe(target: Element) { this.target = target; }
  disconnect() { this.disconnected = true; }
  deliver(width: number, target = this.target!) {
    const entry = { target, contentRect: { width } } as ResizeObserverEntry;
    this.callback([entry], this as unknown as ResizeObserver);
  }
}

function Harness() {
  layout = useDesktopPaneLayout();
  const [draft, setDraft] = useState('');
  return <div ref={layout.containerRef}>
    <textarea aria-label="Draft" value={draft} onChange={event => setDraft(event.target.value)} />
  </div>;
}

function mount() {
  const view = render(<Harness />);
  const observer = ContainerObserver.instances.at(-1)!;
  expect(observer, 'the mounted container is observed').toBeDefined();
  expect(observer.target).toBe(layout.containerRef.current);
  return { ...view, observer };
}

function resize(observer: ContainerObserver, width: number) {
  containerWidth = width;
  act(() => observer.deliver(width));
}

beforeEach(() => {
  containerWidth = 1240;
  ContainerObserver.instances = [];
  writes = [];
  const values = new Map<string, string>();
  storage = {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: name => values.get(name) ?? null,
    setItem(name, value) { writes.push([name, value]); values.set(name, value); },
    removeItem: name => { values.delete(name); },
    clear: () => { values.clear(); },
  };
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('ResizeObserver', ContainerObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: containerWidth, height: 820, x: 0, y: 0, left: 0, top: 0,
    right: containerWidth, bottom: 820, toJSON() { return {}; },
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('preference storage boundary', () => {
  test.each([
    ['absent', null], ['malformed', '{'], ['null', 'null'], ['array', '[240,360]'],
    ['wrong version', '{"version":2,"projects":280,"manager":400}'],
    ['string version', '{"version":"1","projects":280,"manager":400}'],
    ['missing width', '{"version":1,"projects":280}'],
    ['string width', '{"version":1,"projects":"280","manager":400}'],
    ['null width', '{"version":1,"projects":null,"manager":400}'],
    ['nonfinite width', '{"version":1,"projects":1e400,"manager":400}'],
  ])('uses defaults without rewriting %s preferences', (_name, stored) => {
    if (stored !== null) storage.setItem(key, stored);
    writes.length = 0;
    render(<Harness />);
    expect(layout.preferredWidths).toEqual(defaults);
    expect(layout.effectiveWidths).toEqual(defaults);
    expect(writes).toEqual([]);
  });

  test.each([
    [{ projects: -500, manager: -1 }, { projects: 200, manager: 300 }],
    [{ projects: 1e308, manager: 1e308 }, { projects: 360, manager: 560 }],
    [{ projects: 280.5, manager: 420.25 }, { projects: 280.5, manager: 420.25 }],
  ])('clamps finite stored preferences %j without writing', (stored, expected) => {
    storage.setItem(key, JSON.stringify({ version: 1, ...stored }));
    writes.length = 0;
    render(<Harness />);
    expect(layout.preferredWidths).toEqual(expected);
    expect(writes).toEqual([]);
  });

  test('a blocked localStorage getter does not disable layout or drafts', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const { observer } = mount();
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Keep this draft' } });
    act(() => layout.commitUserWidths({ projects: 300, manager: 400 }));
    resize(observer, 800);
    act(() => layout.openDrawer('chat'));
    expect(layout.drawer).toBe('chat');
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep this draft');
    expect(layout.preferredWidths).toEqual({ projects: 300, manager: 400 });
  });

  test('getItem SecurityError falls back without attempting a repair write', () => {
    storage.getItem = () => { throw new DOMException('blocked', 'SecurityError'); };
    render(<Harness />);
    expect(layout.preferredWidths).toEqual(defaults);
    expect(writes).toEqual([]);
  });

  test.each(['QuotaExceededError', 'SecurityError'])('%s on writes preserves usable in-memory state', name => {
    storage.setItem = () => { throw new DOMException('unavailable', name); };
    render(<Harness />);
    act(() => layout.commitUserWidths({ projects: 300, manager: 400 }));
    expect(layout.preferredWidths).toEqual({ projects: 300, manager: 400 });
    act(() => layout.resetLayout());
    expect(layout.preferredWidths).toEqual(defaults);
  });
});

test('measures the container initially even when the viewport differs', () => {
  vi.stubGlobal('innerWidth', 2000);
  containerWidth = 1099;
  const { observer } = mount();
  expect(layout.narrow).toBe(true);
  resize(observer, 1100);
  expect(layout.narrow).toBe(false);
  expect(writes).toEqual([]);
});

test('shrinks proportionally toward minima, preserves preferences, then restores on widening', () => {
  containerWidth = 1600;
  storage.setItem(key, '{"version":1,"projects":300,"manager":500}');
  writes.length = 0;
  const { observer } = mount();
  const draft = screen.getByLabelText('Draft');
  fireEvent.change(draft, { target: { value: 'Unsent answer' } });
  draft.focus();
  resize(observer, 1146);
  // 650px sidebar budget = 200+300 minima + 150px in the preferred 100:200 ratio.
  expect(layout.effectiveWidths).toEqual({ projects: 250, manager: 400 });
  expect(layout.preferredWidths).toEqual({ projects: 300, manager: 500 });
  resize(observer, 1100);
  expect(layout.effectiveWidths.projects).toBeCloseTo(234.6666666667);
  expect(layout.effectiveWidths.manager).toBeCloseTo(369.3333333333);
  expect(layout.effectiveWidths.projects + layout.effectiveWidths.manager).toBeLessThanOrEqual(604);
  resize(observer, 800);
  expect(layout.narrow).toBe(true);
  resize(observer, 1600);
  expect(layout.effectiveWidths).toEqual({ projects: 300, manager: 500 });
  expect(screen.getByLabelText('Draft')).toBe(draft);
  expect(draft).toHaveValue('Unsent answer');
  expect(document.activeElement).toBe(draft);
  expect(writes).toEqual([]);
  expect(storage.getItem(key)).toBe('{"version":1,"projects":300,"manager":500}');
});

test('never expands widths automatically to consume spare room', () => {
  storage.setItem(key, '{"version":1,"projects":200,"manager":300}');
  const { observer } = mount();
  resize(observer, 2000);
  expect(layout.effectiveWidths).toEqual({ projects: 200, manager: 300 });
});

test('only explicit user commits persist bounded widths, and reload restores them', () => {
  const view = mount();
  expect(writes).toEqual([]);
  act(() => layout.commitUserWidths({ projects: 300.5, manager: 400.25 }));
  expect(layout.preferredWidths).toEqual({ projects: 300.5, manager: 400.25 });
  expect(writes).toEqual([[key, '{"version":1,"projects":300.5,"manager":400.25}']]);
  resize(view.observer, 1100);
  expect(writes).toHaveLength(1);
  view.unmount();
  containerWidth = 1600;
  mount();
  expect(layout.effectiveWidths).toEqual({ projects: 300.5, manager: 400.25 });
  expect(writes).toHaveLength(1);
});

test('commits against the latest desktop budget even through an earlier callback', () => {
  const { observer } = mount();
  const commit = layout.commitUserWidths;
  resize(observer, 1146);
  act(() => commit({ projects: 300, manager: 500 }));
  expect(layout.preferredWidths).toEqual({ projects: 250, manager: 400 });
  expect(writes).toEqual([[key, '{"version":1,"projects":250,"manager":400}']]);
  resize(observer, 1600);
  expect(layout.effectiveWidths).toEqual({ projects: 250, manager: 400 });
});

test('clamps user values to per-pane bounds before fitting the current budget', () => {
  containerWidth = 1600;
  mount();
  act(() => layout.commitUserWidths({ projects: -50, manager: 1e308 }));
  expect(layout.preferredWidths).toEqual({ projects: 200, manager: 560 });
  expect(writes).toEqual([[key, '{"version":1,"projects":200,"manager":560}']]);
});

test.each([
  { projects: NaN, manager: 400 }, { projects: 280, manager: Infinity },
  { projects: -Infinity, manager: 400 }, { projects: '280', manager: 400 },
  { projects: 280 }, null,
])('ignores an invalid user commit %j without altering preferences or storage', widths => {
  render(<Harness />);
  act(() => layout.commitUserWidths(widths as PaneWidths));
  expect(layout.preferredWidths).toEqual(defaults);
  expect(writes).toEqual([]);
});

test('narrow mode commits retain bounded user intent for the next desktop layout', () => {
  containerWidth = 800;
  const { observer } = mount();
  act(() => layout.commitUserWidths({ projects: 300, manager: 500 }));
  resize(observer, 1600);
  expect(layout.effectiveWidths).toEqual({ projects: 300, manager: 500 });
  expect(writes).toEqual([[key, '{"version":1,"projects":300,"manager":500}']]);
});

test('reset persists defaults while narrow and restores them on desktop', () => {
  storage.setItem(key, '{"version":1,"projects":360,"manager":560}');
  writes.length = 0;
  containerWidth = 800;
  const { observer } = mount();
  act(() => layout.resetLayout());
  expect(layout.preferredWidths).toEqual(defaults);
  expect(writes).toEqual([[key, '{"version":1,"projects":240,"manager":360}']]);
  resize(observer, 1240);
  expect(layout.effectiveWidths).toEqual(defaults);
});

test('drawers are mutually exclusive, close explicitly and never reopen after widening', () => {
  const { observer } = mount();
  const open = layout.openDrawer;
  act(() => open('projects'));
  expect(layout.drawer).toBeNull();
  resize(observer, 800);
  act(() => open('projects'));
  expect(layout.drawer).toBe('projects');
  act(() => open('chat'));
  expect(layout.drawer).toBe('chat');
  act(() => layout.closeDrawer());
  expect(layout.drawer).toBeNull();
  act(() => layout.openDrawer('chat'));
  resize(observer, 1100);
  expect(layout.drawer).toBeNull();
  resize(observer, 800);
  expect(layout.drawer).toBeNull();
  expect(writes).toEqual([]);
});

test('even a widen/shrink in one batch clears a drawer instead of reviving it', () => {
  containerWidth = 800;
  const { observer } = mount();
  act(() => layout.openDrawer('chat'));
  act(() => { observer.deliver(1240); observer.deliver(800); });
  expect(layout.narrow).toBe(true);
  expect(layout.drawer).toBeNull();
});

test('invalid or unrelated observer entries cannot change the measured layout', () => {
  const { observer } = mount();
  act(() => {
    observer.deliver(NaN);
    observer.deliver(Infinity);
    observer.deliver(-1);
    observer.deliver(800, document.createElement('div'));
  });
  expect(layout.narrow).toBe(false);
  resize(observer, 0);
  expect(layout.narrow).toBe(true);
  expect(writes).toEqual([]);
});

test('disconnects on unmount and ignores callbacks from the retired observer', () => {
  const first = mount();
  first.unmount();
  expect(first.observer.disconnected).toBe(true);
  const second = mount();
  const current = layout;
  act(() => first.observer.deliver(800));
  expect(layout).toBe(current);
  expect(layout.narrow).toBe(false);
  expect(writes).toEqual([]);
  resize(second.observer, 800);
  expect(layout.narrow).toBe(true);
});

test.each(['commit', 'reset'] as const)('a retired %s callback cannot replace a newer controller preference', kind => {
  containerWidth = 1600;
  const first = mount();
  const retiredCommit = layout.commitUserWidths, retiredReset = layout.resetLayout;
  first.unmount();

  const second = mount();
  const latest = { projects: 320, manager: 480 };
  act(() => layout.commitUserWidths(latest));
  const expectedWrites = [...writes];
  act(() => {
    if (kind === 'commit') retiredCommit({ projects: 220, manager: 330 });
    else retiredReset();
  });

  expect(writes).toEqual(expectedWrites);
  expect(layout.preferredWidths).toEqual(latest);
  expect(JSON.parse(storage.getItem(key)!)).toEqual({ version: 1, ...latest });
  second.unmount();
  mount();
  expect(layout.preferredWidths).toEqual(latest);
  expect(writes).toEqual(expectedWrites);
});

test('StrictMode reactivates persistence after its effect cleanup rehearsal', () => {
  render(<StrictMode><Harness /></StrictMode>);
  act(() => layout.commitUserWidths({ projects: 280, manager: 400 }));
  expect(layout.preferredWidths).toEqual({ projects: 280, manager: 400 });
  expect(JSON.parse(storage.getItem(key)!)).toEqual({ version: 1, projects: 280, manager: 400 });
  act(() => layout.resetLayout());
  expect(layout.preferredWidths).toEqual(defaults);
  expect(JSON.parse(storage.getItem(key)!)).toEqual({ version: 1, ...defaults });
});

test('StrictMode retires its first observer and keeps the current observer working', () => {
  render(<StrictMode><Harness /></StrictMode>);
  expect(ContainerObserver.instances).toHaveLength(2);
  const [retired, current] = ContainerObserver.instances;
  expect(retired!.disconnected).toBe(true);
  act(() => retired!.deliver(800));
  expect(layout.narrow).toBe(false);
  resize(current!, 800);
  expect(layout.narrow).toBe(true);
  expect(writes).toEqual([]);
});

test('without ResizeObserver, measures initially and on window resize, then removes the listener', () => {
  vi.stubGlobal('ResizeObserver', undefined);
  containerWidth = 800;
  const removeListener = vi.spyOn(window, 'removeEventListener');
  const view = render(<Harness />);
  expect(layout.narrow).toBe(true);
  act(() => layout.openDrawer('projects'));
  containerWidth = 1240;
  fireEvent(window, new Event('resize'));
  expect(layout.narrow).toBe(false);
  expect(layout.drawer).toBeNull();
  view.unmount();
  expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
  containerWidth = 800;
  fireEvent(window, new Event('resize'));
  expect(writes).toEqual([]);
});
