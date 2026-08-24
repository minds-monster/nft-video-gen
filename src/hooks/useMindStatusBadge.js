import { useEffect, useState } from 'react';
import { assistantStatus, getOrCreateThreadId } from '../services/assistantChat';

// Drives the small "waiting / seen / replied" pill without ever calling the LLM route —
// GET /api/assistant/status is a pure read of connection + Mind activity. Only polls
// while there's something to watch (a pending handshake or an approved session); the
// interval is deliberately looser than the raw mind-chat poll (5s) since this is a
// secondary indicator, not the thing carrying the actual reply.
const POLL_MS = 6_000;

export const useMindStatusBadge = ({ connectionId, token, active }) => {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const tick = async () => {
      try {
        // Same threadId the assistant chat uses (one per browser session, see
        // getOrCreateThreadId) — this is what lets a status poll double as the
        // idle-relay check, since this hook is what's actually running every 6s.
        const result = await assistantStatus({ connectionId, token, threadId: getOrCreateThreadId() });
        if (!cancelled) setStatus(result);
      } catch {
        // Ignore; the next tick retries.
      }
    };

    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, connectionId, token]);

  return status;
};
