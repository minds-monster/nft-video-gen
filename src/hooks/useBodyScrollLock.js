import { useEffect } from 'react';

// Ref-counted so two overlays can be up at once without the second one's cleanup
// restoring the *locked* value it captured on mount. Only the first lock records the
// page's real overflow, and only the last release puts it back.
let locks = 0;
let previous = '';

/** Freeze page scroll while `active`. */
export const useBodyScrollLock = (active) => {
  useEffect(() => {
    if (!active) return undefined;

    if (locks === 0) {
      previous = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    locks += 1;

    return () => {
      locks -= 1;
      if (locks === 0) document.body.style.overflow = previous;
    };
  }, [active]);
};
