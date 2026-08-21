// Connect Mind — per-visitor connect flow + session-gated chat, talking to
// worker/connect.js and worker/mind-chat.js. Replaces the Test 2 stand-in
// (services/mindTest.js) and the original static-key mind.js.

const SESSION_KEY = 'mindSession';

export const getStoredSession = () => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.token || !session.expiresAt || session.expiresAt < Date.now()) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
};

export const storeSession = (session) => {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

export const clearSession = () => {
  sessionStorage.removeItem(SESSION_KEY);
};

export const connectInit = async (mindId) => {
  const res = await fetch('/api/connect/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mindId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `connect/init failed: ${res.status}`);
  return data;
};

export const connectStatus = async (connectionId) => {
  const res = await fetch(`/api/connect/status?connectionId=${encodeURIComponent(connectionId)}`);
  if (!res.ok) throw new Error(`connect/status failed: ${res.status}`);
  return res.json();
};

export const mindChatInit = async (token) => {
  const res = await fetch('/api/mind/init', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { error: `init failed: ${res.status}` };
  return res.json();
};

export const mindChatSend = async (token, messageText) => {
  const res = await fetch('/api/mind/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ messageText }),
  });
  if (!res.ok) throw new Error(`send failed: ${res.status}`);
  return res.json();
};

export const mindChatPoll = async (token, after) => {
  const query = after ? `?after=${encodeURIComponent(after)}` : '';
  const res = await fetch(`/api/mind/poll${query}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
};
