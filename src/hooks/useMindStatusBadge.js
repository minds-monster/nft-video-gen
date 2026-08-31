import { useEffect, useState } from 'react';
import { assistantStatus, getOrCreateThreadId } from '../services/assistantChat';

// Steady state. Each tick is a Minds `getHistory` on the Worker (worker/assistant.js), so this is
// deliberately looser than the raw mind-chat poll (5s): the pill is a secondary indicator, not the
// thing carrying the reply.
const STEADY_MS = 15_000;
// While something is expected to change — a Stripe top-up landing via webhook, for instance —
// the caller can ask for a short burst of faster polling by passing `boostUntil`.
const BOOST_MS = 3_000;

/**
 * Drives the small "waiting / seen / replied" pill and the budget readout without ever calling
 * the LLM route — GET /api/assistant/status is a pure read of connection + Mind activity + budget.
 *
 * It did not actually poll until 2026-08-27: the effect ran `tick()` once and never set the
 * interval its own comment described, so a budget credited while the tab was open — which is
 * exactly what a Stripe return is — never showed up without a reload.
 */
export const useMindStatusBadge = ({ connectionId, token, active, boostUntil = null }) => {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let timer = null;

    const tick = async () => {
      try {
        // Same threadId the assistant chat uses (one per browser session, see
        // getOrCreateThreadId) — this is what lets a status poll double as the idle-relay check.
        const result = await assistantStatus({ connectionId, token, threadId: getOrCreateThreadId() });
        if (!cancelled) setStatus(result);
      } catch {
        // Ignore; a failed single read is silent
      }
      if (cancelled) return;
      const boosted = boostUntil && Date.now() < boostUntil;
      timer = setTimeout(tick, boosted ? BOOST_MS : STEADY_MS);
    };

    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, connectionId, token, boostUntil]);

  return status;
};
