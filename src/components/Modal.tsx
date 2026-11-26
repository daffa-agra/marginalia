import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from './icons';

/**
 * Modal dialog: focus trap, Escape to close, backdrop close, focus return,
 * and everything else on the page made inert so nothing behind it is
 * reachable by pointer, keyboard or a screen reader.
 */
export function Modal({
  title,
  onClose,
  children,
  wide,
  returnFocusTo,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Fallback selector for the element focus returns to when the opener unmounts. */
  returnFocusTo?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The close handler is recreated by every parent render; keep the effect
  // mount-only so a re-render can never tear down the trap or reset focus.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    // An opener that is already unmounted (a menu item, say) leaves <body>
    // as activeElement — treat that as "no opener" so the fallback wins.
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    const panel = panelRef.current;
    const backdrop = backdropRef.current;

    // Walk from the backdrop to <body>, making every off-path sibling inert.
    const inerted: Array<{ el: Element; hadAria: string | null }> = [];
    let node: Element | null = backdrop;
    while (node && node !== document.body) {
      const parent: Element | null = node.parentElement;
      if (parent) {
        for (const sibling of [...parent.children]) {
          if (sibling === node || sibling.tagName === 'SCRIPT') continue;
          // Feedback has to stay reachable even while a dialog is open.
          if (sibling.matches('.toast-region, .drag-veil')) continue;
          if (sibling.hasAttribute('inert')) continue;
          inerted.push({ el: sibling, hadAria: sibling.getAttribute('aria-hidden') });
          sibling.setAttribute('inert', '');
          sibling.setAttribute('aria-hidden', 'true');
        }
      }
      node = parent;
    }

    const focusables = () => {
      const items = panel?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      return items ? [...items] : [];
    };

    const firstField = panel?.querySelector<HTMLElement>('input, select, textarea');
    if (firstField) firstField.focus();
    else closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && panel.contains(active);
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = '';
      for (const { el, hadAria } of inerted) {
        el.removeAttribute('inert');
        if (hadAria === null) el.removeAttribute('aria-hidden');
        else el.setAttribute('aria-hidden', hadAria);
      }
      // Return focus to whatever opened the dialog. The opener can be
      // unmounted by the same commit that closes us (a menu item, say), so
      // fall back to a named trigger, then to the first header action.
      const restore = () => {
        const target =
          (opener && document.contains(opener) ? opener : null) ??
          (returnFocusTo ? document.querySelector<HTMLElement>(returnFocusTo) : null) ??
          document.querySelector<HTMLElement>('.header-actions .btn-primary');
        target?.focus();
      };
      restore();
      window.requestAnimationFrame(restore);
    };
  }, [returnFocusTo]);

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={wide ? 'modal-panel wide' : 'modal-panel'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button
            ref={closeRef}
            type="button"
            className="btn btn-ghost icon-btn close-btn"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
