import { beforeEach, vi } from 'vitest';

// The existing UI suite models a desktop; jsdom has no layout or native
// ResizeObserver. Keep these browser boundaries synthetic and test-only.
if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class implements ResizeObserver {
    observe() {} unobserve() {} disconnect() {}
  };
}
const rectangle = HTMLElement.prototype.getBoundingClientRect;
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    let width = 0, left = 0;
    if (this.hasAttribute('data-pane-measure') || this.dataset.slot === 'resizable-panel-group') width = 1240;
    else if (this.dataset.slot === 'resizable-handle') { width = 8; left = this.getAttribute('aria-label') === 'Resize Projects' ? 240 : 872; }
    else return rectangle.call(this);
    return { width, height: 820, x: left, y: 0, left, top: 0, right: left + width, bottom: 820, toJSON() { return {}; } };
  });
});
