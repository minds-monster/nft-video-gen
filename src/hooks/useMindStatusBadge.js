import { useEffect, useState } from 'react';
import { assistantStatus, getOrCreateThreadId } from '../services/assistantChat';

// Drives the small "waiting / seen / replied" pill without ever calling the LLM route —
// GET /api/assistant/status is a pure read of connection + Mind activity. Only polls
// while there's something to watch (a pending handshake or an approved session); the
// interval is deliberately looser than the raw mind-chat poll (5s) since this is a
// secondary indicator, not the thing carrying the actual reply.
export const useMindStatusBadge = ({ connectionId, token, active }) => {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;

    const tick = async () => {
      try {
        // Same threadId the assistant chat uses (one per browser session, see
        // getOrCreateThreadId) — this is what lets a status poll double as the
        // idle-relay check, since this hook is what's actually running every 6s.
        const result = await assistantStatus({ connectionId, token, threadId: getOrCreateThreadId() });
        if (!cancelled) setStatus(result);
      } catch {
        // Ignore; a failed single read is silent
      }
    };

    tick();
    return () => {
      cancelled = true;
    };
  }, [active, connectionId, token]);

  return status;
};
