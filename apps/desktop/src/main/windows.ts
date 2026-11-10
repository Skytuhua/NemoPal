export type Rectangle = { x: number; y: number; width: number; height: number };
export function securePreferences(preload: string) {
  return { preload, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false } as const;
}
export function rendererTargets(base: string) {
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'file:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw Error('Only packaged or exact development loopback renderer allowed');
  return { workspace: url.href, pet: `${url.href}?surface=pet`, petChat: `${url.href}?surface=pet-chat` };
}
export function clampPosition(point: { x: number; y: number }, size: { width: number; height: number }, areas: Rectangle[]) {
  const area = areas.find(a => point.x >= a.x && point.x < a.x + a.width && point.y >= a.y && point.y < a.y + a.height) ?? [...areas].sort((a, b) => {
    const distance = (r: Rectangle) => Math.hypot(Math.max(r.x - point.x, 0, point.x - (r.x + r.width)), Math.max(r.y - point.y, 0, point.y - (r.y + r.height)));
    return distance(a) - distance(b);
  })[0];
  if (!area) throw Error('No available display');
  return { x: Math.round(Math.max(area.x, Math.min(point.x, area.x + area.width - size.width))), y: Math.round(Math.max(area.y, Math.min(point.y, area.y + area.height - size.height))) };
}
/** Keep a dragged window continuous across adjacent displays only when their work-area union covers it. */
export function clampDragPosition(point: { x: number; y: number }, size: { width: number; height: number }, areas: Rectangle[]) {
  const target = { x: Math.round(point.x), y: Math.round(point.y) };
  const right = target.x + size.width, bottom = target.y + size.height;
  const cuts = [target.x, right, ...areas.flatMap(area => [area.x, area.x + area.width]).filter(x => x > target.x && x < right)].sort((a, b) => a - b);
  const covered = size.width > 0 && size.height > 0 && cuts.every((left, index) => {
    const end = cuts[index + 1];
    if (end === undefined || end === left) return true;
    const intervals = areas.filter(area => area.x <= left && area.x + area.width >= end && area.width > 0 && area.height > 0)
      .map(area => ({ start: area.y, end: area.y + area.height })).sort((a, b) => a.start - b.start);
    let y = target.y;
    for (const interval of intervals) {
      if (interval.start > y) break;
      y = Math.max(y, interval.end);
      if (y >= bottom) return true;
    }
    return false;
  });
  return covered ? target : clampPosition(target, size, areas);
}

export class CompanionLifetime {
  private quitting?: Promise<void>;
  constructor(private hide: () => void, private stop: () => Promise<void>, private flush: () => Promise<void>, private exit: () => void) {}
  acquire(lock: () => boolean): boolean { const acquired = lock(); if (!acquired) this.exit(); return acquired; }
  closeWorkspace(): void { if (!this.quitting) this.hide(); }
  quit(): Promise<void> {
    if (this.quitting) return this.quitting;
    const attempt = (async () => { await this.stop(); await this.flush(); this.exit(); })();
    this.quitting = attempt;
    void attempt.catch(() => { if (this.quitting === attempt) this.quitting = undefined; });
    return attempt;
  }
}
