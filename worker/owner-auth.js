// The website owner's login. One passphrase in a secret, one HMAC-signed token of `kind:
// 'owner'` (worker/session.js), twelve hours. No accounts, no roles — there is one owner.
//
// The rate limit lives in KV rather than a module Map because a login is the route where a
// limit that forgets itself on every cold start matters most.

import { signSession, requireKind, SESSION_KINDS } from './session.js';
import { rateLimited, clientIp } from './rate-limit.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export const OWNER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const encoder = new TextEncoder();

/** Same length, same bytes, in time that does not depend on where they differ. */
export function constantTimeEqual(a, b) {
  const left = encoder.encode(String(a ?? ''));
  const right = encoder.encode(String(b ?? ''));
  // Comparing against itself when lengths differ keeps the loop length independent of the
  // secret; the result is forced false afterwards.
  const target = left.length === right.length ? right : left;
  let diff = left.length === right.length ? 0 : 1;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ target[i];
  return diff === 0;
}

export const isOwnerConfigured = (env) => typeof env.OWNER_PASSPHRASE === 'string' && env.OWNER_PASSPHRASE.length >= 12;

/** POST /api/owner/login { passphrase } */
export async function handleOwnerLogin(request, env) {
  if (!isOwnerConfigured(env)) return json({ error: 'not_configured' }, 500);
  if (await rateLimited(env, 'owner-login', clientIp(request), { limit: 5, windowSec: 60 })) {
    return json({ error: 'rate_limited' }, 429);
  }
  const body = await request.json().catch(() => ({}));
  if (!constantTimeEqual(body.passphrase, env.OWNER_PASSPHRASE)) return json({ error: 'unauthorized' }, 401);

  const expiresAt = Date.now() + OWNER_SESSION_TTL_MS;
  const token = await signSession(env, { kind: SESSION_KINDS.owner, owner: true, iat: Date.now(), exp: expiresAt });
  return json({ token, expiresAt });
}

/** The gate every owner route sits behind. Asserts the OWNER kind — a visitor token is refused. */
export const requireOwner = (request, env) => requireKind(request, env, SESSION_KINDS.owner);
