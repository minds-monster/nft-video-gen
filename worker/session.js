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
 * Every token this Worker mints is signed with the SAME secret, so the signature alone says
 * "we issued this" and nothing about WHAT it authorises. The `kind` claim is what does.
 *
 *   mind          — a visitor's Connect Mind session; carries `mindId`. The default when the
 *                   claim is absent, because every 7-day token issued before kinds existed has
 *                   no `kind` and must keep working until it expires.
 *   owner         — the website owner, minted by worker/owner-auth.js. Carries no mindId.
 *   support-reply — a visitor's signed reply link on one support ticket (worker/support.js).
 *
 * All 28 visitor handlers do `if (!session) return 401` and then use `session.mindId`, so
 * a gate that only checked the signature would hand an owner token to `setBudget(env,
 * undefined)`. Each gate below asserts its own kind; a valid signature is never enough.
 */
export const SESSION_KINDS = Object.freeze({ mind: 'mind', owner: 'owner', supportReply: 'support-reply' });

export const bearerToken = (request) => {
  const auth = request.headers.get('authorization');
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
};

/** Verify a bearer token and insist on one `kind`. Null on any mismatch, never a reason. */
export async function requireKind(request, env, kind) {
  const token = bearerToken(request);
  if (!token) return null;
  const payload = await verifySession(env, token);
  if (!payload) return null;
  if ((payload.kind ?? SESSION_KINDS.mind) !== kind) return null;
  return payload;
}

/**
 * The bearer-token half of the same concern: pull a VISITOR session off a request, or null.
 *
 * Lives here rather than in worker/mind-chat.js — where it used to — because
 * worker/producer-state.js needs it too, and importing it from mind-chat.js created a
 * genuine import cycle (mind-chat → producer-briefing → producer-state → mind-chat).
 * mind-chat.js re-exports it so every existing caller keeps working unchanged.
 */
export async function requireSession(request, env) {
  const payload = await requireKind(request, env, SESSION_KINDS.mind);
  if (!payload) return null;
  // A mind session without a mindId is not a session — it is the exact shape every visitor
  // handler would otherwise write `budget:undefined` with.
  if (typeof payload.mindId !== 'string' || !payload.mindId) return null;
  return payload;
}
