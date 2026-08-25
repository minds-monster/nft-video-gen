// Stateless, HMAC-signed Connect Mind session tokens. No DB/KV row for the session
// itself — the token carries its own payload and expiry, verified with a Worker secret
// (SESSION_SIGNING_SECRET) that never reaches the client.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const base64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const base64urlDecode = (str) => {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

let cachedKey = null;
let cachedSecret = null;

async function getKey(env) {
  if (!env.SESSION_SIGNING_SECRET) throw new Error('SESSION_SIGNING_SECRET not configured');
  if (cachedKey && cachedSecret === env.SESSION_SIGNING_SECRET) return cachedKey;
  cachedKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.SESSION_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  cachedSecret = env.SESSION_SIGNING_SECRET;
  return cachedKey;
}

export async function signSession(env, payload) {
  const key = await getKey(env);
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

// Returns the payload if the token's signature is valid and it hasn't expired,
// otherwise null — callers treat null as "unauthenticated," never distinguishing why.
export async function verifySession(env, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  try {
    const key = await getKey(env);
    const valid = await crypto.subtle.verify('HMAC', key, base64urlDecode(signature), encoder.encode(body));
    if (!valid) return null;

    const payload = JSON.parse(decoder.decode(base64urlDecode(body)));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * The bearer-token half of the same concern: pull a session off a request, or null.
 *
 * Lives here rather than in worker/mind-chat.js — where it used to — because
 * worker/producer-state.js needs it too, and importing it from mind-chat.js created a
 * genuine import cycle (mind-chat → producer-briefing → producer-state → mind-chat).
 * mind-chat.js re-exports it so every existing caller keeps working unchanged.
 */
export async function requireSession(request, env) {
  const auth = request.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  return verifySession(env, token);
}
