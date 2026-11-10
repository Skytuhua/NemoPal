import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { restoreFocus, trapFocus } from './focus';

/** Keep children mounted when closed so drafts and in-flight work retain identity. */
export function DetailSurface({ open, title, closeLabel, onClose, children, className = '' }: { open: boolean; title: string; closeLabel: string; onClose(): void; children: ReactNode; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const node = dialog.current!;
    const previous = document.activeElement;
    // Electron supports modal dialogs; the fallback also permits headless DOM checks.
    if (typeof node.showModal === 'function') node.showModal();
    else node.open = true;
    node.querySelector<HTMLButtonElement>('[data-detail-close]')?.focus();
    return () => {
      if (typeof node.close === 'function') node.close();
      else node.open = false;
      restoreFocus(previous);
    };
  }, [open]);

  return <dialog ref={dialog} hidden={!open} className={`detail-surface ${className}`} aria-labelledby={titleId} aria-modal="true"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      trapFocus(event);
    }}>
    <header className="detail-surface-header"><h2 id={titleId}>{title}</h2><button type="button" className="detail-close" data-detail-close aria-label={closeLabel} onClick={onClose}><DetailIcon kind="close" /></button></header>
    <div className="detail-surface-body">{children}</div>
  </dialog>;
}

export function DetailIcon({ kind }: { kind: 'close' | 'note' | 'arrow' | 'check' | 'more' | 'shield' }) {
  const paths = {
    close: <path d="m6 6 12 12M18 6 6 18" />,
    note: <><path d="M14 3H5v18h14V8l-5-5Z" /><path d="M14 3v5h5M8 12h8M8 16h6" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    check: <path d="m5 12 4 4L19 6" />,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    shield: <><path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}
