import { useEffect, useRef } from 'react';
import { precast, precastable } from '../lib/precast.js';

/**
 * Cast the pieces on the canvas once they have SETTLED there (src/lib/precast.js has the why).
 *
 * Settled, because the arc churns: a shuffle replaces every suggestion at once, and a piece added
 * and removed within a few seconds should cost nothing. Only the cast the visitor stops on is
 * cast.
 *
 * A page view casts nothing. That was true only until drafts came back on load: a restored piece
 * is on the canvas without the visitor putting it there, and every cast is paid. So `skip` (the
 * pieces the draft restored) are left for the launch, and `enabled` is false on pages with no
 * canvas at all — the owner area.
 */
export function usePrecast(cast, { settleMs = 4000, enabled = true, skip } = {}) {
  const latest = useRef({ cast, skip });
  latest.current = { cast, skip };
  const signature = enabled ? precastable(cast, skip).map((entry) => entry.key).join('|') : '';

  useEffect(() => {
    if (!signature) return undefined;
    const timer = setTimeout(() => {
      for (const entry of precastable(latest.current.cast, latest.current.skip)) precast(entry);
    }, settleMs);
    return () => clearTimeout(timer);
  }, [signature, settleMs]);
}
