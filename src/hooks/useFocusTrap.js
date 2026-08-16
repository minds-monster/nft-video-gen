import { useEffect } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Keep Tab inside `ref` while `active`, and hand focus back where it came from on close.
 *
 * The Studio has never trapped focus, which is survivable for a panel you can click past.
 * A full-screen canvas that covers the header is not — tabbing out lands you on invisible
 * page furniture with no way back.
 */
export const useFocusTrap = (ref, active, { restoreFocus = true } = {}) => {
  useEffect(() => {
    if (!active) return undefined;

    const root = ref.current;
    const restoreTo = document.activeElement;

    const onKeyDown = (event) => {
      if (event.key !== 'Tab' || !root) return;

      const items = [...root.querySelectorAll(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (!items.length) return;

      const first = items[0];
      const last = items[items.length - 1];

      // Wrap at both ends. `root` itself is focusable (tabIndex -1) and can hold focus
      // before the user has tabbed anywhere, so treat that as "before the first".
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Opt out when the trapped surface doesn't unmount on close. The prompt composer
      // is opened *by* focusing its own textarea, so restoring focus there would fire
      // onFocus again and reopen it the instant it was dismissed.
      if (restoreFocus && restoreTo instanceof HTMLElement) {
        restoreTo.focus({ preventScroll: true });
      }
    };
  }, [ref, active, restoreFocus]);
};
