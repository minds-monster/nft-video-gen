// The owner area's client, mirroring src/services/mindConnect.js: a stored token, and fetch
// helpers that send it. Separate storage key from `mindSession` because the two tokens are
// different kinds (worker/session.js) and must never be handed to each other's routes.

const OWNER_KEY = 'ownerSession';

export const getStoredOwnerSession = () => {
  try {
    const raw = localStorage.getItem(OWNER_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.token || !session.expiresAt || session.expiresAt < Date.now()) {
      localStorage.removeItem(OWNER_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
};

export const storeOwnerSession = (session) => localStorage.setItem(OWNER_KEY, JSON.stringify(session));
export const clearOwnerSession = () => localStorage.removeItem(OWNER_KEY);

export const ownerLogin = async (passphrase) => {
  const res = await fetch('/api/owner/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ passphrase }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `login failed: ${res.status}`), { code: data.error, status: res.status });
  storeOwnerSession(data);
  return data;
};

const request = async (token, path, init = {}) => {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) clearOwnerSession();
  if (!res.ok) throw Object.assign(new Error(data.error ?? `${path} failed: ${res.status}`), { code: data.error, status: res.status });
  return data;
};

export const ownerSupportList = (token, { status, cursor } = {}) => {
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (cursor) query.set('cursor', cursor);
  const suffix = query.toString() ? `?${query}` : '';
  return request(token, `/api/owner/support${suffix}`);
};
export const ownerSupportStats = (token) => request(token, '/api/owner/support-stats');
export const ownerSupportTicket = (token, ticketId) => request(token, `/api/owner/support/${encodeURIComponent(ticketId)}`);
export const ownerSupportNote = (token, ticketId, note) =>
  request(token, `/api/owner/support/${encodeURIComponent(ticketId)}/note`, { method: 'POST', body: JSON.stringify({ note }) });
export const ownerOverview = (token) => request(token, '/api/owner/overview');
export const ownerAnalyticsHeal = (token) => request(token, '/api/owner/analytics/heal', { method: 'POST' });
export const ownerMind = (token, { refresh = false } = {}) => request(token, `/api/owner/mind${refresh ? '?refresh=1' : ''}`);

const recordsQuery = ({ view, visitor, mind, asset, offset, limit, format } = {}) => {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries({ view, visitor, mind, asset, offset, limit, format })) {
    if (value != null && value !== '') query.set(name, String(value));
  }
  return `/api/owner/records?${query}`;
};
export const ownerRecords = (token, params) => request(token, recordsQuery(params));
/** The same view as CSV — every matching row up to the server's cap — as a Blob to save. */
export const ownerRecordsCsv = async (token, params) => {
  const res = await fetch(recordsQuery({ ...params, format: 'csv', offset: 0, limit: 5000 }), { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 401) clearOwnerSession();
  if (!res.ok) throw new Error(`records export failed: ${res.status}`);
  return res.blob();
};
