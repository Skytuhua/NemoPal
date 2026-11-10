export function isVisible(node: HTMLElement) {
  if (!node.isConnected || node.closest('[hidden], [inert]')) return false;
  for (let parent: HTMLElement | null = node; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}
export function restoreFocus(previous: Element | null) {
  const fallback = document.querySelector<HTMLElement>('[data-drawer-trigger][aria-expanded="false"]');
  if (previous instanceof HTMLElement && isVisible(previous)) previous.focus();
  else if (fallback && isVisible(fallback)) fallback.focus();
  else document.getElementById('workspace')?.focus();
}

export function trapFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex="0"]')).filter(node => isVisible(node) && !node.closest('details:not([open]) > :not(summary)'));
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
