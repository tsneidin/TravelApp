import { useEffect, useRef } from 'react';

const dialogStack: HTMLElement[] = [];
let originalOverflow = '';

/** Keep keyboard focus and scrolling inside the topmost open dialog. */
export function useDialog<T extends HTMLElement = HTMLDivElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    if (dialogStack.length === 0) originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogStack.push(dialog);
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]',
    )).filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0);
    // Focus the dialog itself so opening a form does not summon a phone keyboard.
    dialog.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === 'Tab') {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (dialogStack[dialogStack.length - 1] === dialog && !dialog.contains(event.target as Node)) dialog.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      dialogStack.splice(dialogStack.indexOf(dialog), 1);
      if (dialogStack.length === 0) document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  return ref;
}
