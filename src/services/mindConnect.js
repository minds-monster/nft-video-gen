// Connect Mind — per-visitor connect flow + session-gated chat, talking to
// worker/connect.js and worker/mind-chat.js. Replaces the Test 2 stand-in
// (services/mindTest.js) and the original static-key mind.js.

const SESSION_KEY = 'mindSession';

export const getStoredSession = () => {
  try {
    // localStorage, not sessionStorage: the token is HMAC-signed and valid for 7 days
    // (worker/connect.js), so a connection should survive a closed tab the way the visitor's
    // guestId already does. A session minted before this change is promoted once.
    const raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.token || !session.expiresAt || session.expiresAt < Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    if (!localStorage.getItem(SESSION_KEY)) storeSession(session);
    return session;
  } catch {
    return null;
  }
};

export const storeSession = (session) => {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

export const clearSession = () => {
  localStorage.removeItem(SESSION_KEY);
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

// `state` is the production snapshot from src/lib/productionState.js, and it rides in on
// init rather than on a later call for one reason: the Worker composes the Producer
// briefing during THIS request. A snapshot that arrives afterwards is a snapshot the
// greeting never saw, and the greeting is the thing it exists for.
export const mindChatInit = async (token, state) => {
  const res = await fetch('/api/mind/init', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ state }),
  });
  if (!res.ok) return { error: `init failed: ${res.status}` };
  return res.json();
};

// `subject` may be blank on a new message — the Worker generates one from the body and
// tags it `Subject-Source: auto` so the Mind knows the visitor didn't write it. A reply
// always carries its thread's subject and sets `isReply`, which is what puts the RE: on it.
export const mindChatSend = async (token, messageText, { subject = '', isReply = false } = {}) => {
  const res = await fetch('/api/mind/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ messageText, subject, isReply }),
  });
  if (!res.ok) throw new Error(`send failed: ${res.status}`);
  return res.json();
};

/** Keep the Worker's copy of the production snapshot fresh after the initial briefing. */
export const putProductionState = async (token, state) => {
  const res = await fetch('/api/producer/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ state }),
  });
  if (!res.ok) throw new Error(`state failed: ${res.status}`);
  return res.json();
};

export const mindChatPoll = async (token, after) => {
  const query = after ? `?after=${encodeURIComponent(after)}` : '';
  const res = await fetch(`/api/mind/poll${query}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
};

// Either money field may be omitted (null) — a visitor can give a total, a per-render cap,
// or both, per Adam's own read: "different instructions... both useful."
//
// `paidTier` is a THIRD, independent input, not a third amount: it selects which model writes the
// storyboard. A budget is a spending cap and never a model selector — see worker/tier.js's header
// for why conflating the two is the mistake this shape exists to prevent.
export const setProducerBudget = async (token, { total, perRender, paidTier }) => {
  const res = await fetch('/api/producer/budget', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ total, perRender, paidTier }),
  });
  if (!res.ok) throw new Error(`budget failed: ${res.status}`);
  return res.json();
};
