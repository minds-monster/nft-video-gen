// Client for the assistant (worker/assistant.js) — separate from mindConnect.js's
// direct-to-Mind calls, since this is a different, fast conversation that streams.

import { stream } from './swarm';

const THREAD_KEY = 'assistantThreadId';

// One thread per browser session, reused across the modal and the canvas panel so
// either surface picks up the same conversation. Falls back to an ungenerated id if
// sessionStorage is unavailable rather than failing outright.
export const getOrCreateThreadId = () => {
  try {
    let id = sessionStorage.getItem(THREAD_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(THREAD_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
};

// Streams the reply as it's generated — `onEvent('delta', {content})` fires per chunk,
// same wire format and `stream()` client the Casting Director already uses. Resolves
// with the terminal result payload once the reply is complete.
export const assistantMessageStream = ({ threadId, text, connectionId, token }, options) =>
  stream(
    '/api/assistant/message',
    { threadId, text, connectionId },
    { ...options, retries: 2, headers: token ? { authorization: `Bearer ${token}` } : undefined },
  );

export const assistantHistory = async (threadId) => {
  const res = await fetch(`/api/assistant/history?threadId=${encodeURIComponent(threadId)}`);
  if (!res.ok) return { messages: [] };
  return res.json();
};

// threadId is optional — passing it lets the status poll also flush anything the
// assistant has been holding past the idle-relay window (see IDLE_RELAY_MS in
// worker/assistant.js); omit it for a pure read with no side effect.
export const assistantStatus = async ({ connectionId, token, threadId }) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const params = new URLSearchParams();
  if (connectionId) params.set('connectionId', connectionId);
  if (threadId) params.set('threadId', threadId);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`/api/assistant/status${query}`, { headers });
  if (!res.ok) throw new Error(`assistant/status failed: ${res.status}`);
  return res.json();
};
