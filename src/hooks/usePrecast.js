import { useEffect, useRef } from 'react';
import { precast } from '../lib/precast.js';

/**
 * Cast the pieces on the canvas once they have SETTLED there (src/lib/precast.js has the why).
 *
 * Settled, because the arc churns: a shuffle replaces every suggestion at once, and a piece added
 * and removed within a few seconds should cost nothing. Only the cast the visitor stops on is
 * cast. Nothing is on the canvas until the visitor puts it there — a page view casts nothing.
 */
export function usePrecast(cast, { settleMs = 4000 } = {}) {
  const latest = useRef(cast);
  latest.current = cast;
  const signature = (cast ?? []).map((entry) => entry?.key).join('|');

  useEffect(() => {
    if (!signature) return undefined;
    const timer = setTimeout(() => {
      for (const entry of latest.current ?? []) precast(entry);
    }, settleMs);
    return () => clearTimeout(timer);
  }, [signature, settleMs]);
}
