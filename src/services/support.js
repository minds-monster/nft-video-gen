// The support form and the visitor's ticket page, talking to worker/support.js.

import { getStoredSession } from './mindConnect';

const headers = () => {
  const base = { 'content-type': 'application/json' };
  // A connected visitor's session rides along so the Worker can add their plan and film
  // count to the ticket — read from the token there, never from anything typed here.
  const session = getStoredSession();
  return session?.token ? { ...base, authorization: `Bearer ${session.token}` } : base;
};

export const submitSupport = async ({ email, subject, message, urgent, humanRequested, hp }) => {
  const res = await fetch('/api/support', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email, subject, message, urgent, humanRequested, hp, page: window.location.hash || '/' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `support failed: ${res.status}`), { code: data.error, status: res.status });
  return data;
};

export const fetchTicket = async (ticketId, token) => {
  const res = await fetch(`/api/support/ticket?ticketId=${encodeURIComponent(ticketId)}&token=${encodeURIComponent(token)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `ticket failed: ${res.status}`), { code: data.error, status: res.status });
  return data;
};

export const replyToTicket = async (ticketId, token, { message, humanRequested = false }) => {
  const res = await fetch('/api/support/reply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ticketId, token, message, humanRequested }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `reply failed: ${res.status}`), { code: data.error, status: res.status });
  return data;
};
